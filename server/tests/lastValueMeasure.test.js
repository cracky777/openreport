// A measure read on its last date (`lastValue = { dim }`, utils/sqlBuilder/lastValue.js):
// a stock summed over the days meant nothing (Karim's 16 million pallets).
// Its aggregate keeps the rows of the last date the visual's rows hold — per
// period when the visual groups by one, else the last date the slicers keep —
// wherever it is shown, referenced or ranked; never from a rollup. The SQL is
// run on DuckDB to check the figures, not only its shape.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');
const { reachesLastValue } = require('../utils/sqlBuilder/lastValue');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const DIMENSIONS = [
  { name: 'items.wh', table: 'items', column: 'wh', type: 'string', label: 'Warehouse' },
  { name: 'items.d', table: 'items', column: 'd', type: 'date', label: 'Date' },
  { name: 'items.d_year_month', table: 'items', column: 'd', type: 'string', datePart: 'year_month', label: 'Month' },
];
const LAST = { dim: 'items.d' };
const MEASURES = [
  { name: 'items.stock_sum', table: 'items', column: 'stock', aggregation: 'sum', label: 'Stock (summed)' },
  { name: 'items.stock_last', table: 'items', column: 'stock', aggregation: 'sum', label: 'Stock', lastValue: LAST },
  { name: 'items.stock_last_a', table: 'items', column: 'stock', aggregation: 'sum', label: 'Stock A', lastValue: LAST, filterRules: [{ field: 'items.wh', op: 'eq', value: 'A', values: ['A'] }], overrideFilters: false },
  { name: 'items.gap', table: '', column: '', aggregation: 'custom', expression: '(${items.stock_last}) - (${items.stock_sum})', label: 'Gap' },
  { name: 'items.bad_last', table: 'items', column: 'stock', aggregation: 'sum', label: 'Bad', lastValue: { dim: 'items.wh' } },
];

const ROWS = [
  ['2025-01-30', 'A', 10], ['2025-01-30', 'B', 20],
  ['2025-01-31', 'A', 11], ['2025-01-31', 'B', 21],
  ['2025-02-14', 'A', 5], ['2025-02-14', 'B', 6],
];

let owner; let pgModel; let duckModel;
beforeAll(() => {
  owner = seedUser({ role: 'editor' });
  pgModel = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'postgres' }), measures: MEASURES, dimensions: DIMENSIONS });
  duckModel = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'duckdb' }), measures: MEASURES, dimensions: DIMENSIONS });
});

async function sqlFor(model, body) {
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner).send({ ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

// The statement run on an in-memory DuckDB holding ROWS, in a child process
// (the native module is loaded outside Jest's sandbox, as relationships.test.js does).
function run(sql) {
  const script = `
    const duckdb = require(${JSON.stringify(require.resolve('duckdb-async'))});
    (async () => {
      const d = await duckdb.Database.create(':memory:');
      await d.run('CREATE TABLE items (d DATE, wh VARCHAR, stock INTEGER)');
      for (const [d0, w, s] of ${JSON.stringify(ROWS)}) await d.run(\`INSERT INTO items VALUES ('\${d0}', '\${w}', \${s})\`);
      const rows = await d.all(${JSON.stringify(sql)});
      process.stdout.write(JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
      await d.close();
    })();`;
  return JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', script]).toString());
}
const figures = (rows, key, value) => Object.fromEntries(rows.map((r) => [r[key], Number(r[value])]));

describe('the SQL', () => {
  test('the aggregate keeps the rows of the last date, read on the same FROM and WHERE', async () => {
    const sql = await sqlFor(pgModel, { dimensionNames: ['items.wh'], measureNames: ['items.stock_last'], widgetFilters: [{ field: 'items.wh', op: 'neq', value: 'Z', values: ['Z'] }] });
    expect(sql).toMatch(/SUM\(CASE WHEN "items"\."d" IN \(SELECT MAX\("items"\."d"\) FROM "items" WHERE .*'Z'.*\) THEN/);
    expect(sql).not.toContain('__LAST_DATE_');
    // Grouped by a warehouse, not a period: one last date for all.
    expect(sql).not.toMatch(/SELECT MAX\([^)]*\)\) FROM "items"[^)]* GROUP BY/);
  });
  test('grouped by a period, each period reads its own last date', async () => {
    const sql = await sqlFor(pgModel, { dimensionNames: ['items.d_year_month'], measureNames: ['items.stock_last'] });
    expect(sql).toMatch(/IN \(SELECT MAX\("items"\."d"\) FROM "items" GROUP BY /);
  });
  test('a date that is not a plain date dimension leaves the measure a plain sum', async () => {
    const sql = await sqlFor(pgModel, { dimensionNames: [], measureNames: ['items.bad_last'] });
    expect(sql).not.toContain('MAX(');
  });
  test('reached through a reference: never a rollup', () => {
    expect(reachesLastValue(['items.gap'], MEASURES)).toBe(true);
    expect(reachesLastValue(['items.stock_sum'], MEASURES)).toBe(false);
  });
});

describe('the figures', () => {
  test('a scorecard: the stock of the last day, not the days added up', async () => {
    const rows = run(await sqlFor(duckModel, { dimensionNames: [], measureNames: ['items.stock_last', 'items.stock_sum'] }));
    expect(Number(rows[0].Stock)).toBe(11);
    expect(Number(rows[0]['Stock (summed)'])).toBe(73);
  });
  test('per warehouse: each on the last day', async () => {
    const rows = run(await sqlFor(duckModel, { dimensionNames: ['items.wh'], measureNames: ['items.stock_last'] }));
    expect(figures(rows, 'Warehouse', 'Stock')).toEqual({ A: 5, B: 6 });
  });
  test('per month: the closing stock of each month', async () => {
    const rows = run(await sqlFor(duckModel, { dimensionNames: ['items.d_year_month'], measureNames: ['items.stock_last'] }));
    expect(figures(rows, 'Month', 'Stock')).toEqual({ '2025-01': 32, '2025-02': 11 });
  });
  test('a slicer on the dates moves the last date with it', async () => {
    const january = { field: 'items.d', op: 'between', value: ['2025-01-01', '2025-01-31'], values: ['2025-01-01', '2025-01-31'] };
    const rows = run(await sqlFor(duckModel, { dimensionNames: [], measureNames: ['items.stock_last'], widgetFilters: [january] }));
    expect(Number(rows[0].Stock)).toBe(32);
  });
  test('with its own rules, and referenced by another measure', async () => {
    const rows = run(await sqlFor(duckModel, { dimensionNames: [], measureNames: ['items.stock_last_a', 'items.gap'] }));
    expect(Number(rows[0]['Stock A'])).toBe(5);
    expect(Number(rows[0].Gap)).toBe(11 - 73);
  });
  test('a top N ranks on the last day too', async () => {
    const rows = run(await sqlFor(duckModel, {
      dimensionNames: ['items.wh'], measureNames: ['items.stock_last'],
      widgetFilters: [{ field: 'items.stock_last', op: 'top_n', value: 1, isMeasure: true }],
    }));
    expect(figures(rows, 'Warehouse', 'Stock')).toEqual({ B: 6 });
  });
});
