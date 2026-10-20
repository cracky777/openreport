// `withTotalComponents`: the /query handler appends the SUM/COUNT atoms of every
// decomposable AVG so a pivot can rebuild a true weighted mean at any grain
// instead of averaging per-group averages.
//
// What matters here is the contract the client depends on: which measures get
// atoms, what the atoms compile to, and that nothing changes without the flag.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');
const { decomposeMeasure, avgAliasBase } = require('../utils/measureType');

const app = buildApp();

const MEASURES = [
  { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Total' },
  { name: 'items.amt_avg', table: 'items', column: 'amt', aggregation: 'avg', label: 'Moyenne' },
  // Same column as the AVG above — must share one pair of atoms, not duplicate them.
  { name: 'items.amt_avg2', table: 'items', column: 'amt', aggregation: 'avg', label: 'Moyenne bis' },
  { name: 'items.qty_avg', table: 'items', column: 'qty', aggregation: 'avg', label: 'Qté moyenne' },
  // Filtered AVG: its atoms would be built from the bare column, so the total
  // would be the UNFILTERED mean. decomposeMeasure refuses it; so must this.
  {
    name: 'items.amt_avg_filtered', table: 'items', column: 'amt', aggregation: 'avg', label: 'Moyenne filtrée',
    filterRules: [{ field: 'items.label', op: 'equals', value: 'x' }],
  },
  { name: 'items.qty_sum', table: 'items', column: 'qty', aggregation: 'sum', label: 'Qty' },
  // The forms the chat writes (utils/ai/reportMeasures.js): rebuilt from the totals of their two parts.
  { name: '_calc.gap', table: '', column: '', aggregation: 'custom', expression: '(${items.amt_sum}) - (${items.qty_sum})', label: 'Gap' },
  { name: '_calc.rate', table: '', column: '', aggregation: 'custom', expression: '100.0 * (${items.amt_sum}) / NULLIF((${items.qty_sum}), 0)', label: 'Rate' },
  // A product is not: Σ(a × b) ≠ Σa × Σb. Nor an expression over an average.
  { name: '_calc.prod', table: '', column: '', aggregation: 'custom', expression: '(${items.amt_sum}) * (${items.qty_sum})', label: 'Prod' },
  { name: '_calc.of_avg', table: '', column: '', aggregation: 'custom', expression: '(${items.amt_avg}) - (${items.qty_sum})', label: 'Of avg' },
];

const AMT_BASE = avgAliasBase(decomposeMeasure(MEASURES[1], MEASURES));
const QTY_BASE = avgAliasBase(decomposeMeasure(MEASURES[3], MEASURES));

async function compile(body, dbType = 'postgres') {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType });
  const model = seedModel({ userId: owner, datasourceId: ds, measures: MEASURES });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], sqlOnly: true, ...body });
  expect(res.status).toBe(200);
  return res.body.sql;
}

test('without the flag the SQL is untouched', async () => {
  const sql = await compile({ measureNames: ['items.amt_avg'] });
  expect(sql).not.toContain('_avg_');
});

test('an AVG gets a SUM and a COUNT of the same column', async () => {
  const sql = await compile({ measureNames: ['items.amt_avg'], withTotalComponents: true });
  // COUNT(col), never COUNT(*): SQL AVG skips NULLs, so the divisor must too —
  // otherwise the rebuilt mean is understated wherever the column is NULL.
  expect(sql).toContain(`COUNT("items"."amt") AS "${AMT_BASE}_count"`);
  expect(sql).toMatch(new RegExp(`SUM\\(.*"items"\\."amt".*\\) AS "${AMT_BASE}_sum"`));
});

test('the numerator is widened where SUM would narrow it', async () => {
  // PG returns SUM(real) as a real — ~7 significant digits. The division
  // amplifies that, and the sub-total lands a couple of units off the single
  // row it sums. MySQL already widens SUM, so its SQL must stay bare.
  const pg = await compile({ measureNames: ['items.amt_avg'], withTotalComponents: true });
  expect(pg).toContain(`SUM(CAST("items"."amt" AS DOUBLE PRECISION)) AS "${AMT_BASE}_sum"`);
  const my = await compile({ measureNames: ['items.amt_avg'], withTotalComponents: true }, 'mysql');
  expect(my).toContain(`SUM(\`items\`.\`amt\`) AS \`${AMT_BASE}_sum\``);
});

