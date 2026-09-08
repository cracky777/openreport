/**
 * Hex ↔ HSV, for the colour picker's saturation square and hue slider.
 *
 * Hex is what the app stores and shows; HSV is only the geometry the picker
 * needs, so it never leaves the picker.
 */

/** '#rrggbb' (or '#rgb') → { h: 0-360, s: 0-1, v: 0-1 }. Null when unparseable. */
export function hexToHsv(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** { h, s, v } → '#rrggbb'. */
export function hsvToHex({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  const to255 = (n) => Math.round((n + m) * 255);
  return rgbToHex(to255(r), to255(g), to255(b));
}

/** '#rrggbb' or '#rgb' → { r, g, b } in 0-1. Null when unparseable. */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  // The 3-digit form is what people type by hand; expand it rather than reject.
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Three 0-255 channels → '#rrggbb'. */
export function rgbToHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('');
}

/** Normalize anything typable to '#rrggbb', or null. */
export function normalizeHex(input) {
  const rgb = hexToRgb(input);
  if (!rgb) return null;
  return rgbToHex(rgb.r * 255, rgb.g * 255, rgb.b * 255);
}
