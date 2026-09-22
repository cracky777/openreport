// The last word on a design proposal: can everything still be read?
//
// Asked for "a dark / orange theme", a real model switched the report to the
// dark theme — and the page came out with light text on the table's white
// rows and a dark filter label on a black page. Nothing in the proposal was
// wrong on its own. What broke is every color that had been FIXED as a hex
// under the light theme, in the report's own config as much as in the
// proposal: a hex does not follow the theme, a theme switch strands it.
//
// A model cannot be asked to find those: it would have to read every widget's
// config and do contrast arithmetic. So it is done here, on the state the page
// will be in once the proposal is applied — current config, plus everything
// the proposal sets, under the theme it ends up with. Whatever text does not
// reach WCAG AA (4.5:1) on what is actually behind it is put right, and the
// fix travels with the proposal as ordinary `update_config` operations.

const { contrast, toLch, fromLch } = require('./colorScheme');

const MIN_TEXT_CONTRAST = 4.5;

// The surfaces and inks of each theme, as client/src/themes/themes.json has
// them: what a widget falls back to when a color is left unset.
const THEMES = {
  light: { panel: '#ffffff', subtle: '#f8fafc', hover: '#f1f5f9', canvas: '#ffffff', text: '#0f172a', secondary: '#334155', border: '#e2e8f0' },
  dark: { panel: '#111827', subtle: '#1e293b', hover: '#1f2a3d', canvas: '#0f172a', text: '#f1f5f9', secondary: '#cbd5e1', border: '#1e293b' },
};

// Config keys that color text drawn on the widget's own background, and the
// ink each falls back to: the figure a widget exists for reads as primary
// text, its captions as secondary.
const TEXT_KEYS = {
  valueColor: 'text',
  gaugeValueColor: 'text',
  slicerFontColor: 'text',
  labelColor: 'secondary',
  legendTextColor: 'secondary',
  xAxisLabelColor: 'secondary',
  yAxisLabelColor: 'secondary',
  secondaryYAxisLabelColor: 'secondary',
  headerColor: 'secondary',
  gaugeLabelColor: 'secondary',
  gaugeAxisColor: 'secondary',
};
// Drawn without a card of their own unless told otherwise (WidgetItem.jsx).
const TRANSPARENT_BY_DEFAULT = new Set(['filter', 'image']);
const HEX = /^#[0-9a-f]{6}/i;

const isHex = (v) => typeof v === 'string' && HEX.test(v);
const reads = (ink, surface) => contrast(ink.slice(0, 7), surface.slice(0, 7)) >= MIN_TEXT_CONTRAST;

/**
 * The color that was asked for, made readable: same hue, same saturation,
 * only as much darker (or lighter) as it takes. Asked for pale yellow legend
 * text on a white page, the author gets a yellow they can read — not the grey
 * that would make it look as if nothing had been done, and not the theme
 * switch a model reaches for to make its yellow show.
 */
function legible(color, surface) {
  const { L, C, h } = toLch(color.slice(0, 7));
  const darker = contrast(THEMES.light.text, surface.slice(0, 7)) > contrast(THEMES.dark.text, surface.slice(0, 7));
  for (let step = 1; step <= 45; step++) {
    const candidate = fromLch(Math.min(Math.max(L + (darker ? -0.02 : 0.02) * step, 0.04), 0.98), C, h);
    if (reads(candidate, surface)) return candidate;
  }
  return darker ? THEMES.light.text : THEMES.dark.text;
}

function mergeConfig(config, set) {
  const next = { ...config, ...set };
  if (set.tableConfig) {
    next.tableConfig = { ...(config.tableConfig || {}) };
    for (const [group, values] of Object.entries(set.tableConfig)) next.tableConfig[group] = { ...(next.tableConfig[group] || {}), ...values };
  }
  return next;
}

/** The theme and page background the page ends up with. */
function finalLook(pageContext, ops) {
  let theme = pageContext.theme === 'dark' ? 'dark' : 'light';
  let pageBackground = isHex(pageContext.pageBackground) ? pageContext.pageBackground : null;
  for (const op of ops) {
    if (op.op !== 'report_settings') continue;
    if (op.set.theme) theme = op.set.theme === 'dark' ? 'dark' : 'light';
    if (op.set.pageBackground) pageBackground = op.set.pageBackground;
  }
  return { theme, pageBackground };
}

