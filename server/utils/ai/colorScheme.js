// One color rule for a whole page.
//
// Left to itself a model picks hex values one widget at a time: the bars go
// blue, the table stays grey, two charts get two unrelated blues, and a series
// legend is skipped altogether because coloring it needs the NAMES of the
// series, which are data it does not have. So it no longer picks colors. It
// picks a RULE of color harmony and a base color; the colors are computed
// here, and one fixed rule decides which goes where on every widget.
//
// Harmony is the classic color-wheel geometry — hues at set angles from the
// base. It is computed in OKLCH (Björn Ottosson's OKLab, polar form) rather
// than HSL: there, equal lightness LOOKS equally light whatever the hue, so a
// generated yellow does not glare beside a generated blue, and a lightness
// step is the same visible step everywhere. A rule also never runs out: a
// chart colors its n-th series with `palette[n % length]`, and a fixed list of
// six let the seventh brand of a treemap come back in the color of the first.
//
// Which colors is the smaller half of the job. WHERE color goes, and what kind,
// follows what the data is — the part the experts agree on:
//   Stephen Few, "Practical Rules for Using Color in Charts": color only where
//     it serves; different colors only for differences of meaning (one measure
//     is ONE color, not one per bar); soft colors for most of the display;
//     a single hue of varying intensity for what is quantitative or ordered;
//     no red against green; enough contrast with the background.
//   Cynthia Brewer (ColorBrewer), Datawrapper: a QUALITATIVE set — distinct
//     hues of the same visual weight — for unordered categories; a SEQUENTIAL
//     ramp, light to dark, for ordered ones.
//   Maureen Stone: large areas want less saturation, thin marks more contrast.
// So the harmony the model picks only decides the hues of a qualitative set;
// `roleOf` below decides, per widget, whether it gets that set at all.

// Hue offsets from the base, in degrees. `categorical` is not a wheel figure:
// it steps by the golden angle, which keeps any number of hues as far apart as
// they can be — what a qualitative set is for.
const GOLDEN_ANGLE = 137.5;
const HARMONIES = {
  categorical: Array.from({ length: 8 }, (_, i) => (i * GOLDEN_ANGLE) % 360),
  monochromatic: [0],
  analogous: [0, 30, -30],
  complementary: [0, 180],
  'split-complementary': [0, 150, 210],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
};

const HARMONY_NOTES = {
  categorical: 'hues as far apart as possible, same visual weight — unrelated categories that must be told apart at a glance; the default when in doubt',
  monochromatic: 'one hue, from dark to light — a sober page, or series that are ORDERED (tiers, age bands, low to high)',
  analogous: 'three neighbouring hues — calm and unified, for categories that belong together',
  complementary: 'two opposite hues — two groups to set against each other (actual vs target, this year vs last)',
  'split-complementary': 'the base and the two hues beside its opposite — contrast without the clash, three groups',
  triadic: 'three hues evenly spaced — a few unrelated categories, lively but balanced',
  tetradic: 'four hues evenly spaced — many unrelated categories',
};

const SURFACES = {
  light: { background: '#ffffff', text: '#0f172a', track: '#e2e8f0', lightness: [0.45, 0.68] },
  // `background` is what a chart is drawn on — the widget card (--bg-panel).
  dark: { background: '#111827', text: '#f1f5f9', track: '#334155', lightness: [0.62, 0.8] },
};

