// Golden SQL snapshots for the measure aggregate-expression blocks in models.js.
// This is the guard for the LOT 6.1 dedup refactor: the compiled SQL (sqlOnly)
// must stay byte-identical before and after extracting buildMeasureAggExpr.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

// SUM (standard), AVG, MIN, MAX (standard), and an interval-typed SUM (exercises
// the EXTRACT(EPOCH …) branch on pg/duckdb).
const MEASURES = [
  { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'total' },
  { name: 'items.amt_avg', table: 'items', column: 'amt', aggregation: 'avg', label: 'moyenne' },
  { name: 'items.amt_min', table: 'items', column: 'amt', aggregation: 'min', label: 'mini' },
  { name: 'items.amt_max', table: 'items', column: 'amt', aggregation: 'max', label: 'maxi' },
  { name: 'items.dur_sum', table: 'items', column: 'dur', aggregation: 'sum', label: 'duree', dataType: 'interval' },
];

async function compileSql(dbType) {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType });
  const model = seedModel({ userId: owner, datasourceId: ds, measures: MEASURES });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], measureNames: MEASURES.map((m) => m.name), sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

for (const dbType of ['postgres', 'mysql', 'mssql']) {
  test(`aggregate SQL is stable — ${dbType}`, async () => {
    expect(await compileSql(dbType)).toMatchSnapshot();
  });
}
