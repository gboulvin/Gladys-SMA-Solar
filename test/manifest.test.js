// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code registers, nor that every text exists in the four
// languages of the Gladys UI: these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG } from '../src/config.js';
import { Installation } from '../src/installation.js';
import { createActions } from '../src/actions.js';
import { createSceneActions } from '../src/scenes.js';
import { createWidgets } from '../src/widgets.js';
import { TRIGGER_KEYS } from '../src/triggers.js';
import { LANGUAGES } from '../src/i18n.js';
import { memoryStorage } from './helpers/fakeSma.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const installation = new Installation({ gladys: createFakeGladys(), storage: memoryStorage() });
const ACTIONS = createActions(installation);
const SCENE_ACTIONS = createSceneActions(installation);
const WIDGETS = createWidgets(installation);

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

// Every multi-language text of the manifest, with its path.
function* texts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    for (const [index, child] of node.entries()) {
      yield* texts(child, `${path}[${index}]`);
    }
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key)) {
        yield [`${path}.${key}`, value];
      } else {
        yield* texts(value, `${path}.${key}`);
      }
    }
  }
}

test('every text of the manifest exists in English, French, German and Spanish', () => {
  let count = 0;
  for (const [path, value] of texts(manifest)) {
    count += 1;
    assert.equal(typeof value, 'object', `${path} must be a multi-language object`);
    for (const language of LANGUAGES) {
      assert.ok(value[language]?.trim(), `${path}.${language} is missing`);
    }
  }
  assert.ok(count > 50);
});

test('the integration is local only', () => {
  assert.deepEqual(manifest.transports, ['local']);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const widget of manifest.widgets) {
    for (const language of LANGUAGES) {
      const length = widget.label[language].length;
      assert.ok(length >= 3 && length <= 30, `widget ${widget.key} label.${language}: 3-30 chars`);
      assert.ok(widget.description[language].length <= 100, `widget ${widget.key} description`);
    }
  }
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...TRIGGER_KEYS].sort());
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const stored = manifest.config_schema.filter((field) => field.type !== 'section');
  assert.deepEqual(keysOf(stored).sort(), Object.keys(DEFAULT_CONFIG).sort());
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
  }
});

test('scene trigger fields use the types a trigger filter accepts', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        ['string', 'number', 'select', 'multi_select', 'section'].includes(field.type),
        `${trigger.key}.${field.key}: ${field.type}`,
      );
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, value] of Object.entries(manifest.description)) {
    assert.ok(
      value.length >= 10 && value.length <= 100,
      `description.${lang} has ${value.length} characters (10 to 100 allowed)`,
    );
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const doc = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    assert.ok(doc.length >= 300, `docs/${language}.md needs at least 300 characters`);
  }
});
