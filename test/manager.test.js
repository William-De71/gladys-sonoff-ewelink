import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createIntegration } from '../src/integration.js';
import { LocalClient } from '../src/ewelink/local.js';
import { decryptPayload, encryptPayload } from '../src/ewelink/crypto.js';
import { CLOUD_STATUS, DEVICE_CONNECTION_TRIGGER, CLOUD_STATUS_TRIGGER } from '../src/manager.js';
import { SESSION_KEY } from '../src/config.js';
import {
  DEVICE_KEY,
  FakeWebSocket,
  MemoryStore,
  cloudRoutes,
  fakeFetch,
  flush,
  mdnsRecord,
} from './helpers.js';

const APP = { app_id: 'my-app-id', app_secret: 'my-app-secret' };
const DIY_ID = '10000d1d1d';
const PLUG_ID = '1000aabbcc';
const BUTTON_ID = 'a4000b0b0b';

/** A small LAN: devices answering /zeroconf/<cmd> by IP, encrypted or not. */
class FakeLan {
  constructor() {
    this.devices = new Map();
    this.requests = [];
    this.post = this.post.bind(this);
  }

  add(ip, device) {
    this.devices.set(ip, { online: true, ...device });
  }

  async post(url, body) {
    const { hostname, pathname } = new URL(url);
    const command = pathname.split('/').at(-1);
    const device = this.devices.get(hostname);
    this.requests.push({ ip: hostname, command, body });
    if (!device?.online) {
      throw Object.assign(new Error('unreachable'), { code: 'EHOSTUNREACH' });
    }
    const data = body.encrypt ? decryptPayload(body.data, body.iv, device.devicekey) : body.data;
    if (command !== 'getState' && command !== 'sledOnline') {
      Object.assign(device.state, data);
    }
    const answer = { error: 0, seq: 1 };
    if (device.devicekey) {
      Object.assign(answer, encryptPayload(device.state, device.devicekey), { encrypt: true });
    }
    return { status: 200, contentType: 'application/json', text: JSON.stringify(answer) };
  }
}

function setup({
  config = {},
  mdns = [],
  cloudDevices = [],
  routes = {},
  lan = new FakeLan(),
} = {}) {
  FakeWebSocket.reset();
  const gladys = createFakeGladys({ config, scanResults: { mdns } });
  const fetch = fakeFetch(cloudRoutes(cloudDevices, routes));
  const integration = createIntegration(gladys, {
    store: new MemoryStore(),
    local: new LocalClient({ post: lan.post }),
    fetch,
    WebSocketImpl: FakeWebSocket,
  });
  return { gladys, fetch, lan, integration, manager: integration.manager };
}

const plugItem = (overrides = {}) => ({
  deviceid: PLUG_ID,
  name: 'Kitchen plug',
  extra: { uiid: 32 },
  apikey: 'user-apikey',
  devicekey: DEVICE_KEY,
  online: true,
  productModel: 'POWR2',
  brandName: 'SONOFF',
  params: { switch: 'off', power: '12.5', voltage: '230', current: '0.1', sledOnline: 'on' },
  ...overrides,
});

/** Last transport badge published for a device. */
const badgeOf = (gladys, externalId) =>
  gladys.fake.transports.filter((entry) => entry.device_external_id === externalId).at(-1);

const featureId = (gladys, deviceid, key) => gladys.externalIds('sonoff', deviceid).feature(key);
const deviceId = (gladys, deviceid) => gladys.externalIds('sonoff', deviceid).device;

test('local only: a DIY plug is discovered, read and switched over the LAN', async (t) => {
  const lan = new FakeLan();
  lan.add('192.168.1.60', { state: { switch: 'off' } });
  const { gladys, manager, integration } = setup({
    lan,
    mdns: [
      mdnsRecord({
        deviceid: DIY_ID,
        ip: '192.168.1.60',
        type: 'diy_plug',
        params: { switch: 'off' },
      }),
      // An encrypted device without key: seen, but not usable.
      mdnsRecord({
        deviceid: PLUG_ID,
        ip: '192.168.1.61',
        params: { switch: 'on' },
        devicekey: DEVICE_KEY,
      }),
      { name: 'Living room TV._googlecast._tcp.local', txt: [] },
    ],
  });
  t.after(() => integration.shutdown());
  await gladys.connect();
  await manager.firstCycle;

  const [device] = gladys.fake.discoveredDevices;
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(device.external_id, deviceId(gladys, DIY_ID));
  assert.equal(device.name, `MINI DIY ${DIY_ID}`);
  assert.equal(gladys.fake.lastState(featureId(gladys, DIY_ID, 'switch')), 0);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'local only is a normal mode');

  const feature = device.features.find(
    (f) => f.external_id === featureId(gladys, DIY_ID, 'switch'),
  );
  assert.deepEqual(await gladys.fake.setValue(device, feature, 1), { success: true });
  const command = lan.requests.find((r) => r.command === 'switch');
  assert.deepEqual(command.body.data, { switch: 'on' });
  assert.equal(gladys.fake.lastState(featureId(gladys, DIY_ID, 'switch')), 1);

  assert.equal(badgeOf(gladys, device.external_id).transport, 'local');
});

