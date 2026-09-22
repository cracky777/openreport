const { readabilityOps, legible, THEMES, MIN_TEXT_CONTRAST } = require('../utils/ai/readability');
const { contrast, toLch } = require('../utils/ai/colorScheme');
const { validateDesignProposal } = require('../utils/ai/validateProposal');

// Reported by the author: "propose a dark / orange theme" gave black text on
// grey. Measured on the real page after applying: light text on the table's
// white rows, a dark filter label on a black page — hexes fixed under the
// light theme, stranded by the switch. The check is on the FINAL state.
const REAL_PAGE = {
  theme: null,
  pageBackground: null,
  themes: ['light', 'dark'],
  pageWidth: 1140,
  pageHeight: 800,
  widgets: [
    { id: 'pivot', type: 'pivotTable', config: { tableConfig: { rows: { striped: true, stripeColor1: '#ffffff', stripeColor2: '#f5f5f5' }, grid: { horizontalColor: '#e2e8f0' } } } },
    { id: 'slicer', type: 'filter', config: { slicerFontColor: '#0f172a' } },
    { id: 'share', type: 'pie', dataBinding: { selectedDimensions: ['t.region'], selectedMeasures: ['t.m'] }, config: { showLegend: true } },
    { id: 'kpi', type: 'scorecard', config: { valueColor: '#111111', backgroundColor: '#ffffff' } },
  ],
};
const DARK = { op: 'report_settings', set: { theme: 'dark', pageBackground: '#121212' } };
const merge = (config, set) => {
  const next = { ...config, ...set };
  if (set.tableConfig) {
    next.tableConfig = { ...(config.tableConfig || {}) };
    for (const [g, v] of Object.entries(set.tableConfig)) next.tableConfig[g] = { ...(next.tableConfig[g] || {}), ...v };
  }
  return next;
};
const finalConfig = (page, ops, id) => ops.filter((op) => op.op === 'update_config' && op.widgetId === id).reduce((c, op) => merge(c, op.set), page.widgets.find((w) => w.id === id).config || {});

test('nothing to fix, nothing proposed', () => {
  expect(readabilityOps(REAL_PAGE, [])).toEqual([]);
  expect(readabilityOps({ ...REAL_PAGE, widgets: [{ id: 'a', type: 'bar', config: {} }] }, [DARK])).toEqual([]);
});

test('a theme switch realigns every hex the old theme left behind', () => {
  const fixes = readabilityOps(REAL_PAGE, [DARK]);
  const set = Object.fromEntries(fixes.map((op) => [op.widgetId, op.set]));
  expect(fixes.every((op) => op.fromReadability)).toBe(true);
  // The table's white rows become the dark theme's surfaces, its grid its border.
  expect(set.pivot.tableConfig.rows).toEqual({ stripeColor1: THEMES.dark.panel, stripeColor2: THEMES.dark.subtle });
  expect(set.pivot.tableConfig.grid).toEqual({ horizontalColor: THEMES.dark.border });
  // The filter has no card: its label is read against the PAGE, now #121212.
  expect(set.slicer).toEqual({ slicerFontColor: THEMES.dark.text });
  // A white card under a dark theme would fight every text the theme draws on it.
  expect(set.kpi).toEqual({ backgroundColor: THEMES.dark.panel, valueColor: THEMES.dark.text });
  expect(set.share).toBeUndefined();
});

