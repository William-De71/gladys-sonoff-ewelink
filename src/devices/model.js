// -----------------------------------------------------------------------------
// Device model: from a registry entry (cloud list and/or LAN discovery) to the
// Gladys device, and from eWeLink parameters to Gladys states and events.
// -----------------------------------------------------------------------------

import { capabilitiesOf } from './specs.js';

// Prefix of the external ids: `ext:<selector>:sonoff:<deviceid>`. Never change it.
export const DEVICE_TYPE = 'sonoff';

/**
 * External ids of a device and of its features.
 * @param {object} gladys - SDK client.
 * @param {string} deviceid - eWeLink device id (10 hex characters, stable).
 */
export const idsOf = (gladys, deviceid) => gladys.externalIds(DEVICE_TYPE, deviceid);

/** Capabilities bound to a feature (scene-event-only ones excluded). */
export const featureCapabilities = (capabilities) =>
  capabilities.filter((capability) => capability.feature);

/**
 * Gladys device of a registry entry, or null when Gladys could not use it.
 * @param {object} gladys - SDK client.
 * @param {object} device - Registry entry.
 * @returns {object | null} The discovery payload.
 */
export function buildGladysDevice(gladys, device) {
  const capabilities = featureCapabilities(device.capabilities ?? capabilitiesOf(device));
  if (capabilities.length === 0) {
    return null;
  }
  const ids = idsOf(gladys, device.deviceid);
  const params = [
    { name: 'DEVICE_ID', value: device.deviceid },
    { name: 'UIID', value: String(device.uiid) },
  ];
  const optional = {
    MODEL: device.productModel,
    BRAND: device.brandName,
    FIRMWARE: device.params?.fwVersion,
    IP_ADDRESS: device.host?.split(':')[0],
    PARENT_ID: device.parentid,
  };
  for (const [name, value] of Object.entries(optional)) {
    if (typeof value === 'string' && value !== '') {
      params.push({ name, value });
    }
  }
  return {
    name: device.name || `Sonoff ${device.deviceid}`,
    external_id: ids.device,
    params,
    features: capabilities.map((capability) => ({
      ...capability.feature,
      external_id: ids.feature(capability.key),
    })),
  };
}

/**
 * States and scene events produced by an update.
 * @param {object} gladys - SDK client.
 * @param {object} device - Registry entry, `params` already merged with `update`.
 * @param {object} update - The parameters the device just reported.
 * @param {{ withEvents?: boolean }} [options] - `withEvents: false` for a resync
 *   (a cached press must not be replayed as a new one).
 * @returns {{ states: object[], events: { key: string, data: object }[] }} What to publish.
 */
export function readUpdate(gladys, device, update, { withEvents = true } = {}) {
  const ids = idsOf(gladys, device.deviceid);
  const cache = device.params ?? {};
  const memory = device.memory;
  const states = [];
  const events = [];
  for (const capability of device.capabilities ?? []) {
    if (withEvents && capability.events) {
      const produced = capability.events(update, cache, memory);
      events.push(...produced);
      if (produced.length > 0 && capability.feature && capability.readPress) {
        const value = capability.readPress(memory);
        if (value !== undefined) {
          states.push({ device_feature_external_id: ids.feature(capability.key), state: value });
        }
      }
    }
    if (!capability.feature || !capability.watch.some((param) => param in update)) {
      continue;
    }
    const externalId = ids.feature(capability.key);
    if (capability.readText) {
      const text = capability.readText(cache);
      if (typeof text === 'string') {
        states.push({ device_feature_external_id: externalId, text });
      }
      continue;
    }
    const value = capability.read(cache, update);
    if (typeof value === 'number' && Number.isFinite(value)) {
      states.push({ device_feature_external_id: externalId, state: value });
    }
  }
  return { states, events };
}

/**
 * Every state known from the cache (after a (re)connection or a creation).
 * @returns {object[]} The states.
 */
export function readAll(gladys, device) {
  const cache = device.params ?? {};
  return readUpdate(gladys, device, cache, { withEvents: false }).states;
}

/**
 * Capability behind a Gladys feature external id.
 * @returns {object | undefined} The capability.
 */
export function capabilityOfFeature(gladys, device, featureExternalId) {
  const ids = idsOf(gladys, device.deviceid);
  return (device.capabilities ?? []).find(
    (capability) => capability.feature && ids.feature(capability.key) === featureExternalId,
  );
}
