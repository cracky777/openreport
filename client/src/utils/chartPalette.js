// Shared chart color palette. Lived as a per-widget const in
// Bar/Line/Pie/Combo/Scatter/TreeMap for historical reasons, with two
// flavours (10-color vs 15-color). Two flavours kept as named exports
// so widgets that were on the 10-color palette don't suddenly recolor
// their 11th+ series after the move — the wrap index `i % COLORS.length`
// would otherwise pick from the new tail and silently shift hues on
// existing reports.

// 15-color extended palette — used by Bar / Combo / Scatter where the
// widget can plausibly emit > 10 series (many groupBy categories,
// stacked bars, scatter clusters).
export const CHART_COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5ab1ef',
  '#d87a80', '#8d98b3', '#e5cf0d', '#97b552', '#95706d',
];

// 10-color basic palette — used by Line / Pie / TreeMap where the
// design assumed a small handful of series (top-N grouping rolls the
// long tail into the "Others" bucket anyway). Identical to the first
// 10 of CHART_COLORS so the lower-index colors match across widgets.
export const CHART_COLORS_BASIC = CHART_COLORS.slice(0, 10);

const HEX = /^#[0-9a-f]{6}$/i;

// The series palette of ONE widget: `config.palette` when it holds one, the
// shared palette otherwise — so every report built before the key existed
// keeps its colors. A per-series `legendColors` entry still wins over both.
// This is what lets a whole page be recolored without knowing the name of a
// single series (they are data values): set the palette, not the names.
export function paletteOf(config, fallback) {
  const own = Array.isArray(config?.palette) ? config.palette.filter((c) => typeof c === 'string' && HEX.test(c)) : [];
  return own.length ? own : fallback;
}

// Neutral fill for the "Others" slice/bar/cell when a widget bundles
// the long tail into a single bucket. Slate-400.
export const OTHERS_COLOR = '#94a3b8';

// Convert a `#RRGGBB` hex string to an `rgba(r,g,b,a)` CSS color.
// `opacity` is a 0–100 integer (matches the slider in PropertyPanel),
// divided by 100 internally to land in the 0–1 range CSS expects.
export function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity / 100})`;
}

// A pale version of a `#RRGGBB` colour — `share` of it over white: the low
// end of a scale whose high end is the colour itself (heatmap, map).
export function tintOf(hex, share = 0.12) {
  const mix = (i) => Math.round(255 - (255 - parseInt(hex.slice(i, i + 2), 16)) * share).toString(16).padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

// The color of the i-th series. Past the end of the palette the colors came
// round again: two series of one chart in one color, which the legend cannot
// tell apart (Jonathan, about the year before drawn in its base's color). A
// second round takes the palette darker, a third lighter, and so on.
export function seriesColor(palette, i) {
  const n = palette.length;
  if (!n) return OTHERS_COLOR;
  const base = palette[((i % n) + n) % n];
  const round = Math.floor(i / n);
  if (round <= 0 || !/^#[0-9a-f]{6}$/i.test(base)) return base;
  const toward = round % 2 ? 0 : 255;
  const share = Math.min(0.2 * Math.ceil(round / 2) + 0.15, 0.6);
  const mix = (k) => Math.round(parseInt(base.slice(k, k + 2), 16) * (1 - share) + toward * share).toString(16).padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}
