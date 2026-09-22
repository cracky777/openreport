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

// A custom expression pulls in the tables it NAMES, not every table owning a
// column of the same name. Two facts hang off the same dimensions and share
// their key columns (`id_call`, `id_status`): a ratio on the first fact used to
// register the second one too — its column names appeared inside the quoted
// refs — and the LEFT JOIN through `d_status` multiplied every count by the
// second fact's rows per status. Power BI showed 8 %, the visual showed
// something else, and on a real volume the query timed out.
function twoFactsSharingColumnNames() {
  const u = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: u, dbType: 'postgres' });
  const model = seedModel({
    userId: u, datasourceId: ds, selectedTables: ['f_calls', 'f_calls_agg', 'd_status', 'd_call'],
    dimensions: [
      { name: 'd_status.label', table: 'd_status', column: 'label', type: 'string', label: 'label' },
      { name: 'd_status.id_status', table: 'd_status', column: 'id_status', type: 'integer', label: 'id_status' },
      { name: 'd_call.id_call', table: 'd_call', column: 'id_call', type: 'integer', label: 'id_call' },
      { name: 'f_calls_agg.id_call', table: 'f_calls_agg', column: 'id_call', type: 'integer', label: 'agg id_call' },
    ],
    measures: [
      { name: 'lost', table: 'f_calls', column: 'id_call', aggregation: 'count', label: 'lost',
        filterRules: [{ field: 'd_status.label', isMeasure: false, op: 'eq', value: 'Lost', values: [] }], overrideFilters: false },
      { name: 'handled', table: 'f_calls', column: 'id_call', aggregation: 'count', label: 'handled',
        filterRules: [{ field: 'd_status.label', isMeasure: false, op: 'eq', value: 'Handled', values: [] }], overrideFilters: false },
      { name: 'ratio', table: '', column: '', aggregation: 'custom', label: 'ratio',
        expression: '((${lost}) / NULLIF((${handled}), 0)) * 100' },
      { name: 'agg_sum', table: 'f_calls_agg', column: 'duration', aggregation: 'sum', label: 'agg_sum' },
    ],
    joins: [
      { from_table: 'd_status', from_column: 'id_status', to_table: 'f_calls', to_column: 'id_status', cardinality: { from: '1', to: '*' } },
      { from_table: 'd_status', from_column: 'id_status', to_table: 'f_calls_agg', to_column: 'id_status', cardinality: { from: '1', to: '*' } },
      { from_table: 'd_call', from_column: 'id_call', to_table: 'f_calls', to_column: 'id_call', cardinality: { from: '1', to: '*' } },
      { from_table: 'd_call', from_column: 'id_call', to_table: 'f_calls_agg', to_column: 'id_call', cardinality: { from: '1', to: '*' } },
    ],
  });
  return { u, model };
}

describe('a custom expression joins the tables it names, not every table sharing a column name', () => {
  test('a ratio of two filtered counts on one fact never joins the other fact', async () => {
    const { u, model } = twoFactsSharingColumnNames();
    const sql = await sqlFor(model, u, [], ['ratio']);
    expect(sql).toMatch(/FROM "f_calls" LEFT JOIN "d_status" ON/);
    expect(sql).not.toMatch(/"f_calls_agg"/);
    expect(sql).not.toMatch(/"d_call"/);
  });

  test('a quoted ref to the other fact still joins it', async () => {
    const { u, model } = twoFactsSharingColumnNames();
    const sql = await sqlFor(model, u, ['d_status.label'], ['agg_sum']);
    expect(sql).toMatch(/FROM "f_calls_agg" LEFT JOIN "d_status" ON/);
    expect(sql).not.toMatch(/"f_calls"[^_]/);
  });
});
