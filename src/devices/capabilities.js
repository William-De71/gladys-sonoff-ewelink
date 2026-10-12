// -----------------------------------------------------------------------------
// Capabilities: one Gladys feature each (or a scene event source), built from
// the eWeLink parameters. Ported from the entity classes of SonoffLAN (AlexxIT,
// MIT licence): same parameters, same conversions, same commands.
//
// A capability is a plain object:
//   key       stable feature key (part of the external_id: NEVER renamed)
//   watch     eWeLink parameters whose arrival refreshes the feature
//   feature   Gladys feature fields (category, type, unit, min, max...)
//   read(cache, update)        -> number | undefined  (cache: every known param)
//   write(value, cache, device) -> command | undefined
//   events(update, cache, memory) -> [{ key, data }]   (scene triggers)
//   momentary  the feature falls back to 0 right after a command (RF buttons)
//
// A command is { params, lanParams?, lanCommand?, cloudOnly?, bulk? }.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import {
  conv,
  hsToRgb,
  intToRgb,
  kelvinToMired,
  miredToKelvin,
  onOff,
  rgbToHs,
  rgbToInt,
  round,
  toNumber,
  toOnOff,
} from './convert.js';

// Gladys enums (server/utils/constants.js), mirrored for readability.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const FAN_MODE = { OFF: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
export const FAN_ROCK = { OFF: 0, LEFT_RIGHT: 1 };
export const FAN_WIND = { OFF: 0, SLEEP: 1, NATURAL: 2 };
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };
export const THERMOSTAT_PRESET = { SCHEDULE: 0, ECO: 3, COMFORT: 5 };
export const THERMOSTAT_OPERATING_STATE = { IDLE: 0, HEATING: 1 };
export const BUTTON_STATUS = { CLICK: 1, DOUBLE_CLICK: 2, LONG_CLICK: 6, TRIPLE_CLICK: 18 };
// SINGLE_BUTTON_1 = 89, then DOUBLE, LONG, TRIPLE, and the same for buttons 2-4.
const SINGLE_BUTTON_1 = 89;
export const PRESSES = ['single', 'double', 'long', 'triple'];

const actuator = { read_only: false, has_feedback: true, keep_history: true };
const sensorFields = { read_only: true, has_feedback: false, keep_history: true };

const has = (object, key) => object !== null && typeof object === 'object' && key in object;

// --- Switches ---------------------------------------------------------------

/** Single relay: `switch: on|off` (Basic, Mini, POW...). */
export function relay({ key = 'switch', name = 'Switch', variant } = {}) {
  return {
    key,
    watch: ['switch'],
    feature: { name, category: CAT.SWITCH, type: TYPE.SWITCH.BINARY, min: 0, max: 1, ...actuator },
    read: (cache) => onOff(cache.switch),
    write(value) {
      const state = toOnOff(value);
      if (variant === 'th') {
        // TH: leave the automatic (thermostat) mode, like the eWeLink app.
        return { params: { switch: state, mainSwitch: state, deviceType: 'normal' } };
      }
      return { params: { switch: state } };
    },
  };
}

/** One outlet of a multi-channel device: `switches: [{ outlet, switch }]`. */
export function channel(index, { variant, names = {} } = {}) {
  return {
    key: `switch_${index + 1}`,
    watch: ['switches'],
    feature: {
      name: names[String(index)] ?? `Channel ${index + 1}`,
      category: CAT.SWITCH,
      type: TYPE.SWITCH.BINARY,
      min: 0,
      max: 1,
      ...actuator,
    },
    read(cache) {
      const outlet = Array.isArray(cache.switches)
        ? cache.switches.find((item) => item?.outlet === index)
        : undefined;
      return outlet ? onOff(outlet.switch) : undefined;
    },
    write(value, cache) {
      const state = toOnOff(value);
      if (variant === 'powr3') {
        return { params: { switches: [{ outlet: 0, switch: state }], operSide: 1 } };
      }
      if (variant === 'zigbee') {
        // Zigbee multi-gang switches want every outlet in each command.
        const switches = (Array.isArray(cache.switches) ? cache.switches : []).map((item) =>
          item.outlet === index ? { outlet: index, switch: state } : item,
        );
        if (!switches.some((item) => item.outlet === index)) {
          switches.push({ outlet: index, switch: state });
        }
        return { params: { switches } };
      }
      return { params: { switches: [{ outlet: index, switch: state }] }, bulk: 'switches' };
    },
  };
}

/** A parameter holding 'on' / 'off' (LED indicator, inching...). */
export function toggle(param, { key = param, name, category = CAT.SWITCH } = {}) {
  return {
    key,
    watch: [param],
    feature: { name, category, type: TYPE.SWITCH.BINARY, min: 0, max: 1, ...actuator },
    read: (cache) => onOff(cache[param]),
    write: (value) => ({ params: { [param]: toOnOff(value) } }),
  };
}

/** A parameter holding true / false. */
export function boolSwitch(param, { key = param, name, category = CAT.SWITCH, extra } = {}) {
  const type = category === CAT.CHILD_LOCK ? TYPE.CHILD_LOCK.BINARY : TYPE.SWITCH.BINARY;
  return {
    key,
    watch: [param],
    feature: { name, category, type, min: 0, max: 1, ...actuator },
    read: (cache) => (typeof cache[param] === 'boolean' ? Number(cache[param]) : undefined),
    write: (value) => ({ params: { [param]: Number(value) >= 1, ...extra } }),
  };
}

/** A parameter holding 1 / 0, only settable through the cloud. */
export function intSwitch(param, { key = param, name } = {}) {
  return {
    key,
    watch: [param],
    feature: { name, category: CAT.SWITCH, type: TYPE.SWITCH.BINARY, min: 0, max: 1, ...actuator },
    read: (cache) => (cache[param] === 1 ? 1 : cache[param] === 0 ? 0 : undefined),
    write: (value) => ({ params: { [param]: Number(value) >= 1 ? 1 : 0 }, cloudOnly: true }),
  };
}

/** Power-on state of a single relay: `startup: on|off|stay`. */
export function startup() {
  return {
    key: 'startup',
    watch: ['startup'],
    feature: startupFeature('Power-on state'),
    readText: (cache) =>
      ['on', 'off', 'stay'].includes(cache.startup) ? cache.startup : undefined,
    write: (value) => (STARTUP.includes(value) ? { params: { startup: value } } : undefined),
  };
}

/** Power-on state of one outlet: `configure: [{ outlet, startup }]`. */
export function channelStartup(index) {
  return {
    key: `startup_${index + 1}`,
    watch: ['configure'],
    feature: startupFeature(`Power-on state ${index + 1}`),
    readText(cache) {
      const item = Array.isArray(cache.configure)
        ? cache.configure.find((entry) => entry?.outlet === index)
        : undefined;
      return item ? (item.startup ?? 'stay') : undefined;
    },
    write(value, cache) {
      if (!STARTUP.includes(value)) {
        return undefined;
      }
      const configure = (Array.isArray(cache.configure) ? cache.configure : []).map((item) => ({
        ...item,
      }));
      const item = configure.find((entry) => entry.outlet === index);
      if (item) {
        item.startup = value;
      } else {
        configure.push({ outlet: index, startup: value, enableDelay: 0, width: 1000 });
      }
      return { params: { configure } };
    },
  };
}

