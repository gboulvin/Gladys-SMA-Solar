// -----------------------------------------------------------------------------
// A simulated SMA device for the tests: it answers real Modbus TCP frames from
// a register map, through an in-memory socket (no network involved).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import process from 'node:process';
import { ModbusTcpClient } from '../../src/modbus.js';
import { REGISTERS } from '../../src/sma.js';

// The SDK logger re-reads LOG_LEVEL on every call: keep the test output for
// the errors (`LOG_LEVEL=debug npm test` shows everything).
process.env.LOG_LEVEL ??= 'error';

/** Registers as raw words, built from friendly values. */
export function registerMap(values) {
  const words = new Map();
  const put = (address, buffer) => {
    for (let i = 0; i < buffer.length / 2; i += 1) {
      words.set(address + i, buffer.readUInt16BE(i * 2));
    }
  };
  for (const [name, value] of Object.entries(values)) {
    const { address, format, fix = 0 } = REGISTERS[name];
    const raw = value === null ? null : Math.round(value * 10 ** fix);
    if (format === 'U64') {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64BE(raw === null ? 0xffffffffffffffffn : BigInt(raw));
      put(address, buffer);
    } else {
      const buffer = Buffer.alloc(4);
      if (format === 'S32') {
        buffer.writeInt32BE(raw === null ? -0x80000000 : raw);
      } else {
        buffer.writeUInt32BE(raw === null ? 0xffffffff : raw);
      }
      put(address, buffer);
    }
  }
  return words;
}

export const SOLAR_INVERTER = {
  SERIAL_NUMBER: 3001234567,
  DEVICE_CLASS: 8001,
  DEVICE_TYPE: 9301,
  NOMINAL_POWER: 5000,
  CONDITION: 307,
  AC_POWER: 3250,
  DAY_YIELD_U64: 12345,
  TOTAL_YIELD_U64: 15678900,
  AC_VOLTAGE: 231.45,
  AC_CURRENT: 14.123,
  GRID_FREQUENCY: 50.01,
  INTERNAL_TEMPERATURE: 41.5,
  BATTERY_LEVEL: null,
};

export const HYBRID_INVERTER = {
  ...SOLAR_INVERTER,
  SERIAL_NUMBER: 3009876543,
  BATTERY_LEVEL: 76,
  BATTERY_CHARGE_POWER: 1200,
  BATTERY_DISCHARGE_POWER: 0,
  BATTERY_CHARGE_INDEX: 2500000,
  BATTERY_DISCHARGE_INDEX: 2100000,
  GRID_IMPORT_POWER: 0,
  GRID_EXPORT_POWER: 1800,
  GRID_IMPORT_INDEX: 4200000,
  GRID_EXPORT_INDEX: 9100000,
};

export const BATTERY_INVERTER = {
  SERIAL_NUMBER: 3015550001,
  DEVICE_CLASS: 8007,
  DEVICE_TYPE: 9324,
  CONDITION: 307,
  AC_POWER: -800,
  AC_VOLTAGE: 230,
  AC_CURRENT: 3.5,
  INTERNAL_TEMPERATURE: 30,
  BATTERY_LEVEL: 55,
  BATTERY_CHARGE_POWER: 800,
  BATTERY_DISCHARGE_POWER: 0,
  BATTERY_CHARGE_INDEX: 100000,
  BATTERY_DISCHARGE_INDEX: 90000,
};

/**
 * An in-memory SMA device. `device.values` can be changed between readings,
 * `device.online = false` makes the connection fail (inverter asleep).
 */
export function createFakeSmaDevice(values) {
  const device = {
    values: { ...values },
    online: true,
    requests: [],
    // Corrupt or delay the answers in the framing tests.
    transform: (frame) => [frame],
  };

  device.answer = (request) => {
    const transactionId = request.readUInt16BE(0);
    const unitId = request.readUInt8(6);
    const functionCode = request.readUInt8(7);
    const address = request.readUInt16BE(8);
    const quantity = request.readUInt16BE(10);
    device.requests.push({ unitId, functionCode, address, quantity });
    const words = registerMap(device.values);
    const header = (length) => {
      const buffer = Buffer.alloc(7);
      buffer.writeUInt16BE(transactionId, 0);
      buffer.writeUInt16BE(0, 2);
      buffer.writeUInt16BE(length, 4);
      buffer.writeUInt8(unitId, 6);
      return buffer;
    };
    const exception = (code) =>
      Buffer.concat([header(3), Buffer.from([functionCode | 0x80, code])]);
    if (functionCode !== 0x04) {
      return exception(1);
    }
    const data = Buffer.alloc(quantity * 2);
    for (let i = 0; i < quantity; i += 1) {
      if (!words.has(address + i)) {
        return exception(2);
      }
      data.writeUInt16BE(words.get(address + i), i * 2);
    }
    return Buffer.concat([header(3 + data.length), Buffer.from([functionCode, data.length]), data]);
  };

  device.createConnection = () => {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.write = (request) => {
      for (const chunk of device.transform(device.answer(request))) {
        setImmediate(() => !socket.destroyed && socket.emit('data', chunk));
      }
      return true;
    };
    socket.destroy = () => {
      if (!socket.destroyed) {
        socket.destroyed = true;
        setImmediate(() => socket.emit('close'));
      }
    };
    setImmediate(() => {
      if (device.online) {
        socket.emit('connect');
      } else {
        const err = new Error('connect EHOSTUNREACH');
        err.code = 'EHOSTUNREACH';
        socket.emit('error', err);
      }
    });
    return socket;
  };

  device.client = (options = {}) =>
    new ModbusTcpClient({
      host: '192.168.1.50',
      timeout: 200,
      createConnection: device.createConnection,
      ...options,
    });

  return device;
}

/** A `connect` for Installation: one fake device per host. */
export function fakeNetwork(devicesByHost) {
  return (target) => {
    const device = devicesByHost[target.host];
    if (!device) {
      const offline = createFakeSmaDevice({});
      offline.online = false;
      return offline.client({ host: target.host });
    }
    return device.client({ host: target.host, unitId: target.unitId });
  };
}

/** An in-memory storage for Installation. */
export function memoryStorage(initial = {}) {
  const storage = {
    saved: structuredClone(initial),
    async load() {
      return structuredClone(storage.saved);
    },
    async save(profiles) {
      storage.saved = structuredClone(profiles);
    },
  };
  return storage;
}