test('the widening never touches the measure the user asked for', async () => {
  const sql = await compile({
    measureNames: ['items.amt_sum', 'items.amt_avg'], withTotalComponents: true,
  });
  expect(sql).toContain('SUM("items"."amt") AS "Total"');
});

test('two averages on one column share a single pair of atoms', async () => {
  const sql = await compile({
    measureNames: ['items.amt_avg', 'items.amt_avg2'], withTotalComponents: true,
  });
  expect(sql.match(new RegExp(`${AMT_BASE}_sum`, 'g'))).toHaveLength(1);
  expect(sql.match(new RegExp(`${AMT_BASE}_count`, 'g'))).toHaveLength(1);
});

test('averages on different columns each get their own', async () => {
  const sql = await compile({
    measureNames: ['items.amt_avg', 'items.qty_avg'], withTotalComponents: true,
  });
  expect(sql).toContain(`"${AMT_BASE}_sum"`);
  expect(sql).toContain(`"${QTY_BASE}_sum"`);
  expect(AMT_BASE).not.toBe(QTY_BASE);
});

test('an additive measure needs no atoms', async () => {
  const sql = await compile({ measureNames: ['items.amt_sum'], withTotalComponents: true });
  expect(sql).not.toContain('_avg_');
});

test('a filtered AVG gets none — its atoms would total the unfiltered mean', async () => {
  const sql = await compile({ measureNames: ['items.amt_avg_filtered'], withTotalComponents: true });
  expect(sql).not.toContain('_avg_');
});

test('the response names the atoms of each measure it decomposed', async () => {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({ userId: owner, datasourceId: ds, measures: MEASURES });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({
      dimensionNames: ['items.label'],
      measureNames: ['items.amt_sum', 'items.amt_avg', 'items.amt_avg_filtered'],
      withTotalComponents: true,
      sqlOnly: true,
    });
  expect(res.status).toBe(200);
  // Keyed by the column header the client sees, not the measure name — that is
  // what the row objects are keyed on, so that is what the pivot looks up.
  expect(res.body.totalComponents).toEqual({
    Moyenne: { sum: `${AMT_BASE}_sum`, count: `${AMT_BASE}_count` },
  });
});

test('a difference or a ratio of two additive measures names its parts; a product or an average part gets none', async () => {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({ userId: owner, datasourceId: ds, measures: MEASURES });
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], measureNames: ['_calc.gap', '_calc.rate', '_calc.prod', '_calc.of_avg'], withTotalComponents: true, sqlOnly: true });
  expect(res.status).toBe(200);
  expect(res.body.totalComponents).toEqual({
    Gap: { op: 'subtract', left: 'tc_items_amt_sum', right: 'tc_items_qty_sum' },
    Rate: { op: 'percent', left: 'tc_items_amt_sum', right: 'tc_items_qty_sum' },
  });
  // One hidden column per part, shared by the two measures.
  expect(res.body.sql.match(/AS "tc_items_amt_sum"/g)).toHaveLength(1);
  expect(res.body.sql).toContain('SUM(CAST("items"."qty" AS DOUBLE PRECISION)) AS "tc_items_qty_sum"');
  // Without the flag, nothing is appended.
  const bare = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], measureNames: ['_calc.gap'], sqlOnly: true });
  expect(bare.body.totalComponents).toBeUndefined();
  expect(bare.body.sql).not.toContain('tc_items');
});

test('a per-widget override to AVG is decomposed too', async () => {
  const sql = await compile({
    measureNames: ['items.amt_sum'],
    measureAggOverrides: { 'items.amt_sum': 'avg' },
    withTotalComponents: true,
  });
  expect(sql).toContain(`"${AMT_BASE}_count"`);
});
