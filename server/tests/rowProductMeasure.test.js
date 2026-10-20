// A measure summing a product of two columns row by row (`times`): a ticket
// line's quantity × its unit price. The sum of the quantities times the sum of
// the prices is not the revenue (Maison Gaspard's food cost ignored the
// quantities). Run on DuckDB.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');
const { validateMeasures } = require('../utils/ai/reportMeasures');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const DIMENSIONS = [{ name: 'lines.dish', table: 'lines', column: 'dish', type: 'string', label: 'Dish' }];
const MEASURES = [
  { name: 'lines.qty_sum', table: 'lines', column: 'qty', aggregation: 'sum', label: 'Qty' },
  { name: 'lines.price_sum', table: 'lines', column: 'price', aggregation: 'sum', label: 'Price' },
  { name: 'lines.cost_sum', table: 'lines', column: 'cost', aggregation: 'sum', label: 'Cost' },
  { name: 'revenue', table: 'lines', column: 'qty', times: 'price', aggregation: 'sum', label: 'Revenue' },
  { name: 'food_cost', table: 'lines', column: 'qty', times: 'cost', aggregation: 'sum', label: 'Food cost' },
  { name: 'rate', table: '', column: '', aggregation: 'custom', expression: '100.0 * (${food_cost}) / NULLIF((${revenue}), 0)', label: 'Rate' },
];
// Steak: 3 × 20 (cost 8) and 1 × 20; soup: 10 × 5 (cost 1).
const LINES = [['Steak', 3, 20, 8], ['Steak', 1, 20, 8], ['Soup', 10, 5, 1]];

let owner; let model;
beforeAll(() => {
  owner = seedUser({ role: 'editor' });
  model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'duckdb' }), selectedTables: ['lines'], measures: MEASURES, dimensions: DIMENSIONS, joins: [] });
});

function run(sql) {
  const script = `
    const duckdb = require(${JSON.stringify(require.resolve('duckdb-async'))});
    (async () => {
      const d = await duckdb.Database.create(':memory:');
      await d.run('CREATE TABLE lines (dish VARCHAR, qty INTEGER, price DOUBLE, cost DOUBLE)');
      for (const [a, b, c, e] of ${JSON.stringify(LINES)}) await d.run("INSERT INTO lines VALUES ('" + a + "', " + b + ", " + c + ", " + e + ")");
      const rows = await d.all(${JSON.stringify(sql)});
      process.stdout.write(JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
      await d.close();
    })();`;
  return JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', script]).toString());
}

test('summed row by row, alone and inside a ratio', async () => {
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['lines.dish'], measureNames: ['revenue', 'rate'], sqlOnly: true });
  expect(res.status).toBe(200);
  const rows = run(res.body.sql);
  expect(Object.fromEntries(rows.map((r) => [r.Dish, [Number(r.Revenue), Number(r.Rate)]]))).toEqual({ Steak: [80, 40], Soup: [50, 20] });
});

test('the assistant defines it from two sum measures of one table, never of two', () => {
  const ctx = { effective: { dimensions: DIMENSIONS, measures: [...MEASURES.slice(0, 3), { name: 'other.x_sum', table: 'other', column: 'x', aggregation: 'sum' }] } };
  const ok = validateMeasures([{ label: 'CA des lignes', kind: 'product', left: 'lines.qty_sum', right: 'lines.price_sum' }], ctx);
  expect(ok.errors).toEqual([]);
  expect(ok.measures[0]).toMatchObject({ table: 'lines', column: 'qty', times: 'price', aggregation: 'sum' });
  expect(validateMeasures([{ label: 'X', kind: 'product', left: 'lines.qty_sum', right: 'other.x_sum' }], ctx).errors[0]).toMatch(/SAME table/);
});

describe('the days between two dates of a row', () => {
  const D = [
    { name: 'claims.declared', table: 'claims', column: 'declared', type: 'date', label: 'Declared' },
    { name: 'claims.closed', table: 'claims', column: 'closed', type: 'date', label: 'Closed' },
    { name: 'claims.kind', table: 'claims', column: 'kind', type: 'string', label: 'Kind' },
  ];
  // Hail: 10 and 20 days; water: 40 days, and one still open (no closing date).
  const CLAIMS = [['Hail', '2025-06-20', '2025-06-30'], ['Hail', '2025-06-20', '2025-07-10'], ['Water', '2025-01-01', '2025-02-10'], ['Water', '2025-03-01', null]];
  let delays;
  beforeAll(() => {
    const made = validateMeasures([{ label: 'Délai de gestion', kind: 'days_between', from: 'claims.declared', to: 'claims.closed' }], { effective: { dimensions: D, measures: [] } });
    expect(made.errors).toEqual([]);
    delays = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner, dbType: 'duckdb' }), selectedTables: ['claims'], measures: made.measures, dimensions: D, joins: [] });
  });

  test('averaged by kind, an open claim left out', async () => {
    const res = await request(app).post(`/api/models/${delays}/query`).set('x-test-user', owner)
      .send({ dimensionNames: ['claims.kind'], measureNames: ['_calc.delai_de_gestion'], sqlOnly: true });
    expect(res.status).toBe(200);
    const script = `
      const duckdb = require(${JSON.stringify(require.resolve('duckdb-async'))});
      (async () => {
        const d = await duckdb.Database.create(':memory:');
        await d.run('CREATE TABLE claims (kind VARCHAR, declared DATE, closed DATE)');
        for (const [k, a, b] of ${JSON.stringify(CLAIMS)}) await d.run("INSERT INTO claims VALUES ('" + k + "', '" + a + "', " + (b ? "'" + b + "'" : 'NULL') + ")");
        process.stdout.write(JSON.stringify(await d.all(${JSON.stringify(res.body.sql)})));
        await d.close();
      })();`;
    const rows = JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', script]).toString());
    expect(Object.fromEntries(rows.map((r) => [r.Kind, Number(r['Délai de gestion'])]))).toEqual({ Hail: 15, Water: 40 });
  });

  test('two dates of one table, never a month; a delay is never filtered into its bare column', () => {
    const ctx = { effective: { dimensions: [...D, { name: 'claims.m', table: 'claims', column: 'closed', type: 'string', datePart: 'year_month' }], measures: [{ name: 'x', table: 'claims', column: 'closed', since: 'declared', aggregation: 'avg' }] } };
    expect(validateMeasures([{ label: 'X', kind: 'days_between', from: 'claims.declared', to: 'claims.m' }], ctx).errors[0]).toMatch(/date dimensions/);
    expect(validateMeasures([{ label: 'Y', kind: 'filtered', from: 'x', filters: [{ field: 'claims.kind', op: 'eq', values: ['Hail'] }] }], ctx).errors[0]).toMatch(/product or a delay/);
  });
});
