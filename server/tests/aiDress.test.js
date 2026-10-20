// What a visual made by the assistant looks like when the proposal says
// nothing about it, and where the summaries of a new page land.
const { dressWidget, formatOverrides, matchNeighbours } = require('../utils/ai/dress');
const { validateWidgetsProposal } = require('../utils/ai/validateProposal');
const { layoutNew } = require('../utils/ai/arrangeLayout');

const effective = {
  dimensions: [{ name: 'd.country', label: 'Country', type: 'string' }, { name: 'd.day', label: 'Day', type: 'date' }],
  measures: [
    { name: 'm.sale', label: 'sale_price', aggregation: 'sum', role: 'sales.revenue' },
    { name: 'm.avg', label: 'Average basket', aggregation: 'avg', format: { decimals: 2 } },
  ],
};
const widget = (type, dataBinding, config = {}) => ({ type, config, dataBinding });

describe('dressWidget', () => {
  test('a card is named by the label, a single-series bar has no legend and sorts by value, time keeps its order', () => {
    expect(dressWidget(widget('scorecard', { selectedMeasures: ['m.sale'], compareDateDim: 'd.day' }), { effective }).config)
      .toEqual({ label: 'sale_price', showN1Percent: true, showN1Difference: false, showN1Value: false });
    expect(dressWidget(widget('bar', { selectedDimensions: ['d.country'], selectedMeasures: ['m.sale'] }), { effective, cardinality: { 'd.country': { n: 8 } } }).config)
      .toEqual({ valueAbbreviation: 'auto', showLegend: false, legendPosition: 'top', sortOrder: 'desc', showDataLabels: true });
    expect(dressWidget(widget('bar', { selectedDimensions: ['d.day'], selectedMeasures: ['m.sale'], groupBy: ['d.country'] }), { effective }).config)
      .toEqual({ valueAbbreviation: 'auto', showLegend: true, legendPosition: 'top' });
  });

  test('what the proposal set stays; filters become dropdowns named by the field; tables align their amounts', () => {
    expect(dressWidget(widget('bar', { selectedDimensions: ['d.country'], selectedMeasures: ['m.sale'] }, { sortOrder: 'asc', legendPosition: 'bottom' }), { effective }).config)
      .toMatchObject({ sortOrder: 'asc', legendPosition: 'bottom' });
    expect(dressWidget(widget('filter', { selectedDimensions: ['d.country'] }), { effective }).config).toEqual({ slicerStyle: 'dropdown', title: 'Country' });
    expect(dressWidget(widget('table', { selectedDimensions: ['d.country'], selectedMeasures: ['m.sale'] }), { effective }).config.tableConfig.columns.sale_price.values.alignment).toBe('right');
  });
});

describe('formatOverrides', () => {
  test('bare measures get a format by aggregation and, with a role, a readable label; formatted ones are left alone', () => {
    const out = formatOverrides([widget('bar', { selectedDimensions: ['d.country'], selectedMeasures: ['m.sale', 'm.avg'] })], effective);
    expect(out).toEqual({ 'm.sale': { format: { decimals: 0, thousandSep: ' ', prefix: '', suffix: '' }, label: 'Revenue' } });
  });

  test('a sum or difference of whole measures is whole; a ratio or an average keeps two decimals', () => {
    const measures = [
      { name: 'q.ordered', label: 'Ordered', aggregation: 'sum' },
      { name: 'q.served', label: 'Served', aggregation: 'sum' },
      { name: 'q.avg', label: 'Avg', aggregation: 'avg' },
      { name: 'q.missing', label: 'Missing', aggregation: 'custom', expression: '(${q.ordered}) - (${q.served})' },
      { name: 'q.mixed', label: 'Mixed', aggregation: 'custom', expression: '(${q.ordered}) + (${q.avg})' },
      { name: 'q.rate', label: 'Rate', aggregation: 'custom', expression: '(${q.served}) / NULLIF((${q.ordered}), 0)' },
    ];
    const out = formatOverrides([widget('table', { selectedMeasures: ['q.missing', 'q.mixed', 'q.rate'] })], { dimensions: [], measures });
    expect(out['q.missing'].format.decimals).toBe(0);
    expect(out['q.mixed'].format.decimals).toBe(2);
    expect(out['q.rate'].format.decimals).toBe(2);
  });
});

