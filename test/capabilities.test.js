import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUTTON_PRESSED_TRIGGER,
  button,
  buttonValue,
  channel,
  COVER_STATE,
  cover,
  coverZigbee,
  decodeHundredDays,
  fan17,
  fanIfan,
  lightB02,
  lightB05,
  lightB1,
  lightZigbee,
  relay,
  RF_CODE_RECEIVED_TRIGGER,
  rfBridge,
  rfChannels,
  sensor,
  thermostat127,
  thermostatTrvzb,
  binarySensor,
  startup,
} from '../src/devices/capabilities.js';
import { hsToRgb, kelvinToMired, rgbToHs, rgbToInt } from '../src/devices/convert.js';

const byKey = (capabilities, key) => capabilities.find((capability) => capability.key === key);

test('a relay reads and writes on/off; the TH leaves its automatic mode', () => {
  const plain = relay();
  assert.equal(plain.read({ switch: 'on' }), 1);
  assert.equal(plain.read({ switch: 'off' }), 0);
  assert.equal(plain.read({}), undefined);
  assert.deepEqual(plain.write(1), { params: { switch: 'on' } });
  assert.deepEqual(relay({ variant: 'th' }).write(0), {
    params: { switch: 'off', mainSwitch: 'off', deviceType: 'normal' },
  });
});

test('an outlet reads its own channel and batches its commands', () => {
  const second = channel(1, { names: { 1: 'Kitchen' } });
  assert.equal(second.key, 'switch_2');
  assert.equal(second.feature.name, 'Kitchen');
  const cache = {
    switches: [
      { outlet: 0, switch: 'off' },
      { outlet: 1, switch: 'on' },
    ],
  };
  assert.equal(second.read(cache), 1);
  assert.deepEqual(second.write(0, cache), {
    params: { switches: [{ outlet: 1, switch: 'off' }] },
    bulk: 'switches',
  });
  // Zigbee gangs want every outlet in each command.
  assert.deepEqual(channel(1, { variant: 'zigbee' }).write(0, cache), {
    params: {
      switches: [
        { outlet: 0, switch: 'off' },
        { outlet: 1, switch: 'off' },
      ],
    },
  });
  assert.deepEqual(channel(0, { variant: 'powr3' }).write(1, cache).params.operSide, 1);
});

test('sensors scale, round and filter their readings', () => {
  assert.equal(sensor('power', { multiply: 0.01 }).read({ power: 12345 }), 123.45);
  assert.equal(sensor('voltage').read({ voltage: '229.6' }), 229.6);
  assert.equal(sensor('temperature').read({ temperature: 'unavailable' }), undefined);
  assert.equal(
    sensor('HMI_outdoorTemp', { kind: 'temperature', pick: (v) => v?.current }).read({
      HMI_outdoorTemp: { current: 12, range: '8,15' },
    }),
    12,
  );
});

test('Gladys opening sensors store 1 for closed', () => {
  const door = binarySensor('switch', {
    kind: 'door',
    active: (cache) => (cache.switch === 'on' ? true : cache.switch === 'off' ? false : undefined),
  });
  assert.equal(door.read({ switch: 'on' }), 0, 'open');
  assert.equal(door.read({ switch: 'off' }), 1, 'closed');
  assert.equal(door.read({}), undefined);
});

test('the first-generation POW history decodes to kWh per day', () => {
  assert.deepEqual(decodeHundredDays('0a0102000305'), [10.12, 0.35]);
  assert.equal(decodeHundredDays('zz'), undefined);
});

test('covers use the Gladys convention: 100 = open', () => {
  const [state, position] = cover();
  assert.equal(position.read({ setclose: 30 }, { setclose: 30, switch: 'off' }), 70);
  assert.deepEqual(position.write(25), { params: { setclose: 75 } });
  assert.equal(state.read({}, { switch: 'on' }), COVER_STATE.OPEN);
  assert.deepEqual(state.write(COVER_STATE.CLOSE), { params: { switch: 'off' } });
  assert.deepEqual(state.write(COVER_STATE.STOP), { params: { switch: 'pause' } });
  const [, zigbeePosition] = coverZigbee();
  assert.equal(zigbeePosition.read({ curPercent: 0 }), 100);
  assert.deepEqual(zigbeePosition.write(40), { params: { openPercent: 60 } });
});

