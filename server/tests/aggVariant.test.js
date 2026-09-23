// One visual, the same measure twice, one summed and one averaged.
//
// The two entries are told apart by their name — "<base>@@agg:<fn>" — because
// that is what has to survive all the way to the SELECT list. A map keyed by
// measure name could only ever hold one aggregation for both.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const MEASURES = [{ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Amount' }];
const DIMENSIONS = [{ name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'label' }];

async function compile(measureNames) {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({ userId: owner, datasourceId: ds, measures: MEASURES, dimensions: DIMENSIONS });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], measureNames, sqlOnly: true });
  return res;
}

test('a variant becomes its own SELECT entry, aggregated its own way', async () => {
  const res = await compile(['items.amt_sum', 'items.amt_sum@@agg:avg']);
  expect(res.status).toBe(200);
  expect(res.body.sql).toContain('SUM("items"."amt") AS "Amount"');
  // Its own alias, so the client can tell the two columns apart.
  expect(res.body.sql).toContain('AVG("items"."amt") AS "Amount (avg)"');
});

test('several variants of one measure live side by side', async () => {
  const res = await compile(['items.amt_sum@@agg:min', 'items.amt_sum@@agg:max']);
  expect(res.status).toBe(200);
  expect(res.body.sql).toContain('MIN("items"."amt") AS "Amount (min)"');
  expect(res.body.sql).toContain('MAX("items"."amt") AS "Amount (max)"');
});

test('an aggregation nobody supports is refused, not compiled', async () => {
  // The name reaches the SQL builder as a function name, so this is the guard
  // that keeps a crafted measure name out of the emitted SQL.
  const res = await compile(['items.amt_sum@@agg:1) UNION SELECT secret--']);
  expect(res.status).toBe(400);
});

test('a variant of a custom measure is refused — its SQL already aggregates', async () => {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({
    userId: owner,
    datasourceId: ds,
    dimensions: DIMENSIONS,
    measures: [{ name: 'items.ratio', aggregation: 'custom', label: 'Ratio', expression: 'SUM(items.amt) / COUNT(items.id)' }],
  });
  const res = await request(app)
    .post(`/api/models/${model}/query`)
    .set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], measureNames: ['items.ratio@@agg:avg'], sqlOnly: true });
  expect(res.status).toBe(400);
});

// A dimension put where a measure goes is read as a measure of its column.
test('a dimension variant aggregates the column itself', async () => {
  const res = await compile(['items.label@@agg:max']);
  expect(res.status).toBe(200);
  expect(res.body.sql).toContain('MAX("items"."label") AS "label (max)"');
});

test('a text dimension can be counted but never summed', async () => {
  const ok = await compile(['items.label@@agg:count']);
  expect(ok.status).toBe(200);
  expect(ok.body.sql).toContain('COUNT("items"."label") AS "label (count)"');
  const bad = await compile(['items.label@@agg:sum']);
  expect(bad.status).toBe(400);
});

// BigQuery names a result column with letters, digits and underscores only:
// "Amount (avg)" failed the whole query. The alias is spelled safely there and
// the rows come back keyed on the label.
test('on BigQuery a variant alias is spelled safely and the row keeps the label', async () => {
  const { restoreAliases, aliasName } = require('../utils/sqlDialect');
  expect(aliasName('Amount (avg)', 'bigquery')).toBe('Amount__avg_');
  expect(aliasName('Amount (avg)', 'postgres')).toBe('Amount (avg)');
  expect(aliasName('1er', 'bigquery')).toBe('_1er');
  const rows = restoreAliases([{ label: 'x', Amount__avg_: 3 }], ['label', 'Amount (avg)'], 'bigquery');
  expect(rows).toEqual([{ label: 'x', 'Amount (avg)': 3 }]);
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'bigquery' });
  const model = seedModel({ userId: owner, datasourceId: ds, measures: MEASURES, dimensions: DIMENSIONS });
  const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', owner)
    .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum@@agg:avg'], sqlOnly: true });
  expect(res.status).toBe(200);
  expect(res.body.sql).toContain('AS `Amount__avg_`');
  expect(res.body.sql).not.toContain('(avg)`');
});
