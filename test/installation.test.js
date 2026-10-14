import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { Installation } from '../src/installation.js';
import { buildDevice } from '../src/devices.js';
import {
  BATTERY_INVERTER,
  createFakeSmaDevice,
  fakeNetwork,
  HYBRID_INVERTER,
  memoryStorage,
  SOLAR_INVERTER,
} from './helpers/fakeSma.js';

const HOSTS = { solar: '192.168.1.50', hybrid: '192.168.1.51', battery: '192.168.1.52' };

async function setup({ hosts = Object.values(HOSTS), storage = memoryStorage(), created } = {}) {
  const devices = {
    [HOSTS.solar]: createFakeSmaDevice(SOLAR_INVERTER),
    [HOSTS.hybrid]: createFakeSmaDevice(HYBRID_INVERTER),
    [HOSTS.battery]: createFakeSmaDevice(BATTERY_INVERTER),
  };
  const gladys = createFakeGladys();
  let changes = 0;
  const installation = new Installation({
    gladys,
    storage,
    connect: fakeNetwork(devices),
    onChange: () => {
      changes += 1;
    },
  });
  await installation.configure(normalizeConfig({ hosts: hosts.join(', ') }));
  await installation.discover();
  // Gladys holds the devices the user created from the Discovery tab.
  gladys.fake.devices = (created ?? installation.discoveredDevices()).map((device) => ({
    ...device,
    selector: device.external_id,
  }));
  await installation.refreshCreatedDevices();
  return { gladys, installation, devices, storage, changes: () => changes };
}

const statesOf = (gladys) =>
  Object.fromEntries(
    gladys.fake.states.map((s) => [s.device_feature_external_id.split(':').pop(), s.state]),
  );

test('discovery publishes one Gladys device per SMA device, accepted by Gladys', async () => {
  const { gladys, installation } = await setup();
  await installation.publishDiscoveredDevices();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    [
      'SMA inverter 3001234567',
      'SMA hybrid inverter 3009876543',
      'SMA battery inverter 3015550001',
    ],
  );
});

test('the features follow what each device carries', async () => {
  const { installation } = await setup();
  const keys = installation
    .discoveredDevices()
    .map((device) => device.features.map((feature) => feature.external_id.split(':').pop()));
  assert.deepEqual(keys[0], [
    'production-power',
    'daily-production',
    'production-index',
    'ac-voltage',
    'ac-current',
    'temperature',
  ]);
  assert.ok(keys[1].includes('battery-level') && keys[1].includes('grid-export-power'));
  assert.ok(!keys[2].includes('production-power') && keys[2].includes('battery-level'));
});

test('the production power is bounded by the nominal power of the inverter', async () => {
  const { gladys, installation } = await setup();
  const profile = installation.devices()[0].profile;
  const power = buildDevice(gladys, profile).features[0];
  assert.equal(power.max, 5000);
});

test('a reading cycle publishes the states of the created devices', async () => {
  const { gladys, installation, changes } = await setup({ hosts: [HOSTS.hybrid] });
  await installation.pollAll();
  const states = statesOf(gladys);
  assert.equal(states['production-power'], 3250);
  assert.equal(states['daily-production'], 12.345);
  assert.equal(states['battery-level'], 76);
  assert.equal(states['grid-export-power'], 1800);
  assert.deepEqual(gladys.fake.transports, [
    { device_external_id: installation.discoveredDevices()[0].external_id, transport: 'local' },
  ]);
  assert.equal(changes(), 1, 'the widgets are nudged after the cycle');
});

test('only the values that changed are published again', async () => {
  const { gladys, installation, devices } = await setup({ hosts: [HOSTS.solar] });
  await installation.pollAll();
  const first = gladys.fake.states.length;
  devices[HOSTS.solar].values.AC_POWER = 3400;
  await installation.pollAll();
  assert.deepEqual(
    gladys.fake.states
      .slice(first)
      .map((s) => [s.device_feature_external_id.split(':').pop(), s.state]),
    [['production-power', 3400]],
  );
});

