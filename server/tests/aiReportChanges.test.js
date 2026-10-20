// The report changed as a whole from the studio (utils/ai/reportChanges.js):
// visuals added where they belong, replaced in their slot, removed, pages
// laid out again, added, renamed or removed — every visual checked as a
// propose_widgets answer, every page touched laid out by the server, the
// look untouched. Offered to the studio only.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));
const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { validateReportChanges } = require('../utils/ai/reportChanges');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });

const effective = {
  dimensions: [{ name: 'orders.country', label: 'Country', type: 'string' }, { name: 'orders.day', label: 'Day', type: 'date' }],
  measures: [{ name: 'orders.amount_sum', label: 'Amount', table: 'orders', column: 'amount', aggregation: 'sum' }],
};
const page = { width: 1140, height: 800 };
const W = (id, type, title, binding, layout) => ({ id, type, title, dataBinding: binding, layout, config: {}, shape: {}, merged: false });
const pageContext = {
  pageWidth: 1140, pageHeight: 800, themes: ['light', 'dark'], theme: 'light', pageBackground: null, palette: [],
  pageId: 'page-a', pageName: 'Overview',
  widgets: [
    W('w1', 'scorecard', 'Total', { selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 20, w: 280, h: 120 }),
    W('w2', 'bar', 'By country', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 160, w: 1100, h: 300 }),
  ],
  otherPages: [{ id: 'page-b', name: 'Detail', widgets: [W('7f3a1c2e-0000-4000-8000-000000000001', 'table', 'Rows', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] })] }],
};
const ctx = { effective, page, pageContext, mode: 'visuals', allowReport: true, library: [], cardinality: {}, canWriteVisuals: false };
const bar = { type: 'bar', answers: 'comparison', title: 'Amount by country', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };
const line = { type: 'line', answers: 'trend', title: 'Amount over time', rationale: 'r', binding: { selectedDimensions: ['orders.day'], selectedMeasures: ['orders.amount_sum'] } };

test('a visual added where the model says: the page laid out again from its rows', () => {
  const r = validateReportChanges({ summary: 'Trend added.', pages: [{ page: 'p1', add: [line], rows: [{ widgets: ['w1'] }, { widgets: ['w2', 'n1'] }] }] }, ctx);
  expect(r.errors).toEqual([]);
  expect(r.payload.kind).toBe('reportChanges');
  const [p] = r.payload.pages;
  expect(p).toMatchObject({ shown: true, pageId: 'page-a', isNew: false, remove: false, rename: null });
  expect(p.add).toHaveLength(1);
  expect(p.add[0]).toMatchObject({ type: 'line', config: { title: 'Amount over time' } });
  // Second row: the bar and the line side by side, under the scorecard.
  expect(p.add[0].layout.y).toBeGreaterThan(20);
  expect(p.moves.map((m) => m.widgetId).sort()).toEqual(['w1', 'w2']);
  const w2 = p.moves.find((m) => m.widgetId === 'w2');
  expect(w2.y).toBe(p.add[0].layout.y);
  expect(w2.x + w2.w).toBeLessThanOrEqual(p.add[0].layout.x);
  expect(r.payload.pageHeight).toBe(800);
});

test('replaced in its slot, removed, and a visual added with no place lands at the end of the page, nothing else moving', () => {
  const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', replace: [{ widgetId: 'w2', with: line }], removeWidgets: ['w1'], add: [bar] }] }, ctx);
  expect(r.errors).toEqual([]);
  const [p] = r.payload.pages;
  expect(p.removeWidgets).toEqual(['w1']);
  expect(p.replace).toHaveLength(1);
  expect(p.replace[0]).toMatchObject({ widgetId: 'w2', widget: { type: 'line' } });
  expect(p.replace[0].widget.layout).toBeFalsy();
  // The page keeps its layout: the added bar goes under everything, at a comfortable size.
  expect(p.moves).toEqual([]);
  expect(p.laidOut).toBe(false);
  expect(p.add[0].layout).toMatchObject({ x: 20, y: 160 + 300 + 20 });
  expect(p.add[0].layout.w).toBeGreaterThanOrEqual(280);
  expect(p.add[0]).not.toHaveProperty('place');
  expect(p.add[0]).not.toHaveProperty('minSize');
  // The page grows to hold it.
  expect(r.payload.pageHeight).toBe(480 + p.add[0].layout.h + 20);
});

