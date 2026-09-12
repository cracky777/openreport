// Builds the fixture through the real HTTP API — same path a user takes — then
// stores the session so every spec starts logged in.
const fs = require('fs');
const { test: setup, expect } = require('@playwright/test');
const F = require('../fixtures');

const DIMENSIONS = [
  { name: F.DIM, table: 'sales', column: 'country', type: 'string', label: F.DIM_LABEL },
  { name: F.SPARE_DIM, table: 'sales', column: 'city', type: 'string', label: F.SPARE_DIM_LABEL },
];
const MEASURES = [
  { name: F.MEASURE, table: 'sales', column: 'amt', aggregation: 'sum', label: F.MEASURE_LABEL },
];

// A scorecard reads as text, which is what lets the race spec assert on the
// number that won. The slicer is in `buttons` mode so each value is a real
// button carrying its own label.
const WIDGETS = {
  'w-score': {
    type: 'scorecard',
    dataBinding: { selectedDimensions: [], selectedMeasures: [F.MEASURE] },
    config: {},
  },
  'w-filter': {
    type: 'filter',
    dataBinding: { selectedDimensions: [F.DIM], selectedMeasures: [] },
    config: { slicerStyle: 'buttons' },
  },
};
const LAYOUT = [
  { i: 'w-score', x: 40, y: 40, w: 420, h: 200, z: 1 },
  { i: 'w-filter', x: 40, y: 280, w: 420, h: 220, z: 1 },
];

// A table carrying a Top N rule with no N yet — the state right after the
// measure is dropped into the widget's Filters. Typing the N is what the
// collapsed-panel spec then does.
const TABLE_WIDGETS = {
  'w-table': {
    type: 'table',
    dataBinding: {
      selectedDimensions: [F.DIM],
      selectedMeasures: [F.MEASURE],
      widgetFilters: [{ field: F.MEASURE, isMeasure: true, op: 'top_n', value: '', values: [] }],
    },
    // Saved data, like any report that has been opened and saved once. Its
    // `_fetchedBinding` is deliberately stale: the widget renders without a
    // query, which is the state a real report opens in — and the state the
    // first version of this fixture was missing.
    data: {
      _fetchedBinding: 'stale',
      _rowDims: [F.DIM],
      _measures: [F.MEASURE_LABEL],
      rows: [{ [F.DIM_LABEL]: 'N=saved', [F.MEASURE_LABEL]: 1 }],
    },
    config: {},
  },
};
const TABLE_LAYOUT = [{ i: 'w-table', x: 40, y: 40, w: 600, h: 300, z: 1 }];

// The same measure twice in one visual, summed and averaged. The second entry
// is a variant whose name carries its aggregation.
const TWICE_WIDGETS = {
  'w-t': {
    type: 'table',
    dataBinding: { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE, F.MEASURE + '@@agg:avg'] },
    config: {},
  },
};
const TWICE_LAYOUT = [{ i: 'w-t', x: 40, y: 40, w: 700, h: 300, z: 1 }];

// EVERY visual that can show a measure, with every value-printing option on.
// The measure it is bound to comes back as TEXT in the specs — a duration the
// author formatted in SQL — and the point of the fixture is that one such
// measure has to read the same way in all of them.
const TEXT_TYPES = ['bar', 'line', 'combo', 'pie', 'treemap', 'gauge', 'table', 'pivotTable', 'scorecard'];
const TEXT_WIDGETS = {};
const TEXT_LAYOUT = [];
TEXT_TYPES.forEach((t, i) => {
  const id = 'w-' + t;
  const b = { selectedDimensions: [F.DIM], selectedMeasures: [F.MEASURE] };
  if (t === 'scorecard' || t === 'gauge') b.selectedDimensions = [];
  if (t === 'combo') { b.comboBarMeasures = [F.MEASURE]; b.comboLineMeasures = [F.MEASURE]; }
  TEXT_WIDGETS[id] = {
    type: t,
    dataBinding: b,
    config: { showDataLabels: true, showLegend: true, showTotals: true, dataLabelContent: 'value', gaugeShowMinMax: true, showValue: true },
  };
  TEXT_LAYOUT.push({ i: id, x: 20 + (i % 2) * 620, y: 20 + Math.floor(i / 2) * 340, w: 600, h: 320, z: 1 });
});

