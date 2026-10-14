// -----------------------------------------------------------------------------
// SMA Modbus profile: the registers this integration reads, how to decode
// them, and how to identify a device.
//
// Register numbers are those of the SMA Modbus documentation (Sunny Boy,
// Sunny Tripower, Sunny Boy Storage, Sunny Island...), read with the function
// 0x04 at the address of the same number. Values are big-endian words:
//   - U32 / S32 take 2 registers, U64 takes 4;
//   - FIXn means "divide by 10^n";
//   - each format has its own "not available" value (NaN): a device returns
//     it for a register it implements but cannot fill right now (no sun, no
//     battery), and a Modbus exception for a register it does not implement.
//     Both read as `null` here.
// -----------------------------------------------------------------------------

import { ModbusExceptionError } from './modbus.js';

const NAN = {
  U32: [0xffffffff, 0x00fffffd], // the second one is the NaN of ENUM registers
  S32: [-0x80000000],
};
const NAN_U64 = 0xffffffffffffffffn;

const REGISTER_LENGTH = { U32: 2, S32: 2, U64: 4 };

// Device classes (register 30051).
export const DEVICE_CLASSES = {
  SOLAR_INVERTER: 8001,
  WIND_INVERTER: 8002,
  BATTERY_INVERTER: 8007,
  HYBRID_INVERTER: 8009,
};

// Operating condition (register 30201).
const CONDITIONS = { 35: 'fault', 303: 'off', 307: 'ok', 455: 'warning' };

export const REGISTERS = {
  DEVICE_CLASS: { address: 30051, format: 'U32' },
  DEVICE_TYPE: { address: 30053, format: 'U32' },
  SERIAL_NUMBER: { address: 30057, format: 'U32' },
  CONDITION: { address: 30201, format: 'U32' },
  NOMINAL_POWER: { address: 30231, format: 'U32' }, // W
  TOTAL_YIELD_U64: { address: 30513, format: 'U64' }, // Wh
  DAY_YIELD_U64: { address: 30517, format: 'U64' }, // Wh
  TOTAL_YIELD_U32: { address: 30529, format: 'U32' }, // Wh, older devices
  DAY_YIELD_U32: { address: 30535, format: 'U32' }, // Wh, older devices
  GRID_IMPORT_INDEX: { address: 30581, format: 'U32' }, // Wh, with an energy meter
  GRID_EXPORT_INDEX: { address: 30583, format: 'U32' }, // Wh, with an energy meter
  AC_POWER: { address: 30775, format: 'S32' }, // W
  AC_VOLTAGE: { address: 30783, format: 'U32', fix: 2 }, // V, phase L1
  AC_CURRENT: { address: 30795, format: 'U32', fix: 3 }, // A
  GRID_FREQUENCY: { address: 30803, format: 'U32', fix: 2 }, // Hz
  BATTERY_LEVEL: { address: 30845, format: 'U32' }, // %
  GRID_IMPORT_POWER: { address: 30865, format: 'S32' }, // W, with an energy meter
  GRID_EXPORT_POWER: { address: 30867, format: 'S32' }, // W, with an energy meter
  INTERNAL_TEMPERATURE: { address: 30953, format: 'S32', fix: 1 }, // °C
  BATTERY_CHARGE_POWER: { address: 31393, format: 'U32' }, // W
  BATTERY_DISCHARGE_POWER: { address: 31395, format: 'U32' }, // W
  BATTERY_CHARGE_INDEX: { address: 31397, format: 'U64' }, // Wh
  BATTERY_DISCHARGE_INDEX: { address: 31401, format: 'U64' }, // Wh
};

/**
 * Decode the raw bytes of a register.
 * @returns {number | null} `null` for the NaN value of the format
 */
export function decodeRegister(bytes, { format, fix = 0 }) {
  let value;
  if (format === 'U64') {
    const big = bytes.readBigUInt64BE(0);
    if (big === NAN_U64) {
      return null;
    }
    value = Number(big);
  } else {
    value = format === 'S32' ? bytes.readInt32BE(0) : bytes.readUInt32BE(0);
    if (NAN[format].includes(value)) {
      return null;
    }
  }
  return fix === 0 ? value : value / 10 ** fix;
}

/**
 * Read one register. A register the device does not implement (Modbus
 * exception) reads as `null`; a transport error (timeout, closed session)
 * is thrown, the device is then unreachable.
 */
export async function readRegister(client, register) {
  try {
    const bytes = await client.readInputRegisters(
      register.address,
      REGISTER_LENGTH[register.format],
    );
    return decodeRegister(bytes, register);
  } catch (err) {
    if (err instanceof ModbusExceptionError) {
      return null;
    }
    throw err;
  }
}

