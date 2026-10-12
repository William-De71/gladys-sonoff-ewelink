// Value conversions between eWeLink parameters and Gladys feature values.

/**
 * Linear range conversion, rounded and clamped (SonoffLAN `conv`).
 * @returns {number} `value` mapped from [a1, a2] to [b1, b2].
 */
export function conv(value, a1, a2, b1, b2) {
  const result = Math.round(((value - a1) / (a2 - a1)) * (b2 - b1) + b1);
  return Math.min(Math.max(result, Math.min(b1, b2)), Math.max(b1, b2));
}

/** 'on' -> 1, 'off' -> 0, anything else -> undefined. */
export function onOff(value) {
  if (value === 'on') {
    return 1;
  }
  if (value === 'off') {
    return 0;
  }
  return undefined;
}

export const toOnOff = (value) => (Number(value) >= 1 ? 'on' : 'off');

/** Finite number from a number or a numeric string, else undefined. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

/** Round to `digits` decimals. */
export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Gladys colors are 0xRRGGBB integers. */
export function rgbToInt([r, g, b]) {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export function intToRgb(value) {
  const color = Number(value) & 0xffffff;
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** Gladys light temperatures are in mireds (153 = 6500 K, 500 = 2000 K). */
export const kelvinToMired = (kelvin) => Math.round(1_000_000 / kelvin);
export const miredToKelvin = (mired) => Math.round(1_000_000 / mired);

/** RGB [0-255] -> [hue 0-360, saturation 0-100]. */
export function rgbToHs([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const delta = max - Math.min(rn, gn, bn);
  let hue = 0;
  if (delta !== 0) {
    if (max === rn) {
      hue = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      hue = (bn - rn) / delta + 2;
    } else {
      hue = (rn - gn) / delta + 4;
    }
  }
  hue = Math.round(hue * 60);
  if (hue < 0) {
    hue += 360;
  }
  return [hue, max === 0 ? 0 : Math.round((delta / max) * 100)];
}

/** [hue 0-360, saturation 0-100] at full brightness -> RGB [0-255]. */
export function hsToRgb([hue, saturation]) {
  const s = saturation / 100;
  const k = (n) => (n + hue / 60) % 6;
  const f = (n) => 1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [Math.round(255 * f(5)), Math.round(255 * f(3)), Math.round(255 * f(1))];
}
