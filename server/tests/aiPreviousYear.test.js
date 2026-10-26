// "2025 compared with 2024": the year before as a series of the same visual
// (compareDateDim on a line or a bar, drawn by client/src/utils/chartN1.js),
// never the two years in the legend over a month axis that already holds the
// year — 24 months with half a curve each, seen by Jonathan in Let's Talk.
const { validateWidgetsProposal } = require('../utils/ai/validateProposal');
const { dressWidget } = require('../utils/ai/dress');

const effective = {
  dimensions: [
    { name: 'cal.date', label: 'Date', table: 'cal', column: 'date', type: 'date' },
    { name: 'cal.date_year', label: 'Year', table: 'cal', column: 'date', type: 'integer', datePart: 'num_year' },
    { name: 'cal.date_year_month', label: 'Month', table: 'cal', column: 'date', type: 'string', datePart: 'year_month' },
    { name: 'calendrier.mois', label: 'Mois', table: 'calendrier', column: 'mois', type: 'string' },
    { name: 'cal.month_num', label: 'Month number', table: 'cal', column: 'date', type: 'integer', datePart: 'num_month' },
    { name: 'shops.region', label: 'Region', table: 'shops', column: 'region', type: 'string' },
  ],
  measures: [{ name: 'sales.amount_sum', label: 'Sales', table: 'sales', column: 'amount', aggregation: 'sum' }],
};
const ctx = { effective, page: { width: 1140, height: 800 }, pageContext: { pageWidth: 1140, pageHeight: 800, themes: ['light'], theme: 'light', widgets: [] }, mode: 'visuals', library: [], cardinality: {} };
const line = (binding, extra = {}) => ({ type: 'line', title: 'Sales', answers: 'trend', rationale: 'r', binding: { selectedMeasures: ['sales.amount_sum'], ...binding }, ...extra });

test('two years in the legend over a month that holds the year go back, naming compareDateDim', () => {
  for (const axis of ['cal.date_year_month', 'calendrier.mois', 'cal.date']) {
    const r = validateWidgetsProposal({ widgets: [line({ selectedDimensions: [axis], groupBy: ['cal.date_year'] })] }, ctx);
    expect(r.widgets).toHaveLength(0);
    expect(r.errors.join(' ')).toMatch(/compareDateDim/);
  }
});

test('the years in the legend over the month OF the year are fine: the months line up', () => {
  const r = validateWidgetsProposal({ widgets: [line({ selectedDimensions: ['cal.month_num'], groupBy: ['cal.date_year'] })] }, ctx);
  expect(r.errors).toEqual([]);
  expect(r.widgets).toHaveLength(1);
});

test('a line with compareDateDim is kept, with its legend; a date is required, and no legend beside it', () => {
  const ok = validateWidgetsProposal({ widgets: [line({ selectedDimensions: ['cal.date_year_month'], compareDateDim: 'cal.date' })] }, ctx);
  expect(ok.errors).toEqual([]);
  expect(ok.widgets[0].dataBinding.compareDateDim).toBe('cal.date');
  expect(ok.widgets[0].config.showLegend).toBe(true);

  const notADate = validateWidgetsProposal({ widgets: [line({ selectedDimensions: ['cal.date_year_month'], compareDateDim: 'shops.region' })] }, ctx);
  expect(notADate.errors.join(' ')).toMatch(/compareDateDim must be a date dimension/);
  const withLegend = validateWidgetsProposal({ widgets: [{ ...line({ selectedDimensions: ['cal.date_year_month'], groupBy: ['shops.region'], compareDateDim: 'cal.date' }), type: 'bar', answers: 'comparison' }] }, ctx);
  expect(withLegend.errors.join(' ')).toMatch(/no legend/);
});

test('dress: a bar with the year before shows its legend', () => {
  const w = dressWidget({ type: 'bar', config: {}, dataBinding: { selectedDimensions: ['shops.region'], selectedMeasures: ['sales.amount_sum'], compareDateDim: 'cal.date' } }, { effective, cardinality: {} });
  expect(w.config.showLegend).toBe(true);
});

test('a variance built on a measure of the year before is refused on a date axis, kept off it; compareMode does it by month', () => {
  const shifted = {
    ...effective,
    measures: [
      ...effective.measures,
      { name: '_calc.sales_n_1', label: 'Sales N-1', table: 'sales', column: 'amount', aggregation: 'sum', periodShift: { dim: 'cal.date', unit: 'year', n: -1 } },
      { name: '_calc.gap', label: 'Gap', table: '', column: '', aggregation: 'custom', expression: '(${sales.amount_sum}) - (${_calc.sales_n_1})' },
    ],
  };
  const c = { ...ctx, effective: shifted };
  const onMonths = validateWidgetsProposal({ widgets: [{ ...line({ selectedDimensions: ['cal.date_year_month'], selectedMeasures: ['_calc.gap'] }), type: 'bar', answers: 'comparison' }] }, c);
  expect(onMonths.errors.join(' ')).toMatch(/compareMode "difference"/);
  const byRegion = validateWidgetsProposal({ widgets: [{ ...line({ selectedDimensions: ['shops.region'], selectedMeasures: ['_calc.gap'] }), type: 'bar', answers: 'comparison' }] }, c);
  expect(byRegion.errors).toEqual([]);
  const gap = validateWidgetsProposal({ widgets: [{ ...line({ selectedDimensions: ['cal.date_year_month'], compareDateDim: 'cal.date', compareMode: 'difference' }), type: 'bar', answers: 'comparison' }] }, c);
  expect(gap.widgets[0].dataBinding.compareMode).toBe('difference');
});

// "Add columns of the change in % to the curve" (Jonathan): one combo — the
// lines keep the year and its N-1, the bars show the change.
test('a combo takes the year before too: compareMode is what its bars show', () => {
  const combo = {
    type: 'combo', title: 'Sales vs N-1', answers: 'trend', rationale: 'r',
    binding: { selectedDimensions: ['cal.date_year_month'], comboLineMeasures: ['sales.amount_sum'], comboBarMeasures: ['sales.amount_sum'], compareDateDim: 'cal.date', compareMode: 'change' },
  };
  const r = validateWidgetsProposal({ widgets: [combo] }, ctx);
  expect(r.errors).toEqual([]);
  expect(r.widgets[0].dataBinding).toMatchObject({ compareDateDim: 'cal.date', compareMode: 'change' });
  const legend = validateWidgetsProposal({ widgets: [{ ...combo, binding: { ...combo.binding, groupBy: ['shops.region'] } }] }, ctx);
  expect(legend.widgets).toHaveLength(0);
});
