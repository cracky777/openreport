// Calculated dimensions: a dimension defined by a free SQL expression instead
// of a table/column. The compiler must project and group by the expression,
// filter against the same expression, pull the tables it references into the
// JOIN graph (and therefore into the RLS reachability check), refuse
// aggregates, and keep such dimensions out of the rollup cache.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');
const { dimensionTables, readableTables } = require('../utils/sqlBuilder/dimensionTables');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const TABLES = ['orders', 'customers'];
// orders (fact, many) → customers (dim, one).
const JOINS = [{ from_table: 'orders', from_column: 'customer_id', to_table: 'customers', to_column: 'id', join_type: 'inner', cardinality: { from: '*', to: '1' } }];
const DIMENSIONS = [
  { name: 'customers.country', table: 'customers', column: 'country', type: 'string', label: 'country' },
  { name: 'orders.status', table: 'orders', column: 'status', type: 'string', label: 'status' },
  // Model-level calculated dimension over the joined table.
  { name: '_calcdim.region', label: 'Region', type: 'string', table: '', column: '',
    expression: "CASE WHEN \"customers\".\"country\" IN ('FR', 'DE') THEN 'EU' ELSE 'Other' END" },
  { name: '_calcdim.big', label: 'Big order', type: 'boolean', table: '', column: '',
    expression: '"orders"."amount" > 100' },
  { name: '_calcdim.bad', label: 'Bad', type: 'decimal', table: '', column: '',
    expression: 'SUM("orders"."amount")' },
];
const MEASURES = [
  { name: 'orders.amt_sum', table: 'orders', column: 'amount', aggregation: 'sum', label: 'total' },
];

function seed(dbType = 'postgres') {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType });
  const model = seedModel({ userId: owner, datasourceId: ds, selectedTables: TABLES, joins: JOINS, dimensions: DIMENSIONS, measures: MEASURES });
  return { owner, model };
}

async function compile(body, ctx = seed()) {
  const res = await request(app)
    .post(`/api/models/${ctx.model}/query`)
    .set('x-test-user', ctx.owner)
    .send({ ...body, sqlOnly: true });
  return res;
}

describe('dimensionTables()', () => {
  const fields = [{ table: 'orders', column: 'amount' }, { table: 'customers', column: 'country' }, { table: 'products', column: 'sku' }];

  test('a column dimension names its own table', () => {
    expect(dimensionTables({ table: 'orders', column: 'status' }, fields)).toEqual(['orders']);
  });

  test('an expression dimension lists the tables of its quoted and unquoted references', () => {
    expect(dimensionTables({ expression: '"customers"."country" || orders.status' }, fields).sort()).toEqual(['customers', 'orders']);
  });

  test('a bare column name that happens to match does not pull a table in', () => {
    expect(dimensionTables({ expression: "CASE WHEN sku = 'x' THEN 1 END" }, fields)).toEqual([]);
  });

  test('the home table is always included, alongside the referenced ones', () => {
    expect(dimensionTables({ table: 'orders', expression: 'UPPER(status) || "customers"."country"' }, fields).sort()).toEqual(['customers', 'orders']);
  });
});

describe('readableTables()', () => {
  // orders (*) → customers (1) → countries (1); orders (1) ↔ invoices (1); the
  // regions join has no cardinality and must not be crossed either way.
  const joins = [
    { from_table: 'orders', to_table: 'customers', cardinality: { from: '*', to: '1' } },
    { from_table: 'customers', to_table: 'countries', cardinality: { from: '*', to: '1' } },
    { from_table: 'orders', to_table: 'invoices', cardinality: { from: '1', to: '1' } },
    { from_table: 'regions', to_table: 'countries' },
  ];

  test('a fact reads its dimensions, transitively, and 1:1 tables', () => {
    expect([...readableTables('orders', joins)].sort()).toEqual(['countries', 'customers', 'invoices', 'orders']);
  });

  test('a dimension reads its parents but never its children', () => {
    expect([...readableTables('customers', joins)].sort()).toEqual(['countries', 'customers']);
  });

  test('a join without cardinality is never crossed', () => {
    expect([...readableTables('countries', joins)].sort()).toEqual(['countries']);
    expect([...readableTables('regions', joins)].sort()).toEqual(['regions']);
  });
});