const STARTUP = ['off', 'on', 'stay'];

function startupFeature(name) {
  return {
    name,
    category: CAT.TEXT,
    type: TYPE.TEXT.SELECT,
    read_only: false,
    has_feedback: true,
    keep_history: false,
    supported_options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
      { value: 'stay', label: 'Previous state' },
    ],
  };
}

/** Inching duration, in seconds (`pulseWidth`, in ms, by steps of 500). */
export function pulseWidth() {
  return {
    key: 'pulse_width',
    watch: ['pulseWidth'],
    feature: {
      name: 'Inching duration',
      category: CAT.DURATION,
      type: TYPE.DURATION.DECIMAL,
      unit: UNIT.SECONDS,
      min: 0.5,
      max: 3600,
      ...actuator,
      keep_history: false,
    },
    read: (cache) =>
      toNumber(cache.pulseWidth) === undefined ? undefined : cache.pulseWidth / 1000,
    // The device refuses a width sent without `pulse: on`.
    write: (value) => ({
      params: { pulse: 'on', pulseWidth: Math.max(1, Math.round(Number(value) / 0.5)) * 500 },
    }),
  };
}

// --- Sensors ----------------------------------------------------------------

const SENSOR_KINDS = {
  temperature: [CAT.TEMPERATURE_SENSOR, TYPE.SENSOR.DECIMAL, UNIT.CELSIUS, 'Temperature'],
  probe: [CAT.TEMPERATURE_SENSOR, TYPE.TEMPERATURE_SENSOR.PROBE, UNIT.CELSIUS, 'Probe temperature'],
  device_temperature: [
    CAT.DEVICE_TEMPERATURE_SENSOR,
    TYPE.SENSOR.DECIMAL,
    UNIT.CELSIUS,
    'Device temperature',
  ],
  humidity: [CAT.HUMIDITY_SENSOR, TYPE.SENSOR.DECIMAL, UNIT.PERCENT, 'Humidity'],
  power: [CAT.ENERGY_SENSOR, TYPE.ENERGY_SENSOR.POWER, UNIT.WATT, 'Power'],
  current: [CAT.ENERGY_SENSOR, TYPE.ENERGY_SENSOR.CURRENT, UNIT.AMPERE, 'Current'],
  voltage: [CAT.ENERGY_SENSOR, TYPE.ENERGY_SENSOR.VOLTAGE, UNIT.VOLT, 'Voltage'],
  energy: [CAT.ENERGY_SENSOR, TYPE.ENERGY_SENSOR.ENERGY, UNIT.KILOWATT_HOUR, 'Energy'],
  energy_index: [CAT.ENERGY_SENSOR, TYPE.ENERGY_SENSOR.INDEX, UNIT.KILOWATT_HOUR, 'Energy index'],
  production_power: [
    CAT.ENERGY_PRODUCTION_SENSOR,
    TYPE.ENERGY_PRODUCTION_SENSOR.POWER,
    UNIT.WATT,
    'Supply power',
  ],
  daily_production: [
    CAT.ENERGY_PRODUCTION_SENSOR,
    TYPE.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
    UNIT.KILOWATT_HOUR,
    'Supply today',
  ],
  battery: [CAT.BATTERY, TYPE.BATTERY.INTEGER, UNIT.PERCENT, 'Battery'],
  co2: [CAT.CO2_SENSOR, TYPE.SENSOR.INTEGER, UNIT.PPM, 'CO2'],
  pm25: [CAT.PM25_SENSOR, TYPE.SENSOR.DECIMAL, UNIT.MICROGRAM_PER_CUBIC_METER, 'PM2.5'],
  pm10: [CAT.PM10_SENSOR, TYPE.SENSOR.DECIMAL, UNIT.MICROGRAM_PER_CUBIC_METER, 'PM10'],
  pressure: [CAT.PRESSURE_SENSOR, TYPE.SENSOR.DECIMAL, UNIT.HPA, 'Pressure'],
  illuminance: [CAT.LIGHT_SENSOR, TYPE.SENSOR.DECIMAL, UNIT.LUX, 'Illuminance'],
  light_level: [CAT.LIGHT_SENSOR, TYPE.SENSOR.INTEGER, undefined, 'Light level'],
  noise: [CAT.NOISE_SENSOR, TYPE.SENSOR.INTEGER, UNIT.DECIBEL, 'Noise'],
  water: [CAT.VOLUME_SENSOR, TYPE.SENSOR.DECIMAL, UNIT.LITER, 'Water used today'],
  minutes: [CAT.DURATION, TYPE.DURATION.INTEGER, UNIT.MINUTES, 'Duration'],
  percent: [CAT.UNKNOWN, TYPE.UNKNOWN.UNKNOWN, UNIT.PERCENT, 'Level'],
  raw: [CAT.UNKNOWN, TYPE.UNKNOWN.UNKNOWN, undefined, 'Value'],
};

/**
 * Numeric sensor reading one parameter.
 * @param {string} param - eWeLink parameter.
 * @param {object} [options] - Options.
 * @param {keyof SENSOR_KINDS} [options.kind] - Gladys category/type/unit.
 * @param {string} [options.key] - Feature key (defaults to the parameter).
 * @param {number} [options.multiply] - Factor (0.01 for hundredths).
 * @param {(value: any, cache: object) => any} [options.pick] - Extract a nested value.
 * @param {(value: number) => boolean} [options.valid] - Reject impossible readings.
 */
export function sensor(param, { kind = param, key = param, name, multiply, pick, valid } = {}) {
  const [category, type, unit, defaultName] = SENSOR_KINDS[kind];
  return {
    key,
    watch: [param],
    feature: {
      name: name ?? defaultName,
      category,
      type,
      ...(unit ? { unit } : {}),
      ...sensorFields,
    },
    read(cache) {
      let value = toNumber(pick ? pick(cache[param], cache) : cache[param]);
      if (value === undefined) {
        return undefined;
      }
      if (multiply) {
        value *= multiply;
      }
      value = round(value, 2);
      return valid && !valid(value) ? undefined : value;
    },
  };
}

/** TH temperature: `currentTemperature` or `temperature`, 0 and absurd values filtered. */
export function thTemperature() {
  return {
    ...sensor('temperature', { valid: (v) => v !== 0 && v > -270 && v < 270 }),
    watch: ['currentTemperature', 'temperature'],
    read(cache) {
      const value = toNumber(cache.currentTemperature) ?? toNumber(cache.temperature);
      return value === undefined || value === 0 || value <= -270 || value >= 270
        ? undefined
        : round(value, 1);
    },
  };
}

export function thHumidity() {
  return {
    ...sensor('humidity'),
    watch: ['currentHumidity', 'humidity'],
    read(cache) {
      const value = toNumber(cache.currentHumidity) ?? toNumber(cache.humidity);
      return value === undefined || value === 0 ? undefined : round(value, 1);
    },
  };
}

