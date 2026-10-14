// -----------------------------------------------------------------------------
// Entry point of the SMA Solar integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the installation (src/installation.js).
// It holds no SMA logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled by it);
//   2. registers the event handlers BEFORE connect();
//   3. connects, identifies the configured devices and starts the reading loop.
//
// Environment variables provided by the Gladys supervisor to the container:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// The SDK reads them itself.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { Installation } from './src/installation.js';
import { createStorage } from './src/storage.js';
import { createActions } from './src/actions.js';
import { createSceneActions } from './src/scenes.js';
import { createWidgets, refreshWidgets } from './src/widgets.js';
import { text } from './src/i18n.js';

const gladys = new GladysIntegration();

const installation = new Installation({
  gladys,
  storage: createStorage(),
  // After every reading cycle: the computed parts of the widgets changed.
  onChange: () => refreshWidgets(gladys),
});

// (Re)apply a configuration: identify the devices, publish them, (re)start
// the reading loop.
async function applyConfig(rawConfig) {
  installation.stop();
  await installation.configure(normalizeConfig(rawConfig));
  await installation.discover();
  await installation.publishDiscoveredDevices();
  await installation.refreshCreatedDevices();
  installation.start();
}

// --- Discovery: the user opens the Discovery tab -----------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> identifying the SMA devices');
  await installation.discover();
  await installation.publishDiscoveredDevices();
});

// --- The user created, updated or deleted one of our devices -----------------
// Only created devices receive states: keep the list current.
const refreshCreatedDevices = () =>
  installation
    .refreshCreatedDevices()
    .then(() => installation.pollAll())
    .catch((err) => logger.error('Refreshing the created devices failed', err));
gladys.onDeviceCreated(refreshCreatedDevices);
gladys.onDeviceDeleted(refreshCreatedDevices);

// --- Commands: every SMA feature is a read-only measurement ------------------
gladys.onSetValue(async (device) => {
  throw new Error(`${device.external_id} is read-only`);
});

// --- Manifest actions: buttons of the Configuration screen -------------------
for (const [key, handler] of Object.entries(createActions(installation))) {
  gladys.onAction(key, (fields) => handler(fields));
}

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
// Scene TRIGGERS need no handler: the reading loop fires them with
// publishSceneEvent (see src/installation.js and src/triggers.js).
for (const [key, handler] of Object.entries(createSceneActions(installation))) {
  gladys.onSceneAction(key, (fields) => handler(gladys, { fields }));
}

// --- Dashboard widgets (Gladys 5.1+) -----------------------------------------
for (const [key, widget] of Object.entries(createWidgets(installation))) {
  gladys.onWidgetGet(key, (request) => widget.get(gladys, request));
  gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
    widget.action(gladys, { actionKey, params, settings }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await applyConfig(newConfig);
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    await applyConfig(await gladys.getConfig());
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(
        false,
        text(
          'Initialization failed, check the integration logs.',
          "L'initialisation a échoué, consultez les logs de l'intégration.",
          'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Protokolle der Integration.',
          'La inicialización ha fallado, consulte los registros de la integración.',
        ),
      )
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  installation.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  installation.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the SMA Solar integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
