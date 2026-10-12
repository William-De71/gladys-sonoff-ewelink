// -----------------------------------------------------------------------------
// Device catalog: eWeLink UIID -> capabilities. Port of the DEVICES table of
// SonoffLAN (custom_components/sonoff/core/devices.py, AlexxIT, MIT licence).
// UIID protocol: https://github.com/CoolKit-Technologies/eWeLink-API/blob/main/en/UIIDProtocol.md
//
// Left out on purpose: RSSI (shown in the widget instead), light effects and
// scenes (reachable through the `send_command` scene action), the TH
// thermostat targets (cloud-only, two-threshold model Gladys has no feature
// for), camera devices (proprietary P2P video protocol).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import {
  binarySensor,
  boolSwitch,
  button,
  channel,
  channelStartup,
  cloudEnergyToday,
  corrected,
  cover,
  coverDualR3,
  coverGate,
  coverOp,
  coverZigbee,
  fan17,
  fanDiffuser,
  fanIfan,
  intSwitch,
  light57,
  lightB02,
  lightB05,
  lightB1,
  lightD1,
  lightDiffuser,
  lightDimmer,
  lightIfan,
  lightL1,
  lightMiniDim,
  lightT5,
  lightZigbee,
  lightZigbeeCct,
  pulseWidth,
  relay,
  rfBridge,
  rfChannels,
  sensor,
  siren,
  slide,
  startup,
  thermostat127,
  thermostatNsPanel,
  thermostatTrvzb,
  thHumidity,
  thTemperature,
  toggle,
} from './capabilities.js';

const led = () => toggle('sledOnline', { key: 'led', name: 'LED indicator' });
const pulse = () => toggle('pulse', { key: 'pulse', name: 'Inching' });
const battery = () => sensor('battery');

const channels = (count, options) =>
  Array.from({ length: count }, (_, index) => channel(index, options));
const startups = (count) => Array.from({ length: count }, (_, index) => channelStartup(index));

const switchSpec = () => [relay(), led(), pulse(), pulseWidth()];
const multiSpec = (count) => (device) => [
  ...channels(count, { names: channelNames(device) }),
  led(),
];

/** Per-channel power metering (DualR3, SPM-4Relay): `actPow_00`... in hundredths. */
const meteredChannels = (count) =>
  Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(2, '0');
    const n = index + 1;
    return [
      sensor(`current_${suffix}`, {
        kind: 'current',
        key: `current_${n}`,
        name: `Current ${n}`,
        multiply: 0.01,
      }),
      sensor(`voltage_${suffix}`, {
        kind: 'voltage',
        key: `voltage_${n}`,
        name: `Voltage ${n}`,
        multiply: 0.01,
      }),
      sensor(`actPow_${suffix}`, {
        kind: 'power',
        key: `power_${n}`,
        name: `Power ${n}`,
        multiply: 0.01,
      }),
    ];
  }).flat();

const metered100 = () => [
  sensor('power', { multiply: 0.01 }),
  sensor('current', { multiply: 0.01 }),
  sensor('voltage', { multiply: 0.01 }),
];

const energyTotals = (...periods) =>
  periods.map(([param, key, name]) => sensor(param, { kind: 'energy', key, name, multiply: 0.01 }));
const ENERGY_DAY = ['dayKwh', 'energy_day', 'Energy today'];
const ENERGY_WEEK = ['weekKwh', 'energy_week', 'Energy this week'];
const ENERGY_MONTH = ['monthKwh', 'energy_month', 'Energy this month'];
const ENERGY_YEAR = ['yearKwh', 'energy_year', 'Energy this year'];

const tempHumBattery = (multiply) => [
  sensor('temperature', { multiply }),
  sensor('humidity', { multiply }),
  battery(),
];

const TX_ULTIMATE = [lightT5(), slide()];

