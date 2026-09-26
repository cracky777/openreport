// A period-shifted measure (`periodShift = { dim, unit, n }`) reads the
// report's date selection moved back in time. The date filters live in the
// WHERE, so the query widens each moved filter to the union of its readings
// and gives every measure a CASE WHEN on its own period: the shifted measure
// its moved reading, every other measure the original one. Never nested when
// an expression references a shifted measure, never served by the rollup.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');
const { shiftIsoDate, shiftDimValue, reachablePeriodShifts } = require('../utils/sqlBuilder/periodShift');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const DIMENSIONS = [
  { name: 'items.status', table: 'items', column: 'status', type: 'string', label: 'status' },
  { name: 'items.d', table: 'items', column: 'd', type: 'date', label: 'd' },
  { name: 'items.d_year', table: 'items', column: 'd', type: 'integer', datePart: 'num_year', label: 'year' },
  { name: 'items.d_month', table: 'items', column: 'd', type: 'integer', datePart: 'num_month', label: 'month' },
  { name: 'other.yr', table: 'other', column: 'yr', type: 'integer', label: 'year (other)' },
];
const LY = { dim: 'items.d', unit: 'year', n: -1 };
const MEASURES = [
  { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount' },
  { name: 'items.amt_ly', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount LY', periodShift: LY },
  { name: 'items.amt_ly_ref', table: '', column: '', aggregation: 'custom', expression: '${items.amt_sum}', label: 'Amount LY (ref)', periodShift: LY },
  { name: 'items.evo', table: '', column: '', aggregation: 'custom', expression: '(${items.amt_sum} - ${items.amt_ly_ref}) / NULLIF(${items.amt_ly_ref}, 0)', label: 'Evolution' },
  { name: 'items.amt_lm', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount LM', periodShift: { dim: 'items.d', unit: 'month', n: -1 } },
  { name: 'items.n', table: 'items', column: '*', aggregation: 'count', label: 'Rows' },
  { name: 'items.bad_shift', table: 'items', column: 'amt', aggregation: 'sum', label: 'Bad shift', periodShift: { dim: 'items.status', unit: 'year', n: -1 } },
];

let owner; let model;
beforeAll(() => {
  owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  model = seedModel({
    userId: owner, datasourceId: ds, measures: MEASURES, dimensions: DIMENSIONS,
    joins: [{ from_table: 'other', from_column: 'id', to_table: 'items', to_column: 'other_id', type: 'LEFT', cardinality: { from: '1', to: '*' } }],
  });
});

async function sqlFor(body) {
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

const H1_2025 = { field: 'items.d', op: 'between', value: ['2025-01-01', '2025-06-30'], values: ['2025-01-01', '2025-06-30'] };

describe('date shifting', () => {
  test('moves ISO dates by unit, clamps the day, keeps the suffix', () => {
    expect(shiftIsoDate('2025-06-30', 'year', -1)).toBe('2024-06-30');
    expect(shiftIsoDate('2024-02-29', 'year', -1)).toBe('2023-02-28');
    expect(shiftIsoDate('2025-03-31', 'month', -1)).toBe('2025-02-28');
    expect(shiftIsoDate('2025-01-15', 'quarter', -1)).toBe('2024-10-15');
    expect(shiftIsoDate('2025-01-01', 'day', -1)).toBe('2024-12-31');
    expect(shiftIsoDate('2025-01-01T10:00:00Z', 'year', 2)).toBe('2027-01-01T10:00:00Z');
    expect(shiftIsoDate('yesterday', 'year', -1)).toBeNull();
  });
  test('a year number moves by whole years only', () => {
    const year = DIMENSIONS[2];
    expect(shiftDimValue('2025', year, 'year', -1)).toBe('2024');
    expect(shiftDimValue(2025, year, 'year', -1)).toBe(2024);
    expect(shiftDimValue('2025', year, 'month', -1)).toBeNull();
    expect(shiftDimValue('5', DIMENSIONS[3], 'year', -1)).toBeNull();
  });
  test('shifts are reached through expression references; a shift on a non-date dim is ignored', () => {
    const viaEvo = reachablePeriodShifts(['items.evo'], MEASURES, DIMENSIONS);
    expect(viaEvo).toHaveLength(1);
    expect([...viaEvo[0].measures]).toEqual(['items.amt_ly_ref']);
    expect(reachablePeriodShifts(['items.bad_shift', 'items.amt_sum'], MEASURES, DIMENSIONS)).toEqual([]);
    expect(reachablePeriodShifts(['items.amt_ly', 'items.amt_lm'], MEASURES, DIMENSIONS)).toHaveLength(2);
  });
});

describe('one query, two periods', () => {
  test('a between on the date: WHERE takes both windows, each measure keeps its own', async () => {
    const sql = await sqlFor({ dimensionNames: ['items.status'], measureNames: ['items.amt_sum', 'items.amt_ly'], widgetFilters: [H1_2025] });
    expect(sql).toContain(`WHERE (CAST("items"."d" AS DATE) BETWEEN '2025-01-01' AND '2025-06-30' OR CAST("items"."d" AS DATE) BETWEEN '2024-01-01' AND '2024-06-30')`);
    expect(sql).toContain(`SUM(CASE WHEN CAST("items"."d" AS DATE) BETWEEN '2025-01-01' AND '2025-06-30' THEN "items"."amt" END) AS "Amount"`);
    expect(sql).toContain(`SUM(CASE WHEN CAST("items"."d" AS DATE) BETWEEN '2024-01-01' AND '2024-06-30' THEN "items"."amt" END) AS "Amount LY"`);
    expect(sql).toContain('GROUP BY "items"."status"');
  });

  test('a year picked on the date table (filters map on a date part) moves too; a month does not', async () => {
    const sql = await sqlFor({
      dimensionNames: ['items.status'], measureNames: ['items.amt_ly', 'items.n'],
      filters: { 'items.d_year': [2025], 'items.d_month': [3] },
    });
    expect(sql).toContain(`(EXTRACT(YEAR FROM CAST("items"."d" AS DATE)) = 2025 OR EXTRACT(YEAR FROM CAST("items"."d" AS DATE)) = 2024)`);
    expect(sql).toContain(`EXTRACT(MONTH FROM CAST("items"."d" AS DATE)) = 3`);
    expect(sql).not.toContain('MONTH FROM CAST("items"."d" AS DATE)) = 2');
    expect(sql).toContain(`SUM(CASE WHEN EXTRACT(YEAR FROM CAST("items"."d" AS DATE)) = 2024 THEN "items"."amt" END) AS "Amount LY"`);
    expect(sql).toContain(`COUNT(CASE WHEN EXTRACT(YEAR FROM CAST("items"."d" AS DATE)) = 2025 THEN 1 END) AS "Rows"`);
  });

  test('a year filter on another table is not the date context: nothing moves', async () => {
    const sql = await sqlFor({ dimensionNames: [], measureNames: ['items.amt_sum', 'items.amt_ly'], filters: { 'other.yr': [2025] } });
    expect(sql).not.toContain(' OR ');
    expect(sql).not.toContain('CASE WHEN');
    expect(sql).toContain('SUM("items"."amt") AS "Amount LY"');
  });

  test('no date filter: the shifted measure reads as its base, SQL unchanged', async () => {
    const sql = await sqlFor({ dimensionNames: ['items.status'], measureNames: ['items.amt_sum', 'items.amt_ly'] });
    expect(sql).toBe(await sqlFor({ dimensionNames: ['items.status'], measureNames: ['items.amt_sum', 'items.amt_sum@@agg:sum'] })
      .then((s) => s.replace('"Amount (sum)"', '"Amount LY"')));
  });

  test('ignorePeriodShift compiles the base under the filters as sent', async () => {
    const sql = await sqlFor({ dimensionNames: ['items.status'], measureNames: ['items.amt_ly'], widgetFilters: [H1_2025], ignorePeriodShift: true });
    expect(sql).toContain(`WHERE CAST("items"."d" AS DATE) BETWEEN '2025-01-01' AND '2025-06-30'`);
    expect(sql).toContain('SUM("items"."amt") AS "Amount LY"');
    expect(sql).not.toContain('CASE WHEN');
  });

  test('a month shift clamps the moved window to the shorter month', async () => {
    const march = { field: 'items.d', op: 'between', value: ['2025-03-01', '2025-03-31'], values: ['2025-03-01', '2025-03-31'] };
    const sql = await sqlFor({ dimensionNames: [], measureNames: ['items.amt_lm'], widgetFilters: [march] });
    expect(sql).toContain(`BETWEEN '2025-02-01' AND '2025-02-28' THEN "items"."amt" END) AS "Amount LM"`);
  });

  test('two shifts in one visual: the WHERE takes every reading, each measure its own', async () => {
    const sql = await sqlFor({ dimensionNames: [], measureNames: ['items.amt_sum', 'items.amt_ly', 'items.amt_lm'], widgetFilters: [H1_2025] });
    expect(sql).toMatch(/WHERE \(CAST\("items"\."d" AS DATE\) BETWEEN '2025-01-01' AND '2025-06-30' OR .*'2024-01-01' AND '2024-06-30' OR .*'2024-12-01' AND '2025-05-30'\)/);
    expect(sql).toContain(`BETWEEN '2024-12-01' AND '2025-05-30' THEN "items"."amt" END) AS "Amount LM"`);
    expect(sql).toContain(`BETWEEN '2025-01-01' AND '2025-06-30' THEN "items"."amt" END) AS "Amount"`);
  });

  test('a shift a filter cannot follow leaves its measure on the current period', async () => {
    // A year number cannot move by a month: LM reads the current year, LY the previous one.
    const sql = await sqlFor({ dimensionNames: [], measureNames: ['items.amt_ly', 'items.amt_lm'], filters: { 'items.d_year': [2025] } });
    expect(sql).toContain(`= 2024 THEN "items"."amt" END) AS "Amount LY"`);
    expect(sql).toContain(`= 2025 THEN "items"."amt" END) AS "Amount LM"`);
  });
});

describe('expressions', () => {
  test('a shifted reference to a base measure takes the moved period once', async () => {
    const sql = await sqlFor({ dimensionNames: ['items.status'], measureNames: ['items.amt_ly_ref'], widgetFilters: [H1_2025] });
    expect(sql).toContain(`SUM(CASE WHEN CAST("items"."d" AS DATE) BETWEEN '2024-01-01' AND '2024-06-30' THEN CAST("items"."amt" AS NUMERIC) END)`);
    expect(sql).not.toMatch(/THEN CASE WHEN/);
  });

  test('an evolution over a shifted measure: current wraps the base, the shifted part is sealed', async () => {
    const sql = await sqlFor({ dimensionNames: ['items.status'], measureNames: ['items.evo'], widgetFilters: [H1_2025] });
    expect(sql).not.toContain('__PERIOD_REF_');
    expect(sql).not.toMatch(/THEN CASE WHEN/);
    const current = `SUM(CASE WHEN CAST("items"."d" AS DATE) BETWEEN '2025-01-01' AND '2025-06-30' THEN CAST("items"."amt" AS NUMERIC) END)`;
    // Inlined like any filtered reference: the aggregate takes the rule, not the cast.
    const previous = `SUM(CASE WHEN CAST("items"."d" AS DATE) BETWEEN '2024-01-01' AND '2024-06-30' THEN "items"."amt" END)`;
    expect(sql).toContain(current);
    // Referenced twice, sealed twice.
    expect(sql.split(previous).length - 1).toBe(2);
  });

  test('a shifted measure on a grouped date part keeps the intersection: no window', async () => {
    const sql = await sqlFor({ dimensionNames: ['items.d_year'], measureNames: ['items.amt_sum', 'items.amt_ly'], filters: { 'items.d_year': [2025] } });
    expect(sql).not.toContain('OVER (');
    expect(sql).toContain('GROUP BY EXTRACT(YEAR FROM CAST("items"."d" AS DATE))');
  });
});
