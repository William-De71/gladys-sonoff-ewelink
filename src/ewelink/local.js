// -----------------------------------------------------------------------------
// eWeLink LAN protocol ("zeroconf"), ported from SonoffLAN (AlexxIT, MIT).
//
// Discovery and state: every device announces the `_ewelink._tcp` mDNS service.
// Its TXT record carries the device id, its LAN type, a sequence number and the
// device parameters in `data1`..`data4` (AES encrypted with the devicekey, or in
// clear text for the DIY mode). The integration container sits on a bridge
// network and never sees multicast: the Gladys core browses mDNS for it
// (`scanNetwork('mdns')`) and relays the raw records parsed here.
//
// Commands: `POST http://<ip>:8081/zeroconf/<command>` with a JSON body, in
// unicast (unicast crosses the bridge). An encrypted device answers with its new
// parameters, encrypted too. The device web server handles one request at a
// time and resets the others: a reset is retried a few times.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { nextSequence } from './sequence.js';
import { decryptPayload, encryptPayload } from './crypto.js';

export const LOCAL_DEFAULT_PORT = 8081;

export const LOCAL_RESULT = {
  ONLINE: 'online',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
};

const RESET_RETRIES = 10;
const RESET_RETRY_DELAY_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal JSON POST over node:http. `Connection: close` (the device web server
 * keeps no session) and no keep-alive agent.
 * @param {string} url - Target URL.
 * @param {object} body - JSON body.
 * @param {number} timeoutMs - Whole request timeout.
 * @returns {Promise<{ status: number, contentType: string, text: string }>} The answer.
 */
export function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const request = http.request(
      url,
      {
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Connection: 'close',
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            contentType: String(response.headers['content-type'] ?? ''),
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`timeout after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(payload);
  });
}

/**
 * Parse one record of an mDNS scan relayed by the core.
 * @param {{ name: string, host?: string, addresses?: string[], port?: number, txt?: string[] }} service
 *   Raw scan entry.
 * @returns {null | {
 *   deviceid: string, subdevid: string, localtype: string, seq?: string,
 *   host?: string, encrypted: boolean, data?: string, iv?: string, params?: object
 * }} The message, or null when the record is not an eWeLink device.
 */
export function parseMdnsService(service) {
  const name = String(service?.name ?? '');
  // eWeLink_1000xxxxxx and eWelink_1000xxxxxx (UIID 104) are devices; skip
  // ihost-*, zbbridgeu-* and the other services of the eWeLink family.
  if (!name.toLowerCase().startsWith('ewelink')) {
    return null;
  }
  const txt = parseMdnsTxt(service.txt ?? []);
  const deviceid = name.slice(8, 18);
  if (!/^[0-9a-f]{10}$/i.test(deviceid)) {
    return null;
  }
  const raw = ['data1', 'data2', 'data3', 'data4']
    .map((key) => (typeof txt[key] === 'string' ? txt[key] : ''))
    .join('');
  const address = (service.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  let host;
  if (address) {
    host = service.port ? `${address}:${service.port}` : address;
  } else if (service.host && service.port) {
    host = `${service.host.replace(/\.$/, '')}:${service.port}`;
  }
  const message = {
    deviceid,
    subdevid: typeof txt.id === 'string' ? txt.id : deviceid,
    localtype: typeof txt.type === 'string' ? txt.type : '',
    seq: typeof txt.seq === 'string' ? txt.seq : undefined,
    host,
    encrypted: txt.encrypt === 'true',
  };
  if (message.encrypted) {
    message.data = raw;
    message.iv = typeof txt.iv === 'string' ? txt.iv : '';
  } else if (raw) {
    try {
      message.params = JSON.parse(raw);
    } catch {
      return null;
    }
  } else {
    message.params = {};
  }
  return message;
}

/**
 * Decrypt the payload of a LAN message when needed.
 * @param {{ encrypted?: boolean, data?: string, iv?: string, params?: object }} message - Message.
 * @param {string | undefined} devicekey - The device key.
 * @returns {object | null} The parameters, or null when they cannot be read.
 */
export function readLocalParams(message, devicekey) {
  if (!message.encrypted) {
    return message.params ?? {};
  }
  if (!devicekey) {
    return null;
  }
  try {
    return decryptPayload(message.data, message.iv, devicekey);
  } catch {
    return null;
  }
}

export class LocalClient {
  /**
   * @param {object} [options] - Options.
   * @param {typeof postJson} [options.post] - HTTP transport (replaced in tests).
   * @param {() => string} [options.sequence] - Sequence generator.
   */
  constructor({ post = postJson, sequence = nextSequence } = {}) {
    this.post = post;
    this.sequence = sequence;
  }

  /**
   * Send a command to a device over the LAN.
   * @param {{ deviceid: string, host: string, devicekey?: string }} device - Target.
   * @param {object} [params] - Parameters; empty = a harmless state request.
   * @param {object} [options] - Options.
   * @param {string} [options.command] - Zeroconf command (defaults to the first param key).
   * @param {number} [options.timeoutMs] - Timeout.
   * @returns {Promise<{ result: string, params?: object }>} The outcome, and the
   *   parameters the device answered with (encrypted devices only).
   */
  async send(device, params = {}, { command, timeoutMs = 5000 } = {}) {
    const cmd = command ?? Object.keys(params)[0] ?? 'getState';
    let body = {
      sequence: this.sequence(),
      deviceid: device.deviceid,
      selfApikey: '123',
      data: params,
    };
    if (device.devicekey) {
      body = { ...body, encrypt: true, ...encryptPayload(params, device.devicekey) };
    }
    const host = device.host.includes(':') ? device.host : `${device.host}:${LOCAL_DEFAULT_PORT}`;
    const url = `http://${host}/zeroconf/${cmd}`;

    for (let attempt = 0; ; attempt += 1) {
      let answer;
      try {
        answer = await this.post(url, body, timeoutMs);
      } catch (error) {
        if (error?.code === 'ECONNRESET' && attempt < RESET_RETRIES) {
          // The device serves one request at a time and resets the others.
          await sleep(RESET_RETRY_DELAY_MS);
          continue;
        }
        if (error?.code === 'ETIMEDOUT') {
          return { result: LOCAL_RESULT.TIMEOUT };
        }
        return { result: LOCAL_RESULT.UNREACHABLE };
      }
      return this.readAnswer(answer, cmd, device);
    }
  }

  readAnswer(answer, cmd, device) {
    // Some devices answer `getState` with an HTML page: they are alive.
    if (answer.contentType.startsWith('text/html')) {
      return { result: cmd === 'getState' ? LOCAL_RESULT.ONLINE : LOCAL_RESULT.ERROR };
    }
    let json;
    try {
      json = JSON.parse(answer.text);
    } catch {
      return { result: LOCAL_RESULT.ERROR };
    }
    if (json.error !== 0) {
      // A device that does not know `getState` still proves it is reachable.
      return { result: cmd === 'getState' ? LOCAL_RESULT.ONLINE : LOCAL_RESULT.ERROR };
    }
    if (json.iv && device.devicekey) {
      try {
        return {
          result: LOCAL_RESULT.ONLINE,
          params: decryptPayload(json.data, json.iv, device.devicekey),
        };
      } catch {
        return { result: LOCAL_RESULT.ONLINE };
      }
    }
    if (json.data && typeof json.data === 'object') {
      // DIY mode answers in clear text (e.g. /zeroconf/info).
      return { result: LOCAL_RESULT.ONLINE, params: json.data };
    }
    return { result: LOCAL_RESULT.ONLINE };
  }
}
