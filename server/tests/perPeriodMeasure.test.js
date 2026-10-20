// A value given per period on a dimension table (utils/sqlBuilder/dimMeasure.js,
// `perPeriod`): a branch's MONTHLY production target. Against nine months of
// production it read one month's target (Crédit Ardent: 875 % of target). Read
// on the distinct (month, branch) rows the facts reach, its total adds each
// month's targets of the branches present that month. Run on DuckDB.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const DIMENSIONS = [
  { name: 'sales.day', table: 'sales', column: 'day', type: 'date', label: 'Day' },
  { name: 'sales.day_year_month', table: 'sales', column: 'day', type: 'string', label: 'Month', datePart: 'year_month', datePartOf: 'sales.day' },
  { name: 'branches.branch', table: 'branches', column: 'branch', type: 'string', label: 'Branch' },
];
const MEASURES = [
  { name: 'sales.amount_sum', table: 'sales', column: 'amount', aggregation: 'sum', label: 'Sales' },
  { name: 'branches.target_sum', table: 'branches', column: 'target', aggregation: 'sum', label: 'Target (one month)' },
  { name: 'monthly_target', table: 'branches', column: 'target', aggregation: 'sum', label: 'Target', perPeriod: { dim: 'sales.day_year_month' } },
  { name: 'attainment', table: '', column: '', aggregation: 'custom', expression: '100.0 * (${sales.amount_sum}) / NULLIF((${monthly_target}), 0)', label: 'Attainment' },
];
const JOINS = [{ from_table: 'sales', from_column: 'branch', to_table: 'branches', to_column: 'branch', cardinality: { from: '*', to: '1' } }];

// A: 100 a month from January; B: 50 a month, from February.
// The last row has no date yet (a sale not booked): no month, so no target.
const SALES = [['2025-01-10', 'A', 90], [null, 'A', 0], ['2025-02-10', 'A', 110], ['2025-02-12', 'B', 40], ['2025-03-03', 'A', 60], ['2025-03-20', 'A', 40], ['2025-03-21', 'B', 60]];
const BRANCHES = [['A', 100], ['B', 50]];

let owner; let model;
beforeAll(() => {
  owner = seedUser({ role: 'editor' });
  model = seedModel({
    userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'duckdb' }),
    selectedTables: ['sales', 'branches'], measures: MEASURES, dimensions: DIMENSIONS, joins: JOINS,
  });
});

async function sqlFor(body) {
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner).send({ ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

function run(sql) {
  const script = `
    const duckdb = require(${JSON.stringify(require.resolve('duckdb-async'))});
    (async () => {
      const d = await duckdb.Database.create(':memory:');
      await d.run('CREATE TABLE sales (day DATE, branch VARCHAR, amount INTEGER)');
      await d.run('CREATE TABLE branches (branch VARCHAR, target INTEGER)');
      for (const [day, b, a] of ${JSON.stringify(SALES)}) await d.run(\`INSERT INTO sales VALUES (\${day ? \`'\${day}'\` : 'NULL'}, '\${b}', \${a})\`);
      for (const [b, t] of ${JSON.stringify(BRANCHES)}) await d.run(\`INSERT INTO branches VALUES ('\${b}', \${t})\`);
      const rows = await d.all(${JSON.stringify(sql)});
      process.stdout.write(JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
      await d.close();
    })();`;
  return JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', script]).toString());
}
const figures = (rows, key, value) => Object.fromEntries(rows.map((r) => [r[key], Number(r[value])]));

describe('a target given per month', () => {
  test('over the whole period: each month\'s targets of the branches present, added', async () => {
    const [row] = run(await sqlFor({ dimensionNames: [], measureNames: ['monthly_target', 'sales.amount_sum'] }));
    expect(Number(row.Target)).toBe(400);
    expect(Number(row.Sales)).toBe(400);
  });

  test('alone on a card, and inside a ratio', async () => {
    expect(Number(run(await sqlFor({ dimensionNames: [], measureNames: ['monthly_target'] }))[0].Target)).toBe(400);
    expect(Number(run(await sqlFor({ dimensionNames: [], measureNames: ['attainment'] }))[0].Attainment)).toBe(100);
  });

  test('by branch: its target times the months it had activity', async () => {
    const rows = run(await sqlFor({ dimensionNames: ['branches.branch'], measureNames: ['monthly_target', 'attainment'] }));
    expect(figures(rows, 'Branch', 'Target')).toEqual({ A: 300, B: 100 });
    expect(figures(rows, 'Branch', 'Attainment')).toEqual({ A: 100, B: 100 });
  });

  test('by month: the month\'s target, as without the period', async () => {
    const all = run(await sqlFor({ dimensionNames: ['sales.day_year_month'], measureNames: ['monthly_target', 'branches.target_sum'] }));
    // The sale with no date has no month, so no target of one.
    expect(all.find((r) => r.Month === null).Target).toBeNull();
    const rows = all.filter((r) => r.Month !== null);
    expect(figures(rows, 'Month', 'Target')).toEqual({ '2025-01': 100, '2025-02': 150, '2025-03': 150 });
    expect(figures(rows, 'Month', 'Target (one month)')).toEqual({ '2025-01': 100, '2025-02': 150, '2025-03': 150 });
  });

  test('a filter on the months keeps their targets only', async () => {
    const rows = run(await sqlFor({
      dimensionNames: [], measureNames: ['monthly_target'],
      widgetFilters: [{ field: 'sales.day_year_month', op: 'in', values: ['2025-02', '2025-03'] }],
    }));
    expect(Number(rows[0].Target)).toBe(300);
  });
});

describe('the total of a pivot by branch and month', () => {
  test('its parts travel, and their sums give the branch over its months', async () => {
    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
      .send({ dimensionNames: ['branches.branch', 'sales.day_year_month'], measureNames: ['attainment'], withTotalComponents: true, sqlOnly: true });
    expect(res.status).toBe(200);
    expect(res.body.totalComponents).toEqual({ Attainment: { op: 'percent', left: 'tc_sales_amount_sum', right: 'tc_monthly_target' } });
    const rows = run(res.body.sql).filter((r) => r.Month !== null);
    const sum = (b, k) => rows.filter((r) => r.Branch === b).reduce((s, r) => s + Number(r[k]), 0);
    // B: 100 sold over two months of 50.
    expect([sum('A', 'tc_sales_amount_sum'), sum('A', 'tc_monthly_target'), sum('B', 'tc_sales_amount_sum'), sum('B', 'tc_monthly_target')]).toEqual([300, 300, 100, 100]);
  });
});
