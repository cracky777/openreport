import { describe, test, expect } from 'vitest';
import { hexToHsv, hsvToHex, hexToRgb, rgbToHex, normalizeHex } from './colorConvert';

describe('hexToRgb', () => {
  test('reads the six-digit form', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  test('expands the three-digit form people type by hand', () => {
    expect(hexToRgb('#fff')).toEqual(hexToRgb('#ffffff'));
    expect(hexToRgb('#08f')).toEqual(hexToRgb('#0088ff'));
  });

  test('tolerates a missing # and any case', () => {
    expect(hexToRgb('7C3AED')).toEqual(hexToRgb('#7c3aed'));
  });

  test('refuses what is not a colour', () => {
    for (const bad of ['', '#', '#12345', 'rgb(1,2,3)', 'transparent', null, 42]) {
      expect(hexToRgb(bad)).toBeNull();
    }
  });
});

describe('rgbToHex', () => {
  test('pads each channel to two digits', () => {
    expect(rgbToHex(0, 8, 255)).toBe('#0008ff');
  });

  test('clamps out-of-range channels instead of producing junk', () => {
    expect(rgbToHex(-20, 300, 128)).toBe('#00ff80');
  });
});

describe('hex ↔ hsv round trip', () => {
  // The picker converts on every drag; drift here would make a colour crawl
  // as the user moves the cursor.
  test.each([
    '#000000', '#ffffff', '#7c3aed', '#e11d48', '#059669', '#ca8a04', '#0891b2', '#123456',
  ])('%s survives the trip', (hex) => {
    expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });

  test('grey has no hue, and black no saturation', () => {
    expect(hexToHsv('#808080').s).toBe(0);
    expect(hexToHsv('#000000').v).toBe(0);
  });

  test('the primaries land on their expected hues', () => {
    expect(Math.round(hexToHsv('#ff0000').h)).toBe(0);
    expect(Math.round(hexToHsv('#00ff00').h)).toBe(120);
    expect(Math.round(hexToHsv('#0000ff').h)).toBe(240);
  });

  test('an unparseable value gives null rather than a wrong colour', () => {
    expect(hexToHsv('nope')).toBeNull();
  });

  test('hue wraps instead of falling off the end', () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000');
  });
});

describe('normalizeHex', () => {
  test('brings every accepted form to #rrggbb', () => {
    expect(normalizeHex('#FFF')).toBe('#ffffff');
    expect(normalizeHex('7c3aed')).toBe('#7c3aed');
    expect(normalizeHex('  #E11D48 ')).toBe('#e11d48');
  });

  test('returns null for anything else', () => {
    expect(normalizeHex('transparent')).toBeNull();
    expect(normalizeHex('#12')).toBeNull();
  });
});
