// -----------------------------------------------------------------------------
// eWeLink cloud API v2 (CoolKit), REST part.
// https://coolkit-technologies.github.io/eWeLink-API/#/en/OAuth2.0
//
// The integration never embeds an App ID nor an App Secret: the user brings
// the ones of their own eWeLink developer application (dev.ewelink.cc). Two
// ways to obtain an access token:
//   - OAuth 2.0 (the only one CoolKit opens to personal developers): the user
//     signs in on the eWeLink page, Gladys relays the authorization code;
//   - e-mail (or phone) + password login, for App IDs allowed to use it.
// Requests made before login are signed with HMAC-SHA256 (App Secret).
// -----------------------------------------------------------------------------

import { nonce, sign } from './crypto.js';

export const REGIONS = ['eu', 'us', 'as', 'cn'];

export const API_HOSTS = {
  cn: 'https://cn-apia.coolkit.cn',
  as: 'https://as-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  eu: 'https://eu-apia.coolkit.cc',
};

export const DISPATCH_HOSTS = {
  cn: 'https://cn-dispa.coolkit.cn/dispatch/app',
  as: 'https://as-dispa.coolkit.cc/dispatch/app',
  us: 'https://us-dispa.coolkit.cc/dispatch/app',
  eu: 'https://eu-dispa.coolkit.cc/dispatch/app',
};

export const OAUTH_PAGE = 'https://c2ccdn.coolkit.cc/oauth/index.html';

const REQUEST_TIMEOUT_MS = 15_000;

/** API error: `code` is the eWeLink `error` field (or the HTTP status). */
export class EwelinkError extends Error {
  constructor(code, message, data) {
    super(`eWeLink error ${code}${message ? `: ${message}` : ''}`);
    this.name = 'EwelinkError';
    this.code = code;
    this.data = data;
  }

  /** The access token is refused or expired: refresh it, then sign in again. */
  get isAuthError() {
    return this.code === 401 || this.code === 402;
  }

  /** The free App ID quota (50,000 calls a month per region) is exhausted. */
  get isQuotaError() {
    return this.code === 412 || this.code === 403;
  }
}

export class CloudApi {
  /**
   * @param {object} options - Options.
   * @param {string} options.appId - App ID of the user's developer application.
   * @param {string} options.appSecret - Its App Secret.
   * @param {string} [options.region] - eu | us | as | cn.
   * @param {typeof fetch} [options.fetch] - HTTP client (replaced in tests).
   * @param {() => void} [options.onRequest] - Called for every API call (quota counter).
   */
  constructor({ appId, appSecret, region = 'eu', fetch = globalThis.fetch, onRequest = () => {} }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.region = REGIONS.includes(region) ? region : 'eu';
    this.fetch = fetch;
    this.onRequest = onRequest;
  }

  get host() {
    return API_HOSTS[this.region];
  }

  /**
   * One API call. eWeLink answers HTTP 200 with an `error` field; the HTTP
   * status only matters for the exhausted quota (403) and outages.
   * @returns {Promise<object>} The `data` field.
   */
  async request(method, path, { body, query, at, host = this.host } = {}) {
    const url = new URL(path, host);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = { 'X-CK-Appid': this.appId, 'X-CK-Nonce': nonce() };
    if (text !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    // The signed text must be the exact body sent: sign the serialized string.
    headers.Authorization = at ? `Bearer ${at}` : `Sign ${sign(this.appSecret, text ?? '')}`;

    this.onRequest();
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: text,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new EwelinkError('network', error?.message ?? String(error));
    }
    if (!response.ok) {
      throw new EwelinkError(response.status, `HTTP ${response.status}`);
    }
    let json;
    try {
      json = await response.json();
    } catch {
      throw new EwelinkError('invalid', 'invalid JSON answer');
    }
    if (json.error !== 0) {
      throw new EwelinkError(json.error, json.msg, json.data);
    }
    return json.data ?? {};
  }