export const DEVICES = {
  1: switchSpec,
  2: multiSpec(2),
  3: multiSpec(3),
  4: multiSpec(4),
  // Sonoff POW (first generation)
  5: () => [relay(), led(), sensor('power'), cloudEnergyToday()],
  6: switchSpec,
  // Sonoff T1 2CH / 3CH / 4CH
  7: multiSpec(2),
  8: multiSpec(3),
  9: multiSpec(4),
  // King Art King Q4 cover (cloud only)
  11: () => [...cover(), led()],
  14: switchSpec,
  // Sonoff TH10/TH16
  15: () => [relay({ variant: 'th' }), thTemperature(), thHumidity(), led()],
  17: () => [...fan17(), led()],
  18: () => [
    sensor('temperature'),
    sensor('humidity'),
    sensor('dusty', { kind: 'raw', name: 'Dust' }),
    sensor('light', { kind: 'light_level' }),
    sensor('noise'),
  ],
  // Sonoff B1 (cloud only)
  22: () => lightB1(),
  // Essential oil diffuser
  25: () => [
    fanDiffuser(),
    ...lightDiffuser(),
    binarySensor('water', {
      kind: 'generic',
      name: 'Water tank',
      active: (cache) => (cache.water === undefined ? undefined : cache.water === 1),
    }),
  ],
  // Sonoff RF Bridge 433
  28: (device) => [...rfBridge(rfChannels(device)), led()],
  29: multiSpec(2),
  30: multiSpec(3),
  31: multiSpec(4),
  // Sonoff POWR2
  32: () => [
    relay(),
    led(),
    pulse(),
    pulseWidth(),
    sensor('current'),
    sensor('power'),
    sensor('voltage'),
    cloudEnergyToday(),
    startup(),
  ],
  33: () => lightL1(),
  // Sonoff iFan02 / iFan03 / iFan04
  34: () => [fanIfan(), ...lightIfan(), led()],
  // KING-M4 dimmer (cloud only)
  36: () => lightDimmer(),
  // Sonoff D1
  44: () => lightD1(),
  // Mosquito killer lamp
  57: () => light57(),
  // Sonoff LED (cloud only)
  59: () => lightL1(),
  // Zigbee Bridge
  66: () => [led()],
  // KingArt garage door opener KING-Q1
  67: () => coverOp(),
  // Sonoff Micro
  77: multiSpec(1),
  78: multiSpec(1),
  81: multiSpec(1),
  82: multiSpec(2),
  83: multiSpec(3),
  84: multiSpec(4),
  // ST-03
  91: () => coverOp(),
  // Sonoff DW2 Wi-Fi door/window sensor
  102: () => [
    binarySensor('switch', {
      kind: 'door',
      key: 'door',
      active: (cache) => doorOpen(cache.switch),
    }),
    sensor('battery', { kind: 'voltage', key: 'battery_voltage', name: 'Battery voltage' }),
  ],
  // Sonoff B02 CCT bulb
  103: (device) => lightB02(b02Range(device)),
  // Sonoff B05-B RGB+CCT bulb
  104: () => lightB05(),
  107: multiSpec(1),
  // Sonoff DualR3 (cover mode when workMode is 2)
  126: (device) =>
    device.params?.workMode === 2
      ? [...coverDualR3(), ...meteredChannels(2)]
      : [...channels(2, { names: channelNames(device) }), ...startups(2), ...meteredChannels(2)],
  127: () => thermostat127(),
  // SPM-Main
  128: () => [led()],
  // SPM-4Relay
  130: (device) => [
    ...channels(4, { names: channelNames(device) }),
    ...startups(4),
    ...meteredChannels(4),
  ],
  // Sonoff NSPanel (the thermostat needs a configured switch)
  133: (device) => [
    ...channels(2, { names: channelNames(device) }),
    ...(device.params?.HMI_ATCDevice ? thermostatNsPanel() : []),
    corrected('temperature', 'tempCorrection'),
    sensor('HMI_outdoorTemp', {
      kind: 'temperature',
      key: 'outdoor_temperature',
      name: 'Outdoor temperature',
      pick: (value) => value?.current,
    }),
  ],
  // Sonoff B02-BL
  135: (device) => lightB02(b02Range(device)),
  // Sonoff B05-BL
  136: () => lightB05({ maxCt: 100 }),
  137: () => lightL1(),
  // MINIR3 / MINIR4 / MINIR4M
  138: (device) => [
    ...channels(1, { names: channelNames(device) }),
    ...startups(1),
    led(),
    intSwitch('relaySeparation', { key: 'detach', name: 'Detached mode' }),
    button({ source: 'single' }),
  ],
  // DW2-Wi-Fi-L
  154: () => [
    binarySensor('switch', {
      kind: 'door',
      key: 'door',
      active: (cache) => doorOpen(cache.switch),
    }),
    battery(),
  ],
  // SwitchMan M5 1C / 2C / 3C
  160: (device) => [...multiSpec(1)(device), button({ source: 'localKey' })],
  161: (device) => [...multiSpec(2)(device), button({ source: 'localKey' })],
  162: (device) => [...multiSpec(3)(device), button({ source: 'localKey' })],
  // DualR3 Lite
  165: (device) =>
    device.params?.workMode === 2
      ? coverDualR3()
      : [...channels(2, { names: channelNames(device) }), ...startups(2)],
  // ZBBridge-P
  168: () => [],
  // Sonoff L3-5M-P
  173: () => lightL1({ l3: true }),
  // R5 remote, S-Mate
  174: () => [button()],
  177: () => [button()],
  // THR316D / THR320D
  181: () => [
    relay({ variant: 'th' }),
    thTemperature(),
    thHumidity(),
    intSwitch('autoControlEnabled', { key: 'auto_mode', name: 'Automatic mode' }),
    led(),
  ],
  // Sonoff S40
  182: () => [
    ...channels(1),
    led(),
    sensor('current'),
    sensor('power'),
    sensor('voltage'),
    cloudEnergyToday(),
  ],
  // POWR3, S60TPF, POWCT (supply = energy fed back to the grid)
  190: (device) => [
    ...channels(1, { variant: 'powr3', names: channelNames(device) }),
    ...startups(1),
    led(),
    ...metered100(),
    ...energyTotals(ENERGY_DAY, ENERGY_MONTH),
    ...(device.params && 'supplyPower' in device.params
      ? [
          sensor('supplyPower', { kind: 'production_power', key: 'power_supply', multiply: 0.01 }),
          sensor('dayPowerSupply', {
            kind: 'daily_production',
            key: 'energy_day_supply',
            multiply: 0.01,
          }),
        ]
      : []),
  ],
  // NSPanel Pro / Pro 120
  195: () => nsPanelPro(),
  228: () => nsPanelPro(),
  // TX Ultimate T5 1C-4C
  209: (device) => [
    ...channels(1, { names: channelNames(device) }),
    ...startups(1),
    ...TX_ULTIMATE,
  ],
  210: (device) => [
    ...channels(2, { names: channelNames(device) }),
    ...startups(2),
    ...TX_ULTIMATE,
  ],
  211: (device) => [
    ...channels(3, { names: channelNames(device) }),
    ...startups(3),
    ...TX_ULTIMATE,
  ],
  212: (device) => [
    ...channels(4, { names: channelNames(device) }),
    ...startups(4),
    ...TX_ULTIMATE,
  ],
  // CoolKit gate motor controller
  216: () => coverGate(),
  // CK-BL602-PCSW-01 (PC power switch)
  225: () => [
    boolSwitch('switch', { key: 'switch', name: 'Power' }),
    boolSwitch('childLock', {
      key: 'child_lock',
      name: 'Child lock',
      category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
    }),
    led(),
    startup(),
  ],
  // CK-BL602-W102SW18-01
  226: () => [
    boolSwitch('switch', { key: 'switch', name: 'Switch' }),
    led(),
    sensor('phase_0_c', { kind: 'current', key: 'current' }),
    sensor('phase_0_p', { kind: 'power', key: 'power' }),
    sensor('phase_0_v', { kind: 'voltage', key: 'voltage' }),
    sensor('totalPower', { kind: 'energy_index', key: 'energy' }),
  ],
  // CK-BK7238 temperature and humidity sensor
  242: () => [
    corrected('temperature', 'tempCorrection', { multiply: 0.01 }),
    corrected('humidity', 'humCorrection', { multiply: 0.01 }),
    battery(),
  ],
  // ZBBridge-U
  243: () => [led()],
  258: () => [...cover(), led()],
  // CK-BL602-SWP1-02
  262: (device) => [...channels(4, { names: channelNames(device) }), led(), ...metered100()],
  // SAWF-07P / SAWF-08P air monitors (features present on the device only)
  266: (device) =>
    [
      corrected('temperature', 'tempCorrection'),
      corrected('humidity', 'humCorrection'),
      sensor('co2'),
      sensor('pm10'),
      sensor('pm2_5', { kind: 'pm25', key: 'pm25' }),
    ].filter((capability) => capability.watch.some((param) => param in (device.params ?? {}))),
  // BASIC-1GS
  268: multiSpec(1),
  // MINI-2GS
  275: (device) => [
    ...channels(2, { names: channelNames(device) }),
    ...startups(2),
    led(),
    button({ source: 'localKey' }),
  ],
  // S61STPF
  276: (device) => [
    ...channels(1, { names: channelNames(device) }),
    ...metered100(),
    ...energyTotals(ENERGY_DAY, ENERGY_WEEK, ENERGY_MONTH, ENERGY_YEAR),
    led(),
  ],
  // MINI-DIM
  277: () => [...lightMiniDim(), ...metered100(), led()],
  // MINI-1GSP
  283: (device) => [
    ...channels(1, { names: channelNames(device) }),
    ...metered100(),
    ...energyTotals(ENERGY_DAY, ENERGY_MONTH),
    led(),
  ],
  // Zigbee buttons (SNZB-01...)
  1000: () => [button(), battery()],
  1256: () => [relay()],
  1257: () => lightD1(),
  1258: () => lightZigbeeCct(),
  // NON-OTA-GL curtain (battery in halves)
  1514: () => [...coverZigbee(), sensor('battery', { multiply: 2 })],
  1770: () => tempHumBattery(0.01),
  1771: () => tempHumBattery(0.01),
  // Zigbee motion sensor
  2026: (device) => [
    binarySensor('motion', { kind: 'motion', active: zigbeeMotion }),
    ...(device.params?.battery !== undefined ? [battery()] : []),
  ],
  // Zigbee door/window sensor
  3026: () => [zigbeeDoor(), battery()],
  3258: () => lightZigbee(),
  // Zigbee water leak sensor
  4026: () => [
    binarySensor('water', { kind: 'leak', key: 'leak', active: (cache) => flag(cache.water) }),
    battery(),
  ],
  4256: (device) => channels(4, { variant: 'zigbee', names: channelNames(device) }),
  7000: () => [button(), battery()],
  // SNZB-03P
  7002: () => [
    binarySensor('motion', { kind: 'motion', active: zigbeeMotion }),
    brightness(),
    battery(),
  ],
  // SNZB-04P
  7003: () => [zigbeeDoor(), battery()],
  // ZBMINIL2
  7004: () => [relay()],
  // ZBCurtain
  7006: () => [...coverZigbee(), battery()],
  7009: () => lightZigbee(),
  // ZBMicro
  7010: () => [relay()],
  7014: () => tempHumBattery(0.01),
  // SNZB-06P presence sensor
  7016: () => [presence(), brightness()],
  // TRVZB radiator valve
  7017: () => thermostatTrvzb(),
  // SNZB-05P water leak sensor
  7019: () => [
    binarySensor('water', { kind: 'leak', key: 'leak', active: (cache) => flag(cache.water) }),
    battery(),
  ],
  // SWV water valve
  7027: () => [
    boolSwitch('switch', { key: 'switch', name: 'Valve' }),
    battery(),
    sensor('todayWaterUsage', {
      kind: 'water',
      key: 'water',
      pick: (value, cache) => value ?? cache.TodayWaterUsage,
    }),
  ],
  // MINI-ZB2GS-L
  7029: (device) => [
    ...channels(2, { names: channelNames(device) }),
    button({ source: 'localKey' }),
  ],
  // S60ZBTPF
  7032: (device) => [
    ...channels(1, { names: channelNames(device) }),
    ...metered100(),
    ...energyTotals(ENERGY_DAY, ENERGY_MONTH),
  ],
  // SNZB-02WD (raw values, no correction)
  7033: () => tempHumBattery(),
  // MINI-ZBRBS
  7034: () => [...cover(), led()],
  // SNZB-02DR2
  7038: () => [
    corrected('temperature', 'tempCorrection', { multiply: 0.01 }),
    corrected('humidity', 'humCorrection', { multiply: 0.01 }),
    battery(),
    sensor('remoteTemperature', { kind: 'probe', key: 'remote_temperature', multiply: 0.01 }),
  ],
  // SNZB-01M
  7039: () => [button(), battery()],
  // SWV-ZNE
  7047: () => [boolSwitch('switch_00', { key: 'switch', name: 'Valve' }), battery()],
  // SWV-ZF2E dual valve
  7048: () => [
    boolSwitch('switch_00', { key: 'a', name: 'Valve A', extra: { controlMode: 'manual' } }),
    boolSwitch('switch_01', { key: 'b', name: 'Valve B', extra: { controlMode: 'manual' } }),
    sensor('todayWaterUsage', { kind: 'water', key: 'water_today' }),
    sensor('totalTimeUsage_0', { kind: 'minutes', key: 'time_total_a', name: 'Watering time A' }),
    sensor('totalTimeUsage_1', { kind: 'minutes', key: 'time_total_b', name: 'Watering time B' }),
    battery(),
  ],
  // SNZB-06P24
  7051: () => [presence(), sensor('illumination', { kind: 'illuminance', key: 'illuminance' })],
  // SNZB-02B
  7052: () => tempHumBattery(0.01),
  // MINI-ZB1GP
  7054: (device) => [
    ...channels(1, { names: channelNames(device) }),
    ...metered100(),
    ...energyTotals(ENERGY_DAY, ENERGY_MONTH),
  ],
  // SNZB-03PR2
  7055: () => [
    presence(),
    sensor('illumination', { kind: 'illuminance', key: 'illuminance' }),
    battery(),
  ],
  // SNZB-09P indoor siren
  7056: () => [
    siren(),
    binarySensor('powerExternalState', {
      kind: 'generic',
      key: 'external_power',
      name: 'External power',
      active: (cache) => onOffFlag(cache.powerExternalState),
    }),
    battery(),
  ],
  // SNZB-02M
  7057: () => [
    sensor('temperature', { multiply: 0.01 }),
    sensor('humidity', { multiply: 0.01 }),
    sensor('pressure', { multiply: 0.01 }),
    battery(),
  ],
};

