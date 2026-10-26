import { describe, it, expect } from 'vitest';
import { paletteOf, CHART_COLORS, seriesColor } from './chartPalette';

describe('paletteOf', () => {
  it('falls back to the shared palette, so reports built before the key keep their colors', () => {
    expect(paletteOf(undefined, CHART_COLORS)).toBe(CHART_COLORS);
    expect(paletteOf({}, CHART_COLORS)).toBe(CHART_COLORS);
    expect(paletteOf({ palette: [] }, CHART_COLORS)).toBe(CHART_COLORS);
    expect(paletteOf({ palette: 'blues' }, CHART_COLORS)).toBe(CHART_COLORS);
  });

  it('uses the widget palette, minus anything that is not a hex color', () => {
    expect(paletteOf({ palette: ['#0072B2', 'url(x)', '#E69F00', 7] }, CHART_COLORS)).toEqual(['#0072B2', '#E69F00']);
  });
});
describe('seriesColor', () => {
  it('past the end of the palette, a darker then a lighter round: never one color for two series', () => {
    const palette = ['#336699', '#cc3300'];
    const colors = [0, 1, 2, 3, 4, 5].map((i) => seriesColor(palette, i));
    expect(colors.slice(0, 2)).toEqual(palette);
    expect(new Set(colors).size).toBe(6);
  });
});
