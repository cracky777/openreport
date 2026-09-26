// A measure's own rule on a dimension the visual groups by replaces that
// grouping instead of narrowing it: "lost calls" shown per status is the same
// figure on every status row, spread as a window over the other grouped
// dimensions (Power BI's CALCULATE). Elsewhere the rule stays an intersection.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const DIMENSIONS = [
  { name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'label' },
  { name: 'items.status', table: 'items', column: 'status', type: 'string', label: 'status' },
];
const RULE = [{ field: 'items.status', op: 'in', values: ['lost'] }];
const MEASURES = [
  { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount' },
  { name: 'items.amt_lost', table: 'items', column: 'amt', aggregation: 'sum', label: 'Lost amount', filterRules: RULE, overrideFilters: false },
  { name: 'items.calls_lost', table: 'items', column: 'id', aggregation: 'count', label: 'Lost calls', filterRules: RULE, overrideFilters: false },
  { name: 'items.avg_lost', table: 'items', column: 'amt', aggregation: 'avg', label: 'Avg lost', filterRules: RULE, overrideFilters: false },
  { name: 'items.distinct_lost', table: 'items', column: 'id', aggregation: 'count_distinct', label: 'Distinct lost', filterRules: RULE, overrideFilters: false },
  { name: 'items.ratio', table: '', column: '', aggregation: 'custom', expression: '${items.amt_lost} / NULLIF(${items.amt_sum}, 0)', label: 'Lost share' },
];

let owner; let model;
beforeAll(() => {
  owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  model = seedModel({ userId: owner, datasourceId: ds, measures: MEASURES, dimensions: DIMENSIONS });
});

async function sqlFor(dimensionNames, measureNames) {
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames, measureNames, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

test('grouped by the rule column and another one: a window over the other', async () => {
  const sql = await sqlFor(['items.label', 'items.status'], ['items.amt_lost']);
  expect(sql).toContain(`SUM(SUM(CASE WHEN "items"."status" = 'lost' THEN`);
  expect(sql).toContain('OVER (PARTITION BY "items"."label")');
  expect(sql).toContain('GROUP BY "items"."label", "items"."status"');
});

test('grouped by the rule column alone: a window over every row', async () => {
  const sql = await sqlFor(['items.status'], ['items.calls_lost']);
  expect(sql).toContain('SUM(COUNT(CASE WHEN "items"."status" = \'lost\' THEN "items"."id" END)) OVER ()');
});

test('not grouped by the rule column: the intersection, as before', async () => {
  const sql = await sqlFor(['items.label'], ['items.amt_lost', 'items.calls_lost']);
  expect(sql).not.toContain('OVER');
  expect(sql).toContain(`SUM(CASE WHEN "items"."status" = 'lost' THEN`);
});

test('an average is rebuilt from summed sums and counts; a distinct count keeps the intersection', async () => {
  const sql = await sqlFor(['items.status'], ['items.avg_lost', 'items.distinct_lost']);
  expect(sql).toMatch(/\(SUM\(SUM\(CASE WHEN .* END\)\) OVER \(\) \/ NULLIF\(SUM\(COUNT\(CASE WHEN .* END\)\) OVER \(\), 0\)\)/);
  expect(sql).toContain(`COUNT(DISTINCT CASE WHEN "items"."status" = 'lost' THEN "items"."id" END)`);
});

test('a reference to the filtered measure inside a custom expression gets the same window', async () => {
  const sql = await sqlFor(['items.label', 'items.status'], ['items.ratio']);
  expect(sql).toContain('OVER (PARTITION BY "items"."label")');
  // The unfiltered denominator stays a plain aggregate.
  expect(sql).toContain('NULLIF(SUM(CAST("items"."amt" AS NUMERIC)), 0)');
});