// proposed holds what this very proposal chose ("rows.stripeColor1"): a theme
// switch realigns the colors it inherited, not the ones it was just given.
function tableFixes(table, inks, themeChanged, proposed) {
  const stale = (group, key) => themeChanged && !proposed.has(`${group}.${key}`);
  const fix = {};
  const put = (group, key, value) => { fix[group] = { ...(fix[group] || {}), [key]: value }; };
  const rows = table.rows || {};
  const values = table.values || {};
  const header = table.header || {};
  const totals = table.totals || {};

  // Row inks and row surfaces. On a theme switch every fixed neutral goes to
  // the new theme, not only the ones that fail: dark text on white rows reads,
  // but in the middle of a dark page it is a hole in it.
  const keepInk = isHex(values.fontColor) && !stale('values', 'fontColor') && reads(values.fontColor, inks.panel);
  const rowInk = keepInk ? values.fontColor : inks.secondary;
  if (isHex(values.fontColor) && !keepInk) put('values', 'fontColor', inks.secondary);
  for (const [key, surface] of [['stripeColor1', inks.panel], ['stripeColor2', inks.subtle], ['bgColor', inks.panel]]) {
    if (isHex(rows[key]) && (stale('rows', key) || !reads(rowInk, rows[key]))) put('rows', key, surface);
  }
  for (const key of ['horizontalColor', 'verticalColor', 'outerBorderColor']) {
    if (stale('grid', key) && isHex((table.grid || {})[key])) put('grid', key, inks.border);
  }
  // A header or a totals row may be any color — the accent's tint, say. Its
  // text only has to read on it: whichever of the two inks does so best.
  for (const [group, part, fallback] of [['header', header, inks.hover], ['totals', totals, inks.hover]]) {
    const surface = isHex(part.bgColor) ? part.bgColor : fallback;
    const ink = isHex(part.fontColor) ? part.fontColor : inks.text;
    if (reads(ink, surface)) continue;
    const best = [THEMES.light.text, THEMES.dark.text].sort((a, b) => contrast(b, surface.slice(0, 7)) - contrast(a, surface.slice(0, 7)))[0];
    put(group, 'fontColor', best);
  }
  return Object.keys(fix).length ? fix : null;
}

/**
 * @param {object} pageContext  the page as submitted: { theme, pageBackground, widgets: [{ id, type, config }] }
 * @param {object[]} ops        the validated operations of the proposal, in order
 * @returns {object[]}          the `update_config` operations that make the final state readable
 */
function readabilityOps(pageContext, ops) {
  const { theme, pageBackground } = finalLook(pageContext, ops);
  const inks = THEMES[theme];
  const themeChanged = theme !== (pageContext.theme === 'dark' ? 'dark' : 'light');
  const pageSurface = pageBackground || inks.canvas;

  const fixes = [];
  for (const widget of pageContext.widgets) {
    let config = widget.config || {};
    const proposed = new Set();
    for (const op of ops) {
      if (op.op !== 'update_config' || op.widgetId !== widget.id) continue;
      config = mergeConfig(config, op.set);
      for (const [key, value] of Object.entries(op.set)) {
        proposed.add(key);
        if (key === 'tableConfig') for (const [group, values] of Object.entries(value)) for (const k of Object.keys(values)) proposed.add(`${group}.${k}`);
      }
    }

    const set = {};
    const transparent = typeof config.transparentBg === 'boolean' ? config.transparentBg : TRANSPARENT_BY_DEFAULT.has(widget.type);
    let surface = transparent ? pageSurface : inks.panel;
    if (!transparent && isHex(config.backgroundColor)) {
      // A card that fights the theme's own text (titles, legends, table cells
      // all take it) cannot be saved one key at a time: it goes to the theme's.
      if (reads(inks.text, config.backgroundColor)) surface = config.backgroundColor;
      else set.backgroundColor = inks.panel;
    }

    const textKeys = widget.type === 'text' ? { ...TEXT_KEYS, color: 'text' } : TEXT_KEYS;
    for (const [key, ink] of Object.entries(textKeys)) {
      if (!isHex(config[key]) || reads(config[key], surface)) continue;
      // Chosen in this very proposal: it is what the author asked for, so the
      // hue stays. Inherited from before: it simply goes back to the theme's.
      set[key] = proposed.has(key) ? legible(config[key], surface) : inks[ink];
    }
    if (themeChanged && isHex(config.borderColor) && !proposed.has('borderColor')) set.borderColor = inks.border;

    if (widget.type === 'table' || widget.type === 'pivotTable') {
      const table = tableFixes(config.tableConfig || {}, { ...inks, panel: surface === pageSurface ? inks.panel : surface }, themeChanged, proposed);
      if (table) set.tableConfig = table;
    }
    if (Object.keys(set).length) fixes.push({ op: 'update_config', widgetId: widget.id, set, fromReadability: true });
  }
  return fixes;
}

module.exports = { readabilityOps, finalLook, legible, THEMES, MIN_TEXT_CONTRAST };
