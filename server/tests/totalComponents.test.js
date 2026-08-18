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

test('a per-widget override to AVG is decomposed too', async () => {
  const sql = await compile({
    measureNames: ['items.amt_sum'],
    measureAggOverrides: { 'items.amt_sum': 'avg' },
    withTotalComponents: true,
  });
  expect(sql).toContain(`"${AMT_BASE}_count"`);
});