/** Reading plus its user correction (`tempCorrection`, `humCorrection`). */
export function corrected(param, correction, { multiply } = {}) {
  return {
    ...sensor(param),
    watch: [param, correction],
    read(cache) {
      let value = toNumber(cache[param]);
      if (value === undefined) {
        return undefined;
      }
      if (multiply) {
        value *= multiply;
      }
      return round(value + (toNumber(cache[correction]) ?? 0), 2);
    },
  };
}

/** Today's consumption decoded from the cloud history (`hundredDaysKwhData`). */
export function cloudEnergyToday(param = 'hundredDaysKwhData', decoder = decodeHundredDays) {
  return {
    ...sensor(param, { kind: 'energy', key: 'energy_today', name: 'Energy today' }),
    read(cache) {
      const history = decoder(cache[param]);
      return history?.length ? history[0] : undefined;
    },
  };
}

/** Pairs of hex-int + 2 decimal digits per day (POW, POWR2, S40). */
export function decodeHundredDays(value) {
  if (typeof value !== 'string' || value.length < 6) {
    return undefined;
  }
  const days = [];
  for (let i = 0; i + 6 <= value.length; i += 6) {
    const integer = Number.parseInt(value.slice(i, i + 2), 16);
    const tenth = Number.parseInt(value[i + 3], 10);
    const hundredth = Number.parseInt(value[i + 5], 10);
    if ([integer, tenth, hundredth].some(Number.isNaN)) {
      return undefined;
    }
    days.push(round(integer + tenth * 0.1 + hundredth * 0.01, 2));
  }
  return days;
}

// --- Binary sensors ---------------------------------------------------------

const BINARY_KINDS = {
  door: [CAT.OPENING_SENSOR, TYPE.SENSOR.BINARY, 'Door'],
  motion: [CAT.MOTION_SENSOR, TYPE.SENSOR.BINARY, 'Motion'],
  presence: [CAT.PRESENCE_SENSOR, TYPE.SENSOR.BINARY, 'Occupancy'],
  leak: [CAT.LEAK_SENSOR, TYPE.SENSOR.BINARY, 'Water leak'],
  generic: [CAT.UNKNOWN, TYPE.SENSOR.BINARY, 'State'],
};

/**
 * Binary sensor. `active(cache)` says whether the condition holds (door open,
 * motion, leak...). Gladys stores opening sensors as 1 = closed.
 */
export function binarySensor(param, { kind, key = param, name, active }) {
  const [category, type, defaultName] = BINARY_KINDS[kind];
  return {
    key,
    watch: [param],
    feature: { name: name ?? defaultName, category, type, min: 0, max: 1, ...sensorFields },
    read(cache) {
      const value = active(cache);
      if (value === undefined) {
        return undefined;
      }
      if (kind === 'door') {
        return value ? 0 : 1;
      }
      return value ? 1 : 0;
    },
  };
}

// --- Covers -----------------------------------------------------------------

const coverStateFeature = (name = 'Curtain') => ({
  name,
  category: CAT.SHUTTER,
  type: TYPE.SHUTTER.STATE,
  min: -1,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: true,
});

const coverPositionFeature = (name = 'Position') => ({
  name,
  category: CAT.SHUTTER,
  type: TYPE.SHUTTER.POSITION,
  unit: UNIT.PERCENT,
  min: 0,
  max: 100,
  ...actuator,
});

/**
 * Cover state + position features. `model` gives the parameters of a family:
 * the commands for open / close / stop / position, and how to read the
 * position (0 = closed, 100 = open, the Gladys convention).
 */
function coverPair({ watch, open, close, stop, setPosition, readPosition, readMotion }) {
  const capabilities = [
    {
      key: 'cover',
      watch,
      feature: coverStateFeature(),
      read: (cache, update) => (readMotion ? readMotion(cache, update) : undefined),
      write(value) {
        const number = Number(value);
        if (number === COVER_STATE.OPEN) {
          return { params: open };
        }
        if (number === COVER_STATE.CLOSE) {
          return { params: close };
        }
        return { params: stop };
      },
    },
  ];
  if (readPosition) {
    capabilities.push({
      key: 'position',
      watch,
      feature: coverPositionFeature(),
      read: (cache, update) => readPosition(cache, update),
      write: setPosition
        ? (value) => ({ params: setPosition(Math.min(100, Math.max(0, Math.round(value)))) })
        : undefined,
    });
  }
  return capabilities;
}

const motionFromSwitch = (update) => {
  // A lone `switch` update is the motor starting or stopping.
  if (update && Object.keys(update).length === 1 && 'switch' in update) {
    if (update.switch === 'on') {
      return COVER_STATE.OPEN;
    }
    if (update.switch === 'off') {
      return COVER_STATE.CLOSE;
    }
    return COVER_STATE.STOP;
  }
  return undefined;
};

/** King Q4 and similar: `switch: on|off|pause`, `setclose` = % closed. */
export function cover() {
  return coverPair({
    watch: ['switch', 'setclose'],
    open: { switch: 'on' },
    close: { switch: 'off' },
    stop: { switch: 'pause' },
    setPosition: (position) => ({ setclose: 100 - position }),
    readPosition: (cache, update) =>
      update && Object.keys(update).length === 1 && 'switch' in update
        ? undefined
        : toNumber(cache.setclose) === undefined
          ? undefined
          : 100 - cache.setclose,
    readMotion: (cache, update) => motionFromSwitch(update),
  });
}

/** DualR3 in motor mode: `motorTurn` 0 stop / 1 open / 2 close, `currLocation`. */
export function coverDualR3() {
  return coverPair({
    watch: ['currLocation', 'motorTurn'],
    open: { motorTurn: 1 },
    close: { motorTurn: 2 },
    stop: { motorTurn: 0 },
    setPosition: (position) => ({ location: position }),
    readPosition: (cache) => toNumber(cache.currLocation),
    readMotion: (cache, update) => {
      if (!has(update, 'motorTurn')) {
        return undefined;
      }
      return [COVER_STATE.STOP, COVER_STATE.OPEN, COVER_STATE.CLOSE][update.motorTurn];
    },
  });
}

/** Zigbee curtains: `curtainAction`, `curPercent` = % closed, `openPercent`. */
export function coverZigbee() {
  return coverPair({
    watch: ['curPercent', 'curtainAction'],
    open: { curtainAction: 'open' },
    close: { curtainAction: 'close' },
    stop: { curtainAction: 'pause' },
    setPosition: (position) => ({ openPercent: 100 - position }),
    readPosition: (cache) =>
      toNumber(cache.curPercent) === undefined ? undefined : 100 - cache.curPercent,
  });
}

/** Garage door openers: `op` 1 open / 2 stop / 3 close, no position. */
export function coverOp() {
  return coverPair({
    watch: ['op', 'per'],
    open: { op: 1 },
    close: { op: 3 },
    stop: { op: 2 },
    readMotion: (cache, update) => {
      if (has(update, 'per')) {
        return update.per === 0 ? COVER_STATE.CLOSE : COVER_STATE.OPEN;
      }
      if (has(update, 'op')) {
        return { 1: COVER_STATE.OPEN, 2: COVER_STATE.STOP, 3: COVER_STATE.CLOSE }[update.op];
      }
      return undefined;
    },
  });
}

