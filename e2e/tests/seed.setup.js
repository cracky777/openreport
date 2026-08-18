// Builds the fixture through the real HTTP API — same path a user takes — then
// stores the session so every spec starts logged in.
const fs = require('fs');
const { test: setup, expect } = require('@playwright/test');
const F = require('../fixtures');

const DIMENSIONS = [
  { name: F.DIM, table: 'sales', column: 'country', type: 'string', label: F.DIM_LABEL },
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
  // Exists only to own the title the conflict spec tries to steal.
  const otherReportId = await mkReport(F.TAKEN_TITLE, null, null);
  // The successful-save case renames what it opens, so it gets its own report
  // rather than borrowing — and restoring — the one every other spec reads.
  const renameReportId = await mkReport('Rapport e2e bis', WIDGETS, LAYOUT);

  fs.writeFileSync(F.IDS_FILE, JSON.stringify({ datasourceId, modelId, reportId, otherReportId, renameReportId }, null, 1));
  await request.storageState({ path: F.AUTH_STATE });
});