function nsPanelPro() {
  return [
    thTemperature(),
    boolSwitch('openLED', { key: 'screen', name: 'Screen' }),
    sensor('cpuInfo', {
      kind: 'device_temperature',
      key: 'cpu_temperature',
      name: 'CPU temperature',
      pick: (value) => value?.temperature,
    }),
  ];
}

const flag = (value) => (value === 1 ? true : value === 0 ? false : undefined);
const onOffFlag = (value) => (value === 'on' ? true : value === 'off' ? false : undefined);
const doorOpen = (value) => onOffFlag(value);

function zigbeeMotion(cache) {
  if (cache.motion !== undefined) {
    return cache.motion === 1;
  }
  return cache.online === false ? false : undefined;
}

const zigbeeDoor = () =>
  binarySensor('lock', { kind: 'door', key: 'door', active: (cache) => flag(cache.lock) });

const presence = () =>
  binarySensor('human', {
    kind: 'presence',
    key: 'occupancy',
    active: (cache) => flag(cache.human),
  });

const brightness = () =>
  binarySensor('brState', {
    kind: 'generic',
    key: 'light',
    name: 'Bright',
    active: (cache) => (cache.brState === undefined ? undefined : cache.brState === 'brighter'),
  });

function b02Range(device) {
  if (device.productModel === 'B02-F-ST64') {
    return { minKelvin: 1800, maxKelvin: 5000 };
  }
  if (device.productModel === 'QMS-2C-CW') {
    return { minKelvin: 2700, maxKelvin: 6500 };
  }
  return {};
}

