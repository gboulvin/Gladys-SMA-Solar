// -----------------------------------------------------------------------------
// The SMA installation: the configured devices, their identification, the
// reading loop and what it publishes to Gladys.
//
// Every `poll_frequency` seconds, each device is read over one short Modbus
// session (connect, read, close: SMA devices accept few simultaneous
// sessions, and the Sunny Portal / Data Manager may need one too). Then:
//   - its states go to Gladys with publishChangedStates — only the values that
//     changed, plus a heartbeat — for the devices the user created;
//   - its transitions fire the scene triggers (src/triggers.js);
//   - its reachability feeds the transport badge and the connection status;
//   - the dashboard widgets are nudged.
//
// The Modbus session is injectable (`connect`), so the tests plug a simulated
// SMA device instead of a socket.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { parseTargets } from './config.js';
import { ModbusTcpClient } from './modbus.js';
import { identifyDevice, readSnapshot } from './sma.js';
import { buildDevice, buildStates, deviceIds, deviceName } from './devices.js';
import { detectEvents } from './triggers.js';
import { text } from './i18n.js';

const logger = createLogger({ name: 'installation' });

// Re-send an unchanged value every 15 minutes, so it stays recently dated.
const STATE_HEARTBEAT_MS = 15 * 60 * 1000;

function defaultConnect(target) {
  return new ModbusTcpClient({ host: target.host, port: target.port, unitId: target.unitId });
}

export class Installation {
  /**
   * @param {{ gladys: object, storage: { load: Function, save: Function },
   *   connect?: (target: object) => object, onChange?: () => void }} options
   */
  constructor({ gladys, storage, connect = defaultConnect, onChange = () => {} }) {
    this.gladys = gladys;
    this.storage = storage;
    this.connect = connect;
    this.onChange = onChange;
    this.config = null;
    this.invalidTargets = [];
    // Target key -> { target, profile, reachable, snapshot, readAt, error, tracking }
    this.entries = new Map();
    this.storedProfiles = null;
    this.createdDevices = new Set();
    this.timer = null;
    this.cycle = null;
    this.connectionStatus = null;
  }

  // --- Configuration and identification -------------------------------------

  /**
   * Apply a (new) configuration: the devices of the hosts no longer listed
   * are forgotten, the new ones start unidentified.
   */
  async configure(config) {
    this.config = config;
    // A new configuration (or a reconnection) re-sends the status.
    this.connectionStatus = null;
    if (this.storedProfiles === null) {
      this.storedProfiles = await this.storage.load();
    }
    const { targets, invalid } = parseTargets(config);
    this.invalidTargets = invalid;
    const entries = new Map();
    for (const target of targets) {
      entries.set(
        target.key,
        this.entries.get(target.key) ?? {
          target,
          profile: this.storedProfiles[target.key] ?? null,
          reachable: null,
          snapshot: null,
          readAt: null,
          error: null,
          tracking: {},
        },
      );
    }
    this.entries = entries;
  }

  async session(target, work) {
    const client = this.connect(target);
    try {
      await client.connect();
      return await work(client);
    } finally {
      client.close();
    }
  }

  async identify(entry) {
    const profile = await this.session(entry.target, identifyDevice);
    const changed = JSON.stringify(profile) !== JSON.stringify(entry.profile);
    entry.profile = profile;
    if (changed) {
      logger.info(`${entry.target.key}: ${deviceName(profile)} identified`);
      this.storedProfiles[entry.target.key] = profile;
      await this.storage.save(this.storedProfiles);
    }
    return changed;
  }

  /**
   * Identify every configured device (again). A device that does not answer
   * keeps the profile identified earlier, if any.
   * @returns {Promise<Array<{ target: object, profile: object | null, error: string | null }>>}
   */
  async discover() {
    const results = [];
    for (const entry of this.entries.values()) {
      try {
        await this.identify(entry);
        entry.error = null;
      } catch (err) {
        entry.error = err.message;
        logger.warn(`${entry.target.key}: identification failed (${err.message})`);
      }
      results.push({ target: entry.target, profile: entry.profile, error: entry.error });
    }
    return results;
  }

