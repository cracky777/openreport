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

// A 1:1 join must not cost a fact its status.
//
// `realFacts` is "a many side that is never a one side", and a 1:1 relation put
// its BOTH ends on the one side. So a star schema that also carried a detail
// table joined 1:1 to the fact — `order_items (1) → inventory_items (1)`, next
// to the ordinary `products (1) → order_items (*)` — had no fact left at all.
// Every measure then fell through to the unrelated-table treatment above, and
// each row of the visual showed the same grand total. One such join flattened
// every other join in the model.
function starWithOneToOneDetail() {
  const u = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: u, dbType: 'postgres' });
  const model = seedModel({
    userId: u, datasourceId: ds, selectedTables: ['order_items', 'products', 'inventory_items'],
    dimensions: [
      { name: 'products.category', table: 'products', column: 'category', type: 'string', label: 'category' },
    ],
    measures: [
      { name: 'order_items.sale_price_sum', table: 'order_items', column: 'sale_price', aggregation: 'sum', label: 'sale_price' },
    ],
    joins: [
      { from_table: 'products', from_column: 'id', to_table: 'order_items', to_column: 'product_id', cardinality: { from: '1', to: '*' } },
      { from_table: 'inventory_items', from_column: 'id', to_table: 'order_items', to_column: 'inventory_item_id', cardinality: { from: '1', to: '1' } },
    ],
  });
  return { u, model };
}

describe('a 1:1 join leaves the fact a fact', () => {
  test('the measure aggregates per group, through the join', async () => {
    const { u, model } = starWithOneToOneDetail();
    const sql = await sqlFor(model, u, ['products.category'], ['order_items.sale_price_sum']);
    expect(sql).toMatch(/SUM\("order_items"\."sale_price"\)/);
    expect(sql).toMatch(/FROM "order_items" LEFT JOIN "products" ON/);
    // The grand-total shape: the same number on every row.
    expect(sql).not.toMatch(/\(SELECT SUM\("order_items"\."sale_price"\) FROM "order_items"\)/);
  });
});
