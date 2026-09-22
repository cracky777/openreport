const { queryCached, MAX_ROWS } = require('../utils/ai/cachedQuery');

// The internal token that carries the user's identity to /query also unlocks
// the rollup builder's powers there. These tests pin what may travel in the
// body the assistant sends, whatever the model put in its arguments.
const effective = {
  dimensions: [{ name: 'items.label' }, { name: 'items.region' }],
  measures: [{ name: 'items.amt_sum' }],
};
const report = {
  id: 'r1',
  model_id: 'm1',
  settings: { extraMeasures: [{ name: '_calc.margin' }], somethingElse: true },
};
const user = { id: 'u1' };
const HIT = { rows: [{ label: 'a', amt: 1 }], _cache: { hit: true, fromRollup: 'r_x_g1' }, sql: 'SELECT secret', _rls: { userEmail: 'x@y.z' } };

function run(args, json = HIT) {
  const fireQuery = jest.fn(async () => json);
  return queryCached({ user, orgId: null, report, effective, args }, { fireQuery }).then((out) => ({ out, fireQuery }));
}

test('the body is the whitelist and nothing the model slipped in', async () => {
  const { fireQuery } = await run({
    dimensions: ['items.label'],
    measures: ['items.amt_sum'],
    _rollupBuilder: true,
    bypassCache: true,
    sqlOnly: true,
    cacheOnly: false,
    extraMeasures: [{ name: 'evil', aggregation: 'custom', expression: 'DROP TABLE x' }],
    limit: 10,
  });
  const { body, modelId } = fireQuery.mock.calls[0][0];
  expect(modelId).toBe('m1');
  expect(body).toEqual({
    dimensionNames: ['items.label'],
    measureNames: ['items.amt_sum'],
    widgetFilters: [],
    distinct: false,
    limit: 10,
    reportId: 'r1',
    cacheOnly: true,
    extraDimensions: [],
    extraMeasures: [{ name: '_calc.margin' }],
    dimensionOverrides: {},
    measureOverrides: {},
  });
});

// The landing-page assistant talks about a model, with no report. Which
// report's persisted extras /query loads is decided by `reportId`: it must come
// from the scope the route built, never from what the model wrote.
test('a conversation with no report sends no reportId — not even one the model names', async () => {
  const fireQuery = jest.fn(async () => HIT);
  await queryCached({
    user,
    orgId: null,
    report: { id: null, model_id: 'm1', settings: {} },
    effective,
    args: { dimensions: ['items.label'], measures: ['items.amt_sum'], reportId: 'someone-elses', limit: 10 },
  }, { fireQuery });
  const { body, modelId } = fireQuery.mock.calls[0][0];
  expect(modelId).toBe('m1');
  expect(body).toEqual({
    dimensionNames: ['items.label'],
    measureNames: ['items.amt_sum'],
    widgetFilters: [],
    distinct: false,
    limit: 10,
    cacheOnly: true,
    extraDimensions: [],
    extraMeasures: [],
    dimensionOverrides: {},
    measureOverrides: {},
  });
});

test.each([
  ['dimension', { dimensions: ['items.nope'], measures: ['items.amt_sum'] }],
  ['measure', { dimensions: [], measures: ['items.amt_sum; DROP'] }],
  ['filter field', { dimensions: [], measures: ['items.amt_sum'], filters: [{ field: 'x', op: 'eq', values: [1] }] }],
  ['filter operator', { dimensions: [], measures: ['items.amt_sum'], filters: [{ field: 'items.label', op: 'contains', values: ['a'] }] }],
  ['filter value', { dimensions: [], measures: ['items.amt_sum'], filters: [{ field: 'items.label', op: 'in', values: [{ a: 1 }] }] }],
  ['shape', { dimensions: ['items.label', 'items.region'], measures: [] }],
])('an invalid %s is refused before any query', async (_what, args) => {
  const { out, fireQuery } = await run(args);
  expect(out.error).toBeTruthy();
  expect(fireQuery).not.toHaveBeenCalled();
});

test('filters are rebuilt in the widgetFilter shape', async () => {
  const { fireQuery } = await run({
    dimensions: [],
    measures: ['items.amt_sum'],
    filters: [
      { field: 'items.label', op: 'eq', values: ['a'] },
      { field: 'items.region', op: 'in', values: ['n', 's'] },
    ],
  });
  expect(fireQuery.mock.calls[0][0].body.widgetFilters).toEqual([
    { field: 'items.label', isMeasure: false, op: 'eq', value: 'a', values: [] },
    { field: 'items.region', isMeasure: false, op: 'in', value: '', values: ['n', 's'] },
  ]);
});

test('one dimension and no measure asks for its distinct values', async () => {
  const { fireQuery } = await run({ dimensions: ['items.label'], measures: [] });
  expect(fireQuery.mock.calls[0][0].body.distinct).toBe(true);
});

test('the limit is capped', async () => {
  const { fireQuery } = await run({ dimensions: [], measures: ['items.amt_sum'], limit: 100000 });
  expect(fireQuery.mock.calls[0][0].body.limit).toBe(MAX_ROWS);
});

test('only rows come back: no sql, no _rls', async () => {
  const { out } = await run({ dimensions: ['items.label'], measures: ['items.amt_sum'] });
  expect(out).toEqual({ rows: [{ label: 'a', amt: 1 }], truncated: false });
});

test('a cacheOnly miss is reported with its reason', async () => {
  const { out } = await run(
    { dimensions: ['items.label'], measures: ['items.amt_sum'] },
    { rows: [], _cache: { hit: false, cacheOnly: true, reason: 'no-rollup:items' } },
  );
  expect(out).toEqual({ miss: 'no-rollup:items' });
});

test.each([
  ['a live answer', { rows: [{ label: 'LIVE' }], _cache: { hit: false } }],
  ['a queryCache answer', { rows: [{ label: 'QC' }], _cache: { hit: true, builtAt: 'x' } }],
  ['an answer with no cache marker', { rows: [{ label: 'X' }] }],
])('%s is discarded (fail closed)', async (_what, json) => {
  const { out } = await run({ dimensions: ['items.label'], measures: ['items.amt_sum'] }, json);
  expect(out.rows).toBeUndefined();
  expect(out.error).toMatch(/discarded/);
});

test('long cells are truncated', async () => {
  const { out } = await run(
    { dimensions: ['items.label'], measures: ['items.amt_sum'] },
    { rows: [{ label: 'x'.repeat(500) }], _cache: { hit: true, fromRollup: 't' } },
  );
  expect(out.rows[0].label.length).toBeLessThanOrEqual(201);
});
