import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { Installation } from '../src/installation.js';
import {
  createWidgets,
  formatAge,
  formatPower,
  refreshWidgets,
  WIDGET_KEYS,
} from '../src/widgets.js';
import {
  BATTERY_INVERTER,
  createFakeSmaDevice,
  fakeNetwork,
  HYBRID_INVERTER,
  memoryStorage,
  SOLAR_INVERTER,
} from './helpers/fakeSma.js';

async function setup(hosts = ['192.168.1.50', '192.168.1.51', '192.168.1.52']) {
  const devices = {
    '192.168.1.50': createFakeSmaDevice(SOLAR_INVERTER),
    '192.168.1.51': createFakeSmaDevice(HYBRID_INVERTER),
    '192.168.1.52': createFakeSmaDevice(BATTERY_INVERTER),
  };
  const gladys = createFakeGladys();
  const installation = new Installation({
    gladys,
    storage: memoryStorage(),
    connect: fakeNetwork(devices),
  });
  await installation.configure(normalizeConfig({ hosts: hosts.join(',') }));
  await installation.discover();
  gladys.fake.devices = installation.discoveredDevices();
  await installation.refreshCreatedDevices();
  await installation.pollAll();
  const ids = installation.discoveredDevices().map((device) => device.external_id);
  return { gladys, installation, devices, ids, widgets: createWidgets(installation) };
}

const request = (settings = {}) => ({ settings, language: 'en', units: 'metric' });
const featureIds = (installation) =>
  new Set(
    installation
      .discoveredDevices()
      .flatMap((device) => device.features.map((feature) => feature.external_id)),
  );

test('the solar_overview content is rendered exactly as sent', async () => {
  const { gladys, widgets } = await setup();
  const content = await widgets[WIDGET_KEYS.SOLAR_OVERVIEW].get(gladys, request());
  assert.deepEqual(validateWidgetContent(content), []);
  const types = content.components.map((component) => component.type);
  assert.deepEqual(types, [
    'value',
    'value',
    'value',
    'value',
    'gauge',
    'chart',
    'status',
    'button',
  ]);
  assert.deepEqual(content.components[0], {
    type: 'value',
    label: { en: 'Production', fr: 'Production', de: 'Erzeugung', es: 'Producción' },
    icon: 'sun',
    value: 6.5,
    unit: 'kW',
  });
});

test('the solar_overview chart is bound to production features', async () => {
  const { gladys, installation, widgets } = await setup();
  const content = await widgets[WIDGET_KEYS.SOLAR_OVERVIEW].get(gladys, request());
  const chart = content.components.find((component) => component.type === 'chart');
  const known = featureIds(installation);
  assert.equal(chart.device_features.length, 2);
  for (const id of chart.device_features) {
    assert.ok(known.has(id) && id.endsWith(':production-power'));
  }
});

test('solar_overview of a single PV inverter keeps to what it has', async () => {
  const { gladys, widgets } = await setup(['192.168.1.50']);
  const content = await widgets[WIDGET_KEYS.SOLAR_OVERVIEW].get(gladys, request());
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    content.components.map((component) => component.type),
    ['value', 'value', 'chart', 'status', 'button'],
  );
});

test('solar_overview without any device explains what to do', async () => {
  const { gladys, widgets } = await setup([]);
  const content = await widgets[WIDGET_KEYS.SOLAR_OVERVIEW].get(gladys, request());
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');
});

test('sma_device shows live tiles bound to the features of the chosen device', async () => {
  const { gladys, installation, widgets, ids } = await setup();
  const known = featureIds(installation);
  for (const id of ids) {
    const content = await widgets[WIDGET_KEYS.SMA_DEVICE].get(gladys, request({ device: id }));
    assert.deepEqual(validateWidgetContent(content), []);
    const bound = content.components.filter((component) => component.device_feature);
    assert.ok(bound.length > 0);
    for (const tile of bound) {
      assert.ok(known.has(tile.device_feature), `unknown feature ${tile.device_feature}`);
      assert.ok(tile.device_feature.startsWith(id));
    }
  }
});

test('sma_device shows an unreachable device', async () => {
  const { gladys, installation, devices, widgets, ids } = await setup(['192.168.1.50']);
  devices['192.168.1.50'].online = false;
  await installation.pollAll();
  const content = await widgets[WIDGET_KEYS.SMA_DEVICE].get(gladys, request({ device: ids[0] }));
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items[0].value.en, 'Unreachable');
});

test('sma_device for a device no longer configured says so', async () => {
  const { gladys, widgets } = await setup();
  const content = await widgets[WIDGET_KEYS.SMA_DEVICE].get(
    gladys,
    request({ device: 'ext:x:sma:1' }),
  );
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');
});

test('every button action is handled and answers a short toast in every language', async () => {
  const { gladys, widgets, ids } = await setup();
  for (const [key, settings] of [
    [WIDGET_KEYS.SOLAR_OVERVIEW, {}],
    [WIDGET_KEYS.SMA_DEVICE, { device: ids[0] }],
  ]) {
    const content = await widgets[key].get(gladys, request(settings));
    for (const { action } of content.components.filter((c) => c.type === 'button')) {
      const toast = await widgets[key].action(gladys, {
        actionKey: action.key,
        params: action.params ?? {},
        settings,
      });
      for (const language of ['en', 'fr', 'de', 'es']) {
        assert.ok(toast[language].length > 0 && toast[language].length <= 200);
      }
    }
  }
});

test('an unknown widget action fails, so the user sees the error', async () => {
  const { gladys, widgets } = await setup();
  await assert.rejects(
    widgets[WIDGET_KEYS.SOLAR_OVERVIEW].action(gladys, { actionKey: 'nope', params: {} }),
    /Unknown widget action/,
  );
});

test('formatPower switches to kW above 1000 W', () => {
  assert.deepEqual(formatPower(850.4), { value: 850, unit: 'W' });
  assert.deepEqual(formatPower(3456), { value: 3.46, unit: 'kW' });
  assert.deepEqual(formatPower(null), { value: '–', unit: 'W' });
});

test('formatAge reads in every language', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  assert.equal(formatAge(new Date('2026-06-01T11:55:00Z'), now).de, 'Vor 5 Min.');
  assert.equal(formatAge(new Date('2026-06-01T09:00:00Z'), now).es, 'Hace 3 h');
  assert.equal(formatAge(null, now).fr, 'Jamais');
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.values(WIDGET_KEYS));
});
