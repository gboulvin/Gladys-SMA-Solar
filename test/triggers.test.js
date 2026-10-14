import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEvents, TRIGGERS } from '../src/triggers.js';

const context = {
  device: 'ext:sma-solar:sma:3001234567',
  deviceName: 'SMA inverter 3001234567',
  hasProduction: true,
  threshold: 50,
};
const reading = (power, extra = {}) => ({
  reachable: true,
  condition: 'ok',
  power,
  dailyEnergy: 1.5,
  ...extra,
});

// Feed readings one after the other, collect the events.
function run(readings, ctx = context) {
  let tracking = {};
  const events = [];
  for (const r of readings) {
    const result = detectEvents(tracking, r, ctx);
    tracking = result.tracking;
    events.push(...result.events);
  }
  return events;
}

test('the first reading sets the state without firing anything', () => {
  assert.deepEqual(run([reading(3000)]), []);
});

test('production_started fires once when the power crosses the threshold', () => {
  const events = run([reading(0), reading(20), reading(60), reading(500), reading(800)]);
  assert.deepEqual(events, [
    {
      key: TRIGGERS.PRODUCTION_STARTED,
      data: { device: context.device, device_name: context.deviceName, power: 60 },
    },
  ]);
});

test('production_stopped waits for half the threshold and carries the daily energy', () => {
  const events = run([
    reading(500),
    reading(40), // below the threshold, above half of it: still producing
    reading(10, { dailyEnergy: 21.4 }),
  ]);
  assert.deepEqual(events, [
    {
      key: TRIGGERS.PRODUCTION_STOPPED,
      data: { device: context.device, device_name: context.deviceName, daily_energy: 21.4 },
    },
  ]);
});

test('an inverter falling asleep stops the production with the last known daily energy', () => {
  const events = run([
    reading(500, { dailyEnergy: 18.2 }),
    { reachable: false, condition: 'unknown', power: 0, dailyEnergy: null },
  ]);
  assert.deepEqual(
    events.map((event) => [event.key, event.data.daily_energy ?? event.data.condition]),
    [
      [TRIGGERS.PRODUCTION_STOPPED, 18.2],
      [TRIGGERS.CONDITION_CHANGED, 'unreachable'],
    ],
  );
});

test('condition_changed carries the new and the previous condition', () => {
  const events = run([reading(500), reading(500, { condition: 'fault' })]);
  assert.deepEqual(events, [
    {
      key: TRIGGERS.CONDITION_CHANGED,
      data: {
        device: context.device,
        device_name: context.deviceName,
        condition: 'fault',
        previous_condition: 'ok',
      },
    },
  ]);
});

test('a battery inverter never fires production events', () => {
  const events = run([reading(null), reading(null)], { ...context, hasProduction: false });
  assert.deepEqual(events, []);
});
