import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFrame,
  encodeReadRequest,
  ModbusExceptionError,
  ModbusTcpClient,
} from '../src/modbus.js';
import { createFakeSmaDevice, SOLAR_INVERTER } from './helpers/fakeSma.js';

test('encodeReadRequest builds the MBAP header and the PDU', () => {
  const frame = encodeReadRequest({
    transactionId: 0x1234,
    unitId: 3,
    functionCode: 4,
    address: 30775,
    quantity: 2,
  });
  assert.deepEqual(
    [...frame],
    [0x12, 0x34, 0, 0, 0, 6, 3, 4, 0x78, 0x37, 0, 2], // 30775 = 0x7837
  );
});

test('decodeFrame waits for a complete frame', () => {
  const frame = Buffer.from([0, 1, 0, 0, 0, 7, 3, 4, 4, 0, 0, 0x0c, 0xb2]);
  assert.equal(decodeFrame(frame.subarray(0, 5)), null);
  assert.equal(decodeFrame(frame.subarray(0, 12)), null);
  const decoded = decodeFrame(frame);
  assert.equal(decoded.length, 13);
  assert.equal(decoded.transactionId, 1);
  assert.equal(decoded.data.readUInt32BE(0), 3250);
});

test('decodeFrame reads an exception answer', () => {
  const decoded = decodeFrame(Buffer.from([0, 1, 0, 0, 0, 3, 3, 0x84, 2]));
  assert.equal(decoded.functionCode, 4);
  assert.equal(decoded.exception, 2);
});

test('decodeFrame refuses an invalid length', () => {
  assert.throws(() => decodeFrame(Buffer.from([0, 1, 0, 0, 0xff, 0xff, 3, 4, 0])), /length/);
});

test('the client reads registers from an SMA device', async () => {
  const device = createFakeSmaDevice(SOLAR_INVERTER);
  const client = device.client();
  await client.connect();
  try {
    const bytes = await client.readInputRegisters(30775, 2);
    assert.equal(bytes.readInt32BE(0), 3250);
    assert.deepEqual(device.requests[0], {
      unitId: 3,
      functionCode: 4,
      address: 30775,
      quantity: 2,
    });
  } finally {
    client.close();
  }
});

test('the client reassembles an answer split across TCP chunks', async () => {
  const device = createFakeSmaDevice(SOLAR_INVERTER);
  device.transform = (frame) => [frame.subarray(0, 3), frame.subarray(3, 9), frame.subarray(9)];
  const client = device.client();
  await client.connect();
  try {
    const bytes = await client.readInputRegisters(30775, 2);
    assert.equal(bytes.readInt32BE(0), 3250);
  } finally {
    client.close();
  }
});

test('an unimplemented register is a Modbus exception', async () => {
  const device = createFakeSmaDevice(SOLAR_INVERTER);
  const client = device.client();
  await client.connect();
  try {
    await assert.rejects(client.readInputRegisters(40000, 2), ModbusExceptionError);
    // The session stays usable after an exception.
    assert.equal((await client.readInputRegisters(30775, 2)).readInt32BE(0), 3250);
  } finally {
    client.close();
  }
});

test('a device that never answers times out', async () => {
  const device = createFakeSmaDevice(SOLAR_INVERTER);
  device.transform = () => [];
  const client = device.client({ timeout: 20 });
  await client.connect();
  try {
    await assert.rejects(client.readInputRegisters(30775, 2), /timed out/);
  } finally {
    client.close();
  }
});

test('an unreachable device fails the connection', async () => {
  const device = createFakeSmaDevice(SOLAR_INVERTER);
  device.online = false;
  await assert.rejects(device.client().connect(), /EHOSTUNREACH/);
});

test('a read on a closed client is refused', async () => {
  const client = new ModbusTcpClient({ host: '192.168.1.50' });
  await assert.rejects(client.readInputRegisters(30775, 2), /not connected/);
});

test('an invalid quantity is refused before anything is sent', async () => {
  const device = createFakeSmaDevice(SOLAR_INVERTER);
  const client = device.client();
  await client.connect();
  try {
    await assert.rejects(client.readInputRegisters(30775, 0), RangeError);
    await assert.rejects(client.readInputRegisters(30775, 126), RangeError);
    assert.equal(device.requests.length, 0);
  } finally {
    client.close();
  }
});