// Two frames merged into one block, showing the separator line at their seam,
// with a third widget laid ON TOP of that seam at a higher layer. The colours
// are what the spec reads back: it has to tell the separator from the widget
// covering it.
const MERGE_WIDGETS = {
  'w-left': {
    type: 'text',
    dataBinding: {},
    config: { mergeGroup: 'g1', mergeSeparator: true, mergeSeparatorColor: '#dc2626', text: 'left' },
  },
  'w-right': {
    type: 'text',
    dataBinding: {},
    config: { mergeGroup: 'g1', mergeSeparator: true, mergeSeparatorColor: '#dc2626', text: 'right' },
  },
  'w-over': {
    type: 'shape',
    dataBinding: {},
    config: { backgroundColor: '#16a34a', shape: 'rectangle' },
  },
};
const MERGE_LAYOUT = [
  { i: 'w-left', x: 40, y: 40, w: 300, h: 200, z: 1 },
  { i: 'w-right', x: 340, y: 40, w: 300, h: 200, z: 1 },
  // Straddles the seam at x=340. NO z of its own — which is what a widget
  // added to a report actually gets: the same layer as everything else, on top
  // by virtue of coming last. That is the case the separator used to ignore.
  { i: 'w-over', x: 290, y: 60, w: 100, h: 160 },
];

setup('seed the fixture', async ({ request }) => {
  // First account on a virgin database becomes admin, and register logs it in.
  const reg = await request.post('/api/auth/register', { data: { ...F.USER, displayName: 'E2E' } });
  expect(reg.ok(), await reg.text()).toBeTruthy();

  const ds = await request.post('/api/datasources', {
    data: { name: 'e2e-ds', dbType: 'postgres', host: 'unreachable.invalid', port: 5432, dbName: 'e2e', dbUser: 'u', dbPassword: 'p' },
  });
  expect(ds.ok(), await ds.text()).toBeTruthy();
  const datasourceId = (await ds.json()).datasource.id;

  const mk = await request.post('/api/models', { data: { name: 'e2e-model', datasourceId } });
  expect(mk.ok(), await mk.text()).toBeTruthy();
  const modelId = (await mk.json()).model.id;

  // The model needs its fields before a widget can bind to them.
  const upd = await request.put(`/api/models/${modelId}`, {
    data: {
      name: 'e2e-model',
      selected_tables: ['sales'],
      dimensions: DIMENSIONS,
      measures: MEASURES,
      joins: [],
      rls: {},
      column_types: {},
    },
  });
  expect(upd.ok(), await upd.text()).toBeTruthy();

  const mkReport = async (title, widgets, layout) => {
    const res = await request.post('/api/reports', { data: { title, modelId } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const id = (await res.json()).report.id;
    if (widgets) {
      const put = await request.put(`/api/reports/${id}`, {
        data: { title, settings: {}, layout, widgets, pages: [{ id: 'page-1', name: 'Page 1', layout, widgets }] },
      });
      expect(put.ok(), await put.text()).toBeTruthy();
    }
    return id;
  };

  const reportId = await mkReport('Rapport e2e', WIDGETS, LAYOUT);
  // The collapsed-panel spec edits a widget filter, so it gets its own report
  // rather than mutating the one every other spec reads.
  const tableReportId = await mkReport('Rapport e2e tableau', TABLE_WIDGETS, TABLE_LAYOUT);
  const textReportId = await mkReport('Rapport e2e mesure texte', TEXT_WIDGETS, TEXT_LAYOUT);
  const twiceReportId = await mkReport('Rapport e2e mesure en double', TWICE_WIDGETS, TWICE_LAYOUT);
  // Exists only to own the title the conflict spec tries to steal.
  const otherReportId = await mkReport(F.TAKEN_TITLE, null, null);
  const mergeReportId = await mkReport('Rapport e2e fusion', MERGE_WIDGETS, MERGE_LAYOUT);

  fs.writeFileSync(F.IDS_FILE, JSON.stringify({ datasourceId, modelId, reportId, tableReportId, textReportId, twiceReportId, otherReportId, mergeReportId }, null, 1));
  await request.storageState({ path: F.AUTH_STATE });
});