  /** The discovery payload: one device per identified serial number. */
  discoveredDevices() {
    const bySerial = new Map();
    for (const entry of this.entries.values()) {
      if (entry.profile && !bySerial.has(entry.profile.serial)) {
        bySerial.set(entry.profile.serial, buildDevice(this.gladys, entry.profile));
      }
    }
    return [...bySerial.values()];
  }

  async publishDiscoveredDevices() {
    await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
  }

  /** Track the devices the user created in Gladys: only those get states. */
  async refreshCreatedDevices() {
    const devices = await this.gladys.getDevices();
    this.createdDevices = new Set(devices.map((device) => device.external_id));
  }

  isCreated(entry) {
    return (
      entry.profile !== null &&
      this.createdDevices.has(deviceIds(this.gladys, entry.profile).device)
    );
  }

  // --- Reading ---------------------------------------------------------------

  /**
   * Read every device once. Overlapping calls share the same cycle: a slow
   * network never stacks sessions on the devices.
   */
  pollAll() {
    if (!this.cycle) {
      this.cycle = this.runCycle().finally(() => {
        this.cycle = null;
      });
    }
    return this.cycle;
  }

  async runCycle() {
    let discoveryChanged = false;
    for (const entry of this.entries.values()) {
      discoveryChanged = (await this.poll(entry)) || discoveryChanged;
    }
    if (discoveryChanged) {
      await this.publishDiscoveredDevices();
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.onChange();
  }

  /**
   * Read one device and publish what changed.
   * @returns {Promise<boolean>} whether its profile changed (newly identified)
   */
  async poll(entry) {
    let profileChanged = false;
    try {
      if (!entry.profile) {
        // Not identified yet (e.g. configured at night): try again.
        profileChanged = await this.identify(entry);
      }
      entry.snapshot = await this.session(entry.target, (client) =>
        readSnapshot(client, entry.profile),
      );
      entry.reachable = true;
      entry.readAt = new Date();
      entry.error = null;
    } catch (err) {
      if (entry.reachable !== false) {
        logger.warn(`${entry.target.key}: not reachable (${err.message})`);
      }
      entry.reachable = false;
      entry.error = err.message;
    }
    if (entry.profile) {
      await this.publish(entry);
    }
    return profileChanged;
  }

  async publish(entry) {
    const { profile } = entry;
    const created = this.isCreated(entry);
    const reading = {
      reachable: entry.reachable,
      condition: entry.snapshot?.condition ?? 'unknown',
      power: entry.reachable ? (entry.snapshot?.power ?? null) : 0,
      dailyEnergy: entry.reachable ? (entry.snapshot?.dailyEnergy ?? null) : null,
    };
    const { tracking, events } = detectEvents(entry.tracking, reading, {
      device: deviceIds(this.gladys, profile).device,
      deviceName: deviceName(profile),
      hasProduction: profile.hasProduction,
      threshold: this.config.production_threshold,
    });
    entry.tracking = tracking;
    if (!created) {
      return;
    }
    try {
      let states;
      if (entry.reachable) {
        states = buildStates(this.gladys, profile, entry.snapshot);
      } else {
        // An inverter asleep or cut off produces nothing: say so, instead of
        // leaving the last daytime power on the dashboard all night.
        states = profile.hasProduction ? buildStates(this.gladys, profile, { power: 0 }) : [];
      }
      if (states.length > 0) {
        await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
      }
      for (const { key, data } of events) {
        logger.info(`Scene event ${key} <- ${data.device_name}`);
        await this.gladys.publishSceneEvent(key, data);
      }
    } catch (err) {
      logger.error(`${entry.target.key}: publication failed`, err);
    }
  }

  // --- Status ----------------------------------------------------------------

  /** Transport badge: the devices are read on the LAN, or not at all. */
  transportEntries() {
    const entries = new Map();
    for (const entry of this.entries.values()) {
      if (entry.profile && entry.reachable !== null) {
        const externalId = deviceIds(this.gladys, entry.profile).device;
        entries.set(externalId, {
          external_id: externalId,
          transport: entry.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
        });
      }
    }
    return [...entries.values()];
  }

  async publishTransports() {
    const entries = this.transportEntries().filter((entry) =>
      this.createdDevices.has(entry.external_id),
    );
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries).catch((err) => {
        logger.error('publishTransports failed', err);
      });
    }
  }

  /** The application-level status of the Configuration screen. */
  connectionState() {
    if (this.entries.size === 0) {
      return {
        connected: false,
        message: text(
          'Enter the IP address of at least one SMA device.',
          "Saisissez l'adresse IP d'au moins un appareil SMA.",
          'Geben Sie die IP-Adresse mindestens eines SMA-Geräts ein.',
          'Introduzca la dirección IP de al menos un dispositivo SMA.',
        ),
      };
    }
    const entries = [...this.entries.values()];
    if (entries.some((entry) => entry.reachable)) {
      return { connected: true };
    }
    if (entries.every((entry) => entry.reachable === null)) {
      return { connected: false };
    }
    return {
      connected: false,
      message: text(
        'No SMA device answers. Check Modbus TCP is enabled (some inverters sleep at night).',
        'Aucun appareil SMA ne répond. Vérifiez que Modbus TCP est activé (certains onduleurs dorment la nuit).',
        'Kein SMA-Gerät antwortet. Prüfen Sie, ob Modbus TCP aktiviert ist (manche Wechselrichter schlafen nachts).',
        'Ningún dispositivo SMA responde. Compruebe que Modbus TCP está activado (algunos inversores duermen de noche).',
      ),
    };
  }

  async publishConnectionStatus() {
    const { connected, message } = this.connectionState();
    const key = JSON.stringify([connected, message?.en]);
    if (key === this.connectionStatus || (!connected && !message)) {
      return;
    }
    this.connectionStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      logger.error('setConnectionStatus failed', err);
    });
  }

  // --- Loop ------------------------------------------------------------------

  start() {
    this.stop();
    const run = () => this.pollAll().catch((err) => logger.error('Reading cycle failed', err));
    run();
    this.timer = setInterval(run, this.config.poll_frequency * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // --- Queries (widgets, scene actions) --------------------------------------

  /** The entries of the identified devices, one per serial number. */
  devices() {
    const bySerial = new Map();
    for (const entry of this.entries.values()) {
      if (entry.profile && !bySerial.has(entry.profile.serial)) {
        bySerial.set(entry.profile.serial, entry);
      }
    }
    return [...bySerial.values()];
  }

  findByExternalId(externalId) {
    return (
      this.devices().find((entry) => deviceIds(this.gladys, entry.profile).device === externalId) ??
      null
    );
  }

  /** Read one device now (scene action, widget button), outside the loop. */
  async readNow(entry) {
    await this.poll(entry);
    await this.publishTransports();
    this.onChange();
    return entry;
  }

  /** Sums over the installation, for the overview widget and scene action. */
  totals() {
    const devices = this.devices();
    const reachable = devices.filter((entry) => entry.reachable && entry.snapshot);
    const sum = (key, list = reachable) => {
      const values = list.map((entry) => entry.snapshot[key]).filter((v) => typeof v === 'number');
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
    };
    const producers = devices.filter((entry) => entry.profile.hasProduction);
    const batteries = reachable.filter(
      (entry) => entry.profile.hasBattery && typeof entry.snapshot.batteryLevel === 'number',
    );
    return {
      devices: devices.length,
      reachable: reachable.length,
      hasProduction: producers.length > 0,
      hasBattery: devices.some((entry) => entry.profile.hasBattery),
      hasGrid: devices.some((entry) => entry.profile.hasGrid),
      // An unreachable inverter produces nothing (asleep at night).
      power: producers.length > 0 ? (sum('power') ?? 0) : null,
      // The last reading of an inverter asleep since yesterday evening holds
      // yesterday's total: only today's readings count.
      dailyEnergy: round(
        sum(
          'dailyEnergy',
          producers.filter((entry) => entry.snapshot && isToday(entry.readAt)),
        ),
      ),
      gridImportPower: sum('gridImportPower'),
      gridExportPower: sum('gridExportPower'),
      batteryLevel:
        batteries.length > 0
          ? Math.round(
              batteries.reduce((total, entry) => total + entry.snapshot.batteryLevel, 0) /
                batteries.length,
            )
          : null,
    };
  }
}

function isToday(date) {
  return date !== null && date.toDateString() === new Date().toDateString();
}

function round(value) {
  return value === null ? null : Math.round(value * 1000) / 1000;
}
