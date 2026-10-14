// -----------------------------------------------------------------------------
// Gladys devices built from the identified SMA devices.
//
// One Gladys device per SMA device, keyed by its serial number (never by its
// IP address, which DHCP can change). Its features depend on what the device
// carries: solar production for the PV inverters, battery for the storage and
// hybrid inverters, grid exchange when an SMA Energy Meter or Sunny Home
// Manager feeds the inverter.
//
// Feature keys are forever: Gladys keys the history, the scenes and the
// dashboards on them. Add new ones, never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'sma';

const always = () => true;
const production = (profile) => profile.hasProduction;
const battery = (profile) => profile.hasBattery;
const grid = (profile) => profile.hasGrid;

// `value` is the key of the snapshot read by src/sma.js.
export const FEATURES = [
  {
    key: 'production-power',
    value: 'power',
    when: production,
    name: 'Solar production',
    category: CATEGORIES.ENERGY_PRODUCTION_SENSOR,
    type: TYPES.ENERGY_PRODUCTION_SENSOR.POWER,
    unit: UNITS.WATT,
    min: 0,
    max: (profile) => profile.nominalPower ?? 100000,
  },
  {
    key: 'daily-production',
    value: 'dailyEnergy',
    when: production,
    name: 'Production today',
    category: CATEGORIES.ENERGY_PRODUCTION_SENSOR,
    type: TYPES.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 10000,
  },
  {
    key: 'production-index',
    value: 'totalEnergy',
    when: production,
    name: 'Total production',
    category: CATEGORIES.ENERGY_PRODUCTION_SENSOR,
    type: TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000000,
  },
  {
    key: 'battery-level',
    value: 'batteryLevel',
    when: battery,
    name: 'Battery level',
    category: CATEGORIES.BATTERY_STORAGE,
    type: TYPES.BATTERY_STORAGE.BATTERY_LEVEL,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
  },
  {
    key: 'battery-charge-power',
    value: 'chargePower',
    when: battery,
    name: 'Battery charge power',
    category: CATEGORIES.BATTERY_STORAGE,
    type: TYPES.BATTERY_STORAGE.CHARGE_POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 100000,
  },
  {
    key: 'battery-discharge-power',
    value: 'dischargePower',
    when: battery,
    name: 'Battery discharge power',
    category: CATEGORIES.BATTERY_STORAGE,
    type: TYPES.BATTERY_STORAGE.DISCHARGE_POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 100000,
  },
  {
    key: 'battery-charge-index',
    value: 'chargeIndex',
    when: battery,
    name: 'Battery energy charged',
    category: CATEGORIES.BATTERY_STORAGE,
    type: TYPES.BATTERY_STORAGE.CHARGE_INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000000,
  },
  {
    key: 'battery-discharge-index',
    value: 'dischargeIndex',
    when: battery,
    name: 'Battery energy discharged',
    category: CATEGORIES.BATTERY_STORAGE,
    type: TYPES.BATTERY_STORAGE.DISCHARGE_INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000000,
  },
  {
    key: 'grid-import-power',
    value: 'gridImportPower',
    when: grid,
    name: 'Power drawn from the grid',
    category: CATEGORIES.GRID_SENSOR,
    type: TYPES.GRID_SENSOR.INPUT_POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 100000,
  },
  {
    key: 'grid-export-power',
    value: 'gridExportPower',
    when: grid,
    name: 'Power fed into the grid',
    category: CATEGORIES.GRID_SENSOR,
    type: TYPES.GRID_SENSOR.OUTPUT_POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 100000,
  },
  {
    key: 'grid-import-index',
    value: 'gridImportIndex',
    when: grid,
    name: 'Energy drawn from the grid',
    category: CATEGORIES.GRID_SENSOR,
    type: TYPES.GRID_SENSOR.INPUT_INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000000,
  },
  {
    key: 'grid-export-index',
    value: 'gridExportIndex',
    when: grid,
    name: 'Energy fed into the grid',
    category: CATEGORIES.GRID_SENSOR,
    type: TYPES.GRID_SENSOR.OUTPUT_INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000000,
  },
  {
    key: 'ac-voltage',
    value: 'voltage',
    when: always,
    name: 'AC voltage',
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.VOLTAGE,
    unit: UNITS.VOLT,
    min: 0,
    max: 500,
  },
  {
    key: 'ac-current',
    value: 'current',
    when: always,
    name: 'AC current',
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.CURRENT,
    unit: UNITS.AMPERE,
    min: 0,
    max: 200,
  },
  {
    // The inverter's own temperature: a probe, kept out of the room average.
    key: 'temperature',
    value: 'temperature',
    when: always,
    name: 'Inverter temperature',
    category: CATEGORIES.TEMPERATURE_SENSOR,
    type: TYPES.TEMPERATURE_SENSOR.PROBE,
    unit: UNITS.CELSIUS,
    min: -40,
    max: 120,
  },
];

export function deviceIds(gladys, profile) {
  return gladys.externalIds(DEVICE_TYPE, profile.serial);
}

export function deviceName(profile) {
  if (!profile.hasProduction) {
    return `SMA battery inverter ${profile.serial}`;
  }
  return profile.hasBattery
    ? `SMA hybrid inverter ${profile.serial}`
    : `SMA inverter ${profile.serial}`;
}

export function featuresOf(profile) {
  return FEATURES.filter((feature) => feature.when(profile));
}

/**
 * Find the external id of a feature of a device, `null` when the device does
 * not carry it.
 */
export function featureExternalId(gladys, profile, key) {
  return featuresOf(profile).some((feature) => feature.key === key)
    ? deviceIds(gladys, profile).feature(key)
    : null;
}

/**
 * The discovery payload of one SMA device.
 */
export function buildDevice(gladys, profile) {
  const ids = deviceIds(gladys, profile);
  return {
    name: deviceName(profile),
    external_id: ids.device,
    features: featuresOf(profile).map((feature) => ({
      name: feature.name,
      external_id: ids.feature(feature.key),
      category: feature.category,
      type: feature.type,
      unit: feature.unit,
      min: feature.min,
      max: typeof feature.max === 'function' ? feature.max(profile) : feature.max,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    })),
  };
}

/**
 * The states of one reading, ready for publishChangedStates. Values the
 * device could not fill (`null`) are left out: Gladys keeps the last one.
 */
export function buildStates(gladys, profile, snapshot) {
  const ids = deviceIds(gladys, profile);
  return featuresOf(profile)
    .filter((feature) => typeof snapshot[feature.value] === 'number')
    .map((feature) => ({
      device_feature_external_id: ids.feature(feature.key),
      state: snapshot[feature.value],
    }));
}