/** Channel names set in the eWeLink app. */
function channelNames(device) {
  const names = device.tags?.ck_channel_name;
  return names && typeof names === 'object' ? names : {};
}

/** LAN types of the DIY mode: `[uiid, model]`. */
export const DIY_TYPES = {
  plug: [1, 'Single Channel DIY'],
  strip: [4, 'Multi Channel DIY'],
  diy_plug: [1, 'MINI DIY'],
  enhanced_plug: [5, 'POW DIY'],
  th_plug: [15, 'TH DIY'],
  rf: [28, 'RFBridge DIY'],
  fan_light: [34, 'iFan DIY'],
  light: [44, 'D1 DIY'],
  diylight: [44, 'D1 DIY'],
  diy_light: [136, 'B0x-BL DIY'],
  switch_radar: [77, 'Micro DIY'],
  multifun_switch: [126, 'DualR3 DIY'],
};

/** UIID and model of a device only known from the LAN (DIY mode). */
export function diyIdentity(localtype, params = {}) {
  const known = DIY_TYPES[localtype];
  if (!known) {
    return { uiid: 0, model: localtype || 'Unknown DIY' };
  }
  // A MINI R3 in DIY mode announces `diy_plug` but reports `switches`.
  if (localtype === 'diy_plug' && 'switches' in params) {
    return { uiid: 77, model: 'MINI R3 DIY' };
  }
  return { uiid: known[0], model: known[1] };
}

/**
 * Capabilities of a device.
 * @param {{ uiid: number, params?: object, tags?: object, productModel?: string, localtype?: string }} device
 * @returns {object[]} Its capabilities (empty: nothing Gladys can use).
 */
export function capabilitiesOf(device) {
  const spec = DEVICES[device.uiid];
  if (spec) {
    return spec(device);
  }
  // Unknown UIID: a relay or outlets are the safest guess, like SonoffLAN.
  const params = device.params ?? {};
  if ('switch' in params) {
    return switchSpec();
  }
  if (Array.isArray(params.switches)) {
    return multiSpec(Math.min(4, Math.max(1, params.switches.length)))(device);
  }
  return [];
}

/** Whether the UIID is in the catalog (unknown ones are reported to the user). */
export const isKnownUiid = (uiid) => uiid in DEVICES;
