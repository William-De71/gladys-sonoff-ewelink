// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+), registered by
// index.js with `gladys.onSceneAction(key, ...)`.
//
//   - rf_transmit      send a code learned by an RF Bridge 433;
//   - send_command     send raw eWeLink parameters (what Gladys has no feature
//                      for: light effects, child lock of a rare model...);
//   - refresh_devices  rescan the LAN and the cloud list.
//
// Fields arrive resolved by the core; the handlers resolve the declared
// outputs. An unreachable device is an output (`sent: false`), not a failure:
// a scene action is never a condition, the author gates on the output.
// These actions never fire a scene event (no loop through the integration).
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { rfChannels } from './devices/capabilities.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'scenes' });

function entryOf(manager, externalId) {
  const entry = manager.entryOfDevice({ external_id: externalId });
  if (!entry) {
    throw new Error(t('deviceUnknown').en);
  }
  return entry;
}

/** RF Bridge channel from a number or a learned code name. */
export function findRfChannel(entry, wanted) {
  const value = String(wanted ?? '').trim();
  const channels = entry.uiid === 28 ? rfChannels(entry) : [];
  return (
    channels.find((item) => item.channel === value) ??
    channels.find((item) => item.name.toLowerCase() === value.toLowerCase())
  );
}

export const SCENE_ACTIONS = {
  async rf_transmit(manager, { fields }) {
    const entry = entryOf(manager, fields.device);
    const channel = findRfChannel(entry, fields.channel);
    if (!channel) {
      throw new Error(t('notRfBridge', { channel: fields.channel }).en);
    }
    logger.info(`Scene action rf_transmit <- ${entry.deviceid} code ${channel.channel}`);
    const outcome = await manager.send(entry, {
      params: { cmd: 'transmit', rfChl: Number(channel.channel) },
      lanCommand: 'transmit',
    });
    return { sent: outcome.ok, via: outcome.via ?? DEVICE_TRANSPORTS.UNREACHABLE };
  },

  async send_command(manager, { fields }) {
    const entry = entryOf(manager, fields.device);
    let params;
    try {
      params = JSON.parse(String(fields.params ?? ''));
    } catch {
      params = undefined;
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new Error(t('invalidJson').en);
    }
    logger.info(`Scene action send_command <- ${entry.deviceid} ${Object.keys(params).join(',')}`);
    const outcome = await manager.send(entry, { params });
    return { sent: outcome.ok, via: outcome.via ?? DEVICE_TRANSPORTS.UNREACHABLE };
  },

  async refresh_devices(manager) {
    logger.info('Scene action refresh_devices');
    const devices = await manager.scan();
    const { counts } = manager.summary();
    return { devices, reachable: devices - counts.unreachable };
  },
};
