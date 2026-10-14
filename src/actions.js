// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// The resolved message (multi-language) is displayed under the button; the
// ack is awaited under the action's `timeout_seconds`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { deviceName } from './devices.js';
import { mapText, text } from './i18n.js';

const logger = createLogger({ name: 'actions' });

export const ACTION_KEYS = { TEST_CONNECTION: 'test_connection' };

/**
 * Summarize a discovery for the user.
 * @param {Array<{ target: { key: string }, profile: object | null, error: string | null }>} results
 * @param {string[]} invalid entries of the hosts field that could not be parsed
 */
export function describeDiscovery(results, invalid) {
  const lines = [];
  for (const { target, profile, error } of results) {
    if (!error) {
      lines.push(text(`✓ ${target.key}: ${deviceName(profile)}`, '', '', ''));
    } else {
      lines.push(
        text(
          `✗ ${target.key}: ${error}`,
          `✗ ${target.key} : ${error}`,
          `✗ ${target.key}: ${error}`,
          `✗ ${target.key}: ${error}`,
        ),
      );
    }
  }
  for (const entry of invalid) {
    lines.push(
      text(
        `✗ "${entry}": invalid address`,
        `✗ « ${entry} » : adresse invalide`,
        `✗ „${entry}“: ungültige Adresse`,
        `✗ "${entry}": dirección no válida`,
      ),
    );
  }
  const found = results.filter((result) => !result.error).length;
  const header =
    results.length === 0 && invalid.length === 0
      ? text(
          'No SMA device configured: enter at least one IP address.',
          'Aucun appareil SMA configuré : saisissez au moins une adresse IP.',
          'Kein SMA-Gerät konfiguriert: Geben Sie mindestens eine IP-Adresse ein.',
          'Ningún dispositivo SMA configurado: introduzca al menos una dirección IP.',
        )
      : text(
          `${found} of ${results.length} SMA device(s) answered.`,
          `${found} appareil(s) SMA sur ${results.length} ont répondu.`,
          `${found} von ${results.length} SMA-Gerät(en) haben geantwortet.`,
          `${found} de ${results.length} dispositivo(s) SMA respondieron.`,
        );
  // The success lines only hold names and addresses: the same in every language.
  return mapText(header, (language, value) =>
    [value, ...lines.map((line) => line[language] || line.en)].join('\n'),
  );
}

/**
 * @param {import('./installation.js').Installation} installation
 */
export function createActions(installation) {
  return {
    async [ACTION_KEYS.TEST_CONNECTION]() {
      logger.info('Action test_connection -> identifying the configured devices');
      const results = await installation.discover();
      await installation.publishDiscoveredDevices();
      await installation.pollAll();
      return describeDiscovery(results, installation.invalidTargets);
    },
  };
}