/** Gate motor controllers (UIID 216): `switch` + `doorState` 0 closed. */
export function coverGate() {
  return coverPair({
    watch: ['switch', 'doorState'],
    open: { switch: 'on' },
    close: { switch: 'off' },
    stop: { switch: 'pause' },
    readMotion: (cache, update) => {
      if (has(update, 'doorState')) {
        return update.doorState === 0 ? COVER_STATE.CLOSE : COVER_STATE.OPEN;
      }
      return motionFromSwitch(update);
    },
  });
}

// --- Fans -------------------------------------------------------------------

const fanModeFeature = (options) => ({
  name: 'Fan',
  category: CAT.FAN,
  type: TYPE.FAN.MODE,
  min: 0,
  max: 3,
  ...actuator,
  supported_options: options.map((value) => ({
    value,
    label: ['Off', 'Low', 'Medium', 'High'][value],
  })),
});

/** iFan02/03/04: outlets 1-3 drive the speed (or `fan` + `speed` in DIY). */
export function fanIfan() {
  const outlets = {
    [FAN_MODE.OFF]: { 1: 'off' },
    [FAN_MODE.LOW]: { 1: 'on', 2: 'off', 3: 'off' },
    [FAN_MODE.MEDIUM]: { 1: 'on', 2: 'on', 3: 'off' },
    [FAN_MODE.HIGH]: { 1: 'on', 2: 'off', 3: 'on' },
  };
  return {
    key: 'fan',
    watch: ['switches', 'fan', 'speed'],
    feature: fanModeFeature([0, 1, 2, 3]),
    read(cache) {
      if (Array.isArray(cache.switches)) {
        const s = Object.fromEntries(cache.switches.map((item) => [item.outlet, item.switch]));
        if (s[1] === undefined) {
          return undefined;
        }
        if (s[1] === 'off') {
          return FAN_MODE.OFF;
        }
        if (s[2] === 'on' && s[3] !== 'on') {
          return FAN_MODE.MEDIUM;
        }
        if (s[3] === 'on' && s[2] !== 'on') {
          return FAN_MODE.HIGH;
        }
        return FAN_MODE.LOW;
      }
      if (cache.fan === 'off') {
        return FAN_MODE.OFF;
      }
      return [1, 2, 3].includes(cache.speed) ? cache.speed : undefined;
    },
    write(value, cache, device) {
      const mode = Math.min(3, Math.max(0, Math.round(Number(value))));
      const switches = Object.entries(outlets[mode]).map(([outlet, state]) => ({
        outlet: Number(outlet),
        switch: state,
      }));
      const command = { params: { switches } };
      if (device.localtype === 'fan_light') {
        command.lanParams = mode === 0 ? { fan: 'off' } : { fan: 'on', speed: mode };
      }
      return command;
    },
  };
}

/** UIID 17 fans: `fan`, `speed` slow/moderate/fast, `mode`, `shake`. */
export function fan17() {
  const speeds = { slow: FAN_MODE.LOW, moderate: FAN_MODE.MEDIUM, fast: FAN_MODE.HIGH };
  const winds = { normal: FAN_WIND.OFF, sleep: FAN_WIND.SLEEP, natural: FAN_WIND.NATURAL };
  return [
    {
      key: 'fan',
      watch: ['fan', 'speed'],
      feature: fanModeFeature([0, 1, 2, 3]),
      read(cache) {
        if (cache.fan === 'off') {
          return FAN_MODE.OFF;
        }
        return cache.fan === 'on' ? speeds[cache.speed] : undefined;
      },
      write(value) {
        const mode = Math.round(Number(value));
        if (mode <= 0) {
          return { params: { fan: 'off' } };
        }
        const speed = Object.keys(speeds).find((name) => speeds[name] === Math.min(3, mode));
        return { params: { fan: 'on', speed } };
      },
    },
    {
      key: 'oscillation',
      watch: ['shake'],
      feature: {
        name: 'Oscillation',
        category: CAT.FAN,
        type: TYPE.FAN.ROCK_SETTING,
        min: 0,
        max: 1,
        ...actuator,
        supported_options: [
          { value: FAN_ROCK.OFF, label: 'Off' },
          { value: FAN_ROCK.LEFT_RIGHT, label: 'Left/Right' },
        ],
      },
      read: (cache) => onOff(cache.shake),
      write: (value) => ({ params: { shake: toOnOff(value) } }),
    },
    {
      key: 'wind',
      watch: ['mode'],
      feature: {
        name: 'Wind mode',
        category: CAT.FAN,
        type: TYPE.FAN.WIND_SETTING,
        min: 0,
        max: 2,
        ...actuator,
        supported_options: [
          { value: FAN_WIND.OFF, label: 'Normal' },
          { value: FAN_WIND.SLEEP, label: 'Sleep' },
          { value: FAN_WIND.NATURAL, label: 'Natural' },
        ],
      },
      read: (cache) => winds[cache.mode],
      write(value) {
        const mode = Object.keys(winds).find((name) => winds[name] === Math.round(Number(value)));
        return mode ? { params: { mode } } : undefined;
      },
    },
  ];
}

/** Oil diffuser (UIID 25): `switch` + `state` 1 low / 2 high. */
export function fanDiffuser() {
  return {
    key: 'fan',
    watch: ['switch', 'state'],
    feature: fanModeFeature([0, 1, 3]),
    read(cache) {
      if (cache.switch === 'off') {
        return FAN_MODE.OFF;
      }
      return { 1: FAN_MODE.LOW, 2: FAN_MODE.HIGH }[cache.state];
    },
    write(value) {
      const mode = Math.round(Number(value));
      if (mode <= 0) {
        return { params: { switch: 'off' } };
      }
      return { params: { switch: 'on', state: mode >= FAN_MODE.MEDIUM ? 2 : 1 } };
    },
  };
}

// --- Lights -----------------------------------------------------------------

const lightBinary = (name = 'Light') => ({
  name,
  category: CAT.LIGHT,
  type: TYPE.LIGHT.BINARY,
  min: 0,
  max: 1,
  ...actuator,
});
const lightBrightness = () => ({
  name: 'Brightness',
  category: CAT.LIGHT,
  type: TYPE.LIGHT.BRIGHTNESS,
  unit: UNIT.PERCENT,
  min: 0,
  max: 100,
  ...actuator,
});
const lightColor = () => ({
  name: 'Color',
  category: CAT.LIGHT,
  type: TYPE.LIGHT.COLOR,
  min: 0,
  max: 16777215,
  ...actuator,
});
const lightTemperature = (minKelvin, maxKelvin) => ({
  name: 'Color temperature',
  category: CAT.LIGHT,
  type: TYPE.LIGHT.TEMPERATURE,
  min: kelvinToMired(maxKelvin),
  max: kelvinToMired(minKelvin),
  ...actuator,
});

/**
 * Assemble the light features of one family. `model` provides:
 *   switchParam / on(cache) / onCommand(state)
 *   brightness: { watch, read(cache), write(percent, cache) }
 *   color:      { watch, read(cache) -> [r,g,b], write(rgb, cache) }
 *   temperature:{ min, max (kelvin), watch, read(cache) -> kelvin, write(kelvin, cache) }
 * A dimming or color command on a light that is off also turns it on.
 */
