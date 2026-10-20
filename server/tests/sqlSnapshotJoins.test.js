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
  { name: '_calc.running', table: 'orders', column: 'amount', aggregation: 'sum', label: 'running', runningTotal: true },
  { name: '_calc.net_running', table: '', column: '', aggregation: 'custom', expression: '(${_calc.running}) - (${orders.amt_sum})', label: 'net running' },
];
const MONTH = { name: 'orders.month', table: 'orders', column: 'order_month', type: 'string', label: 'month' };

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

for (const dbType of ['postgres', 'redshift', 'snowflake', 'mysql', 'oracle', 'clickhouse', 'databricks', 'mssql']) {
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

for (const dbType of ['postgres', 'redshift', 'snowflake', 'mysql', 'oracle', 'clickhouse', 'databricks', 'mssql']) {
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

// Un filtre sur une dimension atteinte à travers une autre (fait → product →
// category) : chaque sous-requête de fait doit ponter la table intermédiaire.
// Sans le pont, la requête retombait sur la jointure directe des deux faits par
// la dimension partagée — chaque ligne de l'un multipliée par celles de l'autre.
// A running total: the aggregate summed over the periods of the query within
// the other grouped dimensions (utils/sqlBuilder/windowMeasure.js). Without a
// period among the dimensions, the plain aggregate.
test('a running total runs along the period dimension, within the others', async () => {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  // Orders is the fact: on the many side, so its measure is aggregated per group, not read as one total.
  const model = seedModel({ userId: owner, datasourceId: ds, selectedTables: TABLES, joins: JOINS.map((j) => ({ ...j, cardinality: { from: '*', to: '1' } })), dimensions: [...DIMENSIONS, MONTH], measures: MEASURES });
  const sqlOf = async (body) => (await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner).send({ ...body, sqlOnly: true })).body.sql;
  const byMonth = await sqlOf({ dimensionNames: ['customers.country', 'orders.month'], measureNames: ['_calc.running'] });
  expect(byMonth).toContain('SUM(SUM("orders"."amount")) OVER (PARTITION BY "customers"."country" ORDER BY "orders"."order_month" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "running"');
  // Referenced from an expression, the running total keeps its window.
  const composed = await sqlOf({ dimensionNames: ['orders.month'], measureNames: ['_calc.net_running'] });
  expect(composed).toContain('((SUM(CAST(SUM("orders"."amount") AS NUMERIC)) OVER (ORDER BY "orders"."order_month" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) - (SUM(CAST("orders"."amount" AS NUMERIC)))) AS "net running"');
  const noPeriod = await sqlOf({ dimensionNames: ['customers.country'], measureNames: ['_calc.running'] });
  expect(noPeriod).toContain('SUM("orders"."amount") AS "running"');
  expect(noPeriod).not.toContain('OVER');
});

test('multi-fact filtered through a snowflaked dimension keeps one subquery per fact', async () => {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({
    userId: owner, datasourceId: ds, selectedTables: [...MF_TABLES, 'category'],
    joins: [...MF_JOINS, { from_table: 'category', from_column: 'id', to_table: 'product', to_column: 'category_id', join_type: 'inner' }],
    dimensions: [...MF_DIMENSIONS, { name: 'category.name', table: 'category', column: 'name', type: 'string', label: 'categorie' }],
    measures: MF_MEASURES,
  });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ dimensionNames: ['product.name'], measureNames: ['sales.amt_sum', 'returns.amt_sum'], widgetFilters: [{ field: 'category.name', op: 'in', values: ['A'] }], sqlOnly: true });
  expect(res.status).toBe(200);
  const { sql } = res.body;
  expect(sql).toMatch(/FULL JOIN/);
  expect(sql.match(/FROM "sales"/g)).toHaveLength(1);
  expect(sql.match(/FROM "returns"/g)).toHaveLength(1);
  expect(sql.match(/JOIN "category"/g)).toHaveLength(2);
  expect(sql).toMatchSnapshot();
});