describe('the headers of a table', () => {
  const fields = {
    dimensions: [{ name: 'f.supplier', label: 'fournisseur', type: 'string' }],
    measures: [{ name: 'f.qty', label: 'qte_commandee', aggregation: 'sum', table: 'f', column: 'qty' }],
  };
  const ctx = { effective: fields, page: { width: 1140, height: 800 }, pageContext: { pageWidth: 1140, pageHeight: 800, themes: ['light'], theme: 'light', widgets: [] }, mode: 'visuals', library: [], cardinality: {} };
  test('the model names a raw column in the user\'s words; the amounts stay right-aligned', () => {
    const r = validateWidgetsProposal({ widgets: [{
      type: 'table', answers: 'detail', title: 'Synthèse', rationale: 'r',
      binding: { selectedDimensions: ['f.supplier'], selectedMeasures: ['f.qty'] },
      fieldNames: { 'f.qty': 'Quantité commandée', 'f.supplier': 'Fournisseur', 'f.other': 'Ignored' },
    }] }, ctx);
    expect(r.errors).toEqual([]);
    const { columns } = r.widgets[0].config.tableConfig;
    expect(columns.qte_commandee).toMatchObject({ displayName: 'Quantité commandée', values: { alignment: 'right' } });
    expect(columns.fournisseur).toEqual({ displayName: 'Fournisseur' });
    expect(Object.keys(columns)).toHaveLength(2);
  });
});

describe('layoutNew of a new page', () => {
  const page = { width: 1140, height: 800 };
  test('filters on top, figures in a band of readable width, charts after — whatever the order proposed', () => {
    const laid = layoutNew([
      widget('bar', { selectedDimensions: ['d.country'], selectedMeasures: ['m.sale'] }, { title: 'By country' }),
      widget('scorecard', { selectedMeasures: ['m.sale'] }, { label: 'Revenue' }),
      widget('filter', { selectedDimensions: ['d.country'] }, { slicerStyle: 'dropdown' }),
    ], page, effective);
    const [bar, card, filter] = laid.map((w) => w.layout);
    expect(filter.y).toBeLessThan(card.y);
    expect(card.y).toBeLessThan(bar.y);
    expect(card.w).toBeLessThanOrEqual(380);
    expect(filter.w).toBeLessThanOrEqual(340);
    expect(bar.w).toBe(1100);
  });
});

describe('colorWidgets', () => {
  const { colorWidgets } = require('../utils/ai/dress');
  test('a single-series bar gets the accent, a legend gets distinct hues, computed for the theme; set keys stay', () => {
    const light = colorWidgets([widget('bar', { selectedDimensions: ['d.country'], selectedMeasures: ['m.sale'] }), widget('bar', { selectedDimensions: ['d.day'], selectedMeasures: ['m.sale'], groupBy: ['d.country'] }, { color: '#123456' })], { theme: 'light', effective });
    expect(light[0].config.color).toBe('#5470c6');
    expect(light[0].config.palette.length).toBeGreaterThan(5);
    expect(light[1].config.color).toBe('#123456');
    const dark = colorWidgets([widget('bar', { selectedDimensions: ['d.country'], selectedMeasures: ['m.sale'] })], { theme: 'dark', effective });
    expect(dark[0].config.palette).not.toEqual(light[0].config.palette);
    const table = colorWidgets([widget('table', { selectedDimensions: ['d.country'], selectedMeasures: ['m.sale'] }, { tableConfig: { columns: { x: {} } } })], { theme: 'light', effective });
    expect(table[0].config.tableConfig).toMatchObject({ header: expect.any(Object), columns: { x: {} } });
  });
});

