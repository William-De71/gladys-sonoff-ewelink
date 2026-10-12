// -----------------------------------------------------------------------------
// eWeLink cloud WebSocket: real-time device updates and commands.
//
// One persistent connection per account: the devices report every change on
// it, and commands travel on it too (`action: "update"`, answered with the
// same `sequence`). CoolKit bans the IPs that send `userOnline` too often, so
// the reconnection backs off from 15 s up to an hour.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { nonce } from './crypto.js';
import { nextSequence } from './sequence.js';

export const SOCKET_RESULT = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  TIMEOUT: 'timeout',
  DISCONNECTED: 'disconnected',
};

const ERROR_RESULTS = { 0: SOCKET_RESULT.ONLINE, 503: SOCKET_RESULT.OFFLINE, 504: 'timeout' };
const HANDSHAKE_TIMEOUT_MS = 15_000;
// The cloud drops the connection of a client that floods it.
const MIN_SEND_INTERVAL_MS = 100;

/**
 * Events: `connected`, `disconnected`, `update` ({ deviceid, params }),
 * `auth-error` (406: the token is refused).
 */
export class CloudSocket extends EventEmitter {
  /**
   * @param {object} options - Options.
   * @param {typeof WebSocket} [options.WebSocketImpl] - WebSocket class (replaced in tests).
   * @param {() => string} [options.sequence] - Sequence generator.
   */
  constructor({ WebSocketImpl = globalThis.WebSocket, sequence = nextSequence } = {}) {
    super();
    this.WebSocketImpl = WebSocketImpl;
    this.sequence = sequence;
    this.ws = null;
    this.online = false;
    this.waiters = new Map();
    this.pingTimer = null;
    this.lastSend = 0;
  }

  /**
   * Open the connection and authenticate.
   * @param {{ url: string, at: string, apikey: string, appId: string }} auth - Credentials.
   * @returns {Promise<void>} Resolves once `userOnline` is accepted.
   */
  connect({ url, at, apikey, appId }) {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new this.WebSocketImpl(url);
      this.ws = ws;
      let handshaken = false;
      const timer = setTimeout(() => {
        fail(new Error('WebSocket handshake timeout'));
      }, HANDSHAKE_TIMEOUT_MS);

      const fail = (error) => {
        clearTimeout(timer);
        if (!handshaken) {
          handshaken = true;
          this.close();
          reject(error);
        }
      };

      ws.addEventListener('open', () => {
        const ts = Math.floor(Date.now() / 1000);
        ws.send(
          JSON.stringify({
            action: 'userOnline',
            at,
            apikey,
            appid: appId,
            nonce: nonce(),
            ts,
            userAgent: 'app',
            sequence: this.sequence(),
            version: 8,
          }),
        );
      });

      ws.addEventListener('message', (event) => {
        const text = typeof event.data === 'string' ? event.data : String(event.data);
        if (text === 'pong') {
          return;
        }
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          return;
        }
        if (!handshaken) {
          clearTimeout(timer);
          handshaken = true;
          if (message.error && message.error !== 0) {
            const error = new Error(`WebSocket authentication refused (${message.error})`);
            error.code = message.error;
            this.close();
            if (message.error === 406) {
              this.emit('auth-error', error);
            }
            reject(error);
            return;
          }
          this.online = true;
          this.startPing(message.config);
          this.emit('connected');
          resolve();
          return;
        }
        this.handleMessage(message);
      });

      ws.addEventListener('close', () => {
        fail(new Error('WebSocket closed during the handshake'));
        if (this.ws === ws) {
          this.markDisconnected();
        }
      });

      ws.addEventListener('error', () => {
        fail(new Error('WebSocket error'));
      });
    });
  }

  startPing(config) {
    clearInterval(this.pingTimer);
    // The documentation asks for the announced interval + 7 s (90 s by default).
    const seconds = config?.hb ? Number(config.hbInterval ?? 90) + 7 : 90;
    this.pingTimer = setInterval(() => {
      try {
        this.ws?.send('ping');
      } catch {
        // A broken socket is caught by its close event.
      }
    }, seconds * 1000);
    this.pingTimer.unref?.();
  }

  handleMessage(message) {
    if (!message.action) {
      // Answer to one of our requests: query (with params) or update.
      if (message.sequence && this.waiters.has(message.sequence)) {
        const resolveWaiter = this.waiters.get(message.sequence);
        this.waiters.delete(message.sequence);
        resolveWaiter(ERROR_RESULTS[message.error ?? 0] ?? `error-${message.error}`);
      }
      const params = message.params ?? message.config;
      if (message.deviceid && params && typeof params === 'object') {
        this.emit('update', { deviceid: message.deviceid, params, fromQuery: true });
      }
      return;
    }
    if ((message.action === 'update' || message.action === 'sysmsg') && message.deviceid) {
      this.emit('update', { deviceid: message.deviceid, params: message.params ?? {} });
    }
    // reportSubDevice, notify, subDevice: nothing useful for Gladys.
  }

  markDisconnected() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const resolveWaiter of this.waiters.values()) {
      resolveWaiter(SOCKET_RESULT.DISCONNECTED);
    }
    this.waiters.clear();
    if (this.online) {
      this.online = false;
      this.emit('disconnected');
    }
  }

  /**
   * Send a command (params) or a state query (no params) to a device.
   * @param {{ deviceid: string, apikey: string }} device - Target (apikey of its owner).
   * @param {string} selfApikey - Apikey of the signed-in account.
   * @param {object} [params] - Parameters to set; omitted = query the state.
   * @param {number} [timeoutMs] - Answer timeout; 0 = do not wait.
   * @returns {Promise<string>} One of SOCKET_RESULT.
   */
  async send(device, selfApikey, params, timeoutMs = 5000) {
    if (!this.online || !this.ws) {
      return SOCKET_RESULT.DISCONNECTED;
    }
    const wait = this.lastSend + MIN_SEND_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastSend = Date.now();
    const sequence = this.sequence();
    const payload = {
      action: params ? 'update' : 'query',
      // The owner's apikey: a shared device belongs to another account.
      apikey: device.apikey ?? selfApikey,
      selfApikey,
      deviceid: device.deviceid,
      params: params ?? [],
      userAgent: 'app',
      sequence,
    };
    const answer =
      timeoutMs > 0
        ? new Promise((resolve) => {
            const timer = setTimeout(() => {
              this.waiters.delete(sequence);
              resolve(SOCKET_RESULT.TIMEOUT);
            }, timeoutMs);
            this.waiters.set(sequence, (result) => {
              clearTimeout(timer);
              resolve(result);
            });
          })
        : Promise.resolve(SOCKET_RESULT.ONLINE);
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      this.waiters.delete(sequence);
      return SOCKET_RESULT.DISCONNECTED;
    }
    return answer;
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    this.markDisconnected();
    if (ws) {
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    }
  }
}