  /**
   * URL of the eWeLink sign-in page of the OAuth 2.0 flow.
   * @param {string} redirectUrl - Redirect URI given by Gladys (byte for byte).
   * @param {string} state - Anti-CSRF state.
   * @param {number} [seq] - Timestamp in ms (fixed in tests).
   * @returns {string} The authorization URL.
   */
  authorizeUrl(redirectUrl, state, seq = Date.now()) {
    const url = new URL(OAUTH_PAGE);
    url.searchParams.set('clientId', this.appId);
    url.searchParams.set('seq', String(seq));
    url.searchParams.set('authorization', sign(this.appSecret, `${this.appId}_${seq}`));
    url.searchParams.set('redirectUrl', redirectUrl);
    url.searchParams.set('grantType', 'authorization_code');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce());
    url.searchParams.set('showQRCode', 'false');
    return url.toString();
  }

  /**
   * Exchange an OAuth authorization code. eWeLink tells the account region in
   * the redirect, which Gladys does not relay: the configured region is tried
   * first, then the others (the code stays valid 30 s).
   * @returns {Promise<{ at: string, rt: string, atExpiry: number, rtExpiry: number, region: string }>}
   */
  async exchangeCode(code, redirectUrl) {
    const body = { code, redirectUrl, grantType: 'authorization_code' };
    const order = [this.region, ...REGIONS.filter((region) => region !== this.region)];
    let lastError;
    for (const region of order) {
      try {
        const data = await this.request('POST', '/v2/user/oauth/token', {
          body,
          host: API_HOSTS[region],
        });
        this.region = region;
        return {
          at: data.accessToken,
          rt: data.refreshToken,
          atExpiry: Number(data.atExpiredTime) || 0,
          rtExpiry: Number(data.rtExpiredTime) || 0,
          region,
        };
      } catch (error) {
        lastError = error;
        // A network failure or an exhausted quota will not get better elsewhere.
        if (!(error instanceof EwelinkError) || error.code === 'network' || error.isQuotaError) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  /**
   * E-mail or phone + password login (App IDs allowed to use it).
   * @returns {Promise<{ at: string, rt: string, apikey: string, region: string }>}
   */
  async login(account, password, countryCode) {
    const body = { countryCode, password };
    if (account.includes('@')) {
      body.email = account;
    } else {
      body.phoneNumber = account.startsWith('+') ? account : `+${account}`;
    }
    let data;
    try {
      data = await this.request('POST', '/v2/user/login', { body });
    } catch (error) {
      // 10004: the account lives in another region, which the answer names.
      if (error instanceof EwelinkError && error.code === 10004 && error.data?.region) {
        this.region = error.data.region;
        data = await this.request('POST', '/v2/user/login', { body });
      } else {
        throw error;
      }
    }
    if (data.region && REGIONS.includes(data.region)) {
      this.region = data.region;
    }
    return { at: data.at, rt: data.rt, apikey: data.user?.apikey, region: this.region };
  }

  /** New access and refresh tokens (both rotate). */
  async refresh(rt) {
    const data = await this.request('POST', '/v2/user/refresh', { body: { rt } });
    return { at: data.at, rt: data.rt };
  }

  /** Account apikey, needed by the WebSocket handshake. */
  async getApikey(at) {
    const data = await this.request('GET', '/v2/user/profile', { at });
    return data.user?.apikey;
  }

  /** Homes of the account: `{ id: name }`. */
  async getHomes(at) {
    const data = await this.request('GET', '/v2/family', { at, query: { lang: 'en' } });
    return Object.fromEntries((data.familyList ?? []).map((home) => [home.id, home.name]));
  }

  /**
   * Devices of every home (groups skipped). The device list holds the
   * devicekey, the LAN encryption key.
   * @returns {Promise<object[]>} The `itemData` of each device.
   */
  async getDevices(at) {
    const homes = Object.keys(await this.getHomes(at));
    const devices = new Map();
    for (const familyid of homes.length > 0 ? homes : [undefined]) {
      const data = await this.request('GET', '/v2/device/thing', {
        at,
        query: { num: 0, familyid, lang: 'en' },
      });
      for (const item of data.thingList ?? []) {
        // itemType 1: own device, 2: shared device, 3: group.
        if (item.itemData?.deviceid) {
          devices.set(item.itemData.deviceid, item.itemData);
        }
      }
    }
    return [...devices.values()];
  }

  /** Address of the WebSocket server of the region. */
  async dispatch(at) {
    const data = await this.requestDispatch(at);
    return `wss://${data.domain}:${data.port}/api/ws`;
  }

  async requestDispatch(at) {
    this.onRequest();
    let response;
    try {
      response = await this.fetch(DISPATCH_HOSTS[this.region], {
        headers: { Authorization: `Bearer ${at}`, 'X-CK-Appid': this.appId },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new EwelinkError('network', error?.message ?? String(error));
    }
    if (!response.ok) {
      throw new EwelinkError(response.status, `HTTP ${response.status}`);
    }
    const json = await response.json();
    if (json.error !== 0 || !json.domain) {
      throw new EwelinkError(json.error ?? 'invalid', json.reason);
    }
    return json;
  }
}
