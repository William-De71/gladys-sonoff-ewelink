// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of the manifest. DEFAULT_CONFIG
// mirrors the manifest defaults (test/manifest.test.js checks it). Values kept
// OUTSIDE the schema (never shown in the form) are written with setConfig:
//   - `ewelink_session`: the cloud tokens, region and account apikey (JSON);
//   - `local_devices`: the devices added by hand (id, IP, devicekey) (JSON).
// -----------------------------------------------------------------------------

export const CLOUD_MODES = { NONE: 'none', OAUTH: 'oauth', PASSWORD: 'password' };

export const SESSION_KEY = 'ewelink_session';
export const LOCAL_DEVICES_KEY = 'local_devices';

export const DEFAULT_CONFIG = {
  cloud_mode: CLOUD_MODES.NONE,
  app_id: '',
  app_secret: '',
  region: 'eu',
  account: '',
  password: '',
  country_code: '+33',
  local_enabled: true,
  scan_interval: 60,
  poll_interval: 30,
  cloud_energy_history: true,
  // Reserved key: both transports are declared, so Gladys shows the standard
  // "Prefer the local connection" toggle and sends the choice here.
  GLADYS_PREFER_LOCAL: true,
};

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function parseJson(value, fallback) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string' || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Normalize the configuration received from Gladys.
 * @param {Record<string, unknown>} raw - Config returned by the SDK.
 */
export function normalizeConfig(raw = {}) {
  const mode = Object.values(CLOUD_MODES).includes(raw.cloud_mode)
    ? raw.cloud_mode
    : DEFAULT_CONFIG.cloud_mode;
  const localDevices = parseJson(raw[LOCAL_DEVICES_KEY], []);
  return {
    cloud_mode: mode,
    app_id: text(raw.app_id),
    app_secret: text(raw.app_secret),
    region: ['eu', 'us', 'as', 'cn'].includes(raw.region) ? raw.region : DEFAULT_CONFIG.region,
    account: text(raw.account),
    password: typeof raw.password === 'string' ? raw.password : '',
    country_code: normalizeCountryCode(raw.country_code),
    local_enabled: raw.local_enabled !== false,
    scan_interval: clamp(raw.scan_interval, 20, 3600, DEFAULT_CONFIG.scan_interval),
    poll_interval: clamp(raw.poll_interval, 10, 600, DEFAULT_CONFIG.poll_interval),
    cloud_energy_history: raw.cloud_energy_history !== false,
    GLADYS_PREFER_LOCAL: raw.GLADYS_PREFER_LOCAL !== false,
    session: parseJson(raw[SESSION_KEY], null),
    localDevices: Array.isArray(localDevices) ? localDevices.filter(isLocalDevice) : [],
  };
}

function normalizeCountryCode(value) {
  // '+33', '33' and '0033' are the same calling code.
  const digits = text(value)
    .replace(/[^0-9]/g, '')
    .replace(/^00/, '');
  return digits ? `+${digits}` : DEFAULT_CONFIG.country_code;
}

const isLocalDevice = (entry) =>
  entry && typeof entry === 'object' && /^[0-9a-f]{10}$/i.test(entry.deviceid ?? '');

/** The cloud is usable: a mode, an App ID and an App Secret. */
export function cloudConfigured(config) {
  if (config.cloud_mode === CLOUD_MODES.NONE || !config.app_id || !config.app_secret) {
    return false;
  }
  if (config.cloud_mode === CLOUD_MODES.PASSWORD) {
    return Boolean(config.account && config.password);
  }
  return true;
}
