import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRegister, identifyDevice, readSnapshot } from '../src/sma.js';
import {
  BATTERY_INVERTER,
  createFakeSmaDevice,
  HYBRID_INVERTER,
  SOLAR_INVERTER,
} from './helpers/fakeSma.js';

async function withClient(values, work) {
  const device = createFakeSmaDevice(values);
  const client = device.client();
  await client.connect();
  try {
    return await work(client, device);
  } finally {
    client.close();
  }
}

const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
const s32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
};

test('decodeRegister applies the FIX scale', () => {
  assert.equal(decodeRegister(u32(23145), { format: 'U32', fix: 2 }), 231.45);
  assert.equal(decodeRegister(s32(-415), { format: 'S32', fix: 1 }), -41.5);
});

test('decodeRegister reads the NaN of every format as null', () => {
  assert.equal(decodeRegister(u32(0xffffffff), { format: 'U32' }), null);
  assert.equal(decodeRegister(u32(0x00fffffd), { format: 'U32' }), null);
  assert.equal(decodeRegister(s32(-0x80000000), { format: 'S32' }), null);
  assert.equal(decodeRegister(Buffer.alloc(8, 0xff), { format: 'U64' }), null);
});

test('identifyDevice describes a solar inverter', async () => {
  const profile = await withClient(SOLAR_INVERTER, identifyDevice);
  assert.deepEqual(profile, {
    serial: '3001234567',
    deviceClass: 8001,
    deviceType: 9301,
    nominalPower: 5000,
    hasProduction: true,
    hasBattery: false,
    hasGrid: false,
  });
});

test('identifyDevice detects the battery and the energy meter of a hybrid inverter', async () => {
  const profile = await withClient(HYBRID_INVERTER, identifyDevice);
  assert.equal(profile.hasProduction, true);
  assert.equal(profile.hasBattery, true);
  assert.equal(profile.hasGrid, true);
});

test('identifyDevice does not count a battery inverter as production', async () => {
  const profile = await withClient(BATTERY_INVERTER, identifyDevice);
  assert.equal(profile.hasProduction, false);
  assert.equal(profile.hasBattery, true);
});

test('identifyDevice refuses a device without an SMA serial number', async () => {
  await assert.rejects(withClient({ DEVICE_CLASS: 8001 }, identifyDevice), /No SMA serial number/);
});

test('readSnapshot converts the values to Gladys units', async () => {
  const snapshot = await withClient(HYBRID_INVERTER, async (client) =>
    readSnapshot(client, await identifyDevice(client)),
  );
  assert.deepEqual(snapshot, {
    condition: 'ok',
    power: 3250,
    dailyEnergy: 12.345,
    totalEnergy: 15678.9,
    voltage: 231.45,
    current: 14.123,
    frequency: 50.01,
    temperature: 41.5,
    batteryLevel: 76,
    chargePower: 1200,
    dischargePower: 0,
    chargeIndex: 2500,
    dischargeIndex: 2100,
    gridImportPower: 0,
    gridExportPower: 1800,
    gridImportIndex: 4200,
    gridExportIndex: 9100,
  });
});

test('readSnapshot reads a NaN power at night as no production', async () => {
  const snapshot = await withClient(
    { ...SOLAR_INVERTER, AC_POWER: null, CONDITION: 303 },
    async (client) => readSnapshot(client, await identifyDevice(client)),
  );
  assert.equal(snapshot.power, 0);
  assert.equal(snapshot.condition, 'off');
});

test('readSnapshot falls back to the U32 yield registers of older inverters', async () => {
  const { DAY_YIELD_U64: _day, TOTAL_YIELD_U64: _total, ...older } = SOLAR_INVERTER;
  const snapshot = await withClient(
    { ...older, DAY_YIELD_U32: 8000, TOTAL_YIELD_U32: 2000000 },
    async (client) => readSnapshot(client, await identifyDevice(client)),
  );
  assert.equal(snapshot.dailyEnergy, 8);
  assert.equal(snapshot.totalEnergy, 2000);
});

test('readSnapshot leaves the production of a battery inverter out', async () => {
  const snapshot = await withClient(BATTERY_INVERTER, async (client) =>
    readSnapshot(client, await identifyDevice(client)),
  );
  assert.equal(snapshot.power, null);
  assert.equal(snapshot.dailyEnergy, null);
  assert.equal(snapshot.batteryLevel, 55);
});

test('readSnapshot reads an unknown condition code as unknown', async () => {
  const snapshot = await withClient({ ...SOLAR_INVERTER, CONDITION: 1234 }, async (client) =>
    readSnapshot(client, await identifyDevice(client)),
  );
  assert.equal(snapshot.condition, 'unknown');
});
