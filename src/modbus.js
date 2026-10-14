// -----------------------------------------------------------------------------
// Minimal Modbus TCP client (read side), on top of node:net.
//
// SMA devices expose their values through the SMA Modbus profile: 16-bit
// registers read with the "Read Input Registers" function (0x04). That is the
// only function this integration needs, so it ships its own ~150 lines
// instead of a dependency: the Docker image stays small, the attack surface
// too, and the framing is fully covered by the tests (test/modbus.test.js).
//
// One client = one TCP session to one device (host + unit id). Requests are
// sent one at a time: SMA devices handle a few sessions and answer in order.
// -----------------------------------------------------------------------------

import net from 'node:net';

const MBAP_HEADER_LENGTH = 7;
const PROTOCOL_ID = 0;
export const FUNCTION_READ_INPUT_REGISTERS = 0x04;
// A single read holds at most 125 registers (Modbus specification).
const MAX_REGISTERS_PER_READ = 125;

const EXCEPTION_MESSAGES = {
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'server device failure',
  5: 'acknowledge',
  6: 'server device busy',
  10: 'gateway path unavailable',
  11: 'gateway target device failed to respond',
};

/**
 * The device answered with a Modbus exception: it is reachable, but refused
 * this request (e.g. a register it does not implement).
 */
export class ModbusExceptionError extends Error {
  constructor(code) {
    super(`Modbus exception ${code} (${EXCEPTION_MESSAGES[code] ?? 'unknown'})`);
    this.name = 'ModbusExceptionError';
    this.code = code;
  }
}

/**
 * Encode a request frame (MBAP header + PDU).
 */
export function encodeReadRequest({ transactionId, unitId, functionCode, address, quantity }) {
  const frame = Buffer.alloc(12);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(PROTOCOL_ID, 2);
  frame.writeUInt16BE(6, 4); // unit id + PDU (function, address, quantity)
  frame.writeUInt8(unitId, 6);
  frame.writeUInt8(functionCode, 7);
  frame.writeUInt16BE(address, 8);
  frame.writeUInt16BE(quantity, 10);
  return frame;
}

/**
 * Decode the first frame of a buffer.
 * @returns {null | { length: number, transactionId: number, unitId: number,
 *   functionCode: number, exception?: number, data?: Buffer }}
 *   `null` while the frame is incomplete; `length` is the number of bytes it
 *   used, to slice it off the stream.
 */
export function decodeFrame(buffer) {
  if (buffer.length < MBAP_HEADER_LENGTH + 1) {
    return null;
  }
  const declared = buffer.readUInt16BE(4);
  if (declared < 2 || declared > 254) {
    throw new Error(`Invalid Modbus frame length ${declared}`);
  }
  const length = 6 + declared;
  if (buffer.length < length) {
    return null;
  }
  const transactionId = buffer.readUInt16BE(0);
  const unitId = buffer.readUInt8(6);
  const functionCode = buffer.readUInt8(7);
  if (functionCode & 0x80) {
    return {
      length,
      transactionId,
      unitId,
      functionCode: functionCode & 0x7f,
      exception: buffer.readUInt8(8),
    };
  }
  const byteCount = buffer.readUInt8(8);
  if (9 + byteCount > length) {
    throw new Error('Invalid Modbus frame: byte count exceeds the frame');
  }
  return { length, transactionId, unitId, functionCode, data: buffer.subarray(9, 9 + byteCount) };
}

export class ModbusTcpClient {
  /**
   * @param {{ host: string, port?: number, unitId?: number, timeout?: number,
   *   createConnection?: typeof net.createConnection }} options
   *   `createConnection` is injectable so the tests can plug a simulated
   *   device instead of a real socket.
   */
  constructor({ host, port = 502, unitId = 3, timeout = 5000, createConnection }) {
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.timeout = timeout;
    this.createConnection = createConnection ?? net.createConnection;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.transactionId = 0;
    this.pending = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = this.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection to ${this.host}:${this.port} timed out`));
      }, this.timeout);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.on('data', (chunk) => this.onData(chunk));
      socket.on('error', (err) => this.failPending(err));
      socket.on('close', () => {
        this.socket = null;
        this.failPending(new Error(`Connection to ${this.host}:${this.port} closed`));
      });
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      for (;;) {
        const frame = decodeFrame(this.buffer);
        if (frame === null) {
          return;
        }
        this.buffer = this.buffer.subarray(frame.length);
        this.settle(frame);
      }
    } catch (err) {
      // A corrupted stream cannot be resynchronized: drop the session.
      this.failPending(err);
      this.close();
    }
  }

  settle(frame) {
    const pending = this.pending;
    // A late answer to a request that already timed out: ignore it.
    if (!pending || frame.transactionId !== pending.transactionId) {
      return;
    }
    this.pending = null;
    clearTimeout(pending.timer);
    if (frame.exception !== undefined) {
      pending.reject(new ModbusExceptionError(frame.exception));
    } else if (frame.data.length !== pending.quantity * 2) {
      pending.reject(new Error('Unexpected Modbus answer length'));
    } else {
      pending.resolve(frame.data);
    }
  }

  failPending(err) {
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.reject(err);
    }
  }

  /**
   * Read `quantity` input registers starting at `address`.
   * @returns {Promise<Buffer>} the raw register bytes (big-endian words)
   */
  readInputRegisters(address, quantity) {
    if (!this.socket) {
      return Promise.reject(new Error('Modbus client is not connected'));
    }
    if (this.pending) {
      return Promise.reject(new Error('A Modbus request is already in progress'));
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_REGISTERS_PER_READ) {
      return Promise.reject(new RangeError(`Invalid register quantity ${quantity}`));
    }
    this.transactionId = (this.transactionId + 1) % 0x10000;
    const transactionId = this.transactionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.transactionId === transactionId) {
          this.pending = null;
          reject(new Error(`Modbus request to ${this.host} timed out`));
        }
      }, this.timeout);
      this.pending = { transactionId, quantity, resolve, reject, timer };
      this.socket.write(
        encodeReadRequest({
          transactionId,
          unitId: this.unitId,
          functionCode: FUNCTION_READ_INPUT_REGISTERS,
          address,
          quantity,
        }),
      );
    });
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