test('what the proposal itself chose is kept when it reads, fixed when it does not', () => {
  const chosen = [
    DARK,
    { op: 'update_config', widgetId: 'kpi', set: { backgroundColor: '#1E1E1E', valueColor: '#f97316', labelColor: '#222222', borderColor: '#333333' } },
    { op: 'update_config', widgetId: 'pivot', set: { tableConfig: { rows: { stripeColor1: '#1c1917', stripeColor2: '#292524' }, header: { bgColor: '#7c2d12' } } } },
  ];
  const set = Object.fromEntries(readabilityOps(REAL_PAGE, chosen).map((op) => [op.widgetId, op.set]));
  // Orange on near-black reads; near-black on near-black does not, and is
  // lightened until it does (it was a choice: adjusted, not replaced); the
  // border was a choice too, and borders are not text.
  expect(Object.keys(set.kpi)).toEqual(['labelColor']);
  expect(set.kpi.labelColor).toBe(legible('#222222', '#1E1E1E'));
  expect(contrast(set.kpi.labelColor, '#1E1E1E')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  // The rows the proposal picked stay; only the inherited grid goes to the theme.
  expect(set.pivot.tableConfig.rows).toBeUndefined();
  expect(set.pivot.tableConfig.grid).toEqual({ horizontalColor: THEMES.dark.border });
});

test('a header may be any color: its text is whichever ink reads on it', () => {
  const page = { ...REAL_PAGE, theme: 'dark', widgets: [{ id: 't', type: 'table', config: {} }] };
  const pale = readabilityOps(page, [{ op: 'update_config', widgetId: 't', set: { tableConfig: { header: { bgColor: '#faecdc' } } } }]);
  expect(pale[0].set.tableConfig.header.fontColor).toBe(THEMES.light.text);
  const deep = readabilityOps(page, [{ op: 'update_config', widgetId: 't', set: { tableConfig: { header: { bgColor: '#7c2d12', fontColor: '#0f172a' } } } }]);
  expect(deep[0].set.tableConfig.header.fontColor).toBe(THEMES.dark.text);
});

// Asked for pale yellow legend text on a white page: grey would look like
// nothing was done, a theme switch is not what was asked. The yellow stays a
// yellow, only as dark as it takes to be read.
test('a color the author asked for keeps its hue and becomes readable', () => {
  const hue = (c) => toLch(c).h;
  for (const [asked, surface] of [['#ffffcc', '#ffffff'], ['#fde047', '#ffffff'], ['#1e3a8a', '#111827']]) {
    const got = legible(asked, surface);
    expect(contrast(got, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(Math.abs(hue(got) - hue(asked))).toBeLessThan(12);
  }
  const light = { ...REAL_PAGE, theme: 'light' };
  const [fix] = readabilityOps(light, [{ op: 'update_config', widgetId: 'share', set: { legendTextColor: '#ffffcc' } }]);
  expect(fix.set.legendTextColor).toBe(legible('#ffffcc', '#ffffff'));
  expect(fix.set.legendTextColor).not.toBe(THEMES.light.secondary);
});

test('through the proposal, the adjusted color is shown where it was set, not as a second operation', () => {
  const { ops } = validateDesignProposal(
    { summary: 's', ops: [{ op: 'report_settings', set: { theme: 'dark' } }, { op: 'update_config', widgetId: 'share', set: { legendTextColor: '#ffffcc' } }] },
    { page: { width: 1140, height: 800 }, pageContext: { ...REAL_PAGE, theme: 'light', widgets: [REAL_PAGE.widgets[2]] }, scope: { layout: false, scheme: false, theme: false } },
  );
  // Out of scope, the theme switch is gone — and the yellow was made to read on white instead.
  expect(ops).toEqual([{ op: 'update_config', widgetId: 'share', set: { legendTextColor: legible('#ffffcc', '#ffffff') } }]);
});

describe('through the design proposal, the author\'s request end to end', () => {
  const ctx = { page: { width: 1140, height: 800 }, pageContext: REAL_PAGE, effective: { dimensions: [], measures: [] }, scope: { layout: false, scheme: true, theme: true } };
  // What the real model sent, verbatim in substance.
  const proposal = {
    summary: 'Thème dark avec une base orange.',
    colorScheme: 'categorical',
    baseColor: '#d97706',
    ops: [
      DARK,
      { op: 'update_config', widgetId: 'pivot', set: { backgroundColor: '#1E1E1E', borderColor: '#333333' } },
      { op: 'update_config', widgetId: 'slicer', set: { slicerFontColor: '#FFFFFF' } },
    ],
  };

  test('the color rule is computed for the theme the page ends up with', () => {
    const { ops } = validateDesignProposal(proposal, ctx);
    const header = ops.find((op) => op.fromScheme && op.widgetId === 'pivot').set.tableConfig.header;
    // A dark tint of the orange under light text — not the pale peach a white page would get.
    expect(contrast(header.bgColor, '#ffffff')).toBeGreaterThan(7);
    expect(header.fontColor).toBe(THEMES.dark.text);
  });

  test('every text of the final page reads on what is behind it', () => {
    const { ops, errors } = validateDesignProposal(proposal, ctx);
    expect(errors).toEqual([]);
    const pivot = finalConfig(REAL_PAGE, ops, 'pivot');
    const rowInk = (pivot.tableConfig.values || {}).fontColor || THEMES.dark.secondary;
    for (const key of ['stripeColor1', 'stripeColor2']) expect(contrast(rowInk, pivot.tableConfig.rows[key])).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(pivot.tableConfig.header.fontColor, pivot.tableConfig.header.bgColor)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(finalConfig(REAL_PAGE, ops, 'slicer').slicerFontColor, '#121212')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    const kpi = finalConfig(REAL_PAGE, ops, 'kpi');
    expect(contrast(kpi.valueColor, kpi.backgroundColor)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});
