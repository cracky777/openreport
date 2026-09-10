// A Top N ranks on the measure it was given — its own filter rules included.
//
// A measure can be defined as "this aggregate, restricted to X" (filterRules
// in intersection mode). The SELECT applies those rules; the ORDER BY of a
// Top N did not, so a widget ranked by "lost calls" was in fact ranked on ALL
// calls and quietly showed the wrong rows. Same for a HAVING comparison.
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

async function sqlFor(measures, measureNames, widgetFilters) {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({ userId: owner, datasourceId: ds, measures, dimensions: DIMENSIONS });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], measureNames, widgetFilters, sqlOnly: true });
  expect(res.status).toBe(200);
  return res.body.sql;
}

test('a custom measure carrying its own rules is ranked with them', async () => {
  const measures = [
    { name: 'items.calls', aggregation: 'custom', label: 'Calls', expression: 'COUNT(items.id)' },
    {
      name: 'items.lost', aggregation: 'custom', label: 'Lost',
      expression: 'COUNT(items.id)', filterRules: RULE, overrideFilters: false,
    },
  ];
  const sql = await sqlFor(measures, ['items.calls'], [
    { field: 'items.lost', op: 'top_n', value: '5', isMeasure: true },
  ]);
  const orderBy = sql.slice(sql.indexOf('ORDER BY'));
  expect(orderBy).toContain('CASE WHEN');
  expect(orderBy).toContain("'lost'");
});

test('a plain measure carrying its own rules is ranked with them', async () => {
  const measures = [
    { name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount' },
    {
      name: 'items.amt_lost', table: 'items', column: 'amt', aggregation: 'sum', label: 'Lost amount',
      filterRules: RULE, overrideFilters: false,
    },
  ];
  const sql = await sqlFor(measures, ['items.amt_sum'], [
    { field: 'items.amt_lost', op: 'top_n', value: '3', isMeasure: true },
  ]);
  const orderBy = sql.slice(sql.indexOf('ORDER BY'));
  expect(orderBy).toContain('CASE WHEN');
  expect(orderBy).toContain("'lost'");
});

test('a measure without rules is untouched', async () => {
  const measures = [{ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount' }];
  const sql = await sqlFor(measures, ['items.amt_sum'], [
    { field: 'items.amt_sum', op: 'top_n', value: '5', isMeasure: true },
  ]);
  const orderBy = sql.slice(sql.indexOf('ORDER BY'));
  expect(orderBy).not.toContain('CASE WHEN');
  expect(orderBy).toContain('SUM(');
});