// The editor's own accent: what a page is based on when nobody names a color.
const DEFAULT_BASE = '#5470c6';
const SERIES_LENGTH = 18;
const RAMP_STEPS = 9;
// Lightness steps away from the base level, for the second, third… round of
// the same hues. Alternating light and dark keeps neighbours in the list apart.
const LEVELS = [0, 0.15, -0.13, 0.08, -0.07, 0.22, -0.19];
// A rule with two or three hues runs out of lightness steps before twelve
// series (a legend by month). Its last resort is the same hues nudged a little
// along the wheel: still plainly the rule's families, and still no repeat.
const HUE_NUDGES = [18, -18];
// A mark must stand out from what it is drawn on. Well under the 3:1 WCAG asks
// of a lone graphic, which no full palette meets; this removes only what is
// actually lost on the page.
const MIN_MARK_CONTRAST = 1.5;
// Two colors closer than this in OKLab read as the same series.
const MIN_DELTA = 0.05;
const SERIES_TYPES = new Set(['bar', 'line', 'combo', 'scatter', 'pie', 'treemap']);
const HEX = /^#[0-9a-f]{6}$/i;

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toLab(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [16, 8, 0].map((s) => toLinear(((n >> s) & 255) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function labToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → hex. A color outside sRGB keeps its lightness and hue and gives up chroma until it fits. */
function fromLch(L, C, h) {
  const rad = (h * Math.PI) / 180;
  for (let chroma = C; chroma >= 0; chroma -= 0.005) {
    const rgb = labToRgb({ L, a: chroma * Math.cos(rad), b: chroma * Math.sin(rad) });
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return `#${rgb.map((v) => Math.round(Math.min(Math.max(toGamma(Math.max(v, 0)), 0), 1) * 255).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return fromLch(L, 0, 0);
}

function toLch(hex) {
  const { L, a, b } = toLab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

function luminance(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [16, 8, 0].reduce((sum, s, i) => sum + [0.2126, 0.7152, 0.0722][i] * toLinear(((n >> s) & 255) / 255), 0);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function delta(a, b) {
  const [x, y] = [toLab(a), toLab(b)];
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

function mix(hex, other, weight) {
  const a = parseInt(hex.slice(1, 7), 16);
  const b = parseInt(other.slice(1, 7), 16);
  const part = (shift) => Math.round(((a >> shift) & 255) * weight + ((b >> shift) & 255) * (1 - weight));
  return `#${[16, 8, 0].map((s) => part(s).toString(16).padStart(2, '0')).join('')}`;
}

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * The series colors of a harmony, in the order charts will use them: every
 * hue of the rule at the base lightness first — so a chart with few series
 * shows the rule at its plainest — then the same hues again, lighter, darker.
 * What would be lost on the page, or too close to a color already in the
 * list, is skipped: no two entries read as the same series.
 */
function harmonySeries(harmony, baseHex, surface, marks = MARKS.fill) {
  const base = toLch(HEX.test(baseHex || '') ? baseHex : DEFAULT_BASE);
  // A grey base has no hue to build a wheel on: fall back to the editor's.
  const anchor = base.C < 0.03 ? toLch(DEFAULT_BASE) : base;
  const [minL, maxL] = surface.lightness;
  const L = clamp(anchor.L, minL, maxL);
  const C = clamp(anchor.C, 0.09, 0.19) * marks.chroma;

  let candidates;
  if (harmony === 'monochromatic') {
    // One hue is a ramp: evenly spaced lightness, the most visible end first.
    // A single hue only holds so many steps the eye can tell apart — six for
    // thin lines — and twelve months in a legend would wrap back onto the
    // first. Past its last step the ramp carries on into the neighbouring
    // hues, as the multi-hue sequential ramps of ColorBrewer do (YlGnBu…):
    // still one progression, never the same color twice.
    const [from, to] = surface === SURFACES.dark ? [0.88, 0.42] : [0.3, 0.84];
    candidates = [0, 40, -40].flatMap((offset) => Array.from({ length: RAMP_STEPS }, (_, i) => (
      fromLch(from + ((to - from) * i) / (RAMP_STEPS - 1), C, (anchor.h + offset + 360) % 360)
    )));
  } else {
    candidates = LEVELS.flatMap((level, round) => HARMONIES[harmony].map((offset, i) => (
      // Hues of one round differ a little in lightness too: that is what still
      // tells them apart for someone who does not see the hue difference.
      fromLch(clamp(L + level + (i % 2 ? 0.04 : 0), 0.28, 0.9), round ? C * 0.85 : C, (anchor.h + offset + 360) % 360)
    )));
    for (const nudge of HUE_NUDGES) {
      for (const level of LEVELS.slice(0, 3)) {
        for (const offset of HARMONIES[harmony]) candidates.push(fromLch(clamp(L + level, 0.28, 0.9), C * 0.85, (anchor.h + offset + nudge + 360) % 360));
      }
    }
    // Two hues held to 3:1 on a white page cannot be told apart twelve ways:
    // that is arithmetic, not a bug. What is left comes from the whole wheel —
    // the rule gives way after it has colored the first series, which beats
    // two series in one color.
    for (const level of LEVELS.slice(0, 3)) {
      for (const offset of HARMONIES.categorical) candidates.push(fromLch(clamp(L + level, 0.28, 0.9), C * 0.85, (anchor.h + offset + 360) % 360));
    }
  }

  const out = [];
  for (const c of candidates) {
    if (out.length >= SERIES_LENGTH) break;
    if (contrast(c, surface.background) < marks.contrast) continue;
    if (out.some((kept) => delta(kept, c) < MIN_DELTA)) continue;
    out.push(c);
  }
  return out;
}

// Stone's size rule. A filled area this large is loud at full saturation, so
// it gets less; a line or a point is a few pixels wide and has to reach the
// contrast WCAG asks of a graphic (3:1) on its own, so what is too pale is
// dropped rather than softened.
const MARKS = {
  fill: { chroma: 1, contrast: MIN_MARK_CONTRAST },
  area: { chroma: 0.8, contrast: MIN_MARK_CONTRAST },
  thin: { chroma: 1, contrast: 3 },
};
const AREA_TYPES = new Set(['pie', 'treemap']);
const THIN_TYPES = new Set(['line', 'scatter']);
const AREA_SUBTYPES = new Set(['area', 'stackedArea', 'stackedArea100']);

function marksOf(widget) {
  if (AREA_TYPES.has(widget.type) || AREA_SUBTYPES.has(widget.shape && widget.shape.subType)) return MARKS.area;
  return THIN_TYPES.has(widget.type) ? MARKS.thin : MARKS.fill;
}

// A dimension whose values have an order: time, numbers, and the names people
// give to ordered buckets. Its series are steps of one thing, not rivals.
const ORDERED_NAME = /(^|[._\s-])(year|annee|année|quarter|trimestre|month|mois|week|semaine|day|jour|date|hour|heure|age|tier|level|niveau|rank|rang|size|taille|range|tranche|bucket|band|score|grade|stage|etape|étape|step)s?($|[._\s-])/i;
const ORDERED_TYPE = /date|time|number|int|float|decimal|numeric/i;

function isOrdered(dimName, dimensions) {
  if (!dimName) return false;
  const dim = dimensions.find((d) => d.name === dimName);
  return ORDERED_TYPE.test(String((dim && dim.type) || '')) || ORDERED_NAME.test(`${dimName} ${(dim && dim.label) || ''}`);
}

/**
 * What color is FOR on this widget — decided by the data, not by taste:
 *   single      one measure, no legend: one color. A different color per bar
 *               would claim differences of meaning that are not there.
 *   sequential  the series are steps of an ordered dimension (years, tiers):
 *               one hue, light to dark, so the order is visible in the color.
 *   qualitative unordered categories: distinct hues of equal weight.
 */
function roleOf(widget, dimensions) {
  const b = widget.dataBinding || {};
  const legend = Array.isArray(b.groupBy) && b.groupBy.length ? b.groupBy[0] : null;
  // The marks of a pie or a treemap ARE the categories of its dimension.
  const categories = AREA_TYPES.has(widget.type) && Array.isArray(b.selectedDimensions) ? b.selectedDimensions[0] : null;
  const seriesDim = legend || categories;
  if (seriesDim) return isOrdered(seriesDim, dimensions) ? 'sequential' : 'qualitative';
  if (widget.type === 'combo') return 'qualitative';
  return Array.isArray(b.selectedMeasures) && b.selectedMeasures.length > 1 ? 'qualitative' : 'single';
}

/**
 * The rule. For every widget of the page, the `update_config` a consistent
 * page needs — nothing for a type it has no business coloring (text, image,
 * shape: those are the author's composition).
 *
 * @param {string} harmony      a key of HARMONIES: how the hues of a qualitative set are chosen
 * @param {string} baseHex      the color the page is built on; the editor's accent when absent or invalid
 * @param {object} pageContext  { theme, widgets }
 * @param {object[]} dimensions the model's dimensions ({ name, label, type }), to tell ordered series from categories
 * @returns {object[]|null}     update_config operations, or null for an unknown harmony
 */
function colorOps(harmony, baseHex, pageContext, dimensions = []) {
  if (!Object.prototype.hasOwnProperty.call(HARMONIES, harmony)) return null;
  const surface = SURFACES[pageContext.theme === 'dark' ? 'dark' : 'light'];
  // The accent is the same everywhere — it is what ties the page together —
  // so it is taken once, from the plain fill series, not per widget.
  const accent = harmonySeries(harmony, baseHex, surface)[0];
  // Tints of the accent, toward the page: the accent itself behind text would
  // fight it, a tint says "same family" and stays readable on both themes.
  const soft = mix(accent, surface.background, 0.14);
  const faint = mix(accent, surface.background, 0.08);

  const ops = [];
  for (const widget of pageContext.widgets) {
    let set = null;
    if (SERIES_TYPES.has(widget.type)) {
      const role = roleOf(widget, dimensions);
      const series = harmonySeries(role === 'sequential' ? 'monochromatic' : harmony, baseHex, surface, marksOf(widget));
      // Per-series overrides are cleared: they would keep the old colors on
      // exactly the series the author looks at most. Ctrl+Z brings them back.
      set = { palette: series, legendColors: {} };
      if (role === 'single') set.color = accent;
    } else if (widget.type === 'gauge') {
      set = { gaugeColor: accent, gaugeTrackColor: surface.track };
    } else if (widget.type === 'filter') {
      set = { slicerSelectedColor: accent, slicerSelectedBg: soft };
    } else if (widget.type === 'table' || widget.type === 'pivotTable') {
      set = { tableConfig: { header: { bgColor: soft, fontColor: surface.text }, rows: { hoverColor: faint } } };
    }
    if (set) ops.push({ op: 'update_config', widgetId: widget.id, set });
  }
  return ops;
}
module.exports = { HARMONIES, HARMONY_NOTES, SURFACES, MARKS, DEFAULT_BASE, colorOps, harmonySeries, roleOf, contrast, delta, toLch, fromLch };
