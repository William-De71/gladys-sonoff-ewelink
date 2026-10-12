// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+). Declarative content
// only: the core renders it with its own theme. Each entry exposes
//   get(manager, { settings, language, units })    -> content
//   action(manager, { actionKey, params, settings }) -> toast (optional)
//
//   network_status  how every device is reached (LAN, cloud, unreachable),
//                   the cloud session and the API quota of the month;
//   energy_monitor  live power, voltage, current and consumption of one
//                   metering device, power chart, on/off buttons;
//   rf_remote       up to four codes of an RF Bridge as buttons, and the codes
//                   it received lately.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { idsOf } from './devices/model.js';
import { rfChannels } from './devices/capabilities.js';
import { findRfChannel } from './scenes.js';
import { CLOUD_STATUS } from './manager.js';
import { FREE_QUOTA_PER_MONTH } from './store.js';
import { t } from './i18n.js';

export const NETWORK_STATUS_WIDGET = 'network_status';
export const ENERGY_MONITOR_WIDGET = 'energy_monitor';
export const RF_REMOTE_WIDGET = 'rf_remote';

const RESCAN_ACTION = 'rescan';
const MAX_RF_BUTTONS = 4;
const MAX_LIST_ITEMS = 8;

const CLOUD_ROW = {
  [CLOUD_STATUS.CONNECTED]: ['wConnected', WIDGET_COLORS.SUCCESS],
  [CLOUD_STATUS.DISABLED]: ['wDisabled', WIDGET_COLORS.NEUTRAL],
  [CLOUD_STATUS.CONNECTING]: ['wDisconnected', WIDGET_COLORS.WARNING],
  [CLOUD_STATUS.DISCONNECTED]: ['wDisconnected', WIDGET_COLORS.WARNING],
  [CLOUD_STATUS.AUTH_REQUIRED]: ['wDisconnected', WIDGET_COLORS.DANGER],
  [CLOUD_STATUS.QUOTA_EXHAUSTED]: ['wDisconnected', WIDGET_COLORS.DANGER],
};

/** Shorten a text to the limit of a card field. */
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const clipAll = (message, max) =>
  Object.fromEntries(Object.entries(message).map(([lang, text]) => [lang, clip(text, max)]));

function networkStatus(manager) {
  const summary = manager.summary();
  const components = [];
  if (summary.total === 0) {
    components.push({ type: 'text', text: t('wNoDevice') });
  } else {
    components.push(
      {
        type: 'value',
        label: t('wLocal'),
        value: summary.counts[DEVICE_TRANSPORTS.LOCAL],
        icon: 'home',
        color: WIDGET_COLORS.SUCCESS,
      },
      {
        type: 'value',
        label: t('wCloudShort'),
        value: summary.counts[DEVICE_TRANSPORTS.CLOUD],
        icon: 'cloud',
        color: WIDGET_COLORS.INFO,
      },
      {
        type: 'value',
        label: t('wOffline'),
        value: summary.counts[DEVICE_TRANSPORTS.UNREACHABLE],
        icon: 'wifi-off',
        color:
          summary.counts[DEVICE_TRANSPORTS.UNREACHABLE] > 0
            ? WIDGET_COLORS.DANGER
            : WIDGET_COLORS.NEUTRAL,
      },
    );
  }

  const [cloudLabel, cloudColor] = CLOUD_ROW[summary.cloudStatus];
  const rows = [
    { label: t('wCloud'), value: t(cloudLabel), icon: 'cloud', color: cloudColor },
    {
      label: t('wLocalScan'),
      value: summary.localEnabled ? t('wLocalOn') : t('wDisabled'),
      icon: 'wifi',
      color: summary.localEnabled ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (summary.cloudStatus !== CLOUD_STATUS.DISABLED) {
    const ratio = summary.apiCalls / FREE_QUOTA_PER_MONTH;
    rows.push({
      label: t('wApiCalls'),
      value: `${summary.apiCalls} / ${FREE_QUOTA_PER_MONTH}`,
      icon: 'activity',
      color:
        ratio >= 0.9
          ? WIDGET_COLORS.DANGER
          : ratio >= 0.7
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items: rows });

  if (summary.problems.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: summary.problems.slice(0, MAX_LIST_ITEMS).map(({ entry, transport, message }) => ({
        title: clip(entry.name ?? entry.deviceid, 60),
        ...(message ? { subtitle: clipAll(message, 60) } : {}),
        badge:
          transport === DEVICE_TRANSPORTS.UNREACHABLE
            ? { text: t('wUnreachable'), color: WIDGET_COLORS.DANGER }
            : { text: t('wDegraded'), color: WIDGET_COLORS.WARNING },
      })),
    });
  } else if (summary.total > 0) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: t('wAllReachable', { count: summary.total }),
    });
  }
  components.push({
    type: 'button',
    label: t('wRescan'),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: RESCAN_ACTION },
  });
  return { ttl_seconds: 60, components };
}