function lightFamily(model) {
  const isOn = model.on ?? ((cache) => onOff(cache[model.switchParam ?? 'switch']));
  const onCommand =
    model.onCommand ?? ((state) => ({ params: { [model.switchParam ?? 'switch']: state } }));
  const withOn = (command, cache) =>
    command && isOn(cache) !== 1 && model.autoOn !== false
      ? { ...command, before: onCommand('on') }
      : command;

  const capabilities = [
    {
      key: 'light',
      watch: model.switchWatch ?? [model.switchParam ?? 'switch'],
      feature: lightBinary(model.name),
      read: isOn,
      write: (value) => onCommand(toOnOff(value)),
    },
  ];
  if (model.brightness) {
    capabilities.push({
      key: 'brightness',
      watch: model.brightness.watch,
      feature: lightBrightness(),
      read: model.brightness.read,
      write(value, cache) {
        const percent = Math.min(100, Math.max(0, Math.round(Number(value))));
        if (percent === 0) {
          return onCommand('off');
        }
        return withOn(model.brightness.write(percent, cache), cache);
      },
    });
  }
  if (model.color) {
    capabilities.push({
      key: 'color',
      watch: model.color.watch,
      feature: lightColor(),
      read(cache) {
        const rgb = model.color.read(cache);
        return rgb ? rgbToInt(rgb) : undefined;
      },
      write: (value, cache) => withOn(model.color.write(intToRgb(value), cache), cache),
    });
  }
  if (model.temperature) {
    const { min, max } = model.temperature;
    capabilities.push({
      key: 'temperature',
      watch: model.temperature.watch,
      feature: lightTemperature(min, max),
      read(cache) {
        const kelvin = model.temperature.read(cache);
        return kelvin ? kelvinToMired(Math.min(max, Math.max(min, kelvin))) : undefined;
      },
      write(value, cache) {
        const kelvin = Math.min(max, Math.max(min, miredToKelvin(Number(value))));
        return withOn(model.temperature.write(kelvin, cache), cache);
      },
    });
  }
  return capabilities;
}

/** Brightness percent from a raw range, for the read side. */
const percentFrom = (value, min, max) => {
  const number = toNumber(value);
  return number === undefined ? undefined : conv(number, min, max, 1, 100);
};

/** KING-M4 (UIID 36): `bright` 10-100. */
export const lightDimmer = () =>
  lightFamily({
    brightness: {
      watch: ['bright'],
      read: (cache) => percentFrom(cache.bright, 10, 100),
      write: (percent) => ({ params: { bright: conv(percent, 1, 100, 10, 100) } }),
    },
  });

/** Mosquito killer lamp (UIID 57): `state`, `channel0` 25-255 (string). */
export const light57 = () =>
  lightFamily({
    switchParam: 'state',
    brightness: {
      watch: ['channel0'],
      read: (cache) => percentFrom(cache.channel0, 25, 255),
      write: (percent) => ({ params: { channel0: String(conv(percent, 1, 100, 25, 255)) } }),
    },
  });

/** Sonoff D1 and Zigbee dimmers: `brightness` 0-100. */
export const lightD1 = () =>
  lightFamily({
    brightness: {
      watch: ['brightness'],
      read: (cache) => percentFrom(cache.brightness, 0, 100),
      write: (percent) => ({
        params: { brightness: conv(percent, 1, 100, 0, 100), mode: 0, switch: 'on' },
      }),
    },
    autoOn: false,
  });

/** MINI-DIM (UIID 277): `brightness` 1-100. */
export const lightMiniDim = () =>
  lightFamily({
    brightness: {
      watch: ['brightness'],
      read: (cache) => percentFrom(cache.brightness, 1, 100),
      write: (percent) => ({ params: { switch: 'on', brightness: percent } }),
    },
    autoOn: false,
  });

/** Sonoff B1 (UIID 22): cold/warm `channel0/1`, RGB `channel2-4`, `zyx_mode`. */
export const lightB1 = () =>
  lightFamily({
    switchParam: 'state',
    brightness: {
      watch: ['channel0', 'channel1', 'zyx_mode'],
      read(cache) {
        if (cache.zyx_mode !== 1) {
          return undefined;
        }
        const level = Math.max(toNumber(cache.channel0) ?? 0, toNumber(cache.channel1) ?? 0);
        return conv(level, 25, 255, 1, 100);
      },
      write: (percent, cache) => b1White(percent, b1Kelvin(cache) ?? 4250),
    },
    color: {
      watch: ['channel2', 'channel3', 'channel4', 'zyx_mode'],
      read: (cache) =>
        cache.zyx_mode === 2
          ? ['channel2', 'channel3', 'channel4'].map((key) => toNumber(cache[key]) ?? 0)
          : undefined,
      write: ([r, g, b]) => ({
        params: {
          channel0: '0',
          channel1: '0',
          channel2: String(r),
          channel3: String(g),
          channel4: String(b),
          zyx_mode: 2,
        },
      }),
    },
    temperature: {
      min: 2000,
      max: 6500,
      watch: ['channel0', 'channel1', 'zyx_mode'],
      read: (cache) => (cache.zyx_mode === 1 ? b1Kelvin(cache) : undefined),
      write: (kelvin, cache) => {
        const level = Math.max(toNumber(cache.channel0) ?? 0, toNumber(cache.channel1) ?? 0);
        return b1White(level ? conv(level, 25, 255, 1, 100) : 100, kelvin);
      },
    },
  });

function b1Kelvin(cache) {
  const cold = toNumber(cache.channel0);
  const warm = toNumber(cache.channel1);
  if (cold === undefined || warm === undefined) {
    return undefined;
  }
  if (warm === 0) {
    return 6500;
  }
  if (cold === warm) {
    return 4250;
  }
  return cold === 0 ? 2000 : 4250;
}

function b1White(percent, kelvin) {
  const level = String(conv(percent, 1, 100, 25, 255));
  let channels;
  if (kelvin >= 5000) {
    channels = { channel0: level, channel1: '0' };
  } else if (kelvin >= 3500) {
    channels = { channel0: level, channel1: level };
  } else {
    channels = { channel0: '0', channel1: level };
  }
  return { params: { ...channels, channel2: '0', channel3: '0', channel4: '0', zyx_mode: 1 } };
}

/** LED strips L1/L2 (UIID 33, 59, 137) and L3 (173): `bright`, `colorR/G/B`. */
export const lightL1 = ({ l3 = false } = {}) =>
  lightFamily({
    brightness: {
      watch: ['bright'],
      read: (cache) => percentFrom(cache.bright, 1, 100),
      write(percent, cache) {
        const params = { mode: 1, bright: percent };
        // The L3 needs the color along with the brightness.
        if (l3) {
          Object.assign(params, l1Color(cache), { light_type: 1 });
        }
        return { params };
      },
    },
    color: {
      watch: ['colorR', 'colorG', 'colorB'],
      read: (cache) =>
        ['colorR', 'colorG', 'colorB'].every((key) => toNumber(cache[key]) !== undefined)
          ? [cache.colorR, cache.colorG, cache.colorB].map(Number)
          : undefined,
      write: ([r, g, b], cache) => ({
        params: {
          mode: 1,
          colorR: r,
          colorG: g,
          colorB: b,
          light_type: 1,
          ...(l3 ? { bright: toNumber(cache.bright) ?? 100 } : {}),
        },
      }),
    },
  });