// The books and a budget sharing a calendar: a filtered measure (revenue =
// the lines of the income statement) and a custom expression (expenses, sign
// flipped) are computed inside their own fact's subquery, with the dimension
// their rules name joined there; the budget, which knows no journal, takes no
// filter on journals — the planner leaves it out of that fact's rollup too.
test('multi-fact with filtered and custom measures: one subquery per fact, a filter only where its dimension is reached', async () => {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const joins = [
    { from_table: 'entries', from_column: 'EcritureDate', to_table: 'calendar', to_column: 'Date', cardinality: { from: '*', to: '1' } },
    { from_table: 'budget', from_column: 'Month', to_table: 'calendar', to_column: 'Date', cardinality: { from: '*', to: '1' } },
    { from_table: 'entries', from_column: 'JournalCode', to_table: 'journals', to_column: 'JournalCode', cardinality: { from: '*', to: '1' } },
  ];
  const dimensions = [
    { name: 'calendar.YearMonth', table: 'calendar', column: 'YearMonth', type: 'string', label: 'Month' },
    { name: 'entries.LineNo', table: 'entries', column: 'LineNo', type: 'integer', label: 'Line number' },
    { name: 'journals.JournalLib', table: 'journals', column: 'JournalLib', type: 'string', label: 'Journal' },
  ];
  const measures = [
    { name: 'entries.Amount_sum', table: 'entries', column: 'Amount', aggregation: 'sum', label: 'Amount' },
    { name: '_calc.revenue', table: 'entries', column: 'Amount', aggregation: 'sum', label: 'Revenue', filterRules: [{ field: 'entries.LineNo', isMeasure: false, op: 'in', value: '', values: ['1', '2'] }], overrideFilters: false },
    { name: '_calc.expenses', table: '', column: '', aggregation: 'custom', expression: '-SUM("entries"."Amount")', label: 'Expenses', filterRules: [{ field: 'entries.LineNo', isMeasure: false, op: 'gte', value: '3', values: [] }], overrideFilters: false },
    { name: 'budget.Amount_sum', table: 'budget', column: 'Amount', aggregation: 'sum', label: 'Budget' },
    // Across the two facts: each side aggregated in its own subquery, the arithmetic on the joined grain.
    { name: '_calc.variance', table: '', column: '', aggregation: 'custom', expression: '(${entries.Amount_sum}) - (${budget.Amount_sum})', label: 'Variance' },
    { name: '_calc.running_amount', table: 'entries', column: 'Amount', aggregation: 'sum', label: 'Running amount', runningTotal: true },
  ];
  const model = seedModel({ userId: owner, datasourceId: ds, selectedTables: ['entries', 'budget', 'calendar', 'journals'], joins, dimensions, measures });
  const variance = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['calendar.YearMonth'], measureNames: ['entries.Amount_sum', 'budget.Amount_sum', '_calc.variance'], sqlOnly: true });
  expect(variance.status).toBe(200);
  expect(variance.body.sql).toMatch(/FULL JOIN/);
  expect(variance.body.sql.match(/FROM "entries"/g)).toHaveLength(1);
  expect(variance.body.sql.match(/FROM "budget"/g)).toHaveLength(1);
  expect(variance.body.sql).toContain('((COALESCE(__m1, 0)) - (COALESCE(__m2, 0))) AS "Variance"');
  expect(variance.body.sql).toContain('SUM("entries"."Amount") AS __m1');
  expect(variance.body.sql).toContain('SUM("budget"."Amount") AS __m2');
  // Ranked on the variance: still one subquery per fact, the outer query ordered by the alias and cut.
  const worst = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['calendar.YearMonth'], measureNames: ['_calc.variance'], widgetFilters: [{ field: '_calc.variance', isMeasure: true, op: 'bottom_n', value: '5', values: [] }], sqlOnly: true });
  expect(worst.status).toBe(200);
  expect(worst.body.sql).toMatch(/FULL JOIN/);
  expect(worst.body.sql).toMatch(/ORDER BY "Variance" ASC NULLS LAST LIMIT 5$/);
  // Ranked on a measure the visual does not show: it rides along hidden, the outer query orders by it.
  const hiddenRank = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['calendar.YearMonth'], measureNames: ['entries.Amount_sum', 'budget.Amount_sum'], widgetFilters: [{ field: '_calc.variance', isMeasure: true, op: 'bottom_n', value: '3', values: [] }], sqlOnly: true });
  expect(hiddenRank.body.sql).toMatch(/FULL JOIN/);
  expect(hiddenRank.body.sql).toContain('((COALESCE(__m');
  expect(hiddenRank.body.sql).toMatch(/AS "__rank" FROM .*ORDER BY "__rank" ASC NULLS LAST LIMIT 3$/);
  // A pivot's totals of the variance: each part summed in its own fact's subquery under a hidden alias.
  const totals = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['calendar.YearMonth'], measureNames: ['_calc.variance'], withTotalComponents: true, sqlOnly: true });
  expect(totals.body.totalComponents).toEqual({ Variance: { op: 'subtract', left: 'tc_entries_Amount_sum', right: 'tc_budget_Amount_sum' } });
  expect(totals.body.sql).toMatch(/FULL JOIN/);
  expect(totals.body.sql).toContain('AS "tc_entries_Amount_sum"');
  expect(totals.body.sql).toContain('AS "tc_budget_Amount_sum"');
  // A running total of one fact keeps its window inside that fact's subquery.
  const cumulative = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['calendar.YearMonth'], measureNames: ['_calc.running_amount', 'budget.Amount_sum'], sqlOnly: true });
  expect(cumulative.body.sql).toContain('SUM(SUM("entries"."Amount")) OVER (ORDER BY "calendar"."YearMonth" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "Running amount"');
  expect(cumulative.body.sql).toMatch(/FULL JOIN/);
  const alone = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: [], measureNames: ['_calc.variance'], sqlOnly: true });
  expect(alone.body.sql).toMatch(/CROSS JOIN/);
  expect(alone.body.sql).toContain('((COALESCE(__m1, 0)) - (COALESCE(__m2, 0))) AS "Variance"');
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ dimensionNames: ['calendar.YearMonth'], measureNames: ['_calc.revenue', '_calc.expenses', 'budget.Amount_sum'], widgetFilters: [{ field: 'journals.JournalLib', op: 'in', values: ['Sales'] }], sqlOnly: true });
  expect(res.status).toBe(200);
  const { sql } = res.body;
  expect(sql).toMatch(/FULL JOIN/);
  expect(sql.match(/FROM "entries"/g)).toHaveLength(1);
  expect(sql.match(/FROM "budget"/g)).toHaveLength(1);
  // The journal filter sits in the entries' subquery only; the budget's has no WHERE.
  expect(sql.match(/JOIN "journals"/g)).toHaveLength(1);
  expect(sql.match(/WHERE/g)).toHaveLength(1);
  expect(sql).toMatch(/SUM\(CASE WHEN .*"LineNo".* THEN .*"Amount".* END\) AS "Revenue"/);
  expect(sql).toMatch(/-SUM\(CASE WHEN .*"LineNo".* THEN .*"Amount".* END\)\) AS "Expenses"/);
  expect(sql).toMatchSnapshot();
});

// Même requête multi-faits, sans dimension : un scorecard qui n'a aucun grain à
// raccorder, donc CROSS JOIN au lieu de FULL JOIN. Ce chemin n'était couvert par
// aucun snapshot, et il tombait sur SQL Server pour une deuxième raison — un
// OFFSET…FETCH sans ORDER BY est une erreur de syntaxe en T-SQL.
for (const dbType of ['postgres', 'redshift', 'snowflake', 'mysql', 'oracle', 'clickhouse', 'databricks', 'mssql']) {
  test(`multi-fact sans grain SQL is stable — ${dbType}`, async () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner, dbType });
    const model = seedModel({ userId: owner, datasourceId: ds, selectedTables: MF_TABLES, joins: MF_JOINS, dimensions: MF_DIMENSIONS, measures: MF_MEASURES });
    const res = await request(app)
      .post(`/api/models/${model}/query`)
      .set('x-test-user', owner)
      .send({ dimensionNames: [], measureNames: ['sales.amt_sum', 'returns.amt_sum'], sqlOnly: true });
    expect(res.status).toBe(200);
    expect(res.body.sql).toMatchSnapshot();
  });
}
