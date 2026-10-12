// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//   - add_local_device    add a device by hand (DIY without mDNS, or a device
//                         whose key the user looked up), id + IP + devicekey;
//   - remove_local_device remove it from that list;
//   - test_connection     LAN scan + cloud status, reported under the button.
// Invalid input is answered with a message rather than thrown: an error
// carries one language only, a message the four of the Gladys interface.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CLOUD_STATUS } from './manager.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'actions' });

const DEVICE_ID = /^[0-9a-f]{10}$/i;
const HOST = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/;

export const ACTIONS = {
  async add_local_device(manager, fields) {
    const deviceid = String(fields.deviceid ?? '')
      .trim()
      .toLowerCase();
    const host = String(fields.host ?? '').trim();
    const devicekey = String(fields.devicekey ?? '').trim();
    if (!DEVICE_ID.test(deviceid)) {
      return t('invalidDeviceId');
    }
    if (host && !validHost(host)) {
      return t('invalidHost');
    }
    const devices = manager.config.localDevices.filter((device) => device.deviceid !== deviceid);
    const previous = manager.config.localDevices.find((device) => device.deviceid === deviceid);
    devices.push({
      deviceid,
      // Leaving a field empty keeps what was saved before.
      host: host || previous?.host || undefined,
      devicekey: devicekey || previous?.devicekey || undefined,
    });
    await manager.saveLocalDevices(devices);
    logger.info(`Manual device ${deviceid} saved`);
    await manager.scan();
    return t('localDeviceSaved', { deviceid });
  },

  async remove_local_device(manager, fields) {
    const deviceid = String(fields.deviceid ?? '')
      .trim()
      .toLowerCase();
    const devices = manager.config.localDevices.filter((device) => device.deviceid !== deviceid);
    if (devices.length === manager.config.localDevices.length) {
      return t('localDeviceUnknown', { deviceid });
    }
    await manager.saveLocalDevices(devices);
    return t('localDeviceRemoved', { deviceid });
  },

  async test_connection(manager) {
    const local = manager.config.local_enabled ? await manager.scanLocal() : 0;
    if (manager.lastScanError) {
      return t('scanUnavailable', { reason: manager.lastScanError });
    }
    const cloud =
      manager.cloudStatus === CLOUD_STATUS.CONNECTED
        ? t('cloudConnected', { count: manager.registry.list().filter((e) => e.apikey).length })
        : manager.cloudStatus === CLOUD_STATUS.DISABLED
          ? t('cloudDisabled')
          : t('cloudDisconnected');
    const total = manager.registry.usable().length;
    const result = {};
    for (const language of Object.keys(cloud)) {
      result[language] = t('testResult', { local, total, cloud: cloud[language] })[language];
    }
    return result;
  },
};

function validHost(host) {
  if (!HOST.test(host)) {
    return false;
  }
  const [address, port] = host.split(':');
  return (
    address.split('.').every((part) => Number(part) <= 255) &&
    (port === undefined || (Number(port) > 0 && Number(port) < 65536))
  );
}
