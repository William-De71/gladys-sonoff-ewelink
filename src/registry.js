// -----------------------------------------------------------------------------
// Device registry: one entry per eWeLink device id, merged from three sources.
//   - the cloud device list: name, UIID, owner apikey, devicekey, params;
//   - the LAN (mDNS records relayed by the core): IP address, LAN type, params;
//   - the devices the user added by hand: device id, IP, devicekey.
// The entry keeps the merged parameters (`params`), from which the features
// are read, and a `memory` for the scene events (last button time...).
// -----------------------------------------------------------------------------

import { capabilitiesOf, diyIdentity } from './devices/specs.js';

/** Merge an update into the cached parameters; outlet lists merge by outlet. */
export function mergeParams(cache, update) {
  const result = { ...cache };
  for (const [key, value] of Object.entries(update)) {
    if (
      (key === 'switches' || key === 'configure') &&
      Array.isArray(value) &&
      Array.isArray(cache[key])
    ) {
      const byOutlet = new Map(cache[key].map((item) => [item?.outlet, item]));
      for (const item of value) {
        byOutlet.set(item?.outlet, { ...byOutlet.get(item?.outlet), ...item });
      }
      result[key] = [...byOutlet.values()].sort((a, b) => (a?.outlet ?? 0) - (b?.outlet ?? 0));
    } else {
      result[key] = value;
    }
  }
  return result;
}

const capabilitySignature = (capabilities) =>
  capabilities
    .filter((capability) => capability.feature)
    .map((capability) => capability.key)
    .join(',');

export class Registry {
  constructor() {
    /** @type {Map<string, object>} */
    this.devices = new Map();
  }

  get(deviceid) {
    return this.devices.get(deviceid);
  }

  list() {
    return [...this.devices.values()];
  }

  /** Entries Gladys can use (known model, at least one feature). */
  usable() {
    return this.list().filter(
      (entry) => entry.uiid !== undefined && entry.capabilities.some((c) => c.feature),
    );
  }

  ensure(deviceid) {
    let entry = this.devices.get(deviceid);
    if (!entry) {
      entry = {
        deviceid,
        params: {},
        memory: {},
        capabilities: [],
        local: { ok: undefined, fails: 0, lastSeen: 0 },
        sources: new Set(),
      };
      this.devices.set(deviceid, entry);
    }
    return entry;
  }

  /**
   * Rebuild the capabilities of an entry (they depend on its parameters: a
   * DualR3 in motor mode, the RF codes learned...).
   * @returns {boolean} Whether its feature list changed.
   */
  rebuild(entry) {
    if (entry.uiid === undefined) {
      entry.capabilities = [];
      return false;
    }
    const before = capabilitySignature(entry.capabilities);
    entry.capabilities = capabilitiesOf(entry);
    return before !== capabilitySignature(entry.capabilities);
  }

  /** Seed the scene-event memory from cached parameters: a replay is not a press. */
  seedMemory(entry) {
    const params = entry.params;
    entry.memory.lastTrigTime ??= params.trigTime ?? params.actionTime;
    for (const [key, value] of Object.entries(params)) {
      if (key.startsWith('rfTrig')) {
        entry.memory.rfTrig = { ...entry.memory.rfTrig, [key.slice(6)]: value };
        entry.memory.rfArmed = true;
      }
    }
  }

  /**
   * Upsert a device of the cloud list (`itemData` of /v2/device/thing).
   * @returns {object} The entry.
   */
  upsertCloud(item) {
    const entry = this.ensure(item.deviceid);
    entry.sources.add('cloud');
    entry.name = item.name || entry.name;
    entry.uiid = Number(item.extra?.uiid ?? entry.uiid);
    entry.productModel = item.productModel ?? entry.productModel;
    entry.brandName = item.brandName ?? entry.brandName;
    entry.apikey = item.apikey ?? entry.apikey;
    entry.devicekey = item.devicekey || entry.devicekey;
    entry.tags = item.tags ?? entry.tags;
    entry.online = item.online;
    const { online: _ignored, ...params } = item.params ?? {};
    entry.params = mergeParams(entry.params, params);
    entry.parentid = params.parentid || undefined;
    this.seedMemory(entry);
    this.rebuild(entry);
    return entry;
  }

  /** Upsert a device the user added by hand. */
  upsertManual({ deviceid, host, devicekey }) {
    const entry = this.ensure(deviceid.toLowerCase());
    entry.sources.add('manual');
    if (host) {
      entry.host = host;
    }
    if (devicekey) {
      entry.devicekey = devicekey;
    }
    return entry;
  }

  /**
   * Record a LAN sighting (mDNS record or answer). Returns the entry the
   * parameters belong to (a sub-device for the SPM-4Relay), or null.
   * @param {object} message - Parsed LAN message (see ewelink/local.js).
   * @param {(entry: object) => object | null} readParams - Decrypts the payload.
   * @returns {{ entry: object, params: object | null, created: boolean } | null}
   */
  upsertLocal(message, readParams) {
    const created = !this.devices.has(message.deviceid);
    const main = this.ensure(message.deviceid);
    main.sources.add('lan');
    if (message.host) {
      main.host = message.host;
    }
    if (message.localtype) {
      main.localtype = message.localtype;
    }
    main.encrypted = message.encrypted;
    main.local.ok = true;
    main.local.fails = 0;
    main.local.lastSeen = Date.now();
    const params = readParams(main);
    // A device only seen on the LAN: DIY mode (clear text), or a device whose
    // key the user entered by hand. Its model comes from the LAN type.
    if (main.uiid === undefined && params) {
      const { uiid, model } = diyIdentity(message.localtype, params);
      main.uiid = uiid;
      main.productModel = model;
      main.brandName = 'SONOFF';
      main.name = main.name ?? `${model} ${message.deviceid}`;
    }
    const realid =
      message.subdevid && message.subdevid !== message.deviceid
        ? message.subdevid
        : message.deviceid;
    const entry = realid === message.deviceid ? main : this.devices.get(realid);
    return entry ? { entry, params, created } : null;
  }
}
