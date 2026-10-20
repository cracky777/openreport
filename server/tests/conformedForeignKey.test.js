// Two facts sharing a dimension (sales and store traffic, both joined to the
// stores): a visual grouped by the FIRST fact's foreign key (sales.store)
// joined the second fact through the stores and summed it once per sales row
// (Marché Plus: a basket of 2.70 € instead of 62 €). The foreign key is read as
// the dimension's key, so each fact is aggregated on its own (joinGraph.
// conformedDimension); a month of the first fact is read on the second fact's
// own date (multiFact.js). Run on DuckDB.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const DIMENSIONS = [
  { name: 'sales.store', table: 'sales', column: 'store', type: 'string', label: 'Store' },
  { name: 'stores.store', table: 'stores', column: 'store', type: 'string', label: 'Store (list)' },
  { name: 'sales.day', table: 'sales', column: 'day', type: 'date', label: 'Day' },
  { name: 'sales.day_year_month', table: 'sales', column: 'day', type: 'string', label: 'Month', datePart: 'year_month', datePartOf: 'sales.day' },
  { name: 'traffic.day', table: 'traffic', column: 'day', type: 'date', label: 'Traffic day' },
];
const MEASURES = [
  { name: 'sales.amount_sum', table: 'sales', column: 'amount', aggregation: 'sum', label: 'Sales' },
  { name: 'traffic.tickets_sum', table: 'traffic', column: 'tickets', aggregation: 'sum', label: 'Tickets' },
  { name: 'basket', table: '', column: '', aggregation: 'custom', expression: '(${sales.amount_sum}) / NULLIF((${traffic.tickets_sum}), 0)', label: 'Basket' },
];
const JOINS = [
  { from_table: 'sales', from_column: 'store', to_table: 'stores', to_column: 'store', cardinality: { from: '*', to: '1' } },
  { from_table: 'traffic', from_column: 'store', to_table: 'stores', to_column: 'store', cardinality: { from: '*', to: '1' } },
];
// A: three aisles a day over two days (600), 10 tickets a day (20); B: 100 over one day, 4 tickets.
// January: A's first day and B; February: A's second day.
const SALES = [
  ['A', '2025-01-02', 100], ['A', '2025-01-02', 100], ['A', '2025-01-02', 100],
  ['A', '2025-02-03', 100], ['A', '2025-02-03', 100], ['A', '2025-02-03', 100],
  ['B', '2025-01-02', 100],
];
const TRAFFIC = [['A', '2025-01-02', 10], ['A', '2025-02-03', 10], ['B', '2025-01-02', 4]];

let owner; let model;
beforeAll(() => {
  owner = seedUser({ role: 'editor' });
  model = seedModel({
    userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'duckdb' }),
    selectedTables: ['sales', 'traffic', 'stores'], measures: MEASURES, dimensions: DIMENSIONS, joins: JOINS,
  });
});

function run(sql) {
  const script = `
    const duckdb = require(${JSON.stringify(require.resolve('duckdb-async'))});
    (async () => {
      const d = await duckdb.Database.create(':memory:');
      await d.run('CREATE TABLE sales (store VARCHAR, day DATE, amount INTEGER)');
      await d.run('CREATE TABLE traffic (store VARCHAR, day DATE, tickets INTEGER)');
      await d.run("CREATE TABLE stores AS SELECT * FROM (VALUES ('A'), ('B')) t(store)");
      for (const [s, day, a] of ${JSON.stringify(SALES)}) await d.run(\`INSERT INTO sales VALUES ('\${s}', '\${day}', \${a})\`);
      for (const [s, day, t] of ${JSON.stringify(TRAFFIC)}) await d.run(\`INSERT INTO traffic VALUES ('\${s}', '\${day}', \${t})\`);
      const rows = await d.all(${JSON.stringify(sql)});
      process.stdout.write(JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
      await d.close();
    })();`;
  return JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', script]).toString());
}
const sqlFor = async (body) => {
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner).send({ ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
};

test('grouped by the first fact\'s foreign key, each fact is summed on its own', async () => {
  const rows = run(await sqlFor({ dimensionNames: ['sales.store'], measureNames: ['basket', 'traffic.tickets_sum'] }));
  expect(Object.fromEntries(rows.map((r) => [r.Store, [Number(r.Basket), Number(r.Tickets)]]))).toEqual({ A: [30, 20], B: [25, 4] });
});

test('by month: each fact on the month of its own date, the two meeting on the month', async () => {
  const rows = run(await sqlFor({ dimensionNames: ['sales.day_year_month'], measureNames: ['basket'] }));
  // January: 400 over 14 tickets; February: 300 over 10.
  expect(Object.fromEntries(rows.map((r) => [r.Month, Math.round(Number(r.Basket) * 100) / 100]))).toEqual({ '2025-01': 28.57, '2025-02': 30 });
});

test('one fact only: its own column, as before', async () => {
  expect(await sqlFor({ dimensionNames: ['sales.store'], measureNames: ['sales.amount_sum'] })).toContain('GROUP BY "sales"."store"');
});
