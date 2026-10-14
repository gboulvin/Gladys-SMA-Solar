// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
//   - solar_overview: the whole installation at a glance — production now,
//     energy of the day, grid exchange, battery, a production chart and the
//     condition of every device;
//   - sma_device: one device chosen by the dashboard author (a
//     `"source": "devices"` setting), with live tiles bound to its features.
//
// The content is declarative (the core renders it with its own theme, dark
// mode and translations). Tiles bound to a device feature are live: they follow
// the published states with no refresh. The computed parts are cached by the
// core until `ttl_seconds`, and index.js nudges the widgets after every
// reading cycle. test/widgets.test.js checks every content with the SDK's
// validateWidgetContent.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CONDITION_LABELS, text } from './i18n.js';
import { deviceName, featureExternalId } from './devices.js';

const logger = createLogger({ name: 'widgets' });

export const WIDGET_KEYS = {
  SOLAR_OVERVIEW: 'solar_overview',
  SMA_DEVICE: 'sma_device',
};

const ACTIONS = { REFRESH: 'refresh' };

const CONDITION_COLORS = {
  ok: WIDGET_COLORS.SUCCESS,
  warning: WIDGET_COLORS.WARNING,
  fault: WIDGET_COLORS.DANGER,
  off: WIDGET_COLORS.NEUTRAL,
  unreachable: WIDGET_COLORS.WARNING,
  unknown: WIDGET_COLORS.NEUTRAL,
};

const LABELS = {
  production: text('Production', 'Production', 'Erzeugung', 'Producción'),
  today: text('Today', "Aujourd'hui", 'Heute', 'Hoy'),
  fromGrid: text('From grid', 'Soutirage réseau', 'Netzbezug', 'Desde la red'),
  toGrid: text('To grid', 'Injection réseau', 'Einspeisung', 'Hacia la red'),
  battery: text('Battery', 'Batterie', 'Batterie', 'Batería'),
  chart: text('Solar production', 'Production solaire', 'Solarertrag', 'Producción solar'),
  refresh: text('Refresh', 'Actualiser', 'Aktualisieren', 'Actualizar'),
  condition: text('Condition', 'État', 'Zustand', 'Estado'),
  address: text('Address', 'Adresse', 'Adresse', 'Dirección'),
  lastReading: text('Last reading', 'Dernière lecture', 'Letzte Messung', 'Última lectura'),
  temperature: text('Temperature', 'Température', 'Temperatur', 'Temperatura'),
  frequency: text('Grid frequency', 'Fréquence réseau', 'Netzfrequenz', 'Frecuencia de red'),
  never: text('Never', 'Jamais', 'Nie', 'Nunca'),
};

const NO_DEVICE = text(
  'No SMA device yet: enter its IP address in the integration configuration, then add it from the Discovery tab.',
  "Aucun appareil SMA pour l'instant : saisissez son adresse IP dans la configuration de l'intégration, puis ajoutez-le depuis l'onglet Découverte.",
  'Noch kein SMA-Gerät: Geben Sie seine IP-Adresse in der Konfiguration der Integration ein und fügen Sie es im Reiter Erkennung hinzu.',
  'Aún no hay ningún dispositivo SMA: introduzca su dirección IP en la configuración de la integración y añádalo desde la pestaña Descubrimiento.',
);

const UNKNOWN_DEVICE = text(
  'This SMA device is no longer configured. Pick another one in the widget settings.',
  "Cet appareil SMA n'est plus configuré. Choisissez-en un autre dans les réglages du widget.",
  'Dieses SMA-Gerät ist nicht mehr konfiguriert. Wählen Sie ein anderes in den Widget-Einstellungen.',
  'Este dispositivo SMA ya no está configurado. Elija otro en los ajustes del widget.',
);

const REFRESHED = text(
  'Values read from the SMA devices.',
  'Valeurs relues sur les appareils SMA.',
  'Werte von den SMA-Geräten gelesen.',
  'Valores leídos de los dispositivos SMA.',
);