const l1Color = (cache) => ({
  colorR: toNumber(cache.colorR) ?? 255,
  colorG: toNumber(cache.colorG) ?? 255,
  colorB: toNumber(cache.colorB) ?? 255,
});

/** B02 bulbs (UIID 103, 135): `ltype` white `{ br 1-100, ct 0-255 }`. */
export const lightB02 = ({ minKelvin = 2200, maxKelvin = 6500, maxCt = 255 } = {}) =>
  lightFamily({
    brightness: {
      watch: ['ltype', 'white'],
      read: (cache) => percentFrom(cache[cache.ltype]?.br, 1, 100),
      write: (percent, cache) =>
        b02White(percent, b02Kelvin(cache, minKelvin, maxKelvin, maxCt) ?? maxKelvin, {
          minKelvin,
          maxKelvin,
          maxCt,
        }),
    },
    temperature: {
      min: minKelvin,
      max: maxKelvin,
      watch: ['ltype', 'white'],
      read: (cache) => b02Kelvin(cache, minKelvin, maxKelvin, maxCt),
      write: (kelvin, cache) =>
        b02White(toNumber(cache.white?.br) ?? 100, kelvin, { minKelvin, maxKelvin, maxCt }),
    },
  });

function b02Kelvin(cache, minKelvin, maxKelvin, maxCt) {
  const ct = toNumber(cache[cache.ltype]?.ct);
  return ct === undefined ? undefined : conv(ct, 0, maxCt, minKelvin, maxKelvin);
}

function b02White(percent, kelvin, { minKelvin, maxKelvin, maxCt }) {
  return {
    params: {
      ltype: 'white',
      white: {
        br: conv(percent, 1, 100, 1, 100),
        ct: conv(kelvin, minKelvin, maxKelvin, 0, maxCt),
      },
    },
  };
}

/** B05-B color bulbs (UIID 104, 136): `ltype` white or color `{ br, r, g, b }`. */
export const lightB05 = ({ maxCt = 255 } = {}) => {
  const minKelvin = 2000;
  const maxKelvin = 6500;
  const capabilities = lightFamily({
    brightness: {
      watch: ['ltype', 'white', 'color'],
      read: (cache) => percentFrom(cache[cache.ltype]?.br, 1, 100),
      write(percent, cache) {
        if (cache.ltype === 'color') {
          return b05Color(percent, b05Rgb(cache) ?? [255, 255, 255]);
        }
        return b02White(percent, b02Kelvin(cache, minKelvin, maxKelvin, maxCt) ?? maxKelvin, {
          minKelvin,
          maxKelvin,
          maxCt,
        });
      },
    },
    color: {
      watch: ['ltype', 'color'],
      read: (cache) => (cache.ltype === 'color' ? b05Rgb(cache) : undefined),
      write: (rgb, cache) => b05Color(toNumber(cache[cache.ltype]?.br) ?? 100, rgb),
    },
    temperature: {
      min: minKelvin,
      max: maxKelvin,
      watch: ['ltype', 'white'],
      read: (cache) =>
        cache.ltype === 'white' ? b02Kelvin(cache, minKelvin, maxKelvin, maxCt) : undefined,
      write: (kelvin, cache) =>
        b02White(toNumber(cache[cache.ltype]?.br) ?? 100, kelvin, { minKelvin, maxKelvin, maxCt }),
    },
  });
  return capabilities;
};

function b05Rgb(cache) {
  const color = cache.color;
  if (!color || typeof color !== 'object') {
    return undefined;
  }
  return [color.r ?? 0, color.g ?? 0, color.b ?? 0].map(Number);
}

const b05Color = (percent, [r, g, b]) => ({
  params: { ltype: 'color', color: { br: conv(percent, 1, 100, 1, 100), r, g, b } },
});

/** Zigbee color lights (UIID 3258, 7009): `colorMode` cct|rgb, hue/saturation. */
export const lightZigbee = () =>
  lightFamily({
    brightness: {
      watch: ['colorMode', 'cctBrightness', 'rgbBrightness'],
      read: (cache) => percentFrom(cache[`${cache.colorMode ?? 'cct'}Brightness`], 1, 100),
      write: (percent, cache) => {
        const mode = cache.colorMode === 'rgb' ? 'rgb' : 'cct';
        return { params: { switch: 'on', colorMode: mode, [`${mode}Brightness`]: percent } };
      },
    },
    color: {
      watch: ['colorMode', 'hue', 'saturation'],
      read: (cache) =>
        cache.colorMode === 'rgb' && toNumber(cache.hue) !== undefined
          ? hsToRgb([Number(cache.hue), toNumber(cache.saturation) ?? 100])
          : undefined,
      write: (rgb) => {
        const [hue, saturation] = rgbToHs(rgb);
        return { params: { switch: 'on', colorMode: 'rgb', hue, saturation } };
      },
    },
    temperature: {
      min: 2000,
      max: 6500,
      watch: ['colorMode', 'colorTemp'],
      read: (cache) =>
        cache.colorMode !== 'rgb' && toNumber(cache.colorTemp) !== undefined
          ? conv(cache.colorTemp, 0, 100, 2000, 6500)
          : undefined,
      write: (kelvin) => ({
        params: { switch: 'on', colorMode: 'cct', colorTemp: conv(kelvin, 2000, 6500, 0, 100) },
      }),
    },
    autoOn: false,
  });

/** Zigbee tunable white (UIID 1258): `brightness` 0-100, `colorTemp` 0-100. */
export const lightZigbeeCct = () =>
  lightFamily({
    brightness: {
      watch: ['brightness'],
      read: (cache) => percentFrom(cache.brightness, 0, 100),
      write: (percent) => ({ params: { switch: 'on', brightness: percent } }),
    },
    temperature: {
      min: 2200,
      max: 4000,
      watch: ['colorTemp'],
      read: (cache) =>
        toNumber(cache.colorTemp) === undefined
          ? undefined
          : conv(cache.colorTemp, 0, 100, 2200, 4000),
      write: (kelvin) => ({
        params: { switch: 'on', colorTemp: conv(kelvin, 2200, 4000, 0, 100) },
      }),
    },
    autoOn: false,
  });

/** iFan light: outlet 0 (or `light` in DIY mode). */
export const lightIfan = () =>
  lightFamily({
    switchWatch: ['switches', 'light'],
    on(cache) {
      if (Array.isArray(cache.switches)) {
        const outlet = cache.switches.find((item) => item.outlet === 0);
        return outlet ? onOff(outlet.switch) : undefined;
      }
      return onOff(cache.light);
    },
    onCommand: (state) => ({
      params: { switches: [{ outlet: 0, switch: state }] },
      lanParamsIf: { localtype: 'fan_light', params: { light: state } },
    }),
  });

