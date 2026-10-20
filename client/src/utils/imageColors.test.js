import { describe, expect, test } from 'vitest';
import { paletteOf } from './imageColors';

const px = (r, g, b, a = 255) => [r, g, b, a];
const fill = (n, color) => Array.from({ length: n }, () => color).flat();

describe('paletteOf', () => {
  test('a two-color logo on white: its two colors, the most present first', () => {
    const pixels = [...fill(500, px(255, 255, 255)), ...fill(300, px(30, 42, 68)), ...fill(120, px(242, 140, 40))];
    expect(paletteOf(pixels)).toEqual(['#1E2A44', '#F28C28']);
  });

  test('white, black, greys, transparent pixels and stray edges are not the brand', () => {
    const pixels = [
      ...fill(400, px(250, 250, 250)), ...fill(300, px(5, 5, 5)), ...fill(200, px(128, 128, 128)),
      ...fill(300, px(200, 30, 30, 0)), ...fill(200, px(16, 120, 200)), ...fill(3, px(0, 200, 0)),
    ];
    expect(paletteOf(pixels)).toEqual(['#1078C8']);
  });

  test('shades of one color are one color; three at most', () => {
    const pixels = [
      ...fill(100, px(240, 140, 40)), ...fill(100, px(250, 150, 50)),
      ...fill(90, px(30, 40, 160)), ...fill(80, px(20, 160, 60)), ...fill(70, px(160, 20, 160)),
    ];
    const out = paletteOf(pixels);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('#F08C28');
    expect(out).not.toContain('#FA9632');
  });

  test('a black and white logo has no color to offer', () => {
    expect(paletteOf([...fill(100, px(0, 0, 0)), ...fill(100, px(255, 255, 255))])).toEqual([]);
  });
});