/** A power in W, as a tile value: W below 1 kW, kW above. */
export function formatPower(watts) {
  if (watts === null || watts === undefined) {
    return { value: '–', unit: 'W' };
  }
  if (Math.abs(watts) < 1000) {
    return { value: Math.round(watts), unit: 'W' };
  }
  return { value: Math.round(watts / 10) / 100, unit: 'kW' };
}

function formatEnergy(kwh) {
  return kwh === null || kwh === undefined
    ? { value: '–', unit: 'kWh' }
    : { value: Math.round(kwh * 100) / 100, unit: 'kWh' };
}

/** How long ago, as a multi-language text. */
export function formatAge(date, now = new Date()) {
  if (!date) {
    return LABELS.never;
  }
  const minutes = Math.floor((now - date) / 60000);
  if (minutes < 1) {
    return text('Just now', "À l'instant", 'Gerade eben', 'Ahora mismo');
  }
  if (minutes < 60) {
    return text(
      `${minutes} min ago`,
      `Il y a ${minutes} min`,
      `Vor ${minutes} Min.`,
      `Hace ${minutes} min`,
    );
  }
  const hours = Math.floor(minutes / 60);
  return text(`${hours} h ago`, `Il y a ${hours} h`, `Vor ${hours} Std.`, `Hace ${hours} h`);
}

function conditionOf(entry) {
  if (entry.reachable === false) {
    return 'unreachable';
  }
  return entry.snapshot?.condition ?? 'unknown';
}

function conditionItem(label, entry) {
  const condition = conditionOf(entry);
  return {
    label,
    icon: condition === 'unreachable' ? 'wifi-off' : 'activity',
    value: CONDITION_LABELS[condition],
    color: CONDITION_COLORS[condition],
  };
}

function refreshButton(params) {
  return {
    type: 'button',
    label: LABELS.refresh,
    icon: 'refresh-cw',
    style: 'secondary',
    action: params ? { key: ACTIONS.REFRESH, params } : { key: ACTIONS.REFRESH },
  };
}

/**
 * @param {import('./installation.js').Installation} installation
 */
