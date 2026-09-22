const { HARMONIES, SURFACES, MARKS, DEFAULT_BASE, colorOps, harmonySeries, roleOf, contrast, delta, toLch } = require('../utils/ai/colorScheme');
const { validateDesignProposal } = require('../utils/ai/validateProposal');

// The model names a rule and a base color; which color lands where follows
// from the data. So the rules are what gets tested: same input, same page.
const DIMS = [
  { name: 't.country', label: 'Country', type: 'string' },
  { name: 't.status', label: 'Status', type: 'string' },
  { name: 't.day', label: 'Order date', type: 'date' },
  { name: 't.order_year', label: 'Year', type: 'string' },
  { name: 't.age_band', label: 'Tranche d\'âge', type: 'string' },
];
const page = (theme, widgets) => ({ theme, themes: ['light', 'dark'], pageWidth: 1140, pageHeight: 800, widgets });
const chart = (id, type, binding, shape) => ({ id, type, dataBinding: binding, shape: shape || {} });
const WIDGETS = [
  chart('single', 'bar', { selectedDimensions: ['t.country'], selectedMeasures: ['t.m'] }),
  chart('byStatus', 'bar', { selectedDimensions: ['t.country'], groupBy: ['t.status'], selectedMeasures: ['t.m'] }),
  chart('byYear', 'line', { selectedDimensions: ['t.day'], groupBy: ['t.order_year'], selectedMeasures: ['t.m'] }),
  chart('twoMeasures', 'line', { selectedDimensions: ['t.day'], selectedMeasures: ['t.m', 't.n'] }),
  chart('share', 'pie', { selectedDimensions: ['t.status'], selectedMeasures: ['t.m'] }),
  chart('ages', 'treemap', { selectedDimensions: ['t.age_band'], selectedMeasures: ['t.m'] }),
  { id: 'gauge', type: 'gauge' },
  { id: 'slicer', type: 'filter' },
  { id: 'grid', type: 'table' },
  { id: 'kpi', type: 'scorecard' },
  { id: 'title', type: 'text' },
  { id: 'deco', type: 'shape' },
];
const byId = (ops) => Object.fromEntries(ops.map((op) => [op.widgetId, op.set]));
const hueGap = (a, b) => { const d = Math.abs(toLch(a).h - toLch(b).h); return Math.min(d, 360 - d); };