test('devices not created in Gladys get no states', async () => {
  const { gladys, installation } = await setup({ created: [] });
  await installation.pollAll();
  assert.deepEqual(gladys.fake.states, []);
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('an inverter going to sleep publishes 0 W, the unreachable badge and scene events', async () => {
  const { gladys, installation, devices } = await setup({ hosts: [HOSTS.solar] });
  await installation.pollAll();
  devices[HOSTS.solar].online = false;
  await installation.pollAll();
  assert.equal(gladys.fake.states.at(-1).state, 0);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    ['production_stopped', 'condition_changed'],
  );
  assert.equal(gladys.fake.sceneEvents[0].data.daily_energy, 12.345);
});

test('the morning start fires production_started', async () => {
  const { gladys, installation, devices } = await setup({ hosts: [HOSTS.solar] });
  devices[HOSTS.solar].values.AC_POWER = null;
  await installation.pollAll();
  devices[HOSTS.solar].values.AC_POWER = 120;
  await installation.pollAll();
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, 'production_started');
  assert.equal(event.data.power, 120);
});

test('a device asleep at startup keeps the profile identified earlier', async () => {
  const first = await setup({ hosts: [HOSTS.solar] });
  const storage = first.storage;
  assert.ok(storage.saved['192.168.1.50:502/3'], 'the profile is stored');

  const gladys = createFakeGladys();
  const asleep = createFakeSmaDevice(SOLAR_INVERTER);
  asleep.online = false;
  const installation = new Installation({
    gladys,
    storage,
    connect: fakeNetwork({ [HOSTS.solar]: asleep }),
  });
  await installation.configure(normalizeConfig({ hosts: HOSTS.solar }));
  const [result] = await installation.discover();
  assert.match(result.error, /EHOSTUNREACH/);
  assert.equal(installation.discoveredDevices().length, 1, 'still offered in Discovery');
});

test('a device configured at night is identified when it wakes up', async () => {
  const gladys = createFakeGladys();
  const device = createFakeSmaDevice(SOLAR_INVERTER);
  device.online = false;
  const installation = new Installation({
    gladys,
    storage: memoryStorage(),
    connect: fakeNetwork({ [HOSTS.solar]: device }),
  });
  await installation.configure(normalizeConfig({ hosts: HOSTS.solar }));
  await installation.discover();
  await installation.pollAll();
  assert.equal(installation.discoveredDevices().length, 0);
  device.online = true;
  await installation.pollAll();
  assert.equal(gladys.fake.discoveredDevices.length, 1, 'published on wake-up');
});

test('the connection status says when no device answers, and when one does again', async () => {
  const { gladys, installation, devices } = await setup({ hosts: [HOSTS.solar] });
  devices[HOSTS.solar].online = false;
  await installation.pollAll();
  devices[HOSTS.solar].online = true;
  await installation.pollAll();
  await installation.pollAll();
  const statuses = gladys.fake.connectionStatuses;
  // Sent on each change only, not after every cycle.
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].connected, false);
  assert.match(statuses[0].message.en, /No SMA device answers/);
  assert.equal(statuses[1].connected, true);
});

test('the connection status asks for an address when none is configured', async () => {
  const { installation } = await setup({ hosts: [] });
  const state = installation.connectionState();
  assert.equal(state.connected, false);
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.ok(state.message[language], `message in ${language}`);
  }
});

test('the totals add the devices up', async () => {
  const { installation } = await setup();
  await installation.pollAll();
  const totals = installation.totals();
  assert.equal(totals.power, 6500);
  assert.equal(totals.dailyEnergy, 24.69);
  assert.equal(totals.batteryLevel, 66);
  assert.equal(totals.gridExportPower, 1800);
  assert.equal(totals.reachable, 3);
});

test('overlapping reading cycles share one run', async () => {
  const { installation, devices } = await setup({ hosts: [HOSTS.solar] });
  const before = devices[HOSTS.solar].requests.length;
  await Promise.all([installation.pollAll(), installation.pollAll()]);
  const perCycle = devices[HOSTS.solar].requests.length - before;
  await installation.pollAll();
  assert.equal(devices[HOSTS.solar].requests.length - before, perCycle * 2);
});
