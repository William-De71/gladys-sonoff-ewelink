import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { capabilitiesOf, DEVICES, diyIdentity, isKnownUiid } from '../src/devices/specs.js';
import { buildGladysDevice, readAll } from '../src/devices/model.js';
import { Registry, mergeParams } from '../src/registry.js';

// Parameters rich enough to unlock every optional feature of the catalog.
const SAMPLE_PARAMS = {
  switch: 'on',
  switches: [0, 1, 2, 3].map((outlet) => ({ outlet, switch: 'on' })),
  configure: [0, 1, 2, 3].map((outlet) => ({ outlet, startup: 'stay' })),
  HMI_ATCDevice: { etype: 'hot' },
  supplyPower: 100,
  co2: 400,
  pm10: 5,
  pm2_5: 3,
  temperature: 2150,
  humidity: 4500,
  battery: 80,
  rfList: [{ rfChl: 0 }, { rfChl: 1 }],
  sledOnline: 'on',
};
const SAMPLE_TAGS = {
  zyx_info: [{ remote_type: '4', name: 'Gate', buttonName: [{ 0: 'Open' }, { 1: 'Close' }] }],
  ck_channel_name: { 0: 'Kitchen', 1: 'Hall' },
};

function catalog() {
  const registry = new Registry();
  return Object.keys(DEVICES).map((uiid) =>
    registry.upsertCloud({
      deviceid: `1000${uiid.padStart(6, '0')}`,
      name: `UIID ${uiid}`,
      extra: { uiid: Number(uiid) },
      params: SAMPLE_PARAMS,
      tags: SAMPLE_TAGS,
    }),
  );
}

test('every UIID of the catalog publishes devices Gladys accepts', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const devices = catalog()
    .map((entry) => buildGladysDevice(gladys, entry))
    .filter(Boolean);
  // The fake Gladys refuses unknown categories, types and units, like the core.
  await gladys.publishDiscoveredDevices(devices);
  assert.ok(gladys.fake.discoveredDevices.length >= 100);
  for (const device of devices) {
    const ids = device.features.map((feature) => feature.external_id);
    assert.equal(new Set(ids).size, ids.length, `${device.name}: duplicate feature keys`);
    for (const feature of device.features) {
      assert.equal(typeof feature.read_only, 'boolean', `${device.name} ${feature.name}`);
      if (feature.supported_options) {
        for (const option of feature.supported_options) {
          assert.equal(typeof option.label, 'string');
          if (feature.type !== 'select') {
            assert.equal(typeof option.value, 'number', 'string values are for text/select only');
          }
        }
      }
    }
  }
});

test('every catalog device turns its cached parameters into valid states', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const entries = catalog();
  await gladys.publishDiscoveredDevices(
    entries.map((entry) => buildGladysDevice(gladys, entry)).filter(Boolean),
  );
  const states = entries.flatMap((entry) => readAll(gladys, entry));
  assert.ok(states.length > 100);
  await gladys.publishStates(states.slice(0, 100));
  for (const state of states) {
    assert.ok(Number.isFinite(state.state) || typeof state.text === 'string');
  }
});

test('the catalog adapts to the device parameters', () => {
  const keys = (device) => capabilitiesOf(device).map((capability) => capability.key);
  // DualR3 in motor mode becomes a cover.
  assert.ok(keys({ uiid: 126, params: { workMode: 2 } }).includes('position'));
  assert.ok(keys({ uiid: 126, params: { workMode: 1 } }).includes('switch_2'));
  // NSPanel thermostat only when a switch drives it.
  assert.ok(!keys({ uiid: 133, params: {} }).includes('target_temperature'));
  assert.ok(keys({ uiid: 133, params: { HMI_ATCDevice: {} } }).includes('target_temperature'));
  // Air monitors: only the sensors the device has.
  assert.deepEqual(keys({ uiid: 266, params: { co2: 1 } }), ['co2']);
  // POWR3 supply sensors only on the POWCT.
  assert.ok(!keys({ uiid: 190, params: {} }).includes('power_supply'));
  assert.ok(keys({ uiid: 190, params: { supplyPower: 1 } }).includes('power_supply'));
});

test('unknown UIIDs fall back on a relay or outlets, like SonoffLAN', () => {
  assert.equal(isKnownUiid(99999), false);
  assert.deepEqual(
    capabilitiesOf({ uiid: 99999, params: { switch: 'on' } }).map((c) => c.key),
    ['switch', 'led', 'pulse', 'pulse_width'],
  );
  assert.deepEqual(
    capabilitiesOf({ uiid: 99999, params: { switches: [{ outlet: 0 }, { outlet: 1 }] } }).map(
      (c) => c.key,
    ),
    ['switch_1', 'switch_2', 'led'],
  );
  assert.deepEqual(capabilitiesOf({ uiid: 99999, params: {} }), []);
});

test('DIY devices get their model from the LAN type', () => {
  assert.deepEqual(diyIdentity('diy_plug', { switch: 'on' }), { uiid: 1, model: 'MINI DIY' });
  assert.deepEqual(diyIdentity('diy_plug', { switches: [] }), { uiid: 77, model: 'MINI R3 DIY' });
  assert.deepEqual(diyIdentity('th_plug'), { uiid: 15, model: 'TH DIY' });
  assert.deepEqual(diyIdentity('something'), { uiid: 0, model: 'something' });
});

test('outlet lists merge by outlet, other parameters are replaced', () => {
  const cache = {
    switch: 'off',
    switches: [
      { outlet: 0, switch: 'off' },
      { outlet: 1, switch: 'off' },
    ],
  };
  assert.deepEqual(mergeParams(cache, { switch: 'on', switches: [{ outlet: 1, switch: 'on' }] }), {
    switch: 'on',
    switches: [
      { outlet: 0, switch: 'off' },
      { outlet: 1, switch: 'on' },
    ],
  });
});

test('device params carry the id, the model and the LAN address', () => {
  const gladys = createFakeGladys();
  const registry = new Registry();
  const entry = registry.upsertCloud({
    deviceid: '1000aabbcc',
    name: 'Plug',
    extra: { uiid: 1 },
    productModel: 'BASICR2',
    brandName: 'SONOFF',
    params: { switch: 'on', fwVersion: '3.7.0' },
  });
  entry.host = '192.168.1.5:8081';
  const device = buildGladysDevice(gladys, entry);
  assert.deepEqual(device.params, [
    { name: 'DEVICE_ID', value: '1000aabbcc' },
    { name: 'UIID', value: '1' },
    { name: 'MODEL', value: 'BASICR2' },
    { name: 'BRAND', value: 'SONOFF' },
    { name: 'FIRMWARE', value: '3.7.0' },
    { name: 'IP_ADDRESS', value: '192.168.1.5' },
  ]);
  assert.equal(device.external_id, gladys.externalIds('sonoff', '1000aabbcc').device);
});