describe('raw names and decimals', () => {
  const effective2 = {
    dimensions: [{ name: 'f.wh', label: 'entrepot', type: 'string' }, { name: 'f.month', label: 'Month', type: 'string', table: 'f', column: 'month' }],
    measures: [
      { name: 'f.ordered', label: 'qte_commandee', aggregation: 'sum', table: 'f', column: 'ordered' },
      { name: 'f.served', label: 'qte_servie', aggregation: 'sum', table: 'f', column: 'served' },
      { name: 'f.min', label: 'Stock minimum', aggregation: 'avg', table: 'f', column: 'min', dataType: 'bigint' },
      { name: 'f.rate', label: 'Rate', aggregation: 'custom', expression: '100.0 * (${f.served}) / NULLIF((${f.ordered}), 0)', format: { decimals: 1, suffix: ' %' } },
    ],
  };
  const ctx2 = { effective: effective2, page: { width: 1140, height: 800 }, pageContext: { pageWidth: 1140, pageHeight: 800, themes: ['light'], theme: 'light', widgets: [] }, mode: 'visuals', library: [], cardinality: {} };
  const line = (fieldNames) => ({
    type: 'line', answers: 'trend', title: 'Commandé et servi par mois', rationale: 'r',
    binding: { selectedDimensions: ['f.month'], selectedMeasures: ['f.ordered', 'f.served'] }, ...(fieldNames ? { fieldNames } : {}),
  });

  test('a legend of raw names goes back once; named, the measures carry the names in the whole report', () => {
    expect(validateWidgetsProposal({ widgets: [line()] }, ctx2).warnings.join(' ')).toMatch(/fieldNames.*f\.ordered, f\.served/);
    const r = validateWidgetsProposal({ widgets: [line({ 'f.ordered': 'Commandé', 'f.served': 'Servi' })] }, ctx2);
    expect(r.warnings).toEqual([]);
    const out = formatOverrides(r.widgets, effective2);
    expect(out['f.ordered'].label).toBe('Commandé');
    expect(out['f.served'].label).toBe('Servi');
    expect(r.widgets[0].fieldLabels).toBeUndefined();
  });

  test('decimals and a name the user asked for win over the report\'s own overrides', () => {
    const asked = { ...line({ 'f.ordered': 'Commandé', 'f.served': 'Servi' }), fieldDecimals: { 'f.ordered': 1, 'f.wh': 2, 'f.served': 9 } };
    const r = validateWidgetsProposal({ widgets: [asked] }, ctx2);
    const out = formatOverrides(r.widgets, effective2);
    expect(out['f.ordered'].chosen).toEqual({ label: 'Commandé', format: { thousandSep: ' ', prefix: '', suffix: '', decimals: 1 } });
    // A dimension, or decimals out of range: nothing.
    expect(out['f.served'].chosen).toEqual({ label: 'Servi' });
    expect(r.widgets[0].fieldDecimals).toBeUndefined();
  });

  test('the average of a whole-number column read once per item is whole, over a fact it keeps one', () => {
    const perItem = { ...effective2, joins: [{ from_table: 'x', from_column: 'wh', to_table: 'f', to_column: 'wh', cardinality: { from: '*', to: '1' } }] };
    const out = formatOverrides([widget('table', { selectedDimensions: ['f.wh'], selectedMeasures: ['f.min', 'f.rate'] })], perItem);
    expect(out['f.min'].format).toMatchObject({ decimals: 0 });
    // A delay in days over shipments: 3.1 against 3 promised is the story.
    expect(formatOverrides([widget('table', { selectedDimensions: ['f.wh'], selectedMeasures: ['f.min'] })], effective2)['f.min'].format.decimals).toBe(1);
    // The separators are the reader's: none is written in a format.
    expect(out['f.rate']).toBeUndefined();
  });
});

describe('the house style of the report', () => {
  const look = { borderEnabled: false, titleFontFamily: 'Poppins', titleColor: '#11254c', labelFontFamily: 'Inter' };
  const siblings = [
    { type: 'scorecard', config: { ...look } }, { type: 'bar', config: { ...look, xAxisLabelFontFamily: 'Inter' } },
    { type: 'line', config: { ...look } }, { type: 'image', config: { borderEnabled: true } },
  ];
  test('a visual with no neighbour like it still takes the frame and the fonts most of the page shares', () => {
    const table = matchNeighbours({ type: 'table', config: {}, dataBinding: {} }, siblings);
    expect(table.config).toMatchObject({ borderEnabled: false, titleFontFamily: 'Poppins', titleColor: '#11254c' });
    expect(table.config.tableConfig).toEqual({ header: { fontFamily: 'Inter' }, values: { fontFamily: 'Inter' } });
  });
  test('what only one neighbour does is its own; what the proposal sets stays', () => {
    const lone = [{ type: 'bar', config: { borderEnabled: false } }, { type: 'line', config: {} }, { type: 'pie', config: {} }];
    expect(matchNeighbours({ type: 'table', config: {}, dataBinding: {} }, lone).config.borderEnabled).toBeUndefined();
    expect(matchNeighbours({ type: 'table', config: { borderEnabled: true }, dataBinding: {} }, siblings).config.borderEnabled).toBe(true);
  });
});
