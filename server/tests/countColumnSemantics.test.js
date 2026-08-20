// `count` measure semantics must agree across every compile path: COUNT(col)
// — non-null count — when the wizard picked a column, COUNT(*) otherwise.
// The standalone path (measureSelect) always honored the column; the
// `${ref}` inliner and both intersection-filter branches compiled the same
// measure to COUNT(*) / COUNT(CASE WHEN … THEN 1 END), silently changing the
// result whenever the column has NULLs (and diverging from the rollup, whose
// build fires measures through the standalone path).
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();

async function compile({ measures }, body) {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({ userId: owner, datasourceId: ds, measures });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], ...body, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

const countCol = { name: 'items.amt_count', table: 'items', column: 'amt', aggregation: 'count', label: 'n_amt' };
const countStar = { name: 'items.rows_count', table: 'items', column: '*', aggregation: 'count', label: 'n_rows' };
const RULE = [{ field: 'items.label', op: 'eq', value: 'X' }];

test('standalone count with a column stays COUNT(col)', async () => {
  const sql = await compile({ measures: [countCol] }, { measureNames: ['items.amt_count'] });
  expect(sql).toContain('COUNT("items"."amt")');
});

test("standalone count with the legacy '*' sentinel stays COUNT(*)", async () => {
  const sql = await compile({ measures: [countStar] }, { measureNames: ['items.rows_count'] });
  expect(sql).toContain('COUNT(*)');
});

test('a ${ref} to a count-with-column measure inlines as COUNT(col), not COUNT(*)', async () => {
  const measures = [countCol, {
    name: 'items.per', aggregation: 'custom', label: 'per',
    expression: 'SUM(items.amt) / NULLIF(${items.amt_count}, 0)',
  }];
  const sql = await compile({ measures }, { measureNames: ['items.per'] });
  expect(sql).toContain('COUNT("items"."amt")');
  expect(sql).not.toContain('COUNT(*)');
});

test('a ${ref} to a column-less count measure inlines as COUNT(*)', async () => {
  const measures = [countStar, {
    name: 'items.per', aggregation: 'custom', label: 'per',
    expression: '${items.rows_count} + 0',
  }];
  const sql = await compile({ measures }, { measureNames: ['items.per'] });
  expect(sql).toContain('COUNT(*)');
});

test('intersection-filtered count with a column counts non-null matching values', async () => {
  const sql = await compile(
    { measures: [{ ...countCol, filterRules: RULE }] },
    { measureNames: ['items.amt_count'] },
  );
  expect(sql).toMatch(/COUNT\(CASE WHEN [\s\S]*THEN "items"\."amt" END\)/);
});

test('intersection-filtered column-less count keeps the THEN 1 row-count shape', async () => {
  const sql = await compile(
    { measures: [{ ...countStar, filterRules: RULE }] },
    { measureNames: ['items.rows_count'] },
  );
  expect(sql).toMatch(/COUNT\(CASE WHEN [\s\S]*THEN 1 END\)/);
});

test('a ${ref} to a filtered count-with-column measure keeps the column inside the CASE', async () => {
  const measures = [
    { ...countCol, filterRules: RULE },
    { name: 'items.per', aggregation: 'custom', label: 'per', expression: '${items.amt_count} * 2' },
  ];
  const sql = await compile({ measures }, { measureNames: ['items.per'] });
  expect(sql).toMatch(/COUNT\(CASE WHEN [\s\S]*THEN "items"\."amt" END\)/);
});