test('iFan speeds map to the Gladys fan modes, DIY mode included', () => {
  const fan = fanIfan();
  const outlets = (s1, s2, s3) => ({
    switches: [
      { outlet: 1, switch: s1 },
      { outlet: 2, switch: s2 },
      { outlet: 3, switch: s3 },
    ],
  });
  assert.equal(fan.read(outlets('off', 'on', 'on')), 0);
  assert.equal(fan.read(outlets('on', 'off', 'off')), 1);
  assert.equal(fan.read(outlets('on', 'on', 'off')), 2);
  assert.equal(fan.read(outlets('on', 'off', 'on')), 3);
  assert.equal(fan.read({ fan: 'on', speed: 2 }), 2);
  const command = fan.write(3, {}, { localtype: 'fan_light' });
  assert.deepEqual(command.lanParams, { fan: 'on', speed: 3 });
  assert.equal(fan.write(3, {}, {}).lanParams, undefined);
});

test('UIID 17 fans expose speed, oscillation and wind mode', () => {
  const [mode, oscillation, wind] = fan17();
  assert.equal(mode.read({ fan: 'on', speed: 'moderate' }), 2);
  assert.deepEqual(mode.write(3), { params: { fan: 'on', speed: 'fast' } });
  assert.deepEqual(oscillation.write(1), { params: { shake: 'on' } });
  assert.equal(wind.read({ mode: 'natural' }), 2);
  assert.deepEqual(wind.write(1), { params: { mode: 'sleep' } });
});

test('lights convert brightness, colors and temperatures, and turn on first', () => {
  const b05 = lightB05();
  const brightness = byKey(b05, 'brightness');
  const color = byKey(b05, 'color');
  const temperature = byKey(b05, 'temperature');
  const cache = { switch: 'off', ltype: 'color', color: { br: 50, r: 255, g: 0, b: 0 } };
  assert.equal(brightness.read(cache), 50);
  assert.equal(color.read(cache), rgbToInt([255, 0, 0]));
  const command = color.write(rgbToInt([0, 0, 255]), cache);
  assert.deepEqual(command.params, { ltype: 'color', color: { br: 50, r: 0, g: 0, b: 255 } });
  assert.deepEqual(command.before, { params: { switch: 'on' } }, 'off: switch on first');
  assert.equal(temperature.read(cache), undefined, 'no temperature in color mode');
  const white = temperature.write(kelvinToMired(6500), {
    switch: 'on',
    ltype: 'white',
    white: { br: 80, ct: 0 },
  });
  assert.deepEqual(white.params, { ltype: 'white', white: { br: 80, ct: 255 } });
  assert.equal(white.before, undefined, 'already on');
  // Brightness 0 is "off".
  assert.deepEqual(brightness.write(0, cache), { params: { switch: 'off' } });
});

test('B02 bulbs map their 0-255 color temperature on the model range', () => {
  const temperature = byKey(lightB02({ minKelvin: 2200, maxKelvin: 6500 }), 'temperature');
  assert.equal(temperature.feature.min, kelvinToMired(6500));
  assert.equal(temperature.feature.max, kelvinToMired(2200));
  assert.equal(
    temperature.read({ ltype: 'white', white: { br: 10, ct: 255 } }),
    kelvinToMired(6500),
  );
});

test('the B1 has three white levels and RGB channels', () => {
  const b1 = lightB1();
  const cache = { state: 'on', zyx_mode: 1, channel0: '255', channel1: '0' };
  assert.equal(byKey(b1, 'temperature').read(cache), kelvinToMired(6500));
  assert.equal(byKey(b1, 'brightness').read(cache), 100);
  assert.deepEqual(byKey(b1, 'color').write(rgbToInt([1, 2, 3]), cache).params, {
    channel0: '0',
    channel1: '0',
    channel2: '1',
    channel3: '2',
    channel4: '3',
    zyx_mode: 2,
  });
});

test('Zigbee color lights speak hue and saturation', () => {
  const color = byKey(lightZigbee(), 'color');
  assert.deepEqual(rgbToHs([255, 0, 0]), [0, 100]);
  assert.deepEqual(hsToRgb([240, 100]), [0, 0, 255]);
  assert.deepEqual(color.write(rgbToInt([0, 255, 0]), {}).params, {
    switch: 'on',
    colorMode: 'rgb',
    hue: 120,
    saturation: 100,
  });
  assert.equal(color.read({ colorMode: 'rgb', hue: 0, saturation: 100 }), rgbToInt([255, 0, 0]));
  assert.equal(color.read({ colorMode: 'cct', hue: 0 }), undefined);
});

