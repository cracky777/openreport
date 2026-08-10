// A measure whose table is NOT join-connected to the grouping dimension must be
// emitted as its own scalar-subquery total, never comma-cross-joined into the
// main FROM (which would multiply every group by the grand total — the bug seen
// with multi-sheet Excel imports, where two unrelated tables share a datasource).
// Properly joined tables are unaffected — covered by tests/sqlSnapshotJoins.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
const sqlFor = async (model, u, dims, meas) => (await request(app)
  .post(`/api/models/${model}/query`).set('x-test-user', u)
  .send({ dimensionNames: dims, measureNames: meas, sqlOnly: true })).body.sql;

// Two unrelated tables in one datasource, no joins (two Excel sheets).
function twoSheetModel() {
  const u = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: u, dbType: 'duckdb' });
  const model = seedModel({
    userId: u, datasourceId: ds, selectedTables: ['sales', 'costs'],
    dimensions: [
      { name: 'sales.cat', table: 'sales', column: 'cat', type: 'string', label: 'cat' },
      { name: 'costs.grp', table: 'costs', column: 'grp', type: 'string', label: 'grp' },
    ],
    measures: [
      { name: 'sales.val_sum', table: 'sales', column: 'val', aggregation: 'sum', label: 'val' },
      { name: 'costs.amt_sum', table: 'costs', column: 'amt', aggregation: 'sum', label: 'amt' },
    ],
    joins: [],
  });
  return { u, model };
}

describe('unrelated-table measure is a scalar total, not a cross join', () => {
  test('measure on the grouping table still aggregates per group', async () => {
    const { u, model } = twoSheetModel();
    const sql = await sqlFor(model, u, ['sales.cat'], ['sales.val_sum']);
    expect(sql).toMatch(/SUM\("sales"\."val"\)/);
    expect(sql).not.toMatch(/FROM "sales", "costs"/);
  });

  test('measure on an unrelated table becomes a scalar total (no Cartesian FROM)', async () => {
    const { u, model } = twoSheetModel();
    const sql = await sqlFor(model, u, ['sales.cat'], ['costs.amt_sum']);
    expect(sql).toMatch(/\(SELECT SUM\("costs"\."amt"\) FROM "costs"\)/);
    expect(sql).not.toMatch(/FROM "sales", "costs"/);
  });

  test('mixing both: own-table measure grouped, unrelated one totalled', async () => {
    const { u, model } = twoSheetModel();
    const sql = await sqlFor(model, u, ['sales.cat'], ['sales.val_sum', 'costs.amt_sum']);
    expect(sql).toMatch(/SUM\("sales"\."val"\)/);                       // per group
    expect(sql).toMatch(/\(SELECT SUM\("costs"\."amt"\) FROM "costs"\)/); // grand total
    expect(sql).not.toMatch(/FROM "sales", "costs"/);
  });

  test('grouping by dimensions from unrelated tables errors clearly (no Cartesian)', async () => {
    const { u, model } = twoSheetModel();
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', u)
      .send({ dimensionNames: ['sales.cat', 'costs.grp'], measureNames: ['sales.val_sum'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unrelated tables/i);
  });
});