describe('a join without cardinality', () => {
  test('is refused with a message that names the missing cardinality', async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    const model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['population', 'finance'],
      joins: [{ from_table: 'population', from_column: 'code', to_table: 'finance', to_column: 'code', join_type: 'inner' }],
      dimensions: [{ name: 'finance.code', table: 'finance', column: 'code', type: 'string', label: 'code' }],
      measures: [{ name: 'finance.debt_sum', table: 'finance', column: 'debt', aggregation: 'sum', label: 'debt' }],
    });
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
      .send({
        dimensionNames: ['_calcdim.x'], measureNames: ['finance.debt_sum'],
        extraDimensions: [{ name: '_calcdim.x', label: 'X', type: 'string', table: 'finance', column: '', expression: 'code || "population"."name"' }],
        sqlOnly: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no cardinality/);
    expect(res.body.error).toContain('"population"');
  });
});

describe('calculated dimensions in /query', () => {
  test('projected and grouped by the expression, with its table joined', async () => {
    const res = await compile({ dimensionNames: ['_calcdim.region'], measureNames: ['orders.amt_sum'] });
    expect(res.status).toBe(200);
    const sql = res.body.sql;
    expect(sql).toContain('(CASE WHEN "customers"."country" IN (\'FR\', \'DE\') THEN \'EU\' ELSE \'Other\' END) AS "Region"');
    expect(sql).toMatch(/GROUP BY \(CASE WHEN "customers"."country"/);
    expect(sql).toMatch(/JOIN "(customers|orders)" ON/);
    expect(sql).not.toContain('undefined');
  });

  test('slicer and widget filters compare against the same expression', async () => {
    const res = await compile({
      dimensionNames: ['orders.status'],
      measureNames: ['orders.amt_sum'],
      filters: { '_calcdim.region': ['EU'] },
      widgetFilters: [{ field: '_calcdim.big', op: 'eq', value: 'true' }],
    });
    expect(res.status).toBe(200);
    const sql = res.body.sql;
    expect(sql).toMatch(/\(CASE WHEN "customers"."country" IN \('FR', 'DE'\) THEN 'EU' ELSE 'Other' END\) = 'EU'/);
    expect(sql).toMatch(/\("orders"."amount" > 100\) = /);
    expect(sql).toMatch(/"customers"[\s\S]*JOIN|JOIN "customers"/); // pulled into the FROM by the filter alone
    expect(sql).not.toContain('undefined');
  });

  test('a dimension attached to a table may use bare column names', async () => {
    const res = await compile({
      dimensionNames: ['_calcdim.short'],
      measureNames: ['orders.amt_sum'],
      extraDimensions: [{ name: '_calcdim.short', label: 'Short', type: 'string', table: 'orders', column: '', expression: 'LEFT(status, 3)' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.sql).toContain('(LEFT(status, 3)) AS "Short"');
    expect(res.body.sql).toMatch(/FROM "orders"/);
    expect(res.body.sql).not.toContain('undefined');
  });

  test('a dimension with neither a table nor a qualified reference is refused', async () => {
    const res = await compile({
      dimensionNames: ['_calcdim.loose'],
      measureNames: ['orders.amt_sum'],
      extraDimensions: [{ name: '_calcdim.loose', label: 'Loose', type: 'string', expression: 'LEFT(status, 3)' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attach it to a table/);
  });

  // The SQL editor's Test: one sample value, without the DISTINCT + ORDER BY
  // that a dimension-only query normally gets (both scan the whole table).
  test('sample mode returns the first raw row: no DISTINCT, no ORDER BY, LIMIT 1', async () => {
    const res = await compile({ dimensionNames: ['_calcdim.region'], measureNames: [], sample: true, limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.sql).not.toContain('DISTINCT');
    expect(res.body.sql).not.toContain('ORDER BY');
    expect(res.body.sql).toMatch(/ LIMIT 1$/);
  });

  test('sample mode uses TOP 1 where OFFSET…FETCH would demand an ORDER BY', async () => {
    const res = await compile({ dimensionNames: ['_calcdim.region'], measureNames: [], sample: true, limit: 1 }, seed('mssql'));
    expect(res.status).toBe(200);
    expect(res.body.sql).toMatch(/^SELECT TOP 1 /);
    expect(res.body.sql).not.toContain('ORDER BY');
    expect(res.body.sql).not.toContain('FETCH');
  });

  test('an aggregate inside a dimension expression is refused with a readable error', async () => {
    const res = await compile({ dimensionNames: ['_calcdim.bad'], measureNames: ['orders.amt_sum'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aggregate/);
    expect(res.body.error).toContain('"Bad"'); // the label, not the technical name
  });

  test('a report-scoped calculated dimension from the model owner works like a model one', async () => {
    const res = await compile({
      dimensionNames: ['_calcdim.upper'],
      measureNames: ['orders.amt_sum'],
      extraDimensions: [{ name: '_calcdim.upper', label: 'Upper', type: 'string', expression: 'UPPER("orders"."status")' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.sql).toContain('(UPPER("orders"."status")) AS "Upper"');
  });
});

describe('calculated dimensions and RLS', () => {
  // RLS keyed on customers. The expression's table is registered like a column
  // dimension's, so the row filter lands on the query, and a table nothing
  // joins to is refused outright rather than joined in unfiltered.
  let owner, viewer, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor', email: 'owner@calc.io' });
    viewer = seedUser({ role: 'viewer', email: 'v@calc.io' });
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['customers', 'orders', 'audit'],
      joins: JOINS,
      dimensions: [
        ...DIMENSIONS,
        { name: '_calcdim.audit', label: 'Audit', type: 'string', expression: '"audit"."actor"' },
      ],
      measures: MEASURES,
      rls: { enabled: true, table: 'customers', primaryKey: 'id', rules: { c1: ['v@calc.io'] } },
    });
    seedReport({ userId: owner, modelId: model, isPublic: 1 });
  });

  test('an expression spanning two joined tables follows the model join, never a cross join', async () => {
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
      .send({
        dimensionNames: ['_calcdim.span'], measureNames: ['orders.amt_sum'],
        extraDimensions: [{ name: '_calcdim.span', label: 'Span', type: 'string', table: 'orders', column: '',
          expression: 'status || \' / \' || "customers"."country"' }],
        sqlOnly: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.sql).toMatch(/JOIN "(customers|orders)" ON "orders"."customer_id" = "customers"."id"/);
    expect(res.body.sql).not.toMatch(/FROM "\w+", "\w+"/);
  });

  test('a dimension on the one side may not read the many side (it would fan out)', async () => {
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
      .send({
        dimensionNames: ['_calcdim.fan'], measureNames: ['orders.amt_sum'],
        extraDimensions: [{ name: '_calcdim.fan', label: 'Fan', type: 'string', table: 'customers', column: '',
          expression: 'country || "orders"."status"' }],
        sqlOnly: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"orders"/);
    expect(res.body.error).toMatch(/repeat|fan/i);
  });

  test('an expression spanning two unjoined tables is refused', async () => {
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
      .send({
        dimensionNames: ['_calcdim.span2'], measureNames: ['orders.amt_sum'],
        extraDimensions: [{ name: '_calcdim.span2', label: 'Span2', type: 'string', table: 'orders', column: '',
          expression: 'status || "audit"."actor"' }],
        sqlOnly: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not joined to "orders"/);
  });

  test('a viewer grouping on an expression over a joined table gets the row filter', async () => {
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', viewer)
      .send({ dimensionNames: ['_calcdim.region'], measureNames: ['orders.amt_sum'], sqlOnly: true });
    expect(res.status).toBe(200);
    expect(res.body.sql).toContain("'c1'");
    expect(res.body.sql).not.toMatch(/1 = 0/);
  });

  // A legacy dimension with no home table over an unjoined table: whichever
  // way the FROM builder settles it, the viewer never gets rows the RLS
  // table cannot constrain — refused, or denied every row.
  test('an expression over a table with no join path is refused or denied, never joined unfiltered', async () => {
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', viewer)
      .send({
        dimensionNames: ['orders.status'], measureNames: ['orders.amt_sum'],
        widgetFilters: [{ field: '_calcdim.audit', op: 'eq', value: 'root' }],
        sqlOnly: true,
      });
    if (res.status === 200) expect(res.body.sql).toMatch(/1 = 0/);
    else expect(res.status).toBe(400);
  });
});