test('the UIID 127 thermostat maps modes and presets', () => {
  const [mode, target, preset] = thermostat127();
  assert.equal(mode.read({ switch: 'off' }), 0);
  assert.equal(mode.read({ switch: 'on', workState: 2 }), 3);
  assert.deepEqual(mode.write(1), { params: { switch: 'on', workState: 1 } });
  assert.deepEqual(target.write(21.5), { params: { targetTemp: 21.5 } });
  assert.equal(preset.read({ workMode: 3 }), 3, 'economical = eco');
  assert.deepEqual(preset.write(0), { params: { workMode: 2 } }, 'schedule = programmed');
});

test('the TRVZB writes the setpoint of its current mode, in tenths', () => {
  const capabilities = thermostatTrvzb();
  const mode = byKey(capabilities, 'mode');
  const target = byKey(capabilities, 'target_temperature');
  assert.equal(mode.read({ workMode: '1' }), 0, 'workMode 1 is off');
  assert.deepEqual(mode.write(3), { params: { workMode: '2' } });
  assert.equal(target.read({ curTargetTemp: 215 }), 21.5);
  assert.deepEqual(target.write(19, { workMode: '2' }), { params: { autoTargetTemp: 190 } });
  assert.equal(byKey(capabilities, 'operating_state').read({ workState: '1' }), 1);
});

test('the power-on state is a select feature', () => {
  const capability = startup();
  assert.equal(capability.readText({ startup: 'stay' }), 'stay');
  assert.deepEqual(capability.write('on'), { params: { startup: 'on' } });
  assert.equal(capability.write('nonsense'), undefined);
});

test('buttons fire one event per press, deduplicated by their time', () => {
  const capability = button();
  const memory = { lastTrigTime: '100' };
  assert.deepEqual(capability.events({ key: 0, trigTime: '100' }, {}, memory), [], 'replay');
  assert.deepEqual(capability.events({ key: 1, outlet: 2, trigTime: '101' }, {}, memory), [
    { key: BUTTON_PRESSED_TRIGGER, data: { button: 3, press: 'double' } },
  ]);
  assert.equal(capability.readPress(memory), buttonValue(3, 'double'));
  assert.equal(buttonValue(3, 'double'), 98, 'DOUBLE_BUTTON_3');
  assert.equal(buttonValue(undefined, 'long'), 6, 'LONG_CLICK');
  assert.deepEqual(capability.events({ key: 0 }, {}, memory), [], 'no time, no event');
});

test('wall switches only report presses through the cloud', () => {
  const capability = button({ source: 'localKey' });
  assert.deepEqual(capability.events({ localKeyPass: { key: 0, outlet: 0 } }, {}, {}), [
    { key: BUTTON_PRESSED_TRIGGER, data: { button: 1, press: 'single' } },
  ]);
  assert.deepEqual(
    capability.events({ localKeyPass: { key: 0 }, switches: [] }, {}, {}),
    [],
    'a full state message is no press',
  );
});

test('the RF Bridge transmits learned codes and reports the received ones', () => {
  const device = {
    params: { rfList: [{ rfChl: 0 }, { rfChl: 1 }] },
    tags: {
      zyx_info: [
        { remote_type: '4', name: 'Gate', buttonName: [{ 0: 'Open' }, { 1: 'Close' }] },
        { remote_type: '6', name: 'Front door', buttonName: [{ 5: 'x' }] },
      ],
    },
  };
  const channels = rfChannels(device);
  assert.deepEqual(channels, [
    { channel: '0', name: 'Open' },
    { channel: '1', name: 'Close' },
  ]);
  const capabilities = rfBridge(channels);
  const transmit = byKey(capabilities, 'rf_1');
  assert.equal(transmit.momentary, true);
  assert.deepEqual(transmit.write(1), {
    params: { cmd: 'transmit', rfChl: 1 },
    lanCommand: 'transmit',
  });
  const receiver = byKey(capabilities, 'rf_receiver');
  const memory = {};
  assert.deepEqual(receiver.events({ rfTrig0: 'T1' }, {}, memory), [], 'first message seeds');
  assert.deepEqual(receiver.events({ rfTrig0: 'T1' }, {}, memory), [], 'same time: replay');
  assert.deepEqual(receiver.events({ rfTrig1: 'T2' }, {}, memory), [
    { key: RF_CODE_RECEIVED_TRIGGER, data: { channel: 1, name: 'Close' } },
  ]);
});
