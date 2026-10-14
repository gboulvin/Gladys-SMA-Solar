// -----------------------------------------------------------------------------
// User-facing texts.
//
// Gladys renders multi-language objects `{ en, fr, de, es }` in the language of
// the user, with `en` as the fallback. Every text this integration shows
// (manifest, action messages, widgets, connection status) carries the four
// languages of the Gladys UI: keep them together here so none is forgotten.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * Build a multi-language text.
 * @param {string} en
 * @param {string} fr
 * @param {string} de
 * @param {string} es
 */
export function text(en, fr, de, es) {
  return { en, fr, de, es };
}

/**
 * Apply a function to every language of a multi-language text.
 * @param {Record<string, string>} value
 * @param {(language: string, value: string) => string} fn
 */
export function mapText(value, fn) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, fn(language, value[language])]));
}

// Operating condition of an SMA device, as read from its condition register,
// plus `unreachable` when it does not answer at all.
export const CONDITION_LABELS = {
  ok: text('OK', 'OK', 'OK', 'OK'),
  warning: text('Warning', 'Avertissement', 'Warnung', 'Advertencia'),
  fault: text('Fault', 'Défaut', 'Störung', 'Fallo'),
  off: text('Off', 'Arrêté', 'Aus', 'Apagado'),
  unreachable: text('Unreachable', 'Injoignable', 'Nicht erreichbar', 'Inaccesible'),
  unknown: text('Unknown', 'Inconnu', 'Unbekannt', 'Desconocido'),
};