test('a visual set into the page where the proposal places it: beside, under, over — only what makes room moves', () => {
  const filter = { type: 'filter', answers: 'filter', title: 'Country', rationale: 'r', binding: { selectedDimensions: ['orders.country'] } };
  // Right of the scorecard: the row has room, nothing moves.
  const right = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...filter, place: { near: 'w1', side: 'right' } }] }] }, ctx);
  expect(right.errors).toEqual([]);
  expect(right.payload.pages[0].moves).toEqual([]);
  expect(right.payload.pages[0].add[0].layout).toMatchObject({ x: 320, y: 20, h: 120 });
  expect(right.payload.pageHeight).toBe(800);
  // Under the scorecard: the bar below slides down by the new row.
  const below = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...line, place: { near: 'w1', side: 'below' } }] }] }, ctx);
  expect(below.errors).toEqual([]);
  const added = below.payload.pages[0].add[0].layout;
  expect(added).toMatchObject({ x: 20, y: 160, w: 280 });
  expect(below.payload.pages[0].moves).toEqual([{ op: 'move', widgetId: 'w2', x: 20, y: 160 + added.h + 20, w: 1100, h: 300 }]);
  expect(below.payload.pages[0].laidOut).toBe(false);
  // Over the bar: same slide, the new one at the bar's place.
  const above = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...bar, place: { near: 'w2', side: 'above' } }] }] }, ctx);
  expect(above.payload.pages[0].add[0].layout).toMatchObject({ x: 20, y: 160, w: 1100 });
  expect(above.payload.pages[0].moves[0]).toMatchObject({ widgetId: 'w2', y: 160 + above.payload.pages[0].add[0].layout.h + 20 });
  // A full row shares its width again, each in proportion, floors kept: two figures across the page and a filter asked right of the second.
  const full = { ...ctx, pageContext: { ...pageContext, widgets: [
    W('w1', 'scorecard', 'Total', { selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 20, w: 540, h: 120 }),
    W('w2', 'scorecard', 'Count', { selectedMeasures: ['orders.amount_sum'] }, { x: 580, y: 20, w: 540, h: 120 }),
    W('w3', 'bar', 'By country', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 160, w: 1100, h: 300 }),
  ] } };
  const shared = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...filter, place: { near: 'w2', side: 'right' } }] }] }, full);
  expect(shared.errors).toEqual([]);
  const row = [...shared.payload.pages[0].moves.map((m) => ({ id: m.widgetId, ...m })), { id: 'n1', ...shared.payload.pages[0].add[0].layout }].sort((a, b) => a.x - b.x);
  expect(row.map((c) => c.id)).toEqual(['w1', 'w2', 'n1']);
  expect(row.every((c) => c.y === 20)).toBe(true);
  expect(row[2].x + row[2].w).toBeLessThanOrEqual(1120);
  expect(row[0].w).toBeGreaterThanOrEqual(140);
  // The bar under them did not move.
  expect(shared.payload.pages[0].moves.some((m) => m.widgetId === 'w3')).toBe(false);
  // Under a widget with room beneath it (nothing in its column): set there, nothing moves.
  const roomy = { ...ctx, pageContext: { ...pageContext, widgets: [
    W('w1', 'scorecard', 'Total', { selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 20, w: 280, h: 120 }),
    W('w2', 'bar', 'By country', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, { x: 320, y: 20, w: 800, h: 300 }),
  ] } };
  const under = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...filter, place: { near: 'w1', side: 'below' } }] }] }, roomy);
  expect(under.payload.pages[0].moves).toEqual([]);
  expect(under.payload.pages[0].add[0].layout).toMatchObject({ x: 20, y: 160, w: 280 });
  // Under a filter whose card is mostly empty: the card is split, the new filter takes its bottom — the
  // page around them does not move (Jonathan: "you add it, you do not touch the rest").
  const tall = { ...ctx, pageContext: { ...pageContext, widgets: [
    W('w1', 'scorecard', 'Total', { selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 20, w: 780, h: 200 }),
    { ...W('w2', 'filter', 'Month', { selectedDimensions: ['orders.day'] }, { x: 820, y: 20, w: 300, h: 200 }), shape: { slicerStyle: 'dropdown' } },
    W('w3', 'bar', 'By country', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 240, w: 1100, h: 300 }),
  ] } };
  const split = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...filter, place: { near: 'w2', side: 'below' } }] }] }, tall);
  expect(split.errors).toEqual([]);
  expect(split.payload.pages[0].moves).toEqual([{ op: 'move', widgetId: 'w2', x: 820, y: 20, w: 300, h: 90 }]);
  expect(split.payload.pages[0].add[0].layout).toEqual({ x: 820, y: 130, w: 300, h: 90 });
  expect(split.payload.pageHeight).toBe(800);
  // A place the page has not (a removed widget, an addition still to come) means the end of the page.
  const nowhere = validateReportChanges({ summary: 's', pages: [{ page: 'p1', removeWidgets: ['w1'], add: [{ ...bar, place: { near: 'n2', side: 'right' } }, { ...line, place: { near: 'w1', side: 'below' } }] }] }, ctx);
  expect(nowhere.errors).toEqual([]);
  expect(nowhere.payload.pages[0].moves).toEqual([]);
  expect(nowhere.payload.pages[0].add.every((w) => w.layout.y >= 480)).toBe(true);
});

