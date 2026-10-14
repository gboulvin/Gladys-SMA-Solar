import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseTargets } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig coerces numeric strings coming from a form', () => {
  const config = normalizeConfig({ port: '1502', unit_id: '4', poll_frequency: '60' });
  assert.equal(config.port, 1502);
  assert.equal(config.unit_id, 4);
  assert.equal(config.poll_frequency, 60);
});

test('normalizeConfig falls back to the defaults for empty or invalid numbers', () => {
  const config = normalizeConfig({ port: '', unit_id: 'abc', production_threshold: null });
  assert.equal(config.port, DEFAULT_CONFIG.port);
  assert.equal(config.unit_id, DEFAULT_CONFIG.unit_id);
  assert.equal(config.production_threshold, DEFAULT_CONFIG.production_threshold);
});

test('normalizeConfig keeps the refresh interval within its bounds', () => {
  assert.equal(normalizeConfig({ poll_frequency: 1 }).poll_frequency, 10);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
});

test('parseTargets applies the default port and unit id', () => {
  const { targets, invalid } = parseTargets(normalizeConfig({ hosts: '192.168.1.50' }));
  assert.deepEqual(targets, [
    { key: '192.168.1.50:502/3', host: '192.168.1.50', port: 502, unitId: 3 },
  ]);
  assert.deepEqual(invalid, []);
});

test('parseTargets reads the port and unit id overrides of each entry', () => {
  const { targets } = parseTargets(
    normalizeConfig({ hosts: '192.168.1.50:1502, datamanager.lan/4; [fe80::1]:502/5' }),
  );
  assert.deepEqual(
    targets.map(({ host, port, unitId }) => [host, port, unitId]),
    [
      ['192.168.1.50', 1502, 3],
      ['datamanager.lan', 502, 4],
      ['fe80::1', 502, 5],
    ],
  );
});

test('parseTargets reports invalid entries and drops duplicates', () => {
  const { targets, invalid } = parseTargets(
    normalizeConfig({ hosts: '192.168.1.50, 192.168.1.50:502/3, http://x, 10.0.0.1/300' }),
  );
  assert.equal(targets.length, 1);
  assert.deepEqual(invalid, ['http://x', '10.0.0.1/300']);
});

test('parseTargets accepts an empty field', () => {
  assert.deepEqual(parseTargets(normalizeConfig({ hosts: '  ' })), { targets: [], invalid: [] });
});