/** Diffuser light (UIID 25): `lightswitch` 1/0, `lightbright`, `lightRcolor`... */
export const lightDiffuser = () =>
  lightFamily({
    switchWatch: ['lightswitch'],
    on: (cache) => (cache.lightswitch === 1 ? 1 : cache.lightswitch === 0 ? 0 : undefined),
    onCommand: (state) => ({ params: { lightswitch: state === 'on' ? 1 : 0 } }),
    brightness: {
      watch: ['lightbright'],
      read: (cache) => percentFrom(cache.lightbright, 0, 100),
      write: (percent) => ({ params: { lightbright: percent } }),
    },
    color: {
      watch: ['lightRcolor', 'lightGcolor', 'lightBcolor'],
      read: (cache) =>
        toNumber(cache.lightRcolor) === undefined
          ? undefined
          : [cache.lightRcolor, cache.lightGcolor, cache.lightBcolor].map((v) => Number(v) || 0),
      write: ([r, g, b]) => ({
        params: { lightmode: 2, lightRcolor: r, lightGcolor: g, lightBcolor: b },
      }),
    },
  });

/** TX Ultimate ambient light: `lightSwitch` on/off. */
export const lightT5 = () => lightFamily({ switchParam: 'lightSwitch', name: 'Ambient light' });

// --- Thermostats ------------------------------------------------------------

const thermostatMode = (options) => ({
  name: 'Mode',
  category: CAT.THERMOSTAT,
  type: TYPE.THERMOSTAT.MODE,
  min: 0,
  max: 3,
  ...actuator,
  supported_options: options.map((value) => ({
    value,
    label: ['Off', 'Heating', 'Cooling', 'Auto'][value],
  })),
});

const targetTemperature = (min, max, step) => ({
  name: 'Target temperature',
  category: CAT.THERMOSTAT,
  type: TYPE.THERMOSTAT.TARGET_TEMPERATURE,
  unit: UNIT.CELSIUS,
  min,
  max,
  step,
  ...actuator,
});

/** Wi-Fi thermostats (UIID 127): `switch`, `workState`, `workMode`, `targetTemp`. */
export function thermostat127() {
  const presets = {
    1: THERMOSTAT_PRESET.COMFORT, // manual
    2: THERMOSTAT_PRESET.SCHEDULE, // programmed
    3: THERMOSTAT_PRESET.ECO, // economical
  };
  return [
    {
      key: 'mode',
      watch: ['switch', 'workState'],
      feature: thermostatMode([0, 1, 3]),
      read(cache) {
        if (cache.switch === 'off') {
          return THERMOSTAT_MODE.OFF;
        }
        if (cache.switch !== 'on') {
          return undefined;
        }
        return cache.workState === 2 ? THERMOSTAT_MODE.AUTO : THERMOSTAT_MODE.HEATING;
      },
      write(value) {
        const mode = Number(value);
        if (mode === THERMOSTAT_MODE.OFF) {
          return { params: { switch: 'off' } };
        }
        return { params: { switch: 'on', workState: mode === THERMOSTAT_MODE.AUTO ? 2 : 1 } };
      },
    },
    {
      key: 'target_temperature',
      watch: ['targetTemp'],
      feature: targetTemperature(5, 45, 0.5),
      read: (cache) => toNumber(cache.targetTemp),
      write: (value) => ({ params: { targetTemp: Number(value) } }),
    },
    {
      key: 'preset',
      watch: ['workMode'],
      feature: {
        name: 'Preset',
        category: CAT.THERMOSTAT,
        type: TYPE.THERMOSTAT.PRESET,
        min: 0,
        max: 5,
        ...actuator,
        supported_options: [
          { value: THERMOSTAT_PRESET.COMFORT, label: 'Manual' },
          { value: THERMOSTAT_PRESET.SCHEDULE, label: 'Programmed' },
          { value: THERMOSTAT_PRESET.ECO, label: 'Economical' },
        ],
      },
      read: (cache) => presets[cache.workMode],
      write(value) {
        const workMode = Object.keys(presets).find((mode) => presets[mode] === Number(value));
        return workMode ? { params: { workMode: Number(workMode) } } : undefined;
      },
    },
    sensor('temperature'),
  ];
}

/** Zigbee radiator valve TRVZB (UIID 7017): temperatures in tenths. */
export function thermostatTrvzb() {
  // workMode: "0" manual (heating), "1" off (eco setpoint), "2" auto.
  const modes = { 0: THERMOSTAT_MODE.HEATING, 1: THERMOSTAT_MODE.OFF, 2: THERMOSTAT_MODE.AUTO };
  const setpoints = { 0: 'manTargetTemp', 1: 'ecoTargetTemp', 2: 'autoTargetTemp' };
  return [
    {
      key: 'mode',
      watch: ['workMode'],
      feature: thermostatMode([0, 1, 3]),
      read: (cache) => modes[cache.workMode],
      write(value) {
        const workMode = Object.keys(modes).find((mode) => modes[mode] === Number(value));
        return workMode === undefined ? undefined : { params: { workMode } };
      },
    },
    {
      key: 'target_temperature',
      watch: ['curTargetTemp'],
      feature: targetTemperature(4, 35, 0.5),
      read: (cache) =>
        toNumber(cache.curTargetTemp) === undefined
          ? undefined
          : round(cache.curTargetTemp * 0.1, 1),
      write(value, cache) {
        const key = setpoints[cache.workMode] ?? 'manTargetTemp';
        return { params: { [key]: Math.round(Number(value) * 10) } };
      },
    },
    {
      key: 'operating_state',
      watch: ['workState'],
      feature: {
        name: 'Heating',
        category: CAT.THERMOSTAT,
        type: TYPE.THERMOSTAT.OPERATING_STATE,
        min: 0,
        max: 2,
        ...sensorFields,
      },
      read: (cache) => ({ 0: 0, 1: 1 })[cache.workState],
    },
    sensor('temperature', { multiply: 0.1 }),
    sensor('openPercent', { kind: 'percent', key: 'valve_opening', name: 'Valve opening' }),
    boolSwitch('childLock', { key: 'child_lock', name: 'Child lock', category: CAT.CHILD_LOCK }),
    boolSwitch('windowSwitch', { key: 'window_switch', name: 'Open window detection' }),
    sensor('battery'),
  ];
}

/** NSPanel thermostat (UIID 133), cloud only: `ATCEnable`, `ATCMode`, `ATCExpect0`. */
export function thermostatNsPanel() {
  return [
    {
      key: 'mode',
      watch: ['ATCEnable', 'ATCMode', 'HMI_ATCDevice'],
      feature: thermostatMode([0, 1, 2, 3]),
      read(cache) {
        if (cache.ATCEnable === 0 || cache.ATCEnable === false) {
          return THERMOSTAT_MODE.OFF;
        }
        if (cache.ATCEnable === undefined) {
          return undefined;
        }
        if (cache.ATCMode) {
          return THERMOSTAT_MODE.AUTO;
        }
        return cache.HMI_ATCDevice?.etype === 'cold'
          ? THERMOSTAT_MODE.COOLING
          : THERMOSTAT_MODE.HEATING;
      },
      write(value) {
        const mode = Number(value);
        if (mode === THERMOSTAT_MODE.OFF) {
          return { params: { ATCEnable: 0 }, cloudOnly: true };
        }
        if (mode === THERMOSTAT_MODE.AUTO) {
          return { params: { ATCEnable: 1, ATCMode: 1 }, cloudOnly: true };
        }
        return { params: { ATCEnable: 1, ATCMode: 0 }, cloudOnly: true };
      },
    },
    {
      key: 'target_temperature',
      watch: ['ATCExpect0'],
      feature: targetTemperature(16, 31, 0.5),
      read: (cache) => toNumber(cache.ATCExpect0),
      write: (value) => ({ params: { ATCMode: 0, ATCExpect0: Number(value) }, cloudOnly: true }),
    },
  ];
}

