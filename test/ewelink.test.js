import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash } from 'node:crypto';
import { decryptPayload, encryptPayload, nonce, sign } from '../src/ewelink/crypto.js';
import {
  LOCAL_RESULT,
  LocalClient,
  parseMdnsService,
  readLocalParams,
} from '../src/ewelink/local.js';
import { nextSequence } from '../src/ewelink/sequence.js';
import { DEVICE_KEY, fakeDevicePost, mdnsRecord } from './helpers.js';

test('sign matches the examples of the eWeLink documentation', () => {
  // OAuth page: HMAC-SHA256(clientSecret, `${clientId}_${seq}`).
  assert.equal(sign('abc', 'ABC_123'), 'v1+mfNY2ukxswM8sZOTg99srZsVnUVv9DGXeav1096M=');
  // Login body signed with the App Secret.
  const body = JSON.stringify({ email: '1234@gmail.com', password: '12345678', countryCode: '+1' });
  assert.equal(
    sign('OdPuCZ4PkPPi0rVKRVcGmll2NM6vVk0c', body),
    'ttZ/gluzqrafvGonjMD20p4//arW6KoZKbo1SOMEzCA=',
  );
});

test('nonce is 8 alphanumeric characters', () => {
  assert.match(nonce(), /^[a-zA-Z0-9]{8}$/);
});

test('LAN payloads round-trip through AES-128-CBC keyed by MD5(devicekey)', () => {
  const params = { switch: 'on', startup: 'stay' };
  const { data, iv } = encryptPayload(params, DEVICE_KEY, Buffer.alloc(16, 7));
  assert.equal(iv, Buffer.alloc(16, 7).toString('base64'));
  assert.deepEqual(decryptPayload(data, iv, DEVICE_KEY), params);
  assert.deepEqual(decryptPayload('', iv, DEVICE_KEY), {});
});

test('decryptPayload fixes the RF Bridge syntax bug and the 0x02 padding', () => {
  const key = createHash('md5').update(DEVICE_KEY).digest();
  const iv = Buffer.alloc(16, 1);
  const encrypt = (text) => {
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
  };
  assert.deepEqual(
    decryptPayload(encrypt('{"rfTrig0"="2026"}'), iv.toString('base64'), DEVICE_KEY),
    {
      rfTrig0: '2026',
    },
  );
  assert.deepEqual(
    decryptPayload(encrypt('{"switch":"on"}\u0002\u0002'), iv.toString('base64'), DEVICE_KEY),
    { switch: 'on' },
  );
});

test('nextSequence never repeats within a millisecond', () => {
  const values = Array.from({ length: 50 }, () => nextSequence());
  assert.equal(new Set(values).size, values.length);
});

test('parseMdnsService reads a DIY record in clear text', () => {
  const message = parseMdnsService(
    mdnsRecord({ deviceid: '10000abcde', type: 'diy_plug', params: { switch: 'on' } }),
  );
  assert.deepEqual(message, {
    deviceid: '10000abcde',
    subdevid: '10000abcde',
    localtype: 'diy_plug',
    seq: '1',
    host: '192.168.1.50:8081',
    encrypted: false,
    params: { switch: 'on' },
  });
});

test('parseMdnsService keeps an encrypted record for later decryption', () => {
  const record = mdnsRecord({
    deviceid: '1000aabbcc',
    params: { switch: 'off' },
    devicekey: DEVICE_KEY,
  });
  const message = parseMdnsService(record);
  assert.equal(message.encrypted, true);
  assert.equal(readLocalParams(message, undefined), null, 'no key, no params');
  assert.equal(readLocalParams(message, 'wrong-key'), null, 'a wrong key is no crash');
  assert.deepEqual(readLocalParams(message, DEVICE_KEY), { switch: 'off' });
});

test('parseMdnsService ignores the other services of the eWeLink family', () => {
  assert.equal(parseMdnsService({ name: 'ihost-1001abcdef._ewelink._tcp.local', txt: [] }), null);
  assert.equal(parseMdnsService({ name: 'eWeLink_not-an-id._ewelink._tcp.local', txt: [] }), null);
  assert.equal(parseMdnsService(null), null);
});

test('LocalClient encrypts the command and decrypts the answer', async () => {
  const post = fakeDevicePost({
    devicekey: DEVICE_KEY,
    handler: (command, body) => {
      assert.equal(command, 'switch');
      assert.equal(body.encrypt, true);
      assert.deepEqual(decryptPayload(body.data, body.iv, DEVICE_KEY), { switch: 'on' });
      return { switch: 'on' };
    },
  });
  const client = new LocalClient({ post });
  const answer = await client.send(
    { deviceid: '1000aabbcc', host: '192.168.1.50', devicekey: DEVICE_KEY },
    { switch: 'on' },
  );
  assert.deepEqual(answer, { result: LOCAL_RESULT.ONLINE, params: { switch: 'on' } });
  assert.equal(post.calls[0].url, 'http://192.168.1.50:8081/zeroconf/switch');
});

test('LocalClient sends DIY commands in clear text', async () => {
  const post = fakeDevicePost({ handler: () => ({}) });
  const client = new LocalClient({ post });
  const answer = await client.send(
    { deviceid: '10000abcde', host: '10.0.0.2:8081' },
    { pulse: 'on' },
  );
  assert.equal(answer.result, LOCAL_RESULT.ONLINE);
  assert.deepEqual(post.calls[0].body.data, { pulse: 'on' });
  assert.equal(post.calls[0].body.encrypt, undefined);
});

test('LocalClient retries a connection reset (one request at a time per device)', async () => {
  let attempts = 0;
  const post = fakeDevicePost({
    handler: () => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      }
      return {};
    },
  });
  const answer = await new LocalClient({ post }).send(
    { deviceid: '10000abcde', host: '10.0.0.2' },
    { switch: 'off' },
  );
  assert.equal(answer.result, LOCAL_RESULT.ONLINE);
  assert.equal(attempts, 3);
});

test('LocalClient reports timeouts, unreachable hosts and refusals', async () => {
  const device = { deviceid: '10000abcde', host: '10.0.0.2' };
  const failing = (code) =>
    new LocalClient({
      post: async () => {
        throw Object.assign(new Error(code), { code });
      },
    });
  assert.equal((await failing('ETIMEDOUT').send(device, {})).result, LOCAL_RESULT.TIMEOUT);
  assert.equal((await failing('EHOSTUNREACH').send(device, {})).result, LOCAL_RESULT.UNREACHABLE);
  const refusing = new LocalClient({ post: fakeDevicePost({ handler: () => null }) });
  assert.equal((await refusing.send(device, { switch: 'on' })).result, LOCAL_RESULT.ERROR);
  // A device that does not know getState still proves it is alive.
  assert.equal((await refusing.send(device)).result, LOCAL_RESULT.ONLINE);
  const html = new LocalClient({
    post: async () => ({ status: 200, contentType: 'text/html', text: '<html></html>' }),
  });
  assert.equal((await html.send(device)).result, LOCAL_RESULT.ONLINE);
  assert.equal((await html.send(device, { switch: 'on' })).result, LOCAL_RESULT.ERROR);
});