test('only removals or replacements: the layout stays', () => {
  const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', removeWidgets: ['w1'] }] }, ctx);
  expect(r.errors).toEqual([]);
  expect(r.payload.pages[0].moves).toEqual([]);
});

test('a new page is laid out like a page of a report; a page can be renamed or removed', () => {
  const r = validateReportChanges({ summary: 's', pages: [
    { page: 'new', name: 'Trends', add: [line, bar] },
    { page: 'p2', name: 'Detailed rows' },
    { page: 'p1', remove: true },
  ] }, ctx);
  expect(r.errors).toEqual([]);
  const [added, renamed, removed] = r.payload.pages;
  expect(added).toMatchObject({ isNew: true, pageId: null, name: 'Trends' });
  // A line takes a row of its own, the bar the next one.
  expect(added.add[0].layout.y).toBe(20);
  expect(added.add[1].layout.y).toBeGreaterThan(added.add[0].layout.y);
  expect(renamed).toMatchObject({ pageId: 'page-b', shown: false, rename: 'Detailed rows' });
  expect(removed).toMatchObject({ pageId: 'page-a', shown: true, remove: true });
});

test('what is refused, and said: unknown page or widget, rows that leave a widget out, nothing to change', () => {
  const unknown = validateReportChanges({ summary: 's', pages: [{ page: 'p9', add: [bar] }, { page: 'p1', removeWidgets: ['w7'] }] }, ctx);
  expect(unknown.payload).toBeNull();
  expect(unknown.errors).toEqual([
    expect.stringMatching(/Page 1: page must be "p1"/),
    expect.stringMatching(/Page 2: removeWidgets: no widget "w7"/),
    expect.stringMatching(/Page 2: nothing changes/),
  ]);
  const partial = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [line], rows: [{ widgets: ['w1', 'n1'] }] }] }, ctx);
  // Rows that leave a widget out, or do not fit: set aside, said as a warning, the new visuals set into the page as it is — nothing added is lost.
  expect(partial.errors).toEqual([]);
  expect(partial.warnings[0]).toMatch(/rows were not used \(rows leave out "w2"\); the new visuals were set into the page as it is/);
  expect(partial.payload.pages[0].add).toHaveLength(1);
  expect(partial.payload.pages[0].add[0].layout.y).toBeGreaterThanOrEqual(480);
  expect(partial.payload.pages[0].moves).toEqual([]);
  expect(partial.payload.pages[0].laidOut).toBe(false);
  // Rows for the page as it is, unusable: the page is laid out again.
  const rearranged = validateReportChanges({ summary: 's', pages: [{ page: 'p1', rows: [{ widgets: ['w1'] }] }] }, ctx);
  expect(rearranged.warnings[0]).toMatch(/the page was laid out again by the app/);
  expect(rearranged.payload.pages[0].laidOut).toBe(true);
  expect(rearranged.payload.pages[0].moves.map((m) => m.widgetId).sort()).toEqual(['w1', 'w2']);
  const crowded = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: Array.from({ length: 6 }, (_, i) => ({ type: 'scorecard', answers: 'figure', title: `KPI ${i}`, rationale: 'r', binding: { selectedMeasures: ['orders.amount_sum'] } })), rows: [{ widgets: ['w1', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'w2'] }] }] }, ctx);
  expect(crowded.errors).toEqual([]);
  expect(crowded.warnings[0]).toMatch(/do not fit side by side/);
  expect(crowded.payload.pages[0].add).toHaveLength(6);
  const wrongField = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...bar, binding: { selectedDimensions: ['orders.nope'], selectedMeasures: ['orders.amount_sum'] } }] }] }, ctx);
  expect(wrongField.errors[0]).toMatch(/Page 1: Widget 1/);
  expect(validateReportChanges({ summary: 's', pages: [] }, ctx).errors[0]).toMatch(/nothing to change/);
});

