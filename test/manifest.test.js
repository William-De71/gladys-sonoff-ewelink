// -----------------------------------------------------------------------------
// Consistency between `gladys-assistant-integration.json` and the code. The
// store validator checks the manifest alone; these tests tie it to the
// handlers, the defaults and the versions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { BUTTON_PRESSED_TRIGGER, RF_CODE_RECEIVED_TRIGGER } from '../src/devices/capabilities.js';
import { CLOUD_STATUS_TRIGGER, DEVICE_CONNECTION_TRIGGER } from '../src/manager.js';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));
const lock = JSON.parse(await read('../package-lock.json'));
const changelog = await read('../CHANGELOG.md');

const REPO = 'William-De71/gladys-sonoff-ewelink';
const FIRED_TRIGGERS = [
  BUTTON_PRESSED_TRIGGER,
  RF_CODE_RECEIVED_TRIGGER,
  DEVICE_CONNECTION_TRIGGER,
  CLOUD_STATUS_TRIGGER,
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

const isAtLeast = (version, required) => {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
};

test('every manifest action, scene action and widget has its handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...FIRED_TRIGGERS].sort());
});

test('gladys_version covers the fields the manifest uses', () => {
  // categories: 4.86.0; widgets and scenes: 5.1.0; a `secret` field in an
  // action form is only typed in from 5.2.0 (Gladys #3154).
  assert.ok(isAtLeast(minGladysVersion(), [5, 2, 0]));
  const secretInAction = manifest.actions.some((action) =>
    (action.fields ?? []).some((field) => field.type === 'secret'),
  );
  assert.ok(secretInAction, 'the reason for 5.2.0 is still there');
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('section fields are purely presentational, with https links', () => {
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    assert.equal(section.default, undefined);
    assert.equal(section.required, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects use the devices source and no static options', () => {
  const dynamic = allFields.filter((field) => field.source !== undefined);
  assert.ok(dynamic.length > 0);
  for (const field of dynamic) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('secrets are secret fields, never stored with a default', () => {
  for (const key of ['app_secret', 'password']) {
    const field = manifest.config_schema.find((entry) => entry.key === key);
    assert.equal(field.type, 'secret');
    assert.equal(field.default, undefined);
  }
  assert.equal(
    manifest.actions
      .find((action) => action.key === 'add_local_device')
      .fields.find((field) => field.key === 'devicekey').type,
    'secret',
  );
});

test('versions agree: package, lock, manifest, image tag and changelog', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/${REPO.toLowerCase()}:${manifest.version}`);
  const firstSection = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
  assert.equal(firstSection, pkg.version, 'the first CHANGELOG section is the current version');
});

test('the integration is local first with an optional cloud', () => {
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: '_ewelink._tcp' }]);
  assert.equal(DEFAULT_CONFIG.cloud_mode, 'none');
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `${language}: ${text.length} characters`);
  }
});

test('placeholders are multi-language objects', () => {
  for (const field of allFields.filter((entry) => entry.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
  }
});

test('scene action fields and outputs respect the store limits', () => {
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    assert.ok((action.fields ?? []).length <= 10);
    assert.ok((action.outputs ?? []).length <= 20);
  }
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10);
    assert.ok((trigger.variables ?? []).length <= 20);
    assert.ok(!(trigger.fields ?? []).some((field) => field.type === 'boolean'));
  }
});
