import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudApi, EwelinkError } from '../src/ewelink/cloud.js';
import { sign } from '../src/ewelink/crypto.js';
import { CloudSocket, SOCKET_RESULT } from '../src/ewelink/socket.js';
import { cloudRoutes, FakeWebSocket, fakeFetch, flush } from './helpers.js';

const APP = { appId: 'app-id-123', appSecret: 'app-secret-456' };

test('the OAuth page URL is signed with the App Secret', () => {
  const api = new CloudApi(APP);
  const url = new URL(api.authorizeUrl('https://my.gladysassistant.com/redirect/oauth', 'st', 42));
  assert.equal(url.origin + url.pathname, 'https://c2ccdn.coolkit.cc/oauth/index.html');
  assert.equal(url.searchParams.get('clientId'), APP.appId);
  assert.equal(url.searchParams.get('seq'), '42');
  assert.equal(url.searchParams.get('authorization'), sign(APP.appSecret, `${APP.appId}_42`));
  assert.equal(
    url.searchParams.get('redirectUrl'),
    'https://my.gladysassistant.com/redirect/oauth',
  );
  assert.equal(url.searchParams.get('grantType'), 'authorization_code');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.match(url.searchParams.get('nonce'), /^[a-zA-Z0-9]{8}$/);
});

test('requests before login are signed, the others carry the token', async () => {
  const fetch = fakeFetch(cloudRoutes([]));
  const counted = [];
  const api = new CloudApi({ ...APP, fetch, onRequest: () => counted.push(1) });
  await api.exchangeCode('code-1', 'https://redirect');
  const [token] = fetch.calls;
  assert.equal(token.url.origin, 'https://eu-apia.coolkit.cc');
  assert.equal(token.headers['X-CK-Appid'], APP.appId);
  assert.equal(
    token.headers.Authorization,
    `Sign ${sign(APP.appSecret, JSON.stringify(token.body))}`,
  );
  await api.getApikey('at-1');
  assert.equal(fetch.calls[1].headers.Authorization, 'Bearer at-1');
  assert.equal(counted.length, 2, 'every API call is counted for the monthly quota');
});

test('the OAuth code is tried in the other regions when the configured one refuses it', async () => {
  const fetch = fakeFetch(
    cloudRoutes([], {
      'POST /v2/user/oauth/token': ({ url }) =>
        url.hostname.startsWith('us-')
          ? { error: 0, data: { accessToken: 'at-us', refreshToken: 'rt-us' } }
          : { error: 405, msg: 'invalid code', data: {} },
    }),
  );
  const api = new CloudApi({ ...APP, fetch });
  const tokens = await api.exchangeCode('code', 'https://redirect');
  assert.equal(tokens.region, 'us');
  assert.equal(tokens.at, 'at-us');
  assert.equal(api.region, 'us');
});

test('the password login follows the region redirection (error 10004)', async () => {
  const fetch = fakeFetch(
    cloudRoutes([], {
      'POST /v2/user/login': ({ url, body }) => {
        assert.equal(body.email, 'me@example.com');
        assert.equal(body.countryCode, '+33');
        return url.hostname.startsWith('as-')
          ? { error: 0, data: { at: 'at', rt: 'rt', user: { apikey: 'key' } } }
          : { error: 10004, msg: 'redirection', data: { region: 'as' } };
      },
    }),
  );
  const api = new CloudApi({ ...APP, fetch });
  assert.deepEqual(await api.login('me@example.com', 'secret', '+33'), {
    at: 'at',
    rt: 'rt',
    apikey: 'key',
    region: 'as',
  });
});

test('a phone number login gets its international prefix', async () => {
  const fetch = fakeFetch(cloudRoutes([]));
  await new CloudApi({ ...APP, fetch }).login('33612345678', 'secret', '+33');
  assert.equal(fetch.calls[0].body.phoneNumber, '+33612345678');
});

test('the device list merges every home and skips the groups', async () => {
  const device = (deviceid) => ({ deviceid, name: deviceid, extra: { uiid: 1 }, params: {} });
  const fetch = fakeFetch(
    cloudRoutes([], {
      'GET /v2/family': () => ({
        error: 0,
        data: {
          familyList: [
            { id: 'h1', name: 'A' },
            { id: 'h2', name: 'B' },
          ],
        },
      }),
      'GET /v2/device/thing': ({ url }) => ({
        error: 0,
        data: {
          thingList:
            url.searchParams.get('familyid') === 'h1'
              ? [
                  { itemType: 1, itemData: device('1000000001') },
                  { itemType: 3, itemData: { id: 'g' } },
                ]
              : [
                  { itemType: 2, itemData: device('1000000002') },
                  { itemType: 1, itemData: device('1000000001') },
                ],
        },
      }),
    }),
  );
  const devices = await new CloudApi({ ...APP, fetch }).getDevices('at');
  assert.deepEqual(
    devices.map((d) => d.deviceid),
    ['1000000001', '1000000002'],
  );
});