test('a trend on a period written as text (the calendar\'s YearMonth) is a trend, drawn as a line', () => {
  const months = { ...ctx, effective: { ...effective, dimensions: [...effective.dimensions, { name: 'calendar.YearMonth', table: 'calendar', column: 'YearMonth', label: 'Month', type: 'string' }] } };
  const trend = { type: 'line', answers: 'trend', title: 'Cash by month', rationale: 'r', binding: { selectedDimensions: ['calendar.YearMonth'], selectedMeasures: ['orders.amount_sum'] } };
  const r = validateReportChanges({ summary: 's', pages: [{ page: 'new', name: 'Cash', add: [trend] }] }, months);
  expect(r.errors).toEqual([]);
  expect(r.payload.pages[0].add[0].type).toBe('line');
});

test('a new visual dresses like its neighbours of the same type on the page it joins', () => {
  const figures = { ...ctx, pageContext: { ...pageContext, widgets: [
    { ...W('w1', 'scorecard', '', { selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 20, w: 280, h: 120 }), config: { valueSize: 28, labelSize: 14, transparentBg: true, borderEnabled: false, titleColor: '#aabbcc' } },
    { ...W('w2', 'bar', 'By country', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 160, w: 1100, h: 300 }), config: { title: 'By country', showLegend: false, legendPosition: 'bottom', legendColors: { Amount: '#ff0000' }, xAxisTitle: 'Countries' } },
  ] } };
  const card = { type: 'scorecard', answers: 'figure', title: 'Écart résultat net', rationale: 'r', binding: { selectedMeasures: ['orders.amount_sum'] } };
  const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [card, { ...bar, config: { showLegend: true } }] }] }, figures);
  expect(r.errors).toEqual([]);
  const [added, chart] = r.payload.pages[0].add;
  // Beside figures without a title bar, the name becomes the label; their sizes and frame follow.
  expect(added.config).toMatchObject({ label: 'Écart résultat net', valueSize: 28, labelSize: 14, transparentBg: true, borderEnabled: false });
  expect(added.config.title).toBeUndefined();
  // A chart keeps its own words and series colours; the legend place follows its neighbour, a key it set stays its own.
  expect(chart.config).toMatchObject({ title: 'Amount by country', legendPosition: 'bottom' });
  expect(chart.config.xAxisTitle).toBeUndefined();
  expect((chart.config.legendColors || {}).Amount).toBeUndefined();
  // A new page follows the page shown.
  const fresh = validateReportChanges({ summary: 's', pages: [{ page: 'new', name: 'N', add: [card] }] }, figures);
  expect(fresh.payload.pages[0].add[0].config.title).toBeUndefined();
  // With no neighbour of its type, the card keeps its title.
  const alone = validateReportChanges({ summary: 's', pages: [{ page: 'new', name: 'N', add: [card] }] }, ctx);
  expect(alone.payload.pages[0].add[0].config.title).toBe('Écart résultat net');
  // Only neighbours that LOOK like it: a figure with its comparison beside plain figures, a two-series
  // chart beside a single-series one, are unlike them — the proposal's own choices stand (Jonathan:
  // the same format as the visuals that resemble it; for the others, the model decides).
  const compared = { ...card, binding: { selectedMeasures: ['orders.amount_sum'], compareDateDim: 'orders.day' } };
  const twoSeries = { ...bar, binding: { selectedDimensions: ['orders.country', 'orders.day'], selectedMeasures: ['orders.amount_sum'] } };
  const unlike = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [compared, twoSeries] }] }, figures);
  expect(unlike.errors).toEqual([]);
  const [figure, series] = unlike.payload.pages[0].add;
  expect(figure.config.title).toBe('Écart résultat net');
  expect(figure.config.valueSize).toBeUndefined();
  // Not the neighbour's legend place (bottom): the default for several series.
  expect(series.config.showLegend).toBe(true);
  expect(series.config.legendPosition).toBe('top');
});

