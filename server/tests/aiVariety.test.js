// Reports that do not all look alike (Jonathan: "chacun de tes rapports se
// ressemble"): a composition per page, a wider vocabulary held to the
// question, a declared style direction for a whole look.
const { layoutNew, COMPOSITIONS } = require('../utils/ai/arrangeLayout');
const { validateWidgetsProposal, validateDesignProposal, DESIGN_CONFIG } = require('../utils/ai/validateProposal');

const page = { width: 1140, height: 800 };
const effective = {
  dimensions: [{ name: 't.month', label: 'Month', type: 'string', datePart: 'year_month', table: 't', column: 'd' }, { name: 't.region', label: 'Region', type: 'string' }, { name: 't.stage', label: 'Stage', type: 'string' }],
  measures: [{ name: 't.sales', label: 'Sales', aggregation: 'sum', format: { decimals: 0 } }, { name: 't.target', label: 'Target', aggregation: 'sum', format: { decimals: 0 } }],
};
const W = (type, extra = {}) => ({ type, config: { title: type }, dataBinding: {}, ...extra });
const page4 = [W('scorecard'), W('scorecard'), W('line'), W('bar'), W('bar'), W('table')];
const boxes = (ws) => ws.map((w) => w.layout);

describe('a composition per page', () => {
  test('hero: the first chart leads on two thirds, the figures stand in a column beside it', () => {
    const [a, b, lead] = boxes(layoutNew(page4, page, effective, 'hero'));
    expect(lead.w).toBeGreaterThan(700);
    expect(a.x).toBeGreaterThan(lead.x + lead.w - 1);
    expect(b.y).toBeGreaterThan(a.y);
    expect(a.y).toBe(lead.y);
  });
  test('sidebar: figures in a left column, charts down the right', () => {
    const ls = boxes(layoutNew(page4, page, effective, 'sidebar'));
    expect(ls[0].x).toBe(20);
    expect(ls[0].w).toBe(280);
    expect(ls.slice(2).every((l) => l.x === 320)).toBe(true);
  });
  test('focus: one tall chart across, the others three in a row', () => {
    const ls = boxes(layoutNew(page4, page, effective, 'focus'));
    expect(ls[2]).toMatchObject({ x: 20, w: 1100 });
    expect(ls[2].h).toBeGreaterThanOrEqual(420);
    expect(new Set(ls.slice(3).map((l) => l.y)).size).toBe(1);
  });
  test('grid: tables in pairs too; a composition with nothing to hold falls back to the standard one', () => {
    const ls = boxes(layoutNew(page4, page, effective, 'grid'));
    expect(ls[5].w).toBeLessThan(1100);
    expect(boxes(layoutNew([W('line'), W('bar')], page, effective, 'hero'))).toEqual(boxes(layoutNew([W('line'), W('bar')], page, effective)));
    expect(COMPOSITIONS).toEqual(['standard', 'hero', 'sidebar', 'grid', 'focus']);
  });
});

describe('the vocabulary held to the question', () => {
  const ctx = { effective, page, pageContext: { pageWidth: 1140, pageHeight: 800, widgets: [], themes: ['light'], theme: 'light' }, mode: 'visuals', library: [], cardinality: {} };
  test('a conversion is a funnel; a ranking reads down horizontal bars', () => {
    const r = validateWidgetsProposal({ widgets: [
      { type: 'pie', answers: 'conversion', title: 'Entonnoir', rationale: 'r', binding: { selectedDimensions: ['t.stage'], selectedMeasures: ['t.sales'] } },
      { type: 'bar', answers: 'ranking', title: 'Top régions', rationale: 'r', binding: { selectedDimensions: ['t.region'], selectedMeasures: ['t.sales'] } },
    ] }, ctx);
    expect(r.errors).toEqual([]);
    expect(r.widgets[0].config.subType).toBe('funnel');
    expect(r.widgets[1].config.barDirection).toBe('horizontal');
  });
  test('a target over time may be a combo of actual and target', () => {
    const r = validateWidgetsProposal({ widgets: [{ type: 'combo', answers: 'target', title: 'Réel et objectif', rationale: 'r', binding: { selectedDimensions: ['t.month'], comboBarMeasures: ['t.sales'], comboLineMeasures: ['t.target'] } }] }, ctx);
    expect(r.warnings.join(' ')).not.toMatch(/does not answer/);
  });
  test('a pivot heatmap is a look the designer sets', () => {
    expect(DESIGN_CONFIG.heatmap({ enabled: true, color: '#c2410c', extra: 1 })).toEqual({ enabled: true, color: '#c2410c' });
  });
});

describe('a whole look names its direction', () => {
  const ctx = (style) => ({
    page, style, scope: { layout: true, scheme: true, theme: true },
    pageContext: { theme: 'light', themes: ['light'], pageWidth: 1140, pageHeight: 800, widgets: [{ id: 'w1', type: 'bar', title: 'b', dataBinding: { selectedDimensions: ['t.region'], selectedMeasures: ['t.sales'] }, layout: { x: 20, y: 20, w: 500, h: 300 }, config: {} }], pageId: 'a', otherPages: [] },
    effective,
  });
  const look = { summary: 's', colorScheme: 'complementary', baseColor: '#1d4ed8', ops: [{ op: 'report_settings', set: { surroundColor: '#eef2ff' } }] };
  test('without reading.style it goes back once; with one it passes', () => {
    expect(validateDesignProposal(look, ctx(null)).warnings.join(' ')).toMatch(/declares its direction in reading.style/);
    expect(validateDesignProposal(look, ctx('corporate')).warnings.join(' ')).not.toMatch(/reading.style/);
  });
});