test('a device added by hand with its key is decrypted and published', async (t) => {
  const lan = new FakeLan();
  lan.add('192.168.1.61', { devicekey: DEVICE_KEY, state: { switch: 'on' } });
  const { gladys, manager, integration } = setup({
    lan,
    mdns: [
      mdnsRecord({
        deviceid: PLUG_ID,
        ip: '192.168.1.61',
        params: { switch: 'on' },
        devicekey: DEVICE_KEY,
      }),
    ],
  });
  t.after(() => integration.shutdown());
  await gladys.connect();
  const message = await gladys.fake.action('add_local_device', {
    deviceid: PLUG_ID.toUpperCase(),
    host: '',
    devicekey: DEVICE_KEY,
  });
  assert.equal(message.success, true);
  assert.match(message.data.message?.fr ?? JSON.stringify(message.data), /1000aabbcc/);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.lastState(featureId(gladys, PLUG_ID, 'switch')), 1);
  assert.deepEqual(JSON.parse(gladys.fake.config.local_devices), [
    { deviceid: PLUG_ID, devicekey: DEVICE_KEY },
  ]);
  // Poll: the encrypted answer refreshes the state.
  lan.devices.get('192.168.1.61').state.switch = 'off';
  await manager.pollLocal();
  assert.equal(gladys.fake.lastState(featureId(gladys, PLUG_ID, 'switch')), 0);
});

test('the manual device form refuses an invalid id or address, in four languages', async (t) => {
  const { gladys, integration } = setup();
  t.after(() => integration.shutdown());
  await gladys.connect();
  const bad = await gladys.fake.action('add_local_device', { deviceid: 'abc' });
  assert.equal(bad.success, true, 'a message, not an error: errors carry one language');
  const result = bad.data.message ?? bad.data;
  assert.deepEqual(Object.keys(result).sort(), ['de', 'en', 'es', 'fr']);
  const badIp = await gladys.fake.action('add_local_device', {
    deviceid: PLUG_ID,
    host: '300.1.1.1',
  });
  assert.match(JSON.stringify(badIp.data), /192\.168\.1\.42/);
});

async function connectOauth({ cloudDevices = [plugItem()], lan, mdns = [], routes } = {}) {
  const context = setup({
    config: { cloud_mode: 'oauth', ...APP },
    cloudDevices,
    lan,
    mdns,
    routes,
  });
  const { gladys, manager } = context;
  await gladys.connect();
  await manager.firstCycle;
  assert.equal(manager.cloudStatus, CLOUD_STATUS.AUTH_REQUIRED);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  const authorize = await gladys.fake.oauthAuthorizeUrl(
    'oauth',
    'https://my.gladysassistant.com/redirect/oauth',
  );
  const url = new URL(authorize.data.authorize_url);
  await gladys.fake.oauthCallback('oauth', {
    code: 'the-code',
    state: url.searchParams.get('state'),
    redirectUri: 'https://my.gladysassistant.com/redirect/oauth',
  });
  await flush();
  return context;
}

