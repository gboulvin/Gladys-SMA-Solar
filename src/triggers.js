// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`, Gladys 5.1+).
//
// The values themselves (power, battery level...) are device features: the
// standard "device state" trigger of Gladys already covers thresholds on them.
// These triggers carry what a single state cannot: a TRANSITION of the
// installation, with its details.
//
//   - production_started : the inverter starts producing (morning);
//   - production_stopped : it stops (evening), with the energy of the day;
//   - condition_changed  : its operating condition changes (ok, warning,
//     fault, off) or it stops answering (unreachable).
//
// One event per transition, never one per reading: the core admits 300
// events per minute per integration. The detection is a pure function of the
// previous and the current tracking state, tested in test/triggers.test.js.
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  PRODUCTION_STARTED: 'production_started',
  PRODUCTION_STOPPED: 'production_stopped',
  CONDITION_CHANGED: 'condition_changed',
};

export const TRIGGER_KEYS = Object.values(TRIGGERS);

// Production stops below half the start threshold: a cloud passing over the
// panels at dawn must not fire started / stopped / started...
const STOP_RATIO = 0.5;

/**
 * Compute the events of a new reading.
 *
 * @param {{ producing?: boolean, condition?: string }} previous tracking
 *   state of the device (empty before its first reading)
 * @param {{ reachable: boolean, condition: string, power: number | null,
 *   dailyEnergy: number | null }} reading
 * @param {{ device: string, deviceName: string, hasProduction: boolean,
 *   threshold: number }} context
 * @returns {{ tracking: { producing?: boolean, condition: string },
 *   events: Array<{ key: string, data: Record<string, unknown> }> }}
 */
export function detectEvents(previous, reading, { device, deviceName, hasProduction, threshold }) {
  const events = [];
  const condition = reading.reachable ? reading.condition : 'unreachable';
  const tracking = { condition };

  if (hasProduction) {
    const power = reading.reachable ? (reading.power ?? 0) : 0;
    if (previous.producing === undefined) {
      // First reading since the start: the state, without an event.
      tracking.producing = power >= threshold;
    } else if (!previous.producing && power >= threshold) {
      tracking.producing = true;
      events.push({
        key: TRIGGERS.PRODUCTION_STARTED,
        data: { device, device_name: deviceName, power },
      });
    } else if (previous.producing && power < threshold * STOP_RATIO) {
      tracking.producing = false;
      events.push({
        key: TRIGGERS.PRODUCTION_STOPPED,
        data: {
          device,
          device_name: deviceName,
          daily_energy: reading.dailyEnergy ?? previous.dailyEnergy ?? 0,
        },
      });
    } else {
      tracking.producing = previous.producing;
    }
    // Remembered for the evening: an inverter that falls asleep at sunset
    // stops answering before its last daily total can be read.
    tracking.dailyEnergy = reading.dailyEnergy ?? previous.dailyEnergy;
  }

  if (previous.condition !== undefined && previous.condition !== condition) {
    events.push({
      key: TRIGGERS.CONDITION_CHANGED,
      data: {
        device,
        device_name: deviceName,
        condition,
        previous_condition: previous.condition,
      },
    });
  }

  return { tracking, events };
}
