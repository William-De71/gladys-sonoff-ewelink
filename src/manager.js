// -----------------------------------------------------------------------------
// Manager: the integration's runtime.
//
//   LAN first   mDNS records relayed by the core (scanNetwork) give the IP and
//               the state of every device; a poll asks each device for its
//               state in unicast; commands go in unicast too.
//   Cloud       optional (user's own eWeLink developer App ID): device list,
//               devicekeys, real-time WebSocket, fallback for the commands
//               and for the devices the LAN cannot reach (Zigbee sub-devices).
//
// The user's "Prefer the local connection" choice orders the two channels;
// the badge of each device reflects the channel actually used.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { CloudApi, EwelinkError } from './ewelink/cloud.js';
import { LOCAL_RESULT, LocalClient, parseMdnsService, readLocalParams } from './ewelink/local.js';
import { CloudSocket, SOCKET_RESULT } from './ewelink/socket.js';
import {
  buildGladysDevice,
  capabilityOfFeature,
  idsOf,
  readAll,
  readUpdate,
} from './devices/model.js';
import { RF_CODE_RECEIVED_TRIGGER } from './devices/capabilities.js';
import { CLOUD_MODES, LOCAL_DEVICES_KEY, SESSION_KEY, cloudConfigured } from './config.js';
import { mergeParams, Registry } from './registry.js';
import { JsonStore, QuotaCounter } from './store.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'manager' });

export const DEVICE_CONNECTION_TRIGGER = 'device_connection_changed';
export const CLOUD_STATUS_TRIGGER = 'cloud_status_changed';