export function createWidgets(installation) {
  const { gladys } = installation;

  function overview() {
    const devices = installation.devices();
    if (devices.length === 0) {
      return { ttl_seconds: 300, components: [{ type: 'text', text: NO_DEVICE }] };
    }
    const totals = installation.totals();
    const components = [];
    if (totals.hasProduction) {
      components.push(
        { type: 'value', label: LABELS.production, icon: 'sun', ...formatPower(totals.power) },
        {
          type: 'value',
          label: LABELS.today,
          icon: 'bar-chart-2',
          ...formatEnergy(totals.dailyEnergy),
        },
      );
    }
    if (totals.hasGrid) {
      components.push(
        {
          type: 'value',
          label: LABELS.fromGrid,
          icon: 'arrow-down-circle',
          ...formatPower(totals.gridImportPower),
        },
        {
          type: 'value',
          label: LABELS.toGrid,
          icon: 'arrow-up-circle',
          ...formatPower(totals.gridExportPower),
        },
      );
    }
    if (totals.hasBattery && totals.batteryLevel !== null) {
      components.push({
        type: 'gauge',
        label: LABELS.battery,
        value: totals.batteryLevel,
        min: 0,
        max: 100,
        unit: '%',
        color: totals.batteryLevel < 20 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
      });
    }
    // The chart reads the history Gladys keeps: only the created devices
    // have one.
    const productionFeatures = devices
      .filter((entry) => installation.isCreated(entry))
      .map((entry) => featureExternalId(gladys, entry.profile, 'production-power'))
      .filter(Boolean)
      .slice(0, 4);
    if (productionFeatures.length > 0) {
      components.push({
        type: 'chart',
        title: LABELS.chart,
        chart_type: 'area',
        device_features: productionFeatures,
        interval: 'last-day',
      });
    }
    components.push(
      {
        type: 'status',
        items: devices.slice(0, 10).map((entry) => conditionItem(deviceName(entry.profile), entry)),
      },
      refreshButton(),
    );
    return { ttl_seconds: 60, components };
  }

  function device(settings) {
    const entry = installation.findByExternalId(settings.device);
    if (!entry) {
      return { ttl_seconds: 300, components: [{ type: 'text', text: UNKNOWN_DEVICE }] };
    }
    const { profile, snapshot } = entry;
    const feature = (key) => featureExternalId(gladys, profile, key);
    const components = [];
    const tiles = [
      ['production-power', LABELS.production, 'sun'],
      ['daily-production', LABELS.today, 'bar-chart-2'],
      ['grid-import-power', LABELS.fromGrid, 'arrow-down-circle'],
      ['grid-export-power', LABELS.toGrid, 'arrow-up-circle'],
    ];
    for (const [key, label, icon] of tiles) {
      if (feature(key)) {
        components.push({ type: 'value', label, icon, device_feature: feature(key) });
      }
    }
    if (feature('battery-level')) {
      components.push({
        type: 'gauge',
        label: LABELS.battery,
        device_feature: feature('battery-level'),
      });
    }
    const items = [
      conditionItem(LABELS.condition, entry),
      {
        label: LABELS.address,
        icon: 'wifi',
        value: entry.target.host,
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: LABELS.lastReading,
        icon: 'clock',
        value: formatAge(entry.readAt),
        color: WIDGET_COLORS.NEUTRAL,
      },
    ];
    if (typeof snapshot?.temperature === 'number') {
      items.push({
        label: LABELS.temperature,
        icon: 'thermometer',
        value: `${snapshot.temperature} °C`,
        color: snapshot.temperature >= 70 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      });
    }
    if (entry.reachable && typeof snapshot?.frequency === 'number') {
      items.push({
        label: LABELS.frequency,
        icon: 'activity',
        value: `${snapshot.frequency} Hz`,
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items }, refreshButton({ device: settings.device }));
    return { ttl_seconds: 60, components };
  }

  return {
    [WIDGET_KEYS.SOLAR_OVERVIEW]: {
      async get() {
        logger.debug(`onWidgetGet <- ${WIDGET_KEYS.SOLAR_OVERVIEW}`);
        return overview();
      },
      async action(_gladys, { actionKey }) {
        logger.info(`onWidgetAction <- ${WIDGET_KEYS.SOLAR_OVERVIEW}.${actionKey}`);
        if (actionKey !== ACTIONS.REFRESH) {
          throw new Error(`Unknown widget action: ${actionKey}`);
        }
        await installation.pollAll();
        return REFRESHED;
      },
    },
    [WIDGET_KEYS.SMA_DEVICE]: {
      async get(_gladys, { settings = {} }) {
        logger.debug(`onWidgetGet <- ${WIDGET_KEYS.SMA_DEVICE}`);
        return device(settings);
      },
      async action(_gladys, { actionKey, params }) {
        logger.info(`onWidgetAction <- ${WIDGET_KEYS.SMA_DEVICE}.${actionKey}`);
        if (actionKey !== ACTIONS.REFRESH) {
          throw new Error(`Unknown widget action: ${actionKey}`);
        }
        const entry = installation.findByExternalId(params.device);
        if (entry) {
          await installation.readNow(entry);
        }
        return REFRESHED;
      },
    },
  };
}

/**
 * Freshness nudge: ask the core to re-pull every widget now (rate-limited
 * core-side to 1 per 10 s per widget, dropped while disconnected).
 */
export function refreshWidgets(gladys) {
  for (const key of Object.values(WIDGET_KEYS)) {
    gladys.requestWidgetRefresh(key);
  }
}
