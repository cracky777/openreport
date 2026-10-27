// A report migrated onto a model takes everything with it: its own
// calculations, Date table and dimensions become the model's, and the report
// reads them there. Left in the report, they stayed tied to the model it came
// from — a catalog showed them as a second model.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');
const { moveReportFieldsToModel } = require('../utils/reportMigration');

const app = buildApp();

const CALC = { name: '_calc.ratio', table: '', column: '', aggregation: 'custom', label: 'Ratio', expression: '${_calc.lost} / NULLIF(${items.amt_sum}, 0)' };
const LOST = { name: '_calc.lost', table: 'items', column: 'amt', aggregation: 'sum', label: 'Lost', filterRules: [{ field: 'items.label', op: 'in', values: ['lost'] }] };
const YEAR = { name: '_date.year', table: 'items', column: 'sold_on', type: 'integer', label: 'Year', datePart: 'num_year', datePartOf: 'items.sold_on' };
const SETTINGS = {
  extraMeasures: [LOST, CALC],
  extraDimensions: [YEAR],
  dateColumn: 'items.sold_on',
  measureOverrides: { '_calc.ratio': { format: { suffix: ' %' } }, 'items.amt_sum': { label: 'Revenue' } },
  pages: [{ id: 'p1', widgets: { w1: { type: 'bar', dataBinding: { selectedDimensions: ['_date.year'], selectedMeasures: ['_calc.ratio', '_calc.lost@@agg:avg'] } } } }],
};
const MODEL = {
  measures: [{ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'amt' }],
  dimensions: [{ name: 'items.label', table: 'items', column: 'label', type: 'string' }, { name: 'items.sold_on', table: 'items', column: 'sold_on', type: 'date' }],
  date_column: '',
};

describe('moving a report\'s own fields into its model', () => {
  test('everything goes: calculations, the Date table, their overrides', () => {
    const out = moveReportFieldsToModel(SETTINGS, MODEL);
    expect(out.measures.map((m) => m.name)).toEqual(['items.amt_sum', '_calc.lost', '_calc.ratio']);
    expect(out.dimensions.map((d) => d.name)).toEqual(['items.label', 'items.sold_on', '_date.year']);
    expect(out.dateColumn).toBe('items.sold_on');
    // The report's own field brings its override; the model's keeps its look in the report.
    expect(out.measures.find((m) => m.name === '_calc.ratio').format).toEqual({ suffix: ' %' });
    expect(out.settings.measureOverrides).toEqual({ 'items.amt_sum': { label: 'Revenue' } });
    expect(out.settings.extraMeasures).toBeUndefined();
    expect(out.settings.extraDimensions).toBeUndefined();
    expect(out.settings.dateColumn).toBeUndefined();
    expect(out.settings.pages).toEqual(SETTINGS.pages);
  });

  test('a field the model already has, identical, is not added twice', () => {
    const out = moveReportFieldsToModel(SETTINGS, { ...MODEL, measures: [...MODEL.measures, LOST] });
    expect(out.measures.filter((m) => m.name === '_calc.lost')).toHaveLength(1);
  });

  test('a name the model uses for something else: renamed, and the report reads the new name', () => {
    const other = { ...LOST, filterRules: [{ field: 'items.label', op: 'in', values: ['won'] }] };
    const out = moveReportFieldsToModel(SETTINGS, { ...MODEL, measures: [...MODEL.measures, other] });
    expect(out.renamed).toEqual({ '_calc.lost': '_calc.lost_2' });
    expect(out.measures.find((m) => m.name === '_calc.lost_2').filterRules[0].values).toEqual(['lost']);
    // References inside the other calculations, bindings and variants follow.
    expect(out.measures.find((m) => m.name === '_calc.ratio').expression).toBe('${_calc.lost_2} / NULLIF(${items.amt_sum}, 0)');
    expect(out.settings.pages[0].widgets.w1.dataBinding.selectedMeasures).toEqual(['_calc.ratio', '_calc.lost_2@@agg:avg']);
  });

  test('a model with its own Date table keeps it; the report\'s date parts still move, renamed if they collide', () => {
    const out = moveReportFieldsToModel(SETTINGS, { ...MODEL, date_column: 'items.other_date', dimensions: [...MODEL.dimensions, { ...YEAR, column: 'other_date' }] });
    expect(out.dateColumn).toBe('items.other_date');
    expect(out.renamed['_date.year']).toBe('_date.year_2');
    expect(out.settings.pages[0].widgets.w1.dataBinding.selectedDimensions).toEqual(['_date.year_2']);
  });
});

describe('routes', () => {
  let owner; let viewer; let ds;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    viewer = seedUser({ role: 'viewer' });
    ds = seedDatasource({ userId: owner });
  });
  const bundle = { format: 'open-report.report.v1', report: { title: 'Calls', settings: SETTINGS, pages: SETTINGS.pages } };

  test('an import onto a model the user writes moves the report\'s fields into it', async () => {
    const model = seedModel({ userId: owner, datasourceId: ds });
    const res = await request(app).post('/api/reports/import').set('x-test-user', owner).send({ bundle, modelId: model });
    expect(res.status).toBe(201);
    expect(res.body.fieldsMoved.moved.measures).toEqual(['_calc.lost', '_calc.ratio']);
    expect(res.body.fieldsKept).toBe(false);
    const settings = JSON.parse(db.prepare('SELECT settings FROM reports WHERE id = ?').get(res.body.report.id).settings);
    expect(settings.extraMeasures).toBeUndefined();
    const m = db.prepare('SELECT measures, dimensions, date_column FROM models WHERE id = ?').get(model);
    expect(JSON.parse(m.measures).map((x) => x.name)).toEqual(expect.arrayContaining(['_calc.lost', '_calc.ratio']));
    expect(JSON.parse(m.dimensions).map((x) => x.name)).toContain('_date.year');
    expect(m.date_column).toBe('items.sold_on');

    // The report still reads its calculation, now from the model.
    const q = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
      .send({ dimensionNames: [], measureNames: ['_calc.ratio'], sqlOnly: true, reportId: res.body.report.id });
    expect(q.status).toBe(200);
    expect(q.body.sql).toMatch(/NULLIF/);
  });

  test('a report already migrated catches up; the model\'s fields never move for someone who cannot write it', async () => {
    const model = seedModel({ userId: owner, datasourceId: ds });
    const report = seedReport({ userId: owner, modelId: model, settings: SETTINGS });
    const refused = await request(app).post(`/api/reports/${report}/move-fields-to-model`).set('x-test-user', viewer);
    expect([403, 404]).toContain(refused.status);
    const res = await request(app).post(`/api/reports/${report}/move-fields-to-model`).set('x-test-user', owner);
    expect(res.status).toBe(200);
    expect(res.body.fieldsMoved.moved.dimensions).toEqual(['_date.year']);
    expect(JSON.parse(db.prepare('SELECT settings FROM reports WHERE id = ?').get(report).settings).extraDimensions).toBeUndefined();
  });
});
