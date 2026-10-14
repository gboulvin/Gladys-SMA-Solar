import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { Installation } from '../src/installation.js';
import { createActions, describeDiscovery } from '../src/actions.js';
import { createStorage } from '../src/storage.js';
import {
  createFakeSmaDevice,
  fakeNetwork,
  memoryStorage,
  SOLAR_INVERTER,
} from './helpers/fakeSma.js';

test('test_connection lists what answered, in every language, and publishes the devices', async () => {
  const gladys = createFakeGladys();
  const installation = new Installation({
    gladys,
    storage: memoryStorage(),
    connect: fakeNetwork({ '192.168.1.50': createFakeSmaDevice(SOLAR_INVERTER) }),
  });
  await installation.configure(
    normalizeConfig({ hosts: '192.168.1.50, 192.168.1.99, http://bad' }),
  );
  const message = await createActions(installation).test_connection();
  assert.match(message.en, /^1 of 2 SMA device\(s\) answered\./);
  assert.match(message.en, /✓ 192\.168\.1\.50:502\/3: SMA inverter 3001234567/);
  assert.match(message.en, /✗ 192\.168\.1\.99:502\/3: connect EHOSTUNREACH/);
  assert.match(message.fr, /1 appareil\(s\) SMA sur 2 ont répondu/);
  assert.match(message.fr, /✓ 192\.168\.1\.50:502\/3: SMA inverter/);
  assert.match(message.de, /adresse/i);
  assert.match(message.es, /dirección no válida/);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('describeDiscovery asks for an address when nothing is configured', () => {
  const message = describeDiscovery([], []);
  assert.match(message.en, /No SMA device configured/);
  assert.match(message.es, /Ningún dispositivo SMA/);
});

test('the storage keeps the profiles across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sma-'));
  try {
    const storage = createStorage(directory);
    assert.deepEqual(await storage.load(), {});
    await storage.save({ 'a:502/3': { serial: '1' } });
    assert.deepEqual(await createStorage(directory).load(), { 'a:502/3': { serial: '1' } });
    const raw = JSON.parse(await readFile(join(directory, 'sma-devices.json'), 'utf8'));
    assert.equal(raw.version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
