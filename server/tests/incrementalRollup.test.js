// Incremental rollup refresh — pure parts. The physical grain of an opted-in
// model gains synthetic `_incr.year/_incr.month` date-part dims (the planner's
// superset match re-aggregates them away), and refreshes re-query only the
// last N months. Full-build behaviour must stay byte-identical for models
// that didn't opt in.
const { seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');
const {
  incrementalContextForModel, incrementalCutoff, planRollupsForModel,
} = require('../utils/rollupBuilder');

describe('incrementalContextForModel', () => {
  test('null without opt-in, a date_column, or a well-formed one', () => {
    expect(incrementalContextForModel({ incremental_months: 0, date_column: 'f.d' })).toBeNull();
    expect(incrementalContextForModel({ incremental_months: 6, date_column: '' })).toBeNull();
    expect(incrementalContextForModel({ incremental_months: 6, date_column: 'nodot' })).toBeNull();
    expect(incrementalContextForModel({ incremental_months: 6, date_column: 'f.' })).toBeNull();
  });
  test('valid: part dims target the date column, raw date dim is date-typed', () => {
    const ctx = incrementalContextForModel({ incremental_months: 3, date_column: 'sales.order_date' });
    expect(ctx.months).toBe(3);
    expect(ctx.partDims.map((d) => d.name)).toEqual(['_incr.year', '_incr.month']);
    expect(ctx.partDims[0]).toMatchObject({ table: 'sales', column: 'order_date', datePart: 'num_year' });
    expect(ctx.rawDateDim).toMatchObject({ name: '_incr.date', type: 'date' });
  });
  test('schema-qualified date tables keep their full prefix', () => {
    const ctx = incrementalContextForModel({ incremental_months: 1, date_column: 'dwh.f_sales.dt' });
    expect(ctx.dateTable).toBe('dwh.f_sales');
    expect(ctx.dateColumn).toBe('dt');
  });
});

describe('incrementalCutoff', () => {
  test('months=1 → first day of the current month', () => {
    expect(incrementalCutoff(1, new Date(Date.UTC(2026, 7, 21)))).toEqual({ year: 2026, month: 8, iso: '2026-08-01' });
  });
  test('months=3 spans back two extra months', () => {
    expect(incrementalCutoff(3, new Date(Date.UTC(2026, 7, 21))).iso).toBe('2026-06-01');
  });
  test('window crossing a year boundary', () => {
    expect(incrementalCutoff(4, new Date(Date.UTC(2026, 1, 10))).iso).toBe('2025-11-01');
  });
});

describe('planRollupsForModel augmentation', () => {
  const widget = { w1: { type: 'bar', dataBinding: { selectedDimensions: ['data.Country'], selectedMeasures: ['data.Sales_sum'] } } };
  const baseModel = (over = {}) => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['data'],
      dimensions: [
        { name: 'data.Country', table: 'data', column: 'Country', label: 'Country', type: 'string' },
        { name: 'data.Date', table: 'data', column: 'Date', label: 'Date', type: 'date' },
      ],
      measures: [{ name: 'data.Sales_sum', table: 'data', column: 'Sales', aggregation: 'sum', label: 'Sales' }],
      joins: [],
    });
    db.prepare('UPDATE models SET date_column = ?, incremental_months = ? WHERE id = ?')
      .run(over.dateColumn ?? 'data.Date', over.months ?? 6, model);
    seedReport({ userId: owner, modelId: model, widgets: widget });
    return model;
  };

  test('opted-in model: physical grain gains the _incr parts, extras carry their defs', () => {
    const model = baseModel();
    const { plan } = planRollupsForModel(model);
    expect(plan).toHaveLength(1);
    expect(plan[0].grain).toEqual(['_incr.month', '_incr.year', 'data.Country']);
    expect(plan[0].incremental).toEqual({ months: 6 });
    const extraNames = plan[0].extras.extraDimensions.map((d) => d.name);
    expect(extraNames).toEqual(expect.arrayContaining(['_incr.year', '_incr.month', '_incr.date']));
  });

  test('no opt-in → grain untouched, no incremental marker', () => {
    const model = baseModel({ months: 0 });
    const { plan } = planRollupsForModel(model);
    expect(plan[0].grain).toEqual(['data.Country']);
    expect(plan[0].incremental).toBeNull();
  });

  test('date table unrelated to the fact → not augmented (would cross-join the build)', () => {
    const model = baseModel({ dateColumn: 'calendar.dt' });
    const { plan } = planRollupsForModel(model);
    expect(plan[0].grain).toEqual(['data.Country']);
    expect(plan[0].incremental).toBeNull();
  });
});

describe('PUT /models/:id — incremental settings coherence', () => {
  const request = require('supertest');
  const { buildApp } = require('./helpers/testApp');
  const app = buildApp();

  test('a window without a date column is normalised away (never a phantom setting)', async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({ userId: owner, datasourceId: ds });

    // window + date column → stored
    let res = await request(app).put(`/api/models/${model}`).set('x-test-user', owner)
      .send({ dateColumn: 'items.created_at', incrementalMonths: 3 });
    expect(res.body.model.incremental_months).toBe(3);

    // clearing the date column silently drops the window too
    res = await request(app).put(`/api/models/${model}`).set('x-test-user', owner)
      .send({ dateColumn: '', incrementalMonths: 3 });
    expect(res.body.model.incremental_months).toBeNull();

    // and a window sent alone against a model with no date column never sticks
    res = await request(app).put(`/api/models/${model}`).set('x-test-user', owner)
      .send({ incrementalMonths: 6 });
    expect(res.body.model.incremental_months).toBeNull();
  });
});
