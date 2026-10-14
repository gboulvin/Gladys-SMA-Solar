import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { Installation } from '../src/installation.js';
import { createSceneActions } from '../src/scenes.js';
import {
  createFakeSmaDevice,
  fakeNetwork,
  HYBRID_INVERTER,
  memoryStorage,
  SOLAR_INVERTER,
} from './helpers/fakeSma.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

async function setup() {
  const devices = {
    '192.168.1.50': createFakeSmaDevice(SOLAR_INVERTER),
    '192.168.1.51': createFakeSmaDevice(HYBRID_INVERTER),
  };
  const gladys = createFakeGladys();
  const installation = new Installation({
    gladys,
    storage: memoryStorage(),
    connect: fakeNetwork(devices),
  });
  await installation.configure(normalizeConfig({ hosts: Object.keys(devices).join(',') }));
  await installation.discover();
  gladys.fake.devices = installation.discoveredDevices();
  await installation.refreshCreatedDevices();
  const ids = installation.discoveredDevices().map((device) => device.external_id);
  return { gladys, installation, devices, ids, actions: createSceneActions(installation) };
}

function assertDeclaredOutputs(key, outputs) {
  const declaration = declarationOf('scene_actions', key);
  const declared = new Map(declaration.outputs.map((output) => [output.key, output.type]));
  for (const [name, value] of Object.entries(outputs)) {
    assert.ok(declared.has(name), `output "${name}" is not declared, the core would drop it`);
    assert.equal(typeof value, declared.get(name), `output "${name}" type`);
  }
}

test('read_device returns the current values of the chosen device', async () => {
  const { gladys, actions, ids } = await setup();
  const outputs = await actions.read_device(gladys, { fields: { device: ids[1] } });
  assert.deepEqual(outputs, {
    reachable: true,
    condition: 'ok',
    power: 3250,
    daily_energy: 12.345,
    battery_level: 76,
    grid_import_power: 0,
    grid_export_power: 1800,
  });
  assertDeclaredOutputs('read_device', outputs);
});

test('read_device reports an unreachable device through its outputs', async () => {
  const { gladys, actions, ids, devices } = await setup();
  devices['192.168.1.50'].online = false;
  const outputs = await actions.read_device(gladys, { fields: { device: ids[0] } });
  assert.deepEqual(outputs, { reachable: false, condition: 'unreachable', power: 0 });
  assertDeclaredOutputs('read_device', outputs);
});

test('read_device answers for a device no longer configured', async () => {
  const { gladys, actions } = await setup();
  const outputs = await actions.read_device(gladys, { fields: { device: 'ext:x:sma:1' } });
  assert.equal(outputs.reachable, false);
  assertDeclaredOutputs('read_device', outputs);
});

test('read_installation returns the totals', async () => {
  const { gladys, actions } = await setup();
  const outputs = await actions.read_installation(gladys, { fields: {} });
  assert.deepEqual(outputs, {
    power: 6500,
    daily_energy: 24.69,
    battery_level: 76,
    grid_import_power: 0,
    grid_export_power: 1800,
    reachable_devices: 2,
  });
  assertDeclaredOutputs('read_installation', outputs);
});

test('scene events only carry keys their trigger declares', async () => {
  const { gladys, installation, devices } = await setup();
  await installation.pollAll();
  devices['192.168.1.50'].values.CONDITION = 455;
  devices['192.168.1.51'].online = false;
  await installation.pollAll();
  devices['192.168.1.51'].online = true;
  devices['192.168.1.51'].values.AC_POWER = 0;
  await installation.pollAll();
  devices['192.168.1.51'].values.AC_POWER = 900;
  await installation.pollAll();

  const fired = new Set(gladys.fake.sceneEvents.map((event) => event.key));
  assert.deepEqual([...fired].sort(), keysOf(manifest.scene_triggers).sort(), 'all fired');
  for (const { key, data } of gladys.fake.sceneEvents) {
    const trigger = declarationOf('scene_triggers', key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [name, value] of Object.entries(data)) {
      assert.ok(declared.includes(name), `${key}: data.${name} is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${name} primitive`);
    }
    const filter = trigger.fields.find((field) => field.key === 'condition');
    if (filter) {
      assert.ok(filter.options.some((option) => option.value === data.condition));
    }
  }
});
