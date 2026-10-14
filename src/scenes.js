// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// A scene action is an operation a scene author places in a scene: here, read
// an SMA device (or the whole installation) NOW and hand the values to the
// following actions of the scene as outputs — "at 10 pm, if the battery is
// above 80 %, start the water heater", "send me today's production".
//
// The rules that matter:
//   - `fields` arrive RESOLVED: a `"source": "devices"` field is the chosen
//     device external_id;
//   - only the declared `outputs` (scalars) reach the scene: test/scenes.test.js
//     checks every returned key against the manifest;
//   - a device that does not answer is an OUTPUT (`reachable: false`), not a
//     failure: a scene action is never a condition, the scene author gates on
//     the output.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTION_KEYS = {
  READ_DEVICE: 'read_device',
  READ_INSTALLATION: 'read_installation',
};

// Drop the outputs the device cannot provide: an undeclared or `null` value
// would read as an empty variable in the scene anyway.
function definedOnly(outputs) {
  return Object.fromEntries(
    Object.entries(outputs).filter(([, value]) => value !== null && value !== undefined),
  );
}

/**
 * @param {import('./installation.js').Installation} installation
 */
export function createSceneActions(installation) {
  return {
    async [SCENE_ACTION_KEYS.READ_DEVICE](_gladys, { fields }) {
      logger.info(`Scene action read_device <- ${fields.device}`);
      const entry = installation.findByExternalId(fields.device);
      if (!entry) {
        // The device was removed from the configuration: the scene author
        // still gets a usable answer.
        return { reachable: false, condition: 'unknown' };
      }
      await installation.readNow(entry);
      const snapshot = entry.reachable ? entry.snapshot : null;
      return definedOnly({
        reachable: entry.reachable === true,
        condition: entry.reachable ? snapshot.condition : 'unreachable',
        power: entry.profile.hasProduction ? (snapshot?.power ?? 0) : null,
        daily_energy: snapshot?.dailyEnergy,
        battery_level: snapshot?.batteryLevel,
        grid_import_power: snapshot?.gridImportPower,
        grid_export_power: snapshot?.gridExportPower,
      });
    },

    async [SCENE_ACTION_KEYS.READ_INSTALLATION]() {
      logger.info('Scene action read_installation');
      await installation.pollAll();
      const totals = installation.totals();
      return definedOnly({
        power: totals.power,
        daily_energy: totals.dailyEnergy,
        battery_level: totals.batteryLevel,
        grid_import_power: totals.gridImportPower,
        grid_export_power: totals.gridExportPower,
        reachable_devices: totals.reachable,
      });
    },
  };
}
