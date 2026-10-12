import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createIntegration } from '../src/integration.js';
import { LocalClient } from '../src/ewelink/local.js';
import { buildGladysDevice } from '../src/devices/model.js';
import { WIDGETS } from '../src/widgets.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { MemoryStore, fakeDevicePost, flush } from './helpers.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const declared = (list, key) => manifest[list].find((entry) => entry.key === key);

const POW = '1000000020';
const BRIDGE = '1000000028';
const DIY = '10000d1d1d';

async function running() {
  const lan = fakeDevicePost();
  const gladys = createFakeGladys({ scanResults: { mdns: [] } });
  const integration = createIntegration(gladys, {
    store: new MemoryStore(),
    local: new LocalClient({ post: lan }),
    fetch: async () => {
      throw new Error('no network in tests');
    },
  });
  await gladys.connect();
  await integration.manager.firstCycle;
  const { registry } = integration.manager;
  registry.upsertCloud({
    deviceid: POW,
    name: 'Washing machine',
    extra: { uiid: 190 },
    params: { switches: [{ outlet: 0, switch: 'on' }], power: 120000, voltage: 23000, current: 50 },
  });
  registry.upsertCloud({
    deviceid: BRIDGE,
    name: 'RF Bridge',
    extra: { uiid: 28 },
    params: { rfList: [0, 1, 2, 3, 4].map((rfChl) => ({ rfChl })) },
    tags: {
      zyx_info: [
        {
          remote_type: '4',
          name: 'Remote',
          buttonName: [
            { 0: 'Gate' },
            { 1: 'Garage' },
            { 2: 'Blind up' },
            { 3: 'Blind down' },
            { 4: 'Light' },
          ],
        },
      ],
    },
  });
  const diy = registry.upsertManual({ deviceid: DIY, host: '192.168.1.70' });
  diy.uiid = 1;
  diy.name = 'Lamp';
  registry.rebuild(diy);
  await integration.manager.publishDevices();
  return { gladys, integration, manager: integration.manager, lan };
}

const settingsFor = (gladys, deviceid) => ({
  device: gladys.externalIds('sonoff', deviceid).device,
});

async function contents(gladys) {
  const results = [];
  for (const key of keysOf(manifest.widgets)) {
    for (const settings of [
      {},
      settingsFor(gladys, POW),
      settingsFor(gladys, BRIDGE),
      settingsFor(gladys, DIY),
    ]) {
      const ack = await gladys.fake.widgetGet(key, { settings, language: 'fr', units: 'metric' });
      assert.equal(ack.success, true, `${key}: ${ack.error}`);
      results.push({ key, settings, content: ack.data.content ?? ack.data });
    }
  }
  return results;
}

test('every widget content is rendered exactly as sent, whatever the settings', async (t) => {
  const { gladys, integration } = await running();
  t.after(() => integration.shutdown());
  for (const { key, settings, content } of await contents(gladys)) {
    assert.deepEqual(validateWidgetContent(content), [], `${key} ${JSON.stringify(settings)}`);
  }
});

test('widget texts are in the four languages', async (t) => {
  const { gladys, integration } = await running();
  t.after(() => integration.shutdown());
  const walk = (value, path) => {
    if (value && typeof value === 'object' && 'en' in value && typeof value.en === 'string') {
      assert.deepEqual(Object.keys(value).sort(), ['de', 'en', 'es', 'fr'], path);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(child, `${path}.${key}`);
      }
    }
  };
  for (const { key, content } of await contents(gladys)) {
    for (const component of content.components) {
      for (const field of ['label', 'text', 'title', 'subtitle']) {
        if (typeof component[field] === 'object') {
          walk(component[field], `${key}.${component.type}.${field}`);
        }
      }
      for (const item of component.items ?? []) {
        walk(item, `${key}.${component.type}.items`);
      }
    }
  }
});

test('live tiles and buttons reference features the integration publishes', async (t) => {
  const { gladys, integration } = await running();
  t.after(() => integration.shutdown());
  const features = new Set(
    gladys.fake.discoveredDevices.flatMap((device) => device.features.map((f) => f.external_id)),
  );
  let bound = 0;
  for (const { content } of await contents(gladys)) {
    for (const component of content.components) {
      for (const feature of [component.device_feature, ...(component.device_features ?? [])]) {
        if (feature) {
          bound += 1;
          assert.ok(features.has(feature), `unknown feature ${feature}`);
        }
      }
    }
  }
  assert.ok(bound > 5);
});

test('the energy widget shows the metering of the chosen device', async (t) => {
  const { gladys, integration } = await running();
  t.after(() => integration.shutdown());
  const ack = await gladys.fake.widgetGet('energy_monitor', {
    settings: settingsFor(gladys, POW),
    language: 'en',
    units: 'metric',
  });
  const content = ack.data.content ?? ack.data;
  const types = content.components.map((component) => component.type);
  assert.deepEqual(types, [
    'value',
    'value',
    'value',
    'value',
    'value',
    'chart',
    'button',
    'button',
  ]);
});

