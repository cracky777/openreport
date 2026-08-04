// Golden SQL snapshots for the /query paths the aggregate-only sqlSnapshot suite
// doesn't reach: multi-table JOIN construction + table ordering, the WHERE filter
// clause builder (buildScalarClause), and dialectal ORDER BY / LIMIT / OFFSET.
// These are the guard for the next god-file extractions (FROM/JOIN, filterClause,
// orderLimit) — the compiled SQL must stay byte-identical across the move.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

// orders (fact) joined to customers (dim) on orders.customer_id = customers.id.
const TABLES = ['orders', 'customers'];
const JOINS = [{ from_table: 'orders', from_column: 'customer_id', to_table: 'customers', to_column: 'id', join_type: 'inner' }];
const DIMENSIONS = [
  { name: 'customers.country', table: 'customers', column: 'country', type: 'string', label: 'country' },
  { name: 'orders.status', table: 'orders', column: 'status', type: 'string', label: 'status' },
];
const MEASURES = [
  { name: 'orders.amt_sum', table: 'orders', column: 'amount', aggregation: 'sum', label: 'total' },
  { name: 'orders.cnt', table: 'orders', column: 'id', aggregation: 'count', label: 'nb' },
];

function seedJoinModel(dbType) {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType });
  const model = seedModel({ userId: owner, datasourceId: ds, selectedTables: TABLES, joins: JOINS, dimensions: DIMENSIONS, measures: MEASURES });
  return { owner, model };
}

async function compile(dbType, body) {
  const { owner, model } = seedJoinModel(dbType);
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

for (const dbType of ['postgres', 'mysql', 'mssql']) {
  // Dim on the joined table + a fact measure → forces the INNER JOIN + ON clause
  // and the group/order over a cross-table projection.
  test(`join + group SQL is stable — ${dbType}`, async () => {
    const sql = await compile(dbType, {
      dimensionNames: ['customers.country'],
      measureNames: ['orders.amt_sum', 'orders.cnt'],
    });
    expect(sql).toMatchSnapshot();
  });

  // A dimension WHERE filter (buildScalarClause: eq + in) plus limit/offset — the
  // mssql branch swaps LIMIT for OFFSET … ROWS FETCH NEXT … ROWS ONLY.
  test(`join + filter + limit/offset SQL is stable — ${dbType}`, async () => {
    const sql = await compile(dbType, {
      dimensionNames: ['customers.country'],
      measureNames: ['orders.amt_sum'],
      widgetFilters: [
        { field: 'orders.status', op: 'eq', value: 'paid' },
        { field: 'customers.country', op: 'in', values: ['FR', 'DE'] },
      ],
      limit: 10,
      offset: 20,
    });
    expect(sql).toMatchSnapshot();
  });
}

// Two fact tables (sales + returns) conformed on a shared product dimension →
// the fan-out-avoidance path (multiFactBody): each fact is aggregated in its own
// subquery and the results are joined on the grain, never cross-joined.
const MF_TABLES = ['product', 'sales', 'returns'];
// from = the shared dim (product), to = each fact — so realFacts classifies
// sales/returns as the "many" side (the fan-out avoidance actually kicks in).
const MF_JOINS = [
  { from_table: 'product', from_column: 'id', to_table: 'sales', to_column: 'product_id', join_type: 'inner' },
  { from_table: 'product', from_column: 'id', to_table: 'returns', to_column: 'product_id', join_type: 'inner' },
];
const MF_DIMENSIONS = [{ name: 'product.name', table: 'product', column: 'name', type: 'string', label: 'produit' }];
const MF_MEASURES = [
  { name: 'sales.amt_sum', table: 'sales', column: 'amount', aggregation: 'sum', label: 'ventes' },
  { name: 'returns.amt_sum', table: 'returns', column: 'amount', aggregation: 'sum', label: 'retours' },
];

for (const dbType of ['postgres', 'mysql', 'mssql']) {
  test(`multi-fact fan-out SQL is stable — ${dbType}`, async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner, dbType });
    const model = seedModel({ userId: owner, datasourceId: ds, selectedTables: MF_TABLES, joins: MF_JOINS, dimensions: MF_DIMENSIONS, measures: MF_MEASURES });
    const res = await request(app)
      .post(`/api/models/${model}/query`)
      .set('x-test-user', owner)
      .send({ dimensionNames: ['product.name'], measureNames: ['sales.amt_sum', 'returns.amt_sum'], sqlOnly: true });
    expect(res.status).toBe(200);
    expect(res.body.sql).toMatchSnapshot();
  });
}