async function readFirst(client, ...registers) {
  for (const register of registers) {
    const value = await readRegister(client, register);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

const round = (value, decimals) =>
  value === null ? null : Math.round(value * 10 ** decimals) / 10 ** decimals;
const toKwh = (wh) => round(wh === null ? null : wh / 1000, 3);

/**
 * Identify the device behind a Modbus session: serial number, class, and the
 * optional measurements it carries (battery, grid exchange through an SMA
 * Energy Meter / Sunny Home Manager). The profile is what the device
 * catalog (src/devices.js) builds the Gladys device from.
 */
export async function identifyDevice(client) {
  const serial = await readRegister(client, REGISTERS.SERIAL_NUMBER);
  if (serial === null || serial === 0) {
    throw new Error('No SMA serial number at this address (is it an SMA device?)');
  }
  const deviceClass = await readRegister(client, REGISTERS.DEVICE_CLASS);
  const deviceType = await readRegister(client, REGISTERS.DEVICE_TYPE);
  const nominalPower = await readRegister(client, REGISTERS.NOMINAL_POWER);
  const batteryLevel = await readRegister(client, REGISTERS.BATTERY_LEVEL);
  const gridImport = await readRegister(client, REGISTERS.GRID_IMPORT_POWER);
  const gridImportIndex = await readRegister(client, REGISTERS.GRID_IMPORT_INDEX);
  return {
    serial: String(serial),
    deviceClass,
    deviceType,
    nominalPower: nominalPower > 0 ? nominalPower : null,
    // A battery inverter (Sunny Boy Storage, Sunny Island) moves energy in
    // and out of its battery: its AC power is not a solar production.
    hasProduction: deviceClass !== DEVICE_CLASSES.BATTERY_INVERTER,
    hasBattery: batteryLevel !== null,
    hasGrid: gridImport !== null || gridImportIndex !== null,
  };
}

/**
 * Read the current values of an identified device.
 */
export async function readSnapshot(client, profile) {
  const conditionCode = await readRegister(client, REGISTERS.CONDITION);
  const acPower = await readRegister(client, REGISTERS.AC_POWER);
  const snapshot = {
    condition: CONDITIONS[conditionCode] ?? 'unknown',
    // At night the inverter reports NaN rather than 0: nothing is produced.
    power: profile.hasProduction ? Math.max(0, acPower ?? 0) : null,
    dailyEnergy: null,
    totalEnergy: null,
    voltage: await readRegister(client, REGISTERS.AC_VOLTAGE),
    current: await readRegister(client, REGISTERS.AC_CURRENT),
    frequency: await readRegister(client, REGISTERS.GRID_FREQUENCY),
    temperature: await readRegister(client, REGISTERS.INTERNAL_TEMPERATURE),
    batteryLevel: null,
    chargePower: null,
    dischargePower: null,
    chargeIndex: null,
    dischargeIndex: null,
    gridImportPower: null,
    gridExportPower: null,
    gridImportIndex: null,
    gridExportIndex: null,
  };
  if (profile.hasProduction) {
    snapshot.dailyEnergy = toKwh(
      await readFirst(client, REGISTERS.DAY_YIELD_U64, REGISTERS.DAY_YIELD_U32),
    );
    snapshot.totalEnergy = toKwh(
      await readFirst(client, REGISTERS.TOTAL_YIELD_U64, REGISTERS.TOTAL_YIELD_U32),
    );
  }
  if (profile.hasBattery) {
    snapshot.batteryLevel = await readRegister(client, REGISTERS.BATTERY_LEVEL);
    snapshot.chargePower = await readRegister(client, REGISTERS.BATTERY_CHARGE_POWER);
    snapshot.dischargePower = await readRegister(client, REGISTERS.BATTERY_DISCHARGE_POWER);
    snapshot.chargeIndex = toKwh(await readRegister(client, REGISTERS.BATTERY_CHARGE_INDEX));
    snapshot.dischargeIndex = toKwh(await readRegister(client, REGISTERS.BATTERY_DISCHARGE_INDEX));
  }
  if (profile.hasGrid) {
    snapshot.gridImportPower = Math.max(
      0,
      (await readRegister(client, REGISTERS.GRID_IMPORT_POWER)) ?? 0,
    );
    snapshot.gridExportPower = Math.max(
      0,
      (await readRegister(client, REGISTERS.GRID_EXPORT_POWER)) ?? 0,
    );
    snapshot.gridImportIndex = toKwh(await readRegister(client, REGISTERS.GRID_IMPORT_INDEX));
    snapshot.gridExportIndex = toKwh(await readRegister(client, REGISTERS.GRID_EXPORT_INDEX));
  }
  return snapshot;
}