export const CLOUD_STATUS = {
  DISABLED: 'disabled',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  AUTH_REQUIRED: 'auth_required',
  QUOTA_EXHAUSTED: 'quota_exhausted',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD_TOKEN_LIFETIME_MS = 30 * DAY_MS;
const CLOUD_LIST_MIN_AGE_MS = 10 * 60 * 1000;
const CLOUD_LIST_REFRESH_MS = 6 * 60 * 60 * 1000;
const ENERGY_HISTORY_MS = 60 * 60 * 1000;
const QUOTA_RETRY_MS = 6 * 60 * 60 * 1000;
const LOCAL_FAILS_OFFLINE = 3;
const LOCAL_POLL_TIMEOUT_MS = 3000;
const LOCAL_POLL_CONCURRENCY = 4;
const MDNS_SCAN_SECONDS = 5;
const BULK_DELAY_MS = 100;
// Devices whose sensors only refresh when an indicator change is sent back.
const SLED_REFRESH_UIIDS = new Set([15, 32, 181, 182, 190, 262, 277, 283]);
const CLOUD_ENERGY_UIIDS = new Set([5, 32, 182]);
// Parents able to relay their children over the LAN (SPM-Main, RF Bridge).
const LOCAL_PARENT_TYPES = new Set(['meter', 'rf']);
const RF_HISTORY_SIZE = 8;
const SETTLED_CLOUD_STATUSES = new Set([
  CLOUD_STATUS.CONNECTED,
  CLOUD_STATUS.DISCONNECTED,
  CLOUD_STATUS.AUTH_REQUIRED,
  CLOUD_STATUS.QUOTA_EXHAUSTED,
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Host of a URL, for the logs (never the path nor the query: no token). */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}

/** One line describing the configuration, without any secret. */
function describeConfig(config) {
  const lan = config.local_enabled
    ? `on (scan ${config.scan_interval} s, poll ${config.poll_interval} s)`
    : 'off';
  let cloud = config.cloud_mode;
  if (config.cloud_mode !== CLOUD_MODES.NONE) {
    const missing = [
      !config.app_id && 'App ID',
      !config.app_secret && 'App Secret',
      config.cloud_mode === CLOUD_MODES.PASSWORD && !config.account && 'account',
      config.cloud_mode === CLOUD_MODES.PASSWORD && !config.password && 'password',
    ].filter(Boolean);
    cloud += ` (region ${config.region}${missing.length ? `, missing: ${missing.join(', ')}` : ''}${config.session ? ', saved session' : ''})`;
  }
  return `Configuration: LAN ${lan}, cloud ${cloud}, prefer local ${config.GLADYS_PREFER_LOCAL ? 'yes' : 'no'}, ${config.localDevices.length} manual device(s)`;
}

export class Manager {
  /**
   * @param {object} options - Options.
   * @param {object} options.gladys - SDK client.
   * @param {JsonStore} [options.store] - Persistence.
   * @param {LocalClient} [options.local] - LAN client.
   * @param {typeof fetch} [options.fetch] - HTTP client of the cloud API.
   * @param {typeof WebSocket} [options.WebSocketImpl] - WebSocket class.
   * @param {() => number} [options.now] - Clock.
   * @param {(widgetKey: string) => void} [options.onWidgetChange] - A widget content changed.
   */
  constructor({
    gladys,
    store = new JsonStore(),
    local,
    fetch,
    WebSocketImpl,
    now = Date.now,
    onWidgetChange = () => {},
  }) {
    this.gladys = gladys;
    this.onWidgetChange = onWidgetChange;
    this.store = store;
    this.local = local ?? new LocalClient();
    this.fetch = fetch ?? globalThis.fetch;
    this.now = now;
    this.registry = new Registry();
    this.quota = new QuotaCounter(store);
    this.socket = new CloudSocket({ WebSocketImpl });
    this.config = null;
    this.api = null;
    this.session = null;
    this.cloudStatus = CLOUD_STATUS.DISABLED;
    this.cloudListAt = 0;
    this.cloudRetries = 0;
    this.timers = {};
    this.oauthState = null;
    this.lastScanCount = 0;
    this.lastScanError = null;
    this.polling = false;
    this.bulk = new Map();
    this.started = false;

    this.socket.on('update', ({ deviceid, params }) => this.onCloudUpdate(deviceid, params));
    this.socket.on('disconnected', () => this.onSocketDisconnected());
    this.socket.on('auth-error', () => {
      this.setCloudStatus(CLOUD_STATUS.AUTH_REQUIRED, t('cloudSignedInElsewhere'));
    });
  }

  // --- Lifecycle --------------------------------------------------------------

  /**
   * Start with the user's configuration. Called again on every reconnection
   * to Gladys: the cloud session is kept (CoolKit bans the IPs that sign in
   * too often), only what Gladys may have missed is published again.
   */
  async start(config) {
    if (this.started) {
      await this.reconfigure(config);
      await this.resyncStates();
      await this.reportConnectionStatus();
      return;
    }
    this.config = config;
    logger.info(describeConfig(config));
    await this.quota.load();
    await this.loadCache();
    this.started = true;
    this.applyManualDevices();
    await this.publishDevices();
    await this.resyncStates();
    await this.publishTransports();
    this.scheduleLocal();
    await this.startCloud();
    await this.reportConnectionStatus();
    // First LAN pass in the background (kept for the tests to await).
    this.firstCycle = this.runLocalCycle().catch((error) =>
      logger.warn('First LAN scan failed', error),
    );
  }

  async reportConnectionStatus() {
    if (!this.gladys.connected) {
      return;
    }
    const { connected, message } = this.connectionStatus();
    await this.gladys.setConnectionStatus(connected, connected ? undefined : message);
  }

  /** New configuration saved by the user. */
  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    logger.info(describeConfig(config));
    this.applyManualDevices();
    this.scheduleLocal();
    const cloudChanged =
      !previous ||
      ['cloud_mode', 'app_id', 'app_secret', 'region', 'account', 'password', 'country_code'].some(
        (key) => previous[key] !== config[key],
      );
    if (cloudChanged) {
      this.stopCloud();
      await this.startCloud();
      await this.reportConnectionStatus();
    }
    await this.publishDevices();
    await this.publishTransports();
  }

  async stop() {
    for (const timer of Object.values(this.timers)) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.timers = {};
    this.stopCloud();
    await this.quota.flush();
  }

  /** The Gladys connection dropped: keep the device links, stop publishing. */
  suspend() {
    for (const name of ['scan', 'poll']) {
      clearInterval(this.timers[name]);
      delete this.timers[name];
    }
  }

  async loadCache() {
    const cached = await this.store.read('devices.json', []);
    for (const item of Array.isArray(cached) ? cached : []) {
      if (item?.deviceid) {
        this.registry.upsertCloud(item);
      }
    }
    if (cached.length > 0) {
      logger.info(`${cached.length} device(s) loaded from the last cloud list`);
    }
  }

  applyManualDevices() {
    for (const device of this.config.localDevices) {
      const entry = this.registry.upsertManual(device);
      this.registry.rebuild(entry);
    }
  }

  scheduleLocal() {
    clearInterval(this.timers.scan);
    clearInterval(this.timers.poll);
    delete this.timers.scan;
    delete this.timers.poll;
    if (!this.config.local_enabled) {
      return;
    }
    this.timers.scan = setInterval(() => {
      this.scanLocal().catch((error) => logger.warn('LAN scan failed', error));
    }, this.config.scan_interval * 1000);
    this.timers.poll = setInterval(() => {
      this.pollLocal().catch((error) => logger.warn('LAN poll failed', error));
    }, this.config.poll_interval * 1000);
  }

  async runLocalCycle() {
    if (!this.config.local_enabled) {
      return;
    }
    await this.scanLocal();
    await this.pollLocal();
  }

  // --- Discovery --------------------------------------------------------------

  /** Scan request from Gladys (Discovery tab) or from a scene / widget. */
  async scan() {
    if (this.socket.online && this.now() - this.cloudListAt > CLOUD_LIST_MIN_AGE_MS) {
      await this.refreshCloudDevices().catch((error) => this.handleListError(error));
    }
    if (this.config.local_enabled) {
      await this.scanLocal();
    }
    return this.publishDevices();
  }

  /** Publish every usable device (idempotent: Gladys upserts by external_id). */
  async publishDevices() {
    const devices = this.registry
      .usable()
      .map((entry) => buildGladysDevice(this.gladys, entry))
      .filter(Boolean);
    if (this.gladys.connected) {
      await this.gladys.publishDiscoveredDevices(devices);
      if (devices.length !== this.lastPublishedCount) {
        this.lastPublishedCount = devices.length;
        logger.info(`${devices.length} device(s) published to Gladys`);
      }
    }
    return devices.length;
  }

  /**
   * Browse `_ewelink._tcp` through the core.
   * @returns {Promise<number>} eWeLink devices seen.
   */
  async scanLocal() {
    let services;
    try {
      services = await this.gladys.scanNetwork('mdns', { timeoutSeconds: MDNS_SCAN_SECONDS });
      if (this.lastScanError) {
        logger.info('mDNS scan available again');
      }
      this.lastScanError = null;
    } catch (error) {
      // 429: one scan at a time; 403: network discovery refused by the core.
      const reason = error?.status ? `HTTP ${error.status}` : (error?.message ?? 'error');
      // Warn once per new reason: the scan runs every minute.
      if (reason !== this.lastScanError) {
        logger.warn(`mDNS scan unavailable (${reason}): LAN discovery relies on the Gladys core`);
      }
      this.lastScanError = reason;
      return this.lastScanCount;
    }
    logger.debug(`mDNS scan: ${services?.length ?? 0} record(s) relayed by the core`);
    let count = 0;
    let newDevices = false;
    for (const service of services ?? []) {
      const message = parseMdnsService(service);
      if (!message) {
        continue;
      }
      count += 1;
      const known = this.registry.get(message.deviceid);
      const hadUiid = known?.uiid !== undefined;
      const result = this.registry.upsertLocal(message, (entry) =>
        readLocalParams(message, entry.devicekey),
      );
      if (!result) {
        continue;
      }
      const { entry, params } = result;
      this.logLanSighting(message, entry, params);
      if (!hadUiid && entry.uiid !== undefined) {
        newDevices = true;
      }
      if (params) {
        await this.handleParams(entry, params, 'local');
      }
      if (this.registry.rebuild(entry)) {
        newDevices = true;
      }
    }
    if (count !== this.lastScanCount || this.scanLogged === undefined) {
      logger.info(`mDNS scan: ${count} eWeLink device(s) found on the LAN`);
      this.scanLogged = true;
    }
    this.lastScanCount = count;
    if (newDevices) {
      await this.publishDevices();
    }
    await this.refreshReachability();
    return count;
  }

  /**
   * Describe a device the first time the LAN shows it, and say why it is not
   * usable yet: the questions a user asks when a device does not show up.
   */
  logLanSighting(message, entry, params) {
    const main = this.registry.get(message.deviceid);
    if (!main || main.memory.lanLogged) {
      return;
    }
    main.memory.lanLogged = true;
    const mode = message.encrypted ? 'encrypted' : 'DIY / clear text';
    logger.info(
      `LAN: ${message.deviceid} at ${message.host ?? 'unknown address'} (type ${message.localtype || '?'}, ${mode})`,
    );
    if (!message.host) {
      logger.warn(`LAN: ${message.deviceid} announced no IP address: it cannot be polled`);
    }
    if (message.encrypted && !main.devicekey) {
      logger.warn(
        `LAN: ${message.deviceid} is encrypted and its devicekey is unknown: link the eWeLink cloud or add it by hand`,
      );
    } else if (message.encrypted && !params) {
      logger.warn(`LAN: ${message.deviceid} cannot be decrypted: its devicekey looks wrong`);
    }
    if (main.uiid === undefined) {
      logger.info(`LAN: ${message.deviceid} model unknown yet (not in the cloud list)`);
    } else if (entry.capabilities.length > 0 && !entry.capabilities.some((c) => c.feature)) {
      logger.info(`LAN: ${entry.deviceid} (UIID ${entry.uiid}) has no feature Gladys can use`);
    }
  }

  /** Ask every LAN device for its state (unicast), a few at a time. */
  async pollLocal() {
    if (this.polling || !this.config.local_enabled) {
      return;
    }
    this.polling = true;
    try {
      const targets = this.registry
        .list()
        .filter((entry) => this.localTarget(entry) && entry.uiid !== undefined);
      for (let i = 0; i < targets.length; i += LOCAL_POLL_CONCURRENCY) {
        await Promise.all(
          targets.slice(i, i + LOCAL_POLL_CONCURRENCY).map((entry) => this.pollDevice(entry)),
        );
      }
      await this.refreshReachability();
    } finally {
      this.polling = false;
    }
  }

  async pollDevice(entry) {
    const target = this.localTarget(entry);
    let params;
    let command;
    if (target !== entry) {
      // SPM-4Relay: the SPM-Main reports one outlet at a time.
      const outlet = entry.memory.activeOutlet ?? 0;
      entry.memory.activeOutlet = (outlet + 1) % 4;
      params = { subDevId: entry.deviceid, uiActive: { outlet, time: 60 } };
      command = 'uiActive';
    } else if (SLED_REFRESH_UIIDS.has(entry.uiid) && entry.params.sledOnline) {
      // Sending the current indicator state makes the device report its sensors.
      params = { sledOnline: entry.params.sledOnline };
      command = 'sledOnline';
    } else if (entry.uiid === 126) {
      params = {};
      command = 'statistics';
    }
    const answer = await this.local.send(target, params, {
      command,
      timeoutMs: LOCAL_POLL_TIMEOUT_MS,
    });
    this.recordLocal(target, answer.result);
    if (answer.params) {
      await this.handleParams(entry, answer.params, 'local');
    }
  }

  recordLocal(entry, result) {
    if (result === LOCAL_RESULT.ONLINE) {
      if (entry.local.ok === false) {
        logger.info(`LAN: ${entry.deviceid} answers again at ${entry.host}`);
      }
      entry.local.ok = true;
      entry.local.fails = 0;
      entry.local.lastSeen = this.now();
      return;
    }
    entry.local.fails += 1;
    logger.debug(`LAN: ${entry.deviceid} at ${entry.host}: ${result} (${entry.local.fails})`);
    if (entry.local.fails >= LOCAL_FAILS_OFFLINE && entry.local.ok !== false) {
      logger.warn(
        `LAN: ${entry.deviceid} at ${entry.host} not answering (${result}, ${entry.local.fails} tries)`,
      );
      entry.local.ok = false;
    }
  }

  /**
   * The entry to talk to over the LAN (itself, or its parent), or null.
   * @returns {object | null} The target.
   */
  localTarget(entry) {
    if (!this.config?.local_enabled) {
      return null;
    }
    let target = entry;
    if (entry.parentid) {
      const parent = this.registry.get(entry.parentid);
      if (!parent || !LOCAL_PARENT_TYPES.has(parent.localtype)) {
        return null;
      }
      target = parent;
    }
    if (!target.host || (target.encrypted && !target.devicekey)) {
      return null;
    }
    return target;
  }

  localUsable(entry) {
    const target = this.localTarget(entry);
    return Boolean(target && target.local.ok);
  }

  cloudUsable(entry) {
    return this.socket.online && Boolean(entry.apikey) && entry.online !== false;
  }

  // --- States and events ------------------------------------------------------

  /**
   * Apply parameters reported by a device (LAN or cloud).
   * @param {object} entry - Registry entry.
   * @param {object} update - Parameters.
   * @param {'local' | 'cloud' | 'command'} source - Origin.
   */
  async handleParams(entry, update, source) {
    if (!update || typeof update !== 'object' || Object.keys(update).length === 0) {
      return;
    }
    entry.params = mergeParams(entry.params, update);
    if (this.registry.rebuild(entry)) {
      await this.publishDevices();
    }
    if (entry.uiid === undefined || !this.gladys.connected) {
      return;
    }
    const { states, events } = readUpdate(this.gladys, entry, update, {
      // An echo of our own command is no press.
      withEvents: source !== 'command',
    });
    if (states.length > 0) {
      await this.gladys
        .publishChangedStates(states)
        .catch((error) => logger.warn(`States of ${entry.deviceid} refused`, error));
    }
    for (const event of events) {
      await this.publishDeviceEvent(entry, event);
    }
  }

  async publishDeviceEvent(entry, { key, data }) {
    const ids = idsOf(this.gladys, entry.deviceid);
    const payload = { device: ids.device, device_name: entry.name ?? entry.deviceid };
    // Trigger filters compare strings (select options): send strings only.
    for (const [name, value] of Object.entries(data)) {
      payload[name] = String(value);
    }
    if (key === RF_CODE_RECEIVED_TRIGGER) {
      const history = entry.memory.rfHistory ?? [];
      history.unshift({ channel: payload.channel, name: payload.name, at: this.now() });
      entry.memory.rfHistory = history.slice(0, RF_HISTORY_SIZE);
      this.onWidgetChange('rf_remote');
    }
    await this.gladys
      .publishSceneEvent(key, payload)
      .catch((error) => logger.warn(`Scene event ${key} refused`, error));
  }

  /** Republish every cached state (after a (re)connection or a creation). */
  async resyncStates(entries = this.registry.usable()) {
    if (!this.gladys.connected) {
      return;
    }
    const states = entries.flatMap((entry) => readAll(this.gladys, entry));
    if (states.length > 0) {
      await this.gladys
        .publishChangedStates(states)
        .catch((error) => logger.warn('State resync refused', error));
    }
  }

  async onCloudUpdate(deviceid, params) {
    const entry = this.registry.get(deviceid);
    if (!entry) {
      return;
    }
    if ('online' in params) {
      entry.online = params.online === true;
      // A device back online in the cloud may be back on the LAN too.
      if (entry.online && entry.local.ok === false) {
        entry.local.fails = 0;
        entry.local.ok = undefined;
      }
    } else if (
      entry.online === false &&
      !('subDevRssi' in params && Object.keys(params).length === 1)
    ) {
      entry.online = true;
    }
    const { online: _ignored, ...rest } = params;
    await this.handleParams(entry, rest, 'cloud');
    await this.refreshReachability();
  }

  /**
   * Reachability transitions -> transport badges and `device_connection_changed`.
   * The first evaluation of a device only records its state.
   */
  async refreshReachability() {
    let changed = false;
    for (const entry of this.registry.usable()) {
      const reachable = this.localUsable(entry) || this.cloudUsable(entry);
      const previous = entry.memory.reachable;
      entry.memory.reachable = reachable;
      // The badge follows the channel in use, not only the reachability.
      const { transport, degraded, message } = this.transportOf(entry);
      const badge = `${transport}|${degraded ? message.en : ''}`;
      if (badge !== entry.memory.badge) {
        entry.memory.badge = badge;
        changed = true;
      }
      if (previous === reachable) {
        continue;
      }
      if (previous !== undefined && this.gladys.connected) {
        await this.publishDeviceEvent(entry, {
          key: DEVICE_CONNECTION_TRIGGER,
          data: { status: reachable ? 'online' : 'offline' },
        });
      }
    }
    if (changed) {
      await this.publishTransports();
    }
  }

  transportOf(entry) {
    const preferLocal = this.config.GLADYS_PREFER_LOCAL;
    const local = this.localUsable(entry);
    const cloud = this.cloudUsable(entry);
    if (local && (preferLocal || !cloud)) {
      return { transport: DEVICE_TRANSPORTS.LOCAL };
    }
    if (cloud) {
      const target = entry.parentid ? this.registry.get(entry.parentid) : entry;
      if (preferLocal && this.config.local_enabled && target?.host) {
        if (target.encrypted && !target.devicekey) {
          return {
            transport: DEVICE_TRANSPORTS.CLOUD,
            degraded: true,
            message: t('transportKeyMissing'),
          };
        }
        if (target.local.ok === false) {
          return {
            transport: DEVICE_TRANSPORTS.CLOUD,
            degraded: true,
            message: t('transportLocalLost'),
          };
        }
      }
      return { transport: DEVICE_TRANSPORTS.CLOUD };
    }
    return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
  }

  async publishTransports() {
    if (!this.gladys.connected || !this.config) {
      return;
    }
    const entries = this.registry.usable().map((entry) => ({
      external_id: idsOf(this.gladys, entry.deviceid).device,
      ...this.transportOf(entry),
    }));
    if (entries.length > 0) {
      await this.gladys
        .publishTransports(entries)
        .catch((error) => logger.warn('Transports refused', error));
    }
    this.onWidgetChange('network_status');
  }

  // --- Commands ---------------------------------------------------------------

  entryOfDevice(device) {
    const deviceid = device?.external_id?.split(':').at(-1);
    const entry = deviceid ? this.registry.get(deviceid) : undefined;
    if (!entry || idsOf(this.gladys, entry.deviceid).device !== device.external_id) {
      return undefined;
    }
    return entry;
  }

  /** onSetValue: a user (or a scene) acts on a feature. */
  async setValue(device, feature, value) {
    const entry = this.entryOfDevice(device);
    if (!entry) {
      throw new Error(t('deviceUnknown').en);
    }
    const capability = capabilityOfFeature(this.gladys, entry, feature.external_id);
    if (!capability?.write) {
      throw new Error(`Feature ${feature.external_id} is read-only`);
    }
    const command = capability.write(value, entry.params, entry);
    if (!command) {
      throw new Error(`Invalid value ${JSON.stringify(value)} for ${capability.key}`);
    }
    if (command.before) {
      await this.sendOrThrow(entry, command.before);
    }
    await this.sendOrThrow(entry, command);
    if (capability.momentary) {
      await this.gladys.publishState(feature.external_id, 0).catch(() => {});
    }
  }

  async sendOrThrow(entry, command) {
    const outcome =
      command.bulk === 'switches'
        ? await this.sendBulk(entry, command)
        : await this.send(entry, command);
    if (!outcome.ok) {
      const message =
        outcome.result === 'unreachable'
          ? t('deviceUnreachable').en
          : t('commandRefused', { result: outcome.result }).en;
      throw new Error(message);
    }
    return outcome;
  }

  /**
   * Group the outlet commands sent within 100 ms into one (a scene switching
   * four channels): the device handles one request at a time.
   */
  sendBulk(entry, command) {
    let pending = this.bulk.get(entry.deviceid);
    if (!pending) {
      pending = { switches: [], promise: null };
      this.bulk.set(entry.deviceid, pending);
      pending.promise = sleep(BULK_DELAY_MS).then(() => {
        this.bulk.delete(entry.deviceid);
        return this.send(entry, { params: { switches: pending.switches } });
      });
    }
    for (const item of command.params.switches) {
      const index = pending.switches.findIndex((existing) => existing.outlet === item.outlet);
      if (index === -1) {
        pending.switches.push(item);
      } else {
        pending.switches[index] = item;
      }
    }
    return pending.promise;
  }

  /**
   * Send a command through the preferred channel, then the other one.
   * @returns {Promise<{ ok: boolean, via?: string, result: string }>} Outcome.
   */
  async send(entry, command) {
    const resolved = { ...command };
    if (command.lanParamsIf && entry.localtype === command.lanParamsIf.localtype) {
      resolved.lanParams = command.lanParamsIf.params;
    }
    const canCloud = this.cloudUsable(entry);
    const target = resolved.cloudOnly ? null : this.localTarget(entry);
    // A device that stopped answering on the LAN is left to the cloud until
    // the poll sees it again; without a cloud, the LAN is tried anyway.
    const canLocal = Boolean(target) && (target.local.ok !== false || !canCloud);
    const order = this.config.GLADYS_PREFER_LOCAL ? ['local', 'cloud'] : ['cloud', 'local'];
    let result = 'unreachable';
    for (const channel of order) {
      if (channel === 'local' && canLocal) {
        result = await this.sendLocal(entry, resolved, { quick: canCloud });
      } else if (channel === 'cloud' && canCloud) {
        result = await this.sendCloud(entry, resolved);
      } else {
        continue;
      }
      logger.debug(`Command to ${entry.deviceid} via ${channel}: ${result}`);
      if (result === 'online') {
        await this.handleParams(entry, resolved.params, 'command');
        await this.refreshReachability();
        return { ok: true, via: channel, result };
      }
    }
    logger.warn(
      `Command to ${entry.deviceid} failed (${result}; LAN ${canLocal ? 'tried' : 'unavailable'}, cloud ${canCloud ? 'tried' : 'unavailable'})`,
    );
    await this.refreshReachability();
    return { ok: false, result };
  }

  async sendLocal(entry, command, { quick }) {
    const target = this.localTarget(entry);
    let params = command.lanParams ?? command.params;
    if (target !== entry) {
      params = { ...params, subDevId: entry.deviceid };
    }
    const answer = await this.local.send(target, params, {
      command: command.lanCommand,
      // With a cloud fallback, do not keep the user waiting on a dead LAN.
      timeoutMs: quick ? 1500 : 5000,
    });
    this.recordLocal(target, answer.result);
    if (answer.params) {
      await this.handleParams(entry, answer.params, 'local');
    }
    return answer.result === LOCAL_RESULT.ONLINE ? 'online' : answer.result;
  }

  async sendCloud(entry, command) {
    const result = await this.socket.send(entry, this.session?.apikey, command.params);
    if (result === SOCKET_RESULT.ONLINE) {
      // Ask for the new state: the cloud does not echo our own command.
      this.socket.send(entry, this.session?.apikey, undefined, 0).catch(() => {});
    }
    return result;
  }

  // --- Cloud ------------------------------------------------------------------

  setCloudStatus(status, message) {
    const previous = this.cloudStatus;
    this.cloudStatus = status;
    this.cloudMessage = message;
    if (status === previous) {
      return;
    }
    logger.info(`eWeLink cloud: ${previous} -> ${status}${message ? ` (${message.en})` : ''}`);
    this.onWidgetChange('network_status');
    if (status === CLOUD_STATUS.CONNECTING) {
      return;
    }
    this.reportConnectionStatus().catch(() => {});
    if (!SETTLED_CLOUD_STATUSES.has(status)) {
      return;
    }
    // The first settled status after start is a state, not an event.
    if (
      this.lastSettledStatus !== undefined &&
      this.lastSettledStatus !== status &&
      this.gladys.connected
    ) {
      this.gladys
        .publishSceneEvent(CLOUD_STATUS_TRIGGER, { status })
        .catch((error) => logger.warn('Cloud status event refused', error));
    }
    this.lastSettledStatus = status;
  }

  /** Connection badge of the Configuration screen. */
  connectionStatus() {
    if (this.cloudStatus === CLOUD_STATUS.DISABLED || this.cloudStatus === CLOUD_STATUS.CONNECTED) {
      return { connected: true };
    }
    if (this.cloudStatus === CLOUD_STATUS.CONNECTING) {
      return { connected: false, message: t('cloudUnreachable') };
    }
    return { connected: false, message: this.cloudMessage ?? t('cloudUnreachable') };
  }

  newApi() {
    return new CloudApi({
      appId: this.config.app_id,
      appSecret: this.config.app_secret,
      region: this.session?.region ?? this.config.region,
      fetch: this.fetch,
      onRequest: () => this.quota.count(),
    });
  }

  /** Session saved for this App ID and mode, if any. */
  loadSession() {
    // onConfigUpdated may omit the off-schema keys: fall back on the live session.
    const saved = this.config.session ?? this.session;
    if (
      saved &&
      saved.appId === this.config.app_id &&
      saved.mode === this.config.cloud_mode &&
      (saved.mode !== CLOUD_MODES.PASSWORD || saved.account === this.config.account) &&
      saved.at
    ) {
      return saved;
    }
    return null;
  }

  async saveSession(session) {
    this.session = session;
    this.config.session = session;
    await this.gladys.setConfig({ [SESSION_KEY]: session ? JSON.stringify(session) : '' });
  }

  async startCloud() {
    if (this.config.cloud_mode === CLOUD_MODES.NONE) {
      this.setCloudStatus(CLOUD_STATUS.DISABLED);
      return;
    }
    if (!cloudConfigured(this.config)) {
      this.setCloudStatus(CLOUD_STATUS.AUTH_REQUIRED, t('cloudAppMissing'));
      return;
    }
    this.session = this.loadSession();
    this.api = this.newApi();
    if (!this.session && this.config.cloud_mode === CLOUD_MODES.OAUTH) {
      this.setCloudStatus(CLOUD_STATUS.AUTH_REQUIRED, t('cloudNotLinked'));
      return;
    }
    await this.connectCloud();
  }

  stopCloud() {
    clearTimeout(this.timers.cloudRetry);
    clearInterval(this.timers.cloudList);
    clearInterval(this.timers.energy);
    delete this.timers.cloudRetry;
    delete this.timers.cloudList;
    delete this.timers.energy;
    // Our own close is no outage: no retry, no event.
    this.stoppingCloud = true;
    this.socket.close();
    this.stoppingCloud = false;
  }

  async connectCloud() {
    this.setCloudStatus(CLOUD_STATUS.CONNECTING);
    try {
      await this.ensureToken();
      if (!this.session.apikey) {
        await this.saveSession({
          ...this.session,
          apikey: await this.api.getApikey(this.session.at),
        });
      }
      await this.refreshCloudDevices();
      const url = await this.api.dispatch(this.session.at);
      logger.info(`eWeLink cloud: opening the WebSocket (${hostOf(url)})`);
      await this.socket.connect({
        url,
        at: this.session.at,
        apikey: this.session.apikey,
        appId: this.config.app_id,
      });
      this.cloudRetries = 0;
      this.setCloudStatus(CLOUD_STATUS.CONNECTED);
      this.timers.cloudList = setInterval(() => {
        this.refreshCloudDevices().catch((error) => this.handleListError(error));
      }, CLOUD_LIST_REFRESH_MS);
      if (this.config.cloud_energy_history) {
        this.timers.energy = setInterval(() => this.queryEnergyHistory(), ENERGY_HISTORY_MS);
        this.queryEnergyHistory();
      }
      await this.publishTransports();
      await this.refreshReachability();
    } catch (error) {
      this.handleCloudError(error);
    }
  }

  handleCloudError(error) {
    if (error instanceof EwelinkError && error.isQuotaError) {
      this.setCloudStatus(CLOUD_STATUS.QUOTA_EXHAUSTED, t('cloudQuotaExhausted'));
      this.scheduleCloudRetry(QUOTA_RETRY_MS);
      return;
    }
    if (this.cloudStatus === CLOUD_STATUS.AUTH_REQUIRED) {
      // A refused session waits for the user (Connect, or new credentials).
      logger.warn(`eWeLink authentication required: ${error?.message ?? error}`);
      return;
    }
    logger.warn(`eWeLink cloud error: ${error?.message ?? error}`);
    this.setCloudStatus(CLOUD_STATUS.DISCONNECTED, t('cloudUnreachable'));
    this.scheduleCloudRetry();
  }

  /**
   * A failed device list refresh while the WebSocket is up: only a quota or a
   * refused session changes the cloud status; anything else waits for the next
   * refresh (reconnecting would cost a sign-in for nothing).
   */
  handleListError(error) {
    if (error instanceof EwelinkError && error.isQuotaError) {
      this.handleCloudError(error);
      return;
    }
    logger.warn(`eWeLink device list not refreshed: ${error?.message ?? error}`);
  }

  scheduleCloudRetry(delay) {
    clearTimeout(this.timers.cloudRetry);
    // 15 s, 30 s, 1 min... up to an hour: CoolKit bans IPs that reconnect too often.
    const wait = delay ?? Math.min(60 * 60 * 1000, 15_000 * 2 ** Math.min(this.cloudRetries, 8));
    this.cloudRetries += 1;
    this.timers.cloudRetry = setTimeout(() => {
      this.connectCloud().catch((error) => this.handleCloudError(error));
    }, wait);
    this.timers.cloudRetry.unref?.();
    logger.info(`eWeLink cloud: next attempt in ${Math.round(wait / 1000)} s`);
  }

  onSocketDisconnected() {
    if (this.stoppingCloud || this.cloudStatus !== CLOUD_STATUS.CONNECTED) {
      return;
    }
    clearInterval(this.timers.cloudList);
    clearInterval(this.timers.energy);
    this.setCloudStatus(CLOUD_STATUS.DISCONNECTED, t('cloudUnreachable'));
    this.scheduleCloudRetry();
    this.publishTransports().then(() => this.refreshReachability());
  }

  /** A valid access token: saved, refreshed, or a new password login. */
  async ensureToken() {
    const session = this.session;
    if (session && session.atExpiry - this.now() > DAY_MS) {
      return;
    }
    if (session?.rt && (!session.rtExpiry || session.rtExpiry > this.now())) {
      try {
        logger.info('eWeLink cloud: refreshing the access token');
        const tokens = await this.api.refresh(session.rt);
        await this.saveSession({
          ...session,
          ...tokens,
          atExpiry: this.now() + PASSWORD_TOKEN_LIFETIME_MS,
          rtExpiry: this.now() + 2 * PASSWORD_TOKEN_LIFETIME_MS,
        });
        return;
      } catch (error) {
        if (!(error instanceof EwelinkError) || error.code === 'network' || error.isQuotaError) {
          throw error;
        }
        logger.warn(`Token refresh refused (${error.code})`);
      }
    }
    if (this.config.cloud_mode === CLOUD_MODES.PASSWORD) {
      try {
        logger.info(
          `eWeLink cloud: signing in (region ${this.config.region}, country code ${this.config.country_code})`,
        );
        const login = await this.api.login(
          this.config.account,
          this.config.password,
          this.config.country_code,
        );
        await this.saveSession({
          mode: CLOUD_MODES.PASSWORD,
          appId: this.config.app_id,
          account: this.config.account,
          at: login.at,
          rt: login.rt,
          apikey: login.apikey,
          region: login.region,
          atExpiry: this.now() + PASSWORD_TOKEN_LIFETIME_MS,
          rtExpiry: this.now() + 2 * PASSWORD_TOKEN_LIFETIME_MS,
        });
        logger.info(`eWeLink cloud: signed in, account region ${login.region}`);
        return;
      } catch (error) {
        if (error instanceof EwelinkError && !error.isQuotaError && error.code !== 'network') {
          this.setCloudStatus(
            CLOUD_STATUS.AUTH_REQUIRED,
            t('cloudLoginFailed', { reason: String(error.code) }),
          );
        }
        throw error;
      }
    }
    await this.saveSession(null);
    this.setCloudStatus(CLOUD_STATUS.AUTH_REQUIRED, t('cloudSessionExpired'));
    throw new Error('eWeLink session expired');
  }

  async refreshCloudDevices() {
    const items = await this.callWithToken((at) => this.api.getDevices(at));
    this.cloudListAt = this.now();
    for (const item of items) {
      this.registry.upsertCloud(item);
    }
    // Keep the list for the next start: the LAN works without the cloud.
    await this.store.write('devices.json', items);
    logger.info(`${items.length} device(s) in the eWeLink account`);
    await this.publishDevices();
    await this.resyncStates(
      items
        .map((item) => this.registry.get(item.deviceid))
        .filter((entry) => entry?.uiid !== undefined),
    );
  }

  /** Run an API call, refreshing the token once if it was refused. */
  async callWithToken(call) {
    try {
      return await call(this.session.at);
    } catch (error) {
      if (!(error instanceof EwelinkError) || !error.isAuthError) {
        throw error;
      }
      await this.saveSession({ ...this.session, atExpiry: 0 });
      await this.ensureToken();
      return call(this.session.at);
    }
  }

  /** Daily consumption history of the first-generation power meters (cloud only). */
  queryEnergyHistory() {
    for (const entry of this.registry.list()) {
      if (CLOUD_ENERGY_UIIDS.has(entry.uiid) && this.cloudUsable(entry)) {
        this.socket.send(entry, this.session?.apikey, { hundredDaysKwh: 'get' }, 0).catch(() => {});
      }
    }
  }

  // --- OAuth ------------------------------------------------------------------

  oauthAuthorizeUrl(redirectUri) {
    if (this.config.cloud_mode !== CLOUD_MODES.OAUTH || !cloudConfigured(this.config)) {
      throw new Error(t('oauthWrongMode').en);
    }
    this.oauthState = randomUUID();
    this.api = this.newApi();
    logger.info(`eWeLink OAuth: authorization page requested (redirect ${hostOf(redirectUri)})`);
    return this.api.authorizeUrl(redirectUri, this.oauthState);
  }

  async oauthCallback({ code, state, redirectUri }) {
    if (!this.oauthState || state !== this.oauthState) {
      logger.warn(
        `eWeLink OAuth: callback ${this.oauthState ? 'with a wrong state' : 'without a pending authorization'} (integration restarted in between?)`,
      );
      this.setCloudStatus(CLOUD_STATUS.AUTH_REQUIRED, t('oauthStateMismatch'));
      throw new Error('OAuth state mismatch');
    }
    this.oauthState = null;
    logger.info('eWeLink OAuth: exchanging the authorization code');
    const tokens = await this.api.exchangeCode(code, redirectUri).catch((error) => {
      logger.warn(`eWeLink OAuth: code refused: ${error?.message ?? error}`);
      throw error;
    });
    await this.saveSession({
      mode: CLOUD_MODES.OAUTH,
      appId: this.config.app_id,
      at: tokens.at,
      rt: tokens.rt,
      atExpiry: tokens.atExpiry || this.now() + PASSWORD_TOKEN_LIFETIME_MS,
      rtExpiry: tokens.rtExpiry || this.now() + 2 * PASSWORD_TOKEN_LIFETIME_MS,
      region: tokens.region,
    });
    this.stopCloud();
    this.cloudRetries = 0;
    await this.connectCloud();
  }

  // --- Manual devices ---------------------------------------------------------

  async saveLocalDevices(devices) {
    this.config.localDevices = devices;
    await this.gladys.setConfig({ [LOCAL_DEVICES_KEY]: JSON.stringify(devices) });
    this.applyManualDevices();
  }

  // --- Summary (widgets, test action) -----------------------------------------

  summary() {
    const entries = this.registry.usable();
    const counts = { local: 0, cloud: 0, unreachable: 0, degraded: 0 };
    const problems = [];
    for (const entry of entries) {
      const { transport, degraded, message } = this.transportOf(entry);
      counts[transport] += 1;
      if (degraded) {
        counts.degraded += 1;
      }
      if (transport === DEVICE_TRANSPORTS.UNREACHABLE || degraded) {
        problems.push({ entry, transport, degraded: Boolean(degraded), message });
      }
    }
    return {
      total: entries.length,
      counts,
      problems,
      cloudStatus: this.cloudStatus,
      apiCalls: this.quota.calls,
      localEnabled: this.config?.local_enabled ?? true,
      lastScanCount: this.lastScanCount,
      lastScanError: this.lastScanError,
    };
  }
}