/** Entry picked in a `source: "devices"` setting, or undefined. */
function pickedEntry(manager, settings) {
  const externalId = settings?.device;
  return externalId ? manager.entryOfDevice({ external_id: externalId }) : undefined;
}

const featureOf = (manager, entry, keys) => {
  const key = keys.find((candidate) =>
    entry.capabilities.some((capability) => capability.feature && capability.key === candidate),
  );
  return key ? idsOf(manager.gladys, entry.deviceid).feature(key) : undefined;
};

function energyMonitor(manager, { settings }) {
  const entry = pickedEntry(manager, settings);
  if (!entry) {
    return { ttl_seconds: 300, components: [{ type: 'text', text: t('wPickDevice') }] };
  }
  const power = featureOf(manager, entry, ['power', 'power_1']);
  if (!power) {
    return { ttl_seconds: 300, components: [{ type: 'text', text: t('wNoMetering') }] };
  }
  const tiles = [
    ['wPower', 'zap', power],
    ['wVoltage', 'activity', featureOf(manager, entry, ['voltage', 'voltage_1'])],
    ['wCurrent', 'trending-up', featureOf(manager, entry, ['current', 'current_1'])],
    ['wToday', 'calendar', featureOf(manager, entry, ['energy_day', 'energy_today'])],
    ['wMonth', 'bar-chart-2', featureOf(manager, entry, ['energy_month'])],
  ]
    .filter(([, , feature]) => feature)
    .map(([label, icon, feature]) => ({
      type: 'value',
      label: t(label),
      icon,
      device_feature: feature,
    }));
  const components = [
    ...tiles,
    {
      type: 'chart',
      chart_type: 'area',
      title: t('wPowerChart'),
      device_features: [power],
      interval: 'last-day',
    },
  ];
  const relay = featureOf(manager, entry, ['switch', 'switch_1']);
  if (relay) {
    components.push(
      {
        type: 'button',
        label: t('wOn'),
        icon: 'power',
        style: 'primary',
        device_feature: relay,
        value: 1,
      },
      {
        type: 'button',
        label: t('wOff'),
        icon: 'power',
        style: 'secondary',
        device_feature: relay,
        value: 0,
      },
    );
  }
  // Live tiles and the chart follow the published states: the TTL only
  // matters if the device changes.
  return { ttl_seconds: 600, components };
}

function rfRemote(manager, { settings }) {
  const entry = pickedEntry(manager, settings);
  if (!entry) {
    return { ttl_seconds: 300, components: [{ type: 'text', text: t('wPickDevice') }] };
  }
  if (entry.uiid !== 28) {
    return { ttl_seconds: 300, components: [{ type: 'text', text: t('wNotRfBridge') }] };
  }
  const ids = idsOf(manager.gladys, entry.deviceid);
  const wanted = String(settings?.codes ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  const channels =
    wanted.length > 0
      ? wanted.map((code) => findRfChannel(entry, code)).filter(Boolean)
      : rfChannels(entry);
  const components = [];
  const history = entry.memory.rfHistory ?? [];
  if (history.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: history.slice(0, MAX_LIST_ITEMS).map((item) => ({
        title: clip(item.name, 60),
        subtitle: `#${item.channel}`,
        date: new Date(item.at).toISOString(),
      })),
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: t('wNothingReceived') });
  }
  if (channels.length === 0) {
    components.unshift({ type: 'text', text: t('wNoRfCode') });
  }
  for (const channel of channels.slice(0, MAX_RF_BUTTONS)) {
    components.push({
      type: 'button',
      label: clip(channel.name, 24),
      icon: 'radio',
      style: 'secondary',
      device_feature: ids.feature(`rf_${channel.channel}`),
      value: 1,
    });
  }
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [NETWORK_STATUS_WIDGET]: {
    get: (manager) => networkStatus(manager),
    async action(manager, { actionKey }) {
      if (actionKey !== RESCAN_ACTION) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const count = await manager.scan();
      return t('scanDone', { count });
    },
  },
  [ENERGY_MONITOR_WIDGET]: { get: (manager, options) => energyMonitor(manager, options) },
  [RF_REMOTE_WIDGET]: { get: (manager, options) => rfRemote(manager, options) },
};

/** Ask the core to re-pull the widgets whose content changed. */
export function refreshWidgets(gladys, keys = Object.keys(WIDGETS)) {
  for (const key of keys) {
    gladys.requestWidgetRefresh(key);
  }
}