// The bug this replaces: a chart colors series n with palette[n % length], and
// a short fixed list gave the seventh brand of a treemap the first one's color.
test('no rule ever hands out the same color twice, on either theme, for any kind of mark', () => {
  for (const harmony of Object.keys(HARMONIES)) {
    for (const surface of Object.values(SURFACES)) {
      for (const marks of Object.values(MARKS)) {
        const series = harmonySeries(harmony, '#2e7d32', surface, marks);
        // Twelve months in a legend is the ordinary worst case: nothing may wrap before that.
        expect(series.length).toBeGreaterThanOrEqual(12);
        for (const c of series) {
          expect(c).toMatch(/^#[0-9a-f]{6}$/);
          expect(contrast(c, surface.background)).toBeGreaterThanOrEqual(marks.contrast);
        }
        series.forEach((a, i) => series.slice(i + 1).forEach((b) => expect(delta(a, b)).toBeGreaterThanOrEqual(0.05)));
      }
    }
  }
});

test('the wheel geometry is what it says: opposite, thirds, neighbours', () => {
  const at = (harmony) => harmonySeries(harmony, '#1565c0', SURFACES.light);
  expect(hueGap(at('complementary')[0], at('complementary')[1])).toBeGreaterThan(150);
  const [a, b, c] = at('triadic');
  for (const gap of [hueGap(a, b), hueGap(b, c), hueGap(a, c)]) expect(gap).toBeGreaterThan(90);
  const [x, y, z] = at('analogous');
  for (const gap of [hueGap(x, y), hueGap(x, z)]) expect(gap).toBeLessThan(45);
  // One hue, walking from the most visible end; only past its last step does
  // the ramp carry on into the neighbouring hue.
  const mono = at('monochromatic');
  for (const m of mono.slice(0, 6)) expect(hueGap(m, mono[0])).toBeLessThan(12);
  expect(toLch(mono[0]).L).toBeLessThan(toLch(mono[5]).L);
  expect(hueGap(mono[mono.length - 1], mono[0])).toBeGreaterThan(20);
});

test('the base color leads the page, and a grey or missing one falls back to the editor\'s', () => {
  expect(harmonySeries('categorical', '#2e7d32', SURFACES.light)[0]).toBe('#2e7d32');
  expect(harmonySeries('categorical', undefined, SURFACES.light)[0]).toBe(DEFAULT_BASE);
  expect(harmonySeries('categorical', 'red; drop', SURFACES.light)[0]).toBe(DEFAULT_BASE);
  expect(toLch(harmonySeries('triadic', '#808080', SURFACES.light)[0]).C).toBeGreaterThan(0.05);
  // Too dark to see on a dark page: same hue, brought up to where it reads.
  const onDark = harmonySeries('categorical', '#0d2b6b', SURFACES.dark)[0];
  expect(contrast(onDark, SURFACES.dark.background)).toBeGreaterThan(3);
  expect(hueGap(onDark, '#0d2b6b')).toBeLessThan(15);
});

describe('what color is FOR, decided by the data', () => {
  test('one measure is one color; ordered series one hue; categories distinct hues', () => {
    const role = (id) => roleOf(WIDGETS.find((w) => w.id === id), DIMS);
    expect(role('single')).toBe('single');
    expect(role('byStatus')).toBe('qualitative');
    expect(role('twoMeasures')).toBe('qualitative');
    expect(role('share')).toBe('qualitative');
    // Ordered by type (a date), by name (year), and by what people call buckets.
    expect(role('byYear')).toBe('sequential');
    expect(role('ages')).toBe('sequential');
    expect(roleOf(chart('x', 'bar', { groupBy: ['t.day'], selectedMeasures: ['t.m'] }), DIMS)).toBe('sequential');
  });

  test('the page gets it widget by widget, from one base and one rule', () => {
    const set = byId(colorOps('triadic', '#1565c0', page('light', WIDGETS), DIMS));
    expect(set.single.color).toBe('#1565c0');
    expect(set.byStatus.color).toBeUndefined();
    expect(set.byStatus.legendColors).toEqual({});
    // Categories: three hues apart. Years and age bands: one hue, whatever the rule.
    expect(hueGap(set.byStatus.palette[0], set.byStatus.palette[1])).toBeGreaterThan(90);
    for (const id of ['byYear', 'ages']) for (const c of set[id].palette.slice(0, 5)) expect(hueGap(c, '#1565c0')).toBeLessThan(12);
    // The accent ties the rest of the page to it; the author's composition is left alone.
    expect(set.gauge.gaugeColor).toBe('#1565c0');
    expect(set.slicer.slicerSelectedColor).toBe('#1565c0');
    for (const id of ['kpi', 'title', 'deco']) expect(set[id]).toBeUndefined();
  });

  test('large fills are toned down, thin marks held to 3:1', () => {
    const set = byId(colorOps('categorical', '#1565c0', page('light', [
      ...WIDGETS,
      chart('area', 'line', { selectedDimensions: ['t.day'], groupBy: ['t.status'], selectedMeasures: ['t.m'] }, { subType: 'stackedArea' }),
    ]), DIMS));
    const chroma = (c) => toLch(c).C;
    expect(chroma(set.share.palette[1])).toBeLessThan(chroma(set.byStatus.palette[1]));
    expect(chroma(set.area.palette[1])).toBeLessThan(chroma(set.byStatus.palette[1]));
    for (const c of set.twoMeasures.palette) expect(contrast(c, '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  test('table header text stays readable on its tint, on both themes and any base', () => {
    for (const theme of ['light', 'dark']) {
      for (const base of ['#1565c0', '#f9a825', '#c62828', '#00695c']) {
        const { header } = byId(colorOps('categorical', base, page(theme, WIDGETS), DIMS)).grid.tableConfig;
        expect(contrast(header.fontColor, header.bgColor)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('the same page, base and rule always give the same colors', () => {
    expect(colorOps('tetradic', '#6a1b9a', page('dark', WIDGETS), DIMS)).toEqual(colorOps('tetradic', '#6a1b9a', page('dark', WIDGETS), DIMS));
  });
});

describe('through the design proposal', () => {
  const ctx = { page: { width: 1140, height: 800 }, pageContext: page('light', WIDGETS), effective: { dimensions: DIMS, measures: [] } };

  test('a rule and a base are a whole proposal; a hand-made exception lands on top of it', () => {
    const { ops, errors, colorScheme } = validateDesignProposal({
      summary: 's',
      colorScheme: 'categorical',
      baseColor: '#1565c0',
      ops: [{ op: 'update_config', widgetId: 'gauge', set: { gaugeOverColor: '#dc2626' } }],
    }, ctx);
    expect(errors).toEqual([]);
    expect(colorScheme).toBe('categorical');
    expect(ops.filter((op) => op.fromScheme)).toHaveLength(9);
    expect(ops.find((op) => op.widgetId === 'byYear').set.palette.slice(0, 5).every((c) => hueGap(c, '#1565c0') < 12)).toBe(true);
    expect(ops.at(-1)).toEqual({ op: 'update_config', widgetId: 'gauge', set: { gaugeOverColor: '#dc2626' } });
  });

  // First real run: the model picked a scheme, then painted the filter black
  // and the table header grey on top of it, restated what was already set, and
  // gave the text widget a title bar.
  test('once a rule is chosen its keys are the rule\'s; a named series is the one way in', () => {
    const page2 = page('light', WIDGETS.map((w) => (w.id === 'byStatus' ? { ...w, config: { showLegend: true } } : w)));
    const { ops, errors } = validateDesignProposal({
      summary: 's',
      colorScheme: 'triadic',
      ops: [
        { op: 'update_config', widgetId: 'slicer', set: { slicerSelectedColor: '#000000', slicerSelectedBg: '#f0f0f0', slicerFontColor: '#111827' } },
        { op: 'update_config', widgetId: 'grid', set: { tableConfig: { header: { bgColor: '#eeeeee', fontBold: true }, rows: { striped: true } } } },
        { op: 'update_config', widgetId: 'byStatus', set: { showLegend: true, legendColors: { Lost: '#dc2626' }, palette: ['#111111', '#222222'] } },
        { op: 'update_config', widgetId: 'title', set: { title: 'Sales overview' } },
      ],
    }, { ...ctx, pageContext: page2 });
    expect(errors).toEqual([]);
    const byHand = Object.fromEntries(ops.filter((op) => !op.fromScheme).map((op) => [op.widgetId, op.set]));
    expect(byHand.slicer).toEqual({ slicerFontColor: '#111827' });
    expect(byHand.grid).toEqual({ tableConfig: { header: { fontBold: true }, rows: { striped: true } } });
    expect(byHand.byStatus).toEqual({ legendColors: { Lost: '#dc2626' } });
    expect(byHand.title).toBeUndefined();
  });

  test('a treemap keeps its labels, whatever the model thinks of clutter', () => {
    const { ops } = validateDesignProposal({
      summary: 's',
      ops: [
        { op: 'update_config', widgetId: 'ages', set: { showDataLabels: false, borderRadius: 4 } },
        { op: 'update_config', widgetId: 'share', set: { showDataLabels: false } },
      ],
    }, ctx);
    expect(ops).toEqual([
      { op: 'update_config', widgetId: 'ages', set: { borderRadius: 4 } },
      { op: 'update_config', widgetId: 'share', set: { showDataLabels: false } },
    ]);
  });

  test('an unknown rule is refused with the list, and prototype keys are not rules', () => {
    for (const name of ['okabe-ito', 'constructor', '__proto__']) {
      const { ops, errors, colorScheme } = validateDesignProposal({ summary: 's', colorScheme: name }, ctx);
      expect(ops).toEqual([]);
      expect(colorScheme).toBeNull();
      expect(errors[0]).toMatch(/unknown rule; use one of categorical, monochromatic/);
    }
  });

  test('a palette set by hand must be hex, all of it', () => {
    const ok = validateDesignProposal({ summary: 's', ops: [{ op: 'update_config', widgetId: 'share', set: { palette: ['#112233', '#445566'] } }] }, ctx);
    expect(ok.ops[0].set.palette).toEqual(['#112233', '#445566']);
    const bad = validateDesignProposal({ summary: 's', ops: [{ op: 'update_config', widgetId: 'share', set: { palette: ['#112233', 'url(x)'] } }] }, ctx);
    expect(bad.ops).toEqual([]);
  });
});
