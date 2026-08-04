// Golden SQL snapshots for the measure-side /query paths the other snapshot
// suites don't reach — the guard for extracting the coupled SELECT-measure loop
// and its helpers (custom expression, override-filtered subquery, measure HAVING
// / top_n, x-grain IN-subquery). Compiled SQL must stay byte-identical across
// the move. All run as the model owner so free-SQL / custom measures pass.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const TWO_DIMS = [
  { name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'label' },
  { name: 'items.region', table: 'items', column: 'region', type: 'string', label: 'region' },
];

async function compile(dbType, { measures, dimensions } = {}, body) {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType });
  const model = seedModel({ userId: owner, datasourceId: ds, measures, dimensions });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

for (const dbType of ['postgres', 'mysql', 'mssql']) {
  // Custom expression with a division → applyNumericCast wraps each aggregate so
  // integer division doesn't truncate (SUM(x)→SUM(CAST(x AS NUMERIC))).
  test(`custom-expression measure SQL is stable — ${dbType}`, async () => {
    const measures = [{
      name: 'items.avg_ticket', aggregation: 'custom', label: 'panier_moyen',
      expression: 'SUM(items.amt) / COUNT(items.id)',
    }];
    const sql = await compile(dbType, { measures }, {
      dimensionNames: ['items.label'], measureNames: ['items.avg_ticket'],
    });
    expect(sql).toMatchSnapshot();
  });

  // Override-filtered measure (CALCULATE-style) → an independent scalar subquery
  // carrying its own rule (items.label = 'X'), built after the FROM.
  test(`override-filtered measure SQL is stable — ${dbType}`, async () => {
    const measures = [{
      name: 'items.amt_x', table: 'items', column: 'amt', aggregation: 'sum', label: 'amt_label_X',
      overrideFilters: true, filterRules: [{ field: 'items.label', op: 'eq', value: 'X' }],
    }];
    const sql = await compile(dbType, { measures }, {
      dimensionNames: [], measureNames: ['items.amt_x'],
    });
    expect(sql).toMatchSnapshot();
  });

  // Measure filter with a comparator → HAVING on the aggregate.
  test(`measure HAVING (gt) SQL is stable — ${dbType}`, async () => {
    const sql = await compile(dbType, {}, {
      dimensionNames: ['items.label'], measureNames: ['items.amt_sum'],
      widgetFilters: [{ field: 'items.amt_sum', op: 'gt', value: 100, isMeasure: true }],
    });
    expect(sql).toMatchSnapshot();
  });

  // top_n measure filter (no legend) → topNOverride replaces ORDER BY + LIMIT.
  test(`measure top_n override SQL is stable — ${dbType}`, async () => {
    const sql = await compile(dbType, {}, {
      dimensionNames: ['items.label'], measureNames: ['items.amt_sum'],
      widgetFilters: [{ field: 'items.amt_sum', op: 'top_n', value: 10, isMeasure: true }],
    });
    expect(sql).toMatchSnapshot();
  });

  // x-grain: two dims (X = region, legend = label), filter the per-region TOTAL
  // via an IN-subquery aggregated at the region grain.
  test(`x-grain top_n IN-subquery SQL is stable — ${dbType}`, async () => {
    const sql = await compile(dbType, { dimensions: TWO_DIMS }, {
      dimensionNames: ['items.region', 'items.label'],
      measureNames: ['items.amt_sum'],
      havingGrainDims: ['items.region'],
      widgetFilters: [{ field: 'items.amt_sum', op: 'top_n', value: 5, isMeasure: true }],
    });
    expect(sql).toMatchSnapshot();
  });
}
