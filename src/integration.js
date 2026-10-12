// -----------------------------------------------------------------------------
// Handler registration, kept out of index.js so the tests can run the whole
// integration against the fake Gladys of the SDK (integration-sdk/testing).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Manager } from './manager.js';
import { ACTIONS } from './actions.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS } from './widgets.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'integration' });

/**
 * Register every handler on the SDK client.
 * @param {object} gladys - SDK client (real or fake).
 * @param {object} [options] - Manager options (store, LAN client, fetch...).
 * @returns {{ manager: Manager, shutdown: () => Promise<void> }} The running integration.
 */
export function createIntegration(gladys, options = {}) {
  const manager = new Manager({
    gladys,
    onWidgetChange: (key) => gladys.requestWidgetRefresh(key),
    ...options,
  });

  gladys.onScanRequest(async () => {
    logger.info('Scan requested');
    await manager.scan();
  });

  gladys.onSetValue((device, feature, value) => manager.setValue(device, feature, value));

  // A device the user just created: send it the states we already know.
  gladys.onDeviceCreated(async (device) => {
    const entry = manager.entryOfDevice(device);
    if (entry) {
      await manager.resyncStates([entry]);
    }
  });

  gladys.onOAuthAuthorizeUrl((_key, redirectUri) => manager.oauthAuthorizeUrl(redirectUri));
  gladys.onOAuthCallback((_key, params) => manager.oauthCallback(params));

  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler(manager, fields ?? {}));
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(manager, { fields: fields ?? {} }));
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(manager, request));
    if (widget.action) {
      gladys.onWidgetAction(key, (actionKey, params, { settings } = {}) =>
        widget.action(manager, { actionKey, params, settings }),
      );
    }
  }

  gladys.onConfigUpdated(async (raw) => {
    logger.info('Configuration updated');
    await manager.reconfigure(normalizeConfig(raw));
  });

  gladys.on('connected', async () => {
    try {
      await manager.start(normalizeConfig(await gladys.getConfig()));
    } catch (error) {
      logger.error('Post-connection initialization failed', error);
      await gladys.setConnectionStatus(false, t('initFailed')).catch(() => {});
    }
  });

  gladys.on('disconnected', () => manager.suspend());

  return {
    manager,
    shutdown: () => manager.stop(),
  };
}