test('OAuth: the account is linked, the devices listed and followed in real time', async (t) => {
  const context = await connectOauth();
  const { gladys, manager, integration, fetch } = context;
  t.after(() => integration.shutdown());

  assert.equal(manager.cloudStatus, CLOUD_STATUS.CONNECTED);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const session = JSON.parse(gladys.fake.config[SESSION_KEY]);
  assert.equal(session.at, 'at-1');
  assert.equal(session.apikey, 'user-apikey');
  assert.ok(
    !fetch.calls.some((call) => JSON.stringify(call).includes('my-app-secret')),
    'secret never sent',
  );

  const plug = gladys.fake.discoveredDevices.find((d) => d.name === 'Kitchen plug');
  assert.ok(plug, 'the cloud name is used');
  assert.equal(gladys.fake.lastState(featureId(gladys, PLUG_ID, 'power')), 12.5);

  FakeWebSocket.last().push({
    action: 'update',
    deviceid: PLUG_ID,
    params: { switch: 'on', power: '1500.2' },
  });
  await flush();
  assert.equal(gladys.fake.lastState(featureId(gladys, PLUG_ID, 'switch')), 1);
  assert.equal(gladys.fake.lastState(featureId(gladys, PLUG_ID, 'power')), 1500.2);

  // No LAN address: the command goes through the cloud.
  const feature = plug.features.find((f) => f.external_id === featureId(gladys, PLUG_ID, 'switch'));
  assert.deepEqual(await gladys.fake.setValue(plug, feature, 0), { success: true });
  const update = FakeWebSocket.last()
    .frames()
    .find((frame) => frame.action === 'update' && 'switch' in frame.params);
  assert.deepEqual(update.params, { switch: 'off' });
  assert.equal(badgeOf(gladys, plug.external_id).transport, 'cloud');
});

test('OAuth refuses a callback whose state does not match', async (t) => {
  const { gladys, integration } = setup({ config: { cloud_mode: 'oauth', ...APP } });
  t.after(() => integration.shutdown());
  await gladys.connect();
  await gladys.fake.oauthAuthorizeUrl('oauth', 'https://redirect');
  const ack = await gladys.fake.oauthCallback('oauth', {
    code: 'c',
    state: 'forged',
    redirectUri: 'https://redirect',
  });
  assert.equal(ack.success, false);
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('LAN first, cloud as a fallback; the badge says why it is degraded', async (t) => {
  const lan = new FakeLan();
  lan.add('192.168.1.61', { devicekey: DEVICE_KEY, state: { switch: 'off' } });
  const mdns = [
    mdnsRecord({
      deviceid: PLUG_ID,
      ip: '192.168.1.61',
      params: { switch: 'off' },
      devicekey: DEVICE_KEY,
    }),
  ];
  const { gladys, manager, integration } = await connectOauth({ lan, mdns });
  t.after(() => integration.shutdown());
  await manager.scanLocal();
  await manager.pollLocal();
  const plug = gladys.fake.discoveredDevices.find((d) => d.name === 'Kitchen plug');
  const feature = plug.features.find((f) => f.external_id === featureId(gladys, PLUG_ID, 'switch'));
  const badge = () => badgeOf(gladys, plug.external_id);
  assert.equal(badge().transport, 'local');

  await gladys.fake.setValue(plug, feature, 1);
  assert.ok(
    lan.requests.some((r) => r.command === 'switch'),
    'sent over the LAN',
  );
  const cloudUpdates = () =>
    FakeWebSocket.last()
      .frames()
      .filter((f) => f.action === 'update' && 'switch' in f.params);
  assert.equal(cloudUpdates().length, 0);

  // The plug stops answering on the LAN: the cloud takes over.
  lan.devices.get('192.168.1.61').online = false;
  for (let i = 0; i < 3; i += 1) {
    await manager.pollLocal();
  }
  assert.deepEqual(await gladys.fake.setValue(plug, feature, 0), { success: true });
  assert.equal(cloudUpdates().length, 1);
  assert.equal(badge().transport, 'cloud');
  assert.equal(badge().degraded, true);
  assert.match(badge().message.fr, /réseau local/);
});

test('a device lost on both channels fires device_connection_changed', async (t) => {
  const lan = new FakeLan();
  lan.add('192.168.1.60', { state: { switch: 'off' } });
  const { gladys, manager, integration } = setup({
    lan,
    mdns: [
      mdnsRecord({
        deviceid: DIY_ID,
        ip: '192.168.1.60',
        type: 'diy_plug',
        params: { switch: 'off' },
      }),
    ],
  });
  t.after(() => integration.shutdown());
  await gladys.connect();
  await manager.firstCycle;
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first evaluation is a state, not an event');

  lan.devices.get('192.168.1.60').online = false;
  for (let i = 0; i < 3; i += 1) {
    await manager.pollLocal();
  }
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, DEVICE_CONNECTION_TRIGGER);
  assert.deepEqual(event.data, {
    device: deviceId(gladys, DIY_ID),
    device_name: `MINI DIY ${DIY_ID}`,
    status: 'offline',
  });
  assert.equal(badgeOf(gladys, deviceId(gladys, DIY_ID)).transport, 'unreachable');

  lan.devices.get('192.168.1.60').online = true;
  await manager.pollLocal();
  assert.equal(gladys.fake.sceneEvents.at(-1).data.status, 'online');
});

test('a Zigbee button press reaches the scenes, a replay does not', async (t) => {
  const button = {
    deviceid: BUTTON_ID,
    name: 'Bedside button',
    extra: { uiid: 7000 },
    apikey: 'user-apikey',
    online: true,
    params: { key: 0, trigTime: '1000', battery: 90, parentid: '1000bridge0' },
  };
  const { gladys, integration } = await connectOauth({ cloudDevices: [button] });
  t.after(() => integration.shutdown());
  const ws = FakeWebSocket.last();
  ws.push({ action: 'update', deviceid: BUTTON_ID, params: { key: 0, trigTime: '1000' } });
  await flush();
  const presses = () => gladys.fake.sceneEvents.filter((e) => e.key === 'button_pressed');
  assert.equal(presses().length, 0, 'the cached press is no new press');
  ws.push({ action: 'update', deviceid: BUTTON_ID, params: { key: 2, trigTime: '1001' } });
  await flush();
  const [event] = presses();
  assert.deepEqual(event.data, {
    device: deviceId(gladys, BUTTON_ID),
    device_name: 'Bedside button',
    button: '1',
    press: 'long',
  });
  assert.equal(gladys.fake.lastState(featureId(gladys, BUTTON_ID, 'button')), 6);
});

test('an exhausted quota leaves the LAN working and tells the user', async (t) => {
  const { gladys, manager, integration } = await connectOauth({
    routes: { 'GET /v2/device/thing': () => ({ httpStatus: 403 }) },
  });
  t.after(() => integration.shutdown());
  assert.equal(manager.cloudStatus, CLOUD_STATUS.QUOTA_EXHAUSTED);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /quota/);
});

