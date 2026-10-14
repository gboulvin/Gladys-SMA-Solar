// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or numbers typed as strings.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  // Comma-separated SMA devices, `host[:port][/unit_id]` (see parseTargets).
  hosts: '',
  // Modbus TCP port and unit id used when a host does not override them. SMA
  // devices answer on 502 with the unit id 3 out of the box.
  port: 502,
  unit_id: 3,
  // Seconds between two reads of every device.
  poll_frequency: 30,
  // Production power (W) above which an inverter is "producing" (scene
  // triggers production_started / production_stopped).
  production_threshold: 50,
};

export const MIN_POLL_FREQUENCY = 10;
export const MAX_POLL_FREQUENCY = 3600;

function toNumber(value, fallback, { min, max }) {
  const number = Number(value);
  if (value === null || value === '' || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    hosts: typeof raw.hosts === 'string' ? raw.hosts.trim() : DEFAULT_CONFIG.hosts,
    port: Math.round(toNumber(raw.port, DEFAULT_CONFIG.port, { min: 1, max: 65535 })),
    unit_id: Math.round(toNumber(raw.unit_id, DEFAULT_CONFIG.unit_id, { min: 1, max: 247 })),
    poll_frequency: toNumber(raw.poll_frequency, DEFAULT_CONFIG.poll_frequency, {
      min: MIN_POLL_FREQUENCY,
      max: MAX_POLL_FREQUENCY,
    }),
    production_threshold: toNumber(raw.production_threshold, DEFAULT_CONFIG.production_threshold, {
      min: 1,
      max: 100000,
    }),
  };
}

const TARGET_PATTERN =
  /^(?<host>\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::(?<port>\d{1,5}))?(?:\/(?<unitId>\d{1,3}))?$/;

/**
 * Parse the `hosts` field into Modbus targets.
 *
 * Each entry is `host`, `host:port`, `host/unit_id` or `host:port/unit_id`:
 * a plain inverter answers on the default port and unit id, while the devices
 * behind an SMA Data Manager or Cluster Controller share its address and are
 * told apart by their unit id.
 *
 * @param {{ hosts: string, port: number, unit_id: number }} config
 * @returns {{ targets: Array<{ key: string, host: string, port: number, unitId: number }>, invalid: string[] }}
 */
export function parseTargets(config) {
  const targets = [];
  const invalid = [];
  const seen = new Set();
  for (const entry of config.hosts.split(/[\s,;]+/)) {
    if (entry === '') {
      continue;
    }
    const match = TARGET_PATTERN.exec(entry);
    const port = match?.groups.port === undefined ? config.port : Number(match.groups.port);
    const unitId =
      match?.groups.unitId === undefined ? config.unit_id : Number(match.groups.unitId);
    if (!match || port < 1 || port > 65535 || unitId < 1 || unitId > 247) {
      invalid.push(entry);
      continue;
    }
    const host = match.groups.host.replace(/^\[|\]$/g, '');
    const key = `${host}:${port}/${unitId}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ key, host, port, unitId });
    }
  }
  return { targets, invalid };
}