test('API errors carry their eWeLink code', async () => {
  const fetch = fakeFetch(
    cloudRoutes([], {
      'GET /v2/user/profile': () => ({ error: 402, msg: 'token expired', data: {} }),
      'GET /v2/family': () => ({ httpStatus: 403 }),
    }),
  );
  const api = new CloudApi({ ...APP, fetch });
  await assert.rejects(api.getApikey('at'), (error) => {
    assert.ok(error instanceof EwelinkError);
    assert.equal(error.isAuthError, true);
    return true;
  });
  await assert.rejects(api.getHomes('at'), (error) => error.isQuotaError);
  const offline = new CloudApi({
    ...APP,
    fetch: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  await assert.rejects(offline.getHomes('at'), (error) => error.code === 'network');
});

test('the WebSocket authenticates, relays updates and matches answers by sequence', async (t) => {
  FakeWebSocket.reset();
  const socket = new CloudSocket({ WebSocketImpl: FakeWebSocket });
  t.after(() => socket.close());
  const updates = [];
  socket.on('update', (update) => updates.push(update));
  await socket.connect({ url: 'wss://x/api/ws', at: 'at', apikey: 'user', appId: 'app' });
  const ws = FakeWebSocket.last();
  const [handshake] = ws.frames();
  assert.equal(handshake.action, 'userOnline');
  assert.equal(handshake.at, 'at');
  assert.equal(handshake.appid, 'app');
  assert.equal(handshake.version, 8);
  assert.equal(socket.online, true);

  // Shared device: the command carries the owner's apikey.
  const result = await socket.send({ deviceid: '1000aabbcc', apikey: 'owner' }, 'user', {
    switch: 'on',
  });
  assert.equal(result, SOCKET_RESULT.ONLINE);
  const command = ws.frames()[1];
  assert.deepEqual(
    { action: command.action, apikey: command.apikey, selfApikey: command.selfApikey },
    { action: 'update', apikey: 'owner', selfApikey: 'user' },
  );

  ws.push({ action: 'update', deviceid: '1000aabbcc', params: { switch: 'off' } });
  ws.push({ action: 'sysmsg', deviceid: '1000aabbcc', params: { online: false } });
  assert.deepEqual(updates, [
    { deviceid: '1000aabbcc', params: { switch: 'off' } },
    { deviceid: '1000aabbcc', params: { online: false } },
  ]);
});

test('the WebSocket reports an offline device and a lost connection', async () => {
  FakeWebSocket.reset();
  const socket = new CloudSocket({ WebSocketImpl: FakeWebSocket });
  await socket.connect({ url: 'wss://x', at: 'at', apikey: 'user', appId: 'app' });
  FakeWebSocket.commandError = 503;
  assert.equal(
    await socket.send({ deviceid: '1000aabbcc', apikey: 'user' }, 'user', { switch: 'on' }),
    SOCKET_RESULT.OFFLINE,
  );
  let disconnected = false;
  socket.on('disconnected', () => {
    disconnected = true;
  });
  FakeWebSocket.last().close();
  await flush();
  assert.equal(disconnected, true);
  assert.equal(
    await socket.send({ deviceid: '1000aabbcc' }, 'user', { switch: 'on' }),
    SOCKET_RESULT.DISCONNECTED,
  );
});

test('a refused WebSocket session is reported (406: signed in elsewhere)', async () => {
  FakeWebSocket.reset();
  FakeWebSocket.handshake = { error: 406, reason: 'Authentication Failed' };
  const socket = new CloudSocket({ WebSocketImpl: FakeWebSocket });
  let authError = false;
  socket.on('auth-error', () => {
    authError = true;
  });
  await assert.rejects(
    socket.connect({ url: 'wss://x', at: 'at', apikey: 'u', appId: 'a' }),
    /406/,
  );
  assert.equal(authError, true);
  assert.equal(socket.online, false);
  FakeWebSocket.reset();
});