test('a reconnection to Gladys keeps the cloud session (no new sign-in)', async (t) => {
  const { gladys, manager, integration } = await connectOauth();
  t.after(() => integration.shutdown());
  const sockets = FakeWebSocket.instances.length;
  await gladys.disconnect();
  await gladys.connect();
  await flush();
  assert.equal(FakeWebSocket.instances.length, sockets, 'no new userOnline');
  assert.equal(manager.cloudStatus, CLOUD_STATUS.CONNECTED);
});

test('a lost cloud connection fires cloud_status_changed and retries later', async (t) => {
  const { gladys, manager, integration } = await connectOauth();
  t.after(() => integration.shutdown());
  FakeWebSocket.last().close();
  await flush();
  assert.equal(manager.cloudStatus, CLOUD_STATUS.DISCONNECTED);
  const statuses = gladys.fake.sceneEvents
    .filter((e) => e.key === CLOUD_STATUS_TRIGGER)
    .map((e) => e.data.status);
  // auth_required (start) -> connected (OAuth) -> disconnected.
  assert.deepEqual(statuses, ['connected', 'disconnected']);
  assert.ok(manager.timers.cloudRetry, 'a retry is scheduled');
});

test('password mode signs in with the account and saves the session', async (t) => {
  const { gladys, manager, integration, fetch } = setup({
    config: { cloud_mode: 'password', ...APP, account: 'me@example.com', password: 'pw' },
    cloudDevices: [plugItem()],
  });
  t.after(() => integration.shutdown());
  await gladys.connect();
  await flush();
  assert.equal(manager.cloudStatus, CLOUD_STATUS.CONNECTED);
  const login = fetch.calls.find((call) => call.url.pathname === '/v2/user/login');
  assert.deepEqual(login.body, { countryCode: '+33', password: 'pw', email: 'me@example.com' });
  assert.equal(JSON.parse(gladys.fake.config[SESSION_KEY]).at, 'at-pw');
});

test('a failed list refresh during a scan keeps the WebSocket session', async (t) => {
  let failing = false;
  const { gladys, manager, integration } = await connectOauth({
    routes: {
      'GET /v2/device/thing': () =>
        failing ? { error: 500, msg: 'busy', data: {} } : { error: 0, data: { thingList: [] } },
    },
  });
  t.after(() => integration.shutdown());
  const sockets = FakeWebSocket.instances.length;
  failing = true;
  manager.cloudListAt = 0;
  await gladys.fake.scanRequest();
  assert.equal(manager.cloudStatus, CLOUD_STATUS.CONNECTED);
  assert.equal(FakeWebSocket.instances.length, sockets, 'no new sign-in');
});