test('the RF remote shows four buttons at most, the chosen codes first', async (t) => {
  const { gladys, integration } = await running();
  t.after(() => integration.shutdown());
  const buttonsOf = async (codes) => {
    const ack = await gladys.fake.widgetGet('rf_remote', {
      settings: { ...settingsFor(gladys, BRIDGE), codes },
      language: 'en',
      units: 'metric',
    });
    return (ack.data.content ?? ack.data).components.filter((c) => c.type === 'button');
  };
  assert.equal((await buttonsOf('')).length, 4);
  assert.deepEqual(
    (await buttonsOf('light, 1')).map((button) => button.label),
    ['Light', 'Garage'],
  );
});

test('the rescan button of the network widget answers a short toast', async (t) => {
  const { gladys, integration } = await running();
  t.after(() => integration.shutdown());
  const ack = await gladys.fake.widgetAction('network_status', 'rescan', {}, { settings: {} });
  assert.equal(ack.success, true);
  const toast = ack.data.message ?? ack.data;
  for (const text of Object.values(toast)) {
    assert.ok(text.length <= 200);
  }
  const unknown = await gladys.fake.widgetAction('network_status', 'nope', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('every widget, scene action and manifest action has its handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('scene actions only return their declared outputs', async (t) => {
  const { gladys, integration, manager } = await running();
  t.after(() => integration.shutdown());
  const outputsOf = (key) => keysOf(declared('scene_actions', key).outputs);
  const run = async (key, fields) => {
    const ack = await gladys.fake.sceneAction(key, fields);
    assert.equal(ack.success, true, `${key}: ${ack.error}`);
    const outputs = ack.data?.outputs ?? ack.data ?? {};
    for (const name of Object.keys(outputs)) {
      assert.ok(outputsOf(key).includes(name), `${key} returns an undeclared output "${name}"`);
    }
    return outputs;
  };
  // The DIY lamp answers on the LAN.
  assert.deepEqual(
    await run('send_command', {
      device: settingsFor(gladys, DIY).device,
      params: '{"switch":"on"}',
    }),
    {
      sent: true,
      via: 'local',
    },
  );
  // The RF Bridge has no LAN address and no cloud here: unreachable is an output.
  assert.deepEqual(
    await run('rf_transmit', { device: settingsFor(gladys, BRIDGE).device, channel: 'Gate' }),
    {
      sent: false,
      via: 'unreachable',
    },
  );
  const refreshed = await run('refresh_devices', {});
  assert.equal(refreshed.devices, manager.registry.usable().length);
});

test('scene actions refuse an unknown device, an unknown code or invalid JSON', async (t) => {
  const { gladys, integration } = await running();
  t.after(() => integration.shutdown());
  const bridge = settingsFor(gladys, BRIDGE).device;
  assert.equal(
    (await gladys.fake.sceneAction('rf_transmit', { device: bridge, channel: '42' })).success,
    false,
  );
  assert.equal(
    (await gladys.fake.sceneAction('send_command', { device: bridge, params: '[1]' })).success,
    false,
  );
  assert.equal(
    (await gladys.fake.sceneAction('send_command', { device: 'ext:x:sonoff:nope', params: '{}' }))
      .success,
    false,
  );
});

test('scene event payloads are flat and only carry declared keys', async (t) => {
  const { gladys, integration, manager } = await running();
  t.after(() => integration.shutdown());
  const bridge = manager.registry.get(BRIDGE);
  await manager.handleParams(bridge, { rfTrig0: '2026-10-12T10:00:00.000Z' }, 'cloud');
  await manager.handleParams(bridge, { rfTrig1: '2026-10-12T10:00:05.000Z' }, 'cloud');
  await flush();
  const events = gladys.fake.sceneEvents;
  assert.ok(events.length > 0);
  for (const { key, data } of events) {
    const trigger = declared('scene_triggers', key);
    assert.ok(trigger, `undeclared trigger ${key}`);
    const allowed = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    assert.ok(Object.keys(data).length <= 30);
    for (const [name, value] of Object.entries(data)) {
      assert.ok(allowed.includes(name), `${key}.${name} is not declared`);
      assert.ok(['string', 'number', 'boolean'].includes(typeof value) || value === null);
      assert.ok(typeof value !== 'string' || value.length <= 1000);
    }
  }
  assert.deepEqual(events.at(-1).data, {
    device: settingsFor(gladys, BRIDGE).device,
    device_name: 'RF Bridge',
    channel: '1',
    name: 'Garage',
  });
});

test('built devices of the widgets fixtures are publishable', async () => {
  const gladys = createFakeGladys();
  const { integration, manager } = await running();
  try {
    for (const entry of manager.registry.usable()) {
      assert.ok(buildGladysDevice(gladys, entry));
    }
  } finally {
    await integration.shutdown();
  }
});
