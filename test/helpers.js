// Test doubles: no test touches the network. The LAN devices, the eWeLink API
// and its WebSocket are simulated in memory.

import { EventEmitter } from 'node:events';
import { encryptPayload } from '../src/ewelink/crypto.js';

export const DEVICE_KEY = '1f2e3d4c-5b6a-7980-a1b2-c3d4e5f60718';

/** In-memory replacement of the /data JSON store. */
export class MemoryStore {
  constructor(files = {}) {
    this.files = { ...files };
  }

  async read(name, fallback) {
    return name in this.files ? structuredClone(this.files[name]) : fallback;
  }

  async write(name, value) {
    this.files[name] = structuredClone(value);
  }
}

/** A raw mDNS record, as `scanNetwork('mdns')` relays it. */
export function mdnsRecord({
  deviceid,
  ip = '192.168.1.50',
  type = 'plug',
  params,
  devicekey,
  seq = '1',
}) {
  const txt = [`id=${deviceid}`, `type=${type}`, `seq=${seq}`, 'txtvers=1', 'apivers=1'];
  if (devicekey) {
    const { data, iv } = encryptPayload(params, devicekey);
    txt.push('encrypt=true', `iv=${iv}`, `data1=${data}`);
  } else {
    txt.push(`data1=${JSON.stringify(params)}`);
  }
  return {
    name: `eWeLink_${deviceid}._ewelink._tcp.local`,
    host: `eWeLink_${deviceid}.local`,
    addresses: [ip],
    port: 8081,
    txt,
  };
}

/**
 * HTTP transport of LocalClient answering like a device: `handler(cmd, data)`
 * returns the new params (or throws an error with a `code`).
 */
export function fakeDevicePost({ devicekey, handler = () => ({}) } = {}) {
  const calls = [];
  const post = async (url, body) => {
    calls.push({ url, body });
    const command = url.split('/zeroconf/')[1];
    const params = await handler(command, body);
    if (params === null) {
      return { status: 200, contentType: 'application/json', text: '{"error":400}' };
    }
    const answer = { seq: 2, sequence: body.sequence, error: 0 };
    if (devicekey) {
      Object.assign(answer, encryptPayload(params, devicekey), { encrypt: true });
    } else if (params && Object.keys(params).length > 0) {
      answer.data = params;
    }
    return { status: 200, contentType: 'application/json', text: JSON.stringify(answer) };
  };
  post.calls = calls;
  return post;
}

/** fetch() answering the eWeLink API from a route table. */
export function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const target = new URL(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: target, method: options.method ?? 'GET', headers: options.headers, body });
    const route = routes[`${options.method ?? 'GET'} ${target.pathname}`];
    if (!route) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const answer = await route({ url: target, body, headers: options.headers });
    const status = answer?.httpStatus ?? 200;
    return { ok: status < 400, status, json: async () => answer };
  };
  fetch.calls = calls;
  return fetch;
}

/** WebSocket double: accepts userOnline, records frames, lets tests push messages. */
export class FakeWebSocket extends EventEmitter {
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeWebSocket.instances.push(this);
    setImmediate(() => this.emit('open', {}));
  }

  addEventListener(event, listener) {
    this.on(event, listener);
  }

  send(text) {
    this.sent.push(text);
    if (text === 'ping') {
      return;
    }
    const message = JSON.parse(text);
    if (message.action === 'userOnline') {
      const answer = FakeWebSocket.handshake ?? { error: 0, config: { hb: 1, hbInterval: 145 } };
      setImmediate(() => this.push({ ...answer, sequence: message.sequence }));
    } else if (message.action === 'update' || message.action === 'query') {
      const error = FakeWebSocket.commandError ?? 0;
      setImmediate(() =>
        this.push({ error, deviceid: message.deviceid, sequence: message.sequence }),
      );
    }
  }

  push(message) {
    this.emit('message', { data: JSON.stringify(message) });
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.emit('close', {});
    }
  }

  static reset() {
    FakeWebSocket.instances = [];
    FakeWebSocket.handshake = undefined;
    FakeWebSocket.commandError = undefined;
  }

  static last() {
    return FakeWebSocket.instances.at(-1);
  }

  frames() {
    return this.sent.filter((text) => text !== 'ping').map((text) => JSON.parse(text));
  }
}

/** Cloud API routes of an account holding `devices` (itemData objects). */
export function cloudRoutes(devices, overrides = {}) {
  return {
    'POST /v2/user/oauth/token': () => ({
      error: 0,
      data: {
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        atExpiredTime: Date.now() + 30 * 86_400_000,
        rtExpiredTime: Date.now() + 60 * 86_400_000,
      },
    }),
    'POST /v2/user/login': () => ({
      error: 0,
      data: { at: 'at-pw', rt: 'rt-pw', user: { apikey: 'user-apikey' }, region: 'eu' },
    }),
    'POST /v2/user/refresh': () => ({ error: 0, data: { at: 'at-2', rt: 'rt-2' } }),
    'GET /v2/user/profile': () => ({ error: 0, data: { user: { apikey: 'user-apikey' } } }),
    'GET /v2/family': () => ({ error: 0, data: { familyList: [{ id: 'home-1', name: 'Home' }] } }),
    'GET /v2/device/thing': () => ({
      error: 0,
      data: { thingList: devices.map((itemData) => ({ itemType: 1, itemData })) },
    }),
    'GET /dispatch/app': () => ({ error: 0, domain: 'eu-pconnect3.coolkit.cc', port: 8080 }),
    ...overrides,
  };
}

/** Wait for the pending promises and immediates (WebSocket doubles). */
export const flush = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