describe('a whole report that does not repeat itself', () => {
  const { sameEverywhere } = require('../utils/ai/agent');
  const pages = (types) => types.map((list) => ({ widgets: list.map((type) => ({ type })) }));
  test('three pages with one composition and bars, lines and figures only go back once', () => {
    const plain = pages([['scorecard', 'line'], ['bar', 'table'], ['scorecard', 'bar']]);
    const warnings = sameEverywhere([{}, {}, {}], plain);
    expect(warnings.join(' ')).toMatch(/same composition/);
    expect(warnings.join(' ')).toMatch(/only with bars, lines/);
    const varied = pages([['gauge', 'combo'], ['bar', 'pivotTable'], ['pie', 'bar']]);
    expect(sameEverywhere([{ composition: 'hero' }, { composition: 'grid' }, {}], varied)).toEqual([]);
    expect(sameEverywhere([{}, {}], plain.slice(0, 2))).toEqual([]);
  });
});

describe('a heatmap and a map among the built-in visuals', () => {
  const geo = {
    dimensions: [...effective.dimensions, { name: 't.city', label: 'Ville', type: 'string' }],
    measures: effective.measures,
  };
  const ctx = { effective: geo, page, pageContext: { pageWidth: 1140, pageHeight: 800, widgets: [], themes: ['light'], theme: 'light' }, mode: 'visuals', library: [], cardinality: {} };
  test('a heatmap crosses its columns and its rows; a map takes one place', () => {
    const r = validateWidgetsProposal({ widgets: [
      { type: 'heatmap', answers: 'crossed', title: 'Ventes par région et mois', rationale: 'r', binding: { selectedDimensions: ['t.month'], groupBy: ['t.region'], selectedMeasures: ['t.sales'] } },
      { type: 'map', answers: 'where', title: 'Ventes par ville', rationale: 'r', binding: { selectedDimensions: ['t.city'], selectedMeasures: ['t.sales', 't.target'] } },
    ] }, ctx);
    expect(r.errors).toEqual([]);
    expect(r.widgets[1].dataBinding.selectedMeasures).toEqual(['t.sales']);
    const bad = validateWidgetsProposal({ widgets: [{ type: 'heatmap', answers: 'crossed', title: 'x', rationale: 'r', binding: { selectedDimensions: ['t.month'], selectedMeasures: ['t.sales'] } }] }, ctx);
    expect(bad.errors.join(' ')).toMatch(/one in groupBy/);
  });
  test('their scale is a look the designer sets', () => {
    expect(DESIGN_CONFIG.scaleColor('#0f766e')).toBe('#0f766e');
    expect(DESIGN_CONFIG.cellGap(30)).toBe(8);
  });
});

describe('the color rule reaches a heatmap and a map', () => {
  const { colorOps } = require('../utils/ai/colorScheme');
  test('a scale of the accent toward the card, parted by the card color', () => {
    const pc = (theme) => ({ theme, widgets: [{ id: 'h', type: 'heatmap', dataBinding: {} }, { id: 'm', type: 'map', dataBinding: {} }] });
    const [h, m] = colorOps('categorical', '#d97706', pc('dark'));
    expect(h.set).toMatchObject({ scaleColor: expect.any(String), cellBorderColor: '#111827' });
    expect(m.set).toMatchObject({ mapBorderColor: '#111827', mapEmptyColor: '#334155' });
    // On a dark card the low end is dark, never a pale tint over white.
    expect(parseInt(h.set.scaleLowColor.slice(1, 3), 16)).toBeLessThan(80);
  });
});

describe('titles and captions are placed, not only colored', () => {
  test('alignment, size, weight and position of a title are the designer\'s', () => {
    expect(DESIGN_CONFIG.titleAlign('center')).toBe('center');
    expect(DESIGN_CONFIG.titlePosition('bottom')).toBe('bottom');
    expect(DESIGN_CONFIG.titlePosition('middle')).toBeUndefined();
    expect(DESIGN_CONFIG.titleFontSize(40)).toBe(28);
    expect(DESIGN_CONFIG.titleWeight(700)).toBe(700);
  });
});

describe('what stands out is the designer\'s', () => {
  test('a highlight by a rule on what is shown, or by naming categories', () => {
    expect(DESIGN_CONFIG.highlight({ mode: 'above', above: 50, color: '#c2410c', label: true })).toEqual({ enabled: true, mode: 'above', above: 50, color: '#c2410c', label: true });
    expect(DESIGN_CONFIG.highlight({ mode: 'values', values: ['2025-06', 7] })).toEqual({ enabled: true, mode: 'values', values: ['2025-06', '7'] });
    expect(DESIGN_CONFIG.highlight(false)).toEqual({ enabled: false });
    expect(DESIGN_CONFIG.highlight({ mode: 'everything' })).toBeUndefined();
  });
});