// --- Siren ------------------------------------------------------------------

/** SNZB-09P siren: the alarm is `alarmSetting.test`. */
export function siren() {
  return {
    key: 'siren',
    watch: ['alarmSetting'],
    feature: {
      name: 'Siren',
      category: CAT.SIREN,
      type: TYPE.SIREN.BINARY,
      min: 0,
      max: 1,
      ...actuator,
    },
    read: (cache) =>
      typeof cache.alarmSetting?.test === 'boolean' ? Number(cache.alarmSetting.test) : undefined,
    write: (value, cache) => ({
      params: { alarmSetting: { ...cache.alarmSetting, test: Number(value) >= 1 } },
    }),
  };
}

// --- Buttons and scene events -----------------------------------------------

export const BUTTON_PRESSED_TRIGGER = 'button_pressed';
export const RF_CODE_RECEIVED_TRIGGER = 'rf_code_received';

const buttonFeature = (name = 'Button') => ({
  name,
  category: CAT.BUTTON,
  type: TYPE.BUTTON.CLICK,
  min: 0,
  max: 104,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

/** Gladys button value of a press: multi-button codes when the button is known. */
export function buttonValue(button, press) {
  const index = PRESSES.indexOf(press);
  if (index === -1) {
    return undefined;
  }
  if (button >= 1 && button <= 4) {
    return SINGLE_BUTTON_1 + (button - 1) * 4 + index;
  }
  return [
    BUTTON_STATUS.CLICK,
    BUTTON_STATUS.DOUBLE_CLICK,
    BUTTON_STATUS.LONG_CLICK,
    BUTTON_STATUS.TRIPLE_CLICK,
  ][index];
}

/**
 * Wireless buttons and wall switches reporting presses: `key` 0 single,
 * 1 double, 2 long, 3 triple, `outlet` the button. `source`:
 *   'key'       remotes and Zigbee buttons, deduplicated by `trigTime`/`actionTime`
 *   'localKey'  wall switches reporting `localKeyPass` (cloud messages only)
 *   'single'    MINIR4 detached key (a message with the `key` alone)
 */
export function button({ source = 'key' } = {}) {
  const watch = source === 'localKey' ? ['localKeyPass'] : ['key'];
  const pressOf = (update, memory) => {
    let payload = update;
    if (source === 'localKey') {
      // A local message cannot tell a press from a state echo: cloud only.
      if (Object.keys(update).length !== 1 || !update.localKeyPass) {
        return undefined;
      }
      payload = update.localKeyPass;
    } else if (source === 'single') {
      if (Object.keys(update).length !== 1) {
        return undefined;
      }
    } else {
      const time = update.trigTime ?? update.actionTime;
      // Without a time, a replayed state cannot be told from a press.
      if (!time || time === memory.lastTrigTime) {
        return undefined;
      }
      memory.lastTrigTime = time;
    }
    const press = PRESSES[payload?.key];
    if (!press) {
      return undefined;
    }
    const button = Number.isInteger(payload.outlet) ? payload.outlet + 1 : undefined;
    return { button, press };
  };
  return {
    key: 'button',
    watch,
    feature: buttonFeature(),
    read: () => undefined,
    pressOf,
    events(update, cache, memory) {
      const result = pressOf(update, memory);
      if (!result) {
        return [];
      }
      memory.lastPress = result;
      return [
        { key: BUTTON_PRESSED_TRIGGER, data: { button: result.button ?? 1, press: result.press } },
      ];
    },
    readPress: (memory) =>
      memory.lastPress ? buttonValue(memory.lastPress.button, memory.lastPress.press) : undefined,
  };
}

/** TX Ultimate slide gesture: `slide` alone in a message. */
export function slide() {
  return {
    key: 'slide',
    watch: ['slide'],
    feature: null,
    read: () => undefined,
    events(update) {
      if (Object.keys(update).length !== 1 || update.slide === undefined) {
        return [];
      }
      return [{ key: BUTTON_PRESSED_TRIGGER, data: { button: 1, press: `slide_${update.slide}` } }];
    },
  };
}

/**
 * RF Bridge 433: each learned code is a momentary switch (set to 1 = send the
 * code), and every received code fires `rf_code_received`.
 * @param {{ channel: string, name: string }[]} channels - Learned codes.
 */
export function rfBridge(channels) {
  const transmitters = channels.map(({ channel, name }) => ({
    key: `rf_${channel}`,
    watch: [],
    momentary: true,
    feature: {
      name: `RF ${name}`,
      category: CAT.SWITCH,
      type: TYPE.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: false,
      keep_history: false,
    },
    read: () => undefined,
    write: (value) =>
      Number(value) >= 1
        ? {
            params: { cmd: 'transmit', rfChl: Number(channel) },
            lanCommand: 'transmit',
          }
        : undefined,
  }));
  const names = Object.fromEntries(channels.map(({ channel, name }) => [channel, name]));
  const receiver = {
    key: 'rf_receiver',
    watch: [],
    feature: null,
    read: () => undefined,
    events(update, cache, memory) {
      if ('init' in update) {
        return [];
      }
      const events = [];
      memory.rfTrig = memory.rfTrig ?? {};
      for (const [param, ts] of Object.entries(update)) {
        if (!param.startsWith('rfTrig')) {
          continue;
        }
        const channel = param.slice(6);
        if (memory.rfTrig[channel] === ts) {
          continue;
        }
        const known = channel in memory.rfTrig || memory.rfArmed;
        memory.rfTrig[channel] = ts;
        if (known) {
          events.push({
            key: RF_CODE_RECEIVED_TRIGGER,
            data: { channel: Number(channel), name: names[channel] ?? `Channel ${channel}` },
          });
        }
      }
      // The first message only seeds the timestamps: a replay is not a press.
      memory.rfArmed = true;
      return events;
    },
  };
  return [...transmitters, receiver];
}

/** RF codes learned in the eWeLink app (`tags.zyx_info`), present in `rfList`. */
export function rfChannels(device) {
  const learned = new Set(
    (Array.isArray(device.params?.rfList) ? device.params.rfList : []).map((item) =>
      String(item.rfChl),
    ),
  );
  const channels = [];
  for (const remote of Array.isArray(device.tags?.zyx_info) ? device.tags.zyx_info : []) {
    for (const buttonName of remote.buttonName ?? []) {
      const [channel, label] = Object.entries(buttonName)[0] ?? [];
      if (channel === undefined || (learned.size > 0 && !learned.has(channel))) {
        continue;
      }
      // remote_type 6 = alarm sensor: one code, named after the remote.
      const name = remote.remote_type === '6' ? remote.name : label;
      channels.push({ channel, name: String(name ?? `Channel ${channel}`).slice(0, 40) });
    }
  }
  return channels;
}