test('the look is never the proposal\'s: a new visual takes the theme, a replacement carries no frame', () => {
  const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [{ ...bar, config: { backgroundColor: '#ff0000', titleColor: '#00ff00' } }] }] }, ctx);
  const [w] = r.payload.pages[0].add;
  expect(w.config.backgroundColor).toBeUndefined();
  expect(w.config.titleColor).toBeUndefined();
});

describe('measures defined from the conversation', () => {
  const budget = { name: 'budget.amount_sum', label: 'Budget', table: 'budget', column: 'amount', aggregation: 'sum', format: { decimals: 0 } };
  const withBudget = { ...ctx, effective: { ...effective, measures: [...effective.measures, budget], dimensions: [...effective.dimensions, { name: 'orders.statement', label: 'Statement', type: 'string' }] } };

  test('a variance, a ratio, a filtered figure and a running total become model measures, usable by the visuals of the same call', () => {
    const r = validateReportChanges({
      summary: 's',
      measures: [
        { label: 'Écart réel budget', kind: 'arithmetic', op: 'subtract', left: 'orders.amount_sum', right: 'budget.amount_sum', description: 'Actual minus budget' },
        { label: 'Écart %', kind: 'arithmetic', op: 'percent', left: '_calc.ecart_reel_budget', right: 'budget.amount_sum' },
        { label: 'Actual P&L', kind: 'filtered', from: 'orders.amount_sum', filters: [{ field: 'orders.statement', op: 'in', values: ['Income statement'] }] },
        { label: 'Cash balance', kind: 'cumulative', from: 'orders.amount_sum' },
        { label: 'Panier moyen', kind: 'aggregate', from: 'orders.amount_sum', aggregation: 'avg' },
        { label: 'Commandes', kind: 'aggregate', from: 'orders.amount_sum', aggregation: 'count' },
      ],
      pages: [{ page: 'new', name: 'Budget', add: [{ type: 'table', answers: 'detail', title: 'By account', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum', 'budget.amount_sum', '_calc.ecart_reel_budget', '_calc.ecart'] } }] }],
    }, withBudget);
    expect(r.errors).toEqual([]);
    const [variance, pct, filtered, running, mean, rows] = r.payload.measures;
    expect(mean).toMatchObject({ name: '_calc.panier_moyen', table: 'orders', column: 'amount', aggregation: 'avg' });
    expect(rows).toMatchObject({ name: '_calc.commandes', table: 'orders', column: 'amount', aggregation: 'count' });
    expect(variance).toEqual({ name: '_calc.ecart_reel_budget', label: 'Écart réel budget', table: '', column: '', aggregation: 'custom', expression: '(${orders.amount_sum}) - (${budget.amount_sum})', format: { decimals: 0 }, description: 'Actual minus budget' });
    expect(pct).toMatchObject({ name: '_calc.ecart', aggregation: 'custom', expression: '100.0 * (${_calc.ecart_reel_budget}) / NULLIF((${budget.amount_sum}), 0)', format: { decimals: 1, suffix: ' %' } });
    expect(filtered).toMatchObject({ name: '_calc.actual_p_l', table: 'orders', column: 'amount', aggregation: 'sum', filterRules: [{ field: 'orders.statement', isMeasure: false, op: 'in', values: ['Income statement'] }], overrideFilters: false });
    expect(running).toMatchObject({ name: '_calc.cash_balance', table: 'orders', column: 'amount', aggregation: 'sum', runningTotal: true });
    expect(r.payload.pages[0].add[0].dataBinding.selectedMeasures).toEqual(['orders.amount_sum', 'budget.amount_sum', '_calc.ecart_reel_budget', '_calc.ecart']);
  });

  test('what is refused, and said: unknown measures, a running total of a computed measure, a name already taken', () => {
    const r = validateReportChanges({ summary: 's', measures: [
      { label: 'Bad', kind: 'arithmetic', op: 'subtract', left: 'orders.nope', right: 'budget.amount_sum' },
      { label: 'Also bad', kind: 'cumulative', from: '_calc.nothing' },
      { label: 'Median', kind: 'aggregate', from: 'orders.amount_sum', aggregation: 'median' },
      { label: 'Amount', kind: 'filtered', from: 'orders.amount_sum', filters: [{ field: 'orders.statement', op: 'in', values: ['x'] }] },
    ], pages: [] }, withBudget);
    expect(r.errors[0]).toMatch(/Measure 1: left and right must be measure names.*orders.nope/);
    expect(r.errors[1]).toMatch(/Measure 2: from must be a measure name/);
    expect(r.errors[2]).toMatch(/Measure 3: aggregation must be one of sum, avg/);
    // A label already used by the schema gets a free name of its own.
    expect(r.payload.measures[0].name).toBe('_calc.amount');
    expect(r.payload.pages).toEqual([]);
  });

  test('the report can be renamed, alone', () => {
    const r = validateReportChanges({ summary: 's', title: 'Maison Verdier', pages: [] }, ctx);
    expect(r.errors).toEqual([]);
    expect(r.payload).toMatchObject({ kind: 'reportChanges', title: 'Maison Verdier', pages: [], measures: [] });
  });
});

describe('on the report chat', () => {
  let owner, reportId;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    const model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: effective.dimensions, measures: effective.measures });
    reportId = seedReport({ userId: owner, modelId: model });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const send = (body) => request(app).post(`/api/ai/reports/${reportId}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'Add the trend next to the bar' }], pageContext, ...body });

  test('the studio is offered the tool, told the pages, and gets the card with real ids', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_report_changes', { reading: { scope: 'precise' }, summary: 'Trend added.', pages: [{ page: 'p1', add: [line], rows: [{ widgets: ['w1'] }, { widgets: ['w2', 'n1'] }] }] }));
    const res = await send({ studio: true });
    expect(res.status).toBe(200);
    const { system, tools } = providers.chat.mock.calls[0][0];
    expect(tools.map((t) => t.name)).toContain('propose_report_changes');
    expect(system).toContain('Pages: p1 = "Overview" (shown), p2 = "Detail".');
    expect(system).toContain('propose_report_changes');
    expect(system).toContain('its look with `propose_design_changes`');
    expect(res.body.proposals[0].kind).toBe('reportChanges');
    expect(res.body.proposals[0].pages[0].moves.map((m) => m.widgetId).sort()).toEqual(['w1', 'w2']);
  });

  test('the editor is not offered it, and a call anyway is refused', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_report_changes', { reading: { scope: 'precise' }, summary: 's', pages: [{ page: 'p1', add: [line] }] }))
      .mockResolvedValueOnce({ text: 'Done.', toolCalls: [], usage: null });
    const res = await send({});
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name)).not.toContain('propose_report_changes');
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/not available here|propose_widgets/);
    expect(res.body.proposals).toEqual([]);
  });
});

describe('a band set over the page', () => {
  const band = { answers: 'decor', title: '', rationale: 'r', binding: {}, type: 'text', text: 'Stocks 2025', layout: { x: 20, y: 20, w: 1100, h: 60 } };
  test('a title band across the top pushes the visuals it covers down, together', () => {
    const { payload } = validateReportChanges({ reading: { scope: 'view' }, summary: 's', pages: [{ page: 'p1', add: [band] }] }, ctx);
    const [p] = payload.pages;
    expect(p.add[0].layout).toMatchObject({ x: 20, y: 20, h: 60 });
    const at = Object.fromEntries(p.moves.map((m) => [m.widgetId, m.y]));
    // The figure goes under the band; the bar keeps its distance to the figure.
    expect(at).toEqual({ w1: 100, w2: 240 });
  });
  test('a shape keeps its place: a background sits under the visuals', () => {
    const shape = { ...band, type: 'shape', shape: 'rectangle', fill: '#EEEEEE', text: undefined };
    const { payload } = validateReportChanges({ reading: { scope: 'view' }, summary: 's', pages: [{ page: 'p1', add: [shape] }] }, ctx);
    expect(payload.pages[0].moves).toEqual([]);
  });
});

// Another page's layout reaches the server (never the prompt): a visual added
// there is set under what it holds. Without it the page looked empty of
// places and every try failed (heatmap on Moreau's "Charge des agences").
test('a visual added to another page lands under what that page holds', () => {
  const laidOut = { ...pageContext, otherPages: [{ id: 'page-b', name: 'Detail', widgets: [W('t1', 'table', 'Rows', { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, { x: 20, y: 20, w: 1100, h: 400 })] }] };
  const r = validateReportChanges({ summary: 's', pages: [{ page: 'p2', add: [bar] }] }, { ...ctx, pageContext: laidOut });
  expect(r.errors).toEqual([]);
  const [p] = r.payload.pages;
  expect(p.add[0].layout.y).toBeGreaterThanOrEqual(420);
  expect(p.moves).toEqual([]);
});

test('a page laid out again keeps its logo at the width it had', () => {
  const withLogo = { ...pageContext, widgets: [W('logo', 'image', '', {}, { x: 20, y: 20, w: 160, h: 60 }), ...pageContext.widgets.map((w) => ({ ...w, layout: { ...w.layout, y: w.layout.y + 80 } }))] };
  const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', rows: [{ widgets: ['logo'] }, { widgets: ['w1'] }, { widgets: ['w2'] }] }] }, { ...ctx, pageContext: withLogo });
  expect(r.errors).toEqual([]);
  const logo = r.payload.pages[0].moves.find((m) => m.widgetId === 'logo');
  expect(logo ? logo.w : 160).toBeLessThanOrEqual(160);
});
