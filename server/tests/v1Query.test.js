// The semantic query API (POST /api/v1/models/:id/query, scope `query`).
//
// Guarded here: the scope gates; a model the caller cannot see answers 404
// before any field name is looked at; every name is resolved (by name, else by
// label) and an unknown one is a 400 — a filter skipped in silence would hand
// back the unfiltered figure as the filtered one; only the documented fields
// reach the widget query handler, with the row limit capped; and only rows come
// back, keyed by the names asked, never the SQL or the RLS diagnostics.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');
const apiToken = require('../utils/apiToken');
const settings = require('../utils/settingsHelper');
const modelsRouter = require('../routes/models');

const app = buildApp();

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const mint = (userId, scopes) => apiToken.create({ userId, name: `t-${Math.random().toString(36).slice(2, 8)}`, scopes }).token;

const DIMENSIONS = [
  { name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'Product' },
  { name: 'items.country', table: 'items', column: 'country', type: 'string', label: 'Country' },
  { name: 'shops.country', table: 'shops', column: 'country', type: 'string', label: 'Country' },
];
const MEASURES = [{ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'Revenue' }];

let owner; let model; let queryToken; let readToken; let strangerToken;
let spy; let received; let answer;

beforeAll(() => {
  settings.setApiEnabled(true);
  settings.setApiMinRole('viewer');
  owner = seedUser({ role: 'editor', email: 'q-owner@corp.io' });
  const stranger = seedUser({ role: 'editor', email: 'q-stranger@corp.io' });
  model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }), dimensions: DIMENSIONS, measures: MEASURES });
  queryToken = mint(owner, ['query']);
  readToken = mint(owner, ['read']);
  strangerToken = mint(stranger, ['query']);
});

beforeEach(() => {
  received = null;
  // What the widget handler answers: rows keyed by label, plus diagnostics.
  answer = (res) => res.json({
    rows: [{ Product: 'a', Revenue: 3, __rank: 1 }],
    rowCount: 1,
    maxReached: false,
    sql: 'SELECT secret',
    _rls: { userEmail: 'q-owner@corp.io', allowedKeys: ['k1'] },
    _cache: { hit: false },
  });
  // The compiler itself is covered by the /query suites; here only what v1 hands it.
  spy = jest.spyOn(modelsRouter, 'queryHandler').mockImplementation((req, res) => {
    received = req.body;
    answer(res);
  });
});
afterEach(() => spy.mockRestore());

const query = (body, t = queryToken, id = model) => request(app).post(`/api/v1/models/${id}/query`).set(bearer(t)).send(body);

test('forwards only the documented fields, resolved to field names, with the limit capped', async () => {
  const res = await query({
    measureNames: ['items.amt_sum'],
    dimensionNames: ['items.label'],
    filters: { 'items.label': ['a'] },
    limit: 999999,
    sqlOnly: true,
    bypassCache: true,
    extraMeasures: [{ name: 'evil', aggregation: 'custom', expression: '1' }],
    widgetFilters: [{ field: 'x' }],
  });
  expect(res.status).toBe(200);
  expect(received).toEqual({
    measureNames: ['items.amt_sum'],
    dimensionNames: ['items.label'],
    filters: { 'items.label': ['a'] },
    limit: 5000,
  });
});

test('answers rows keyed by the names asked, and nothing else', async () => {
  const res = await query({ measureNames: ['items.amt_sum'], dimensionNames: ['Product'] });
  expect(res.body).toEqual({ rows: [{ Product: 'a', 'items.amt_sum': 3 }], rowCount: 1, maxReached: false });
});

test('a label carried by one field stands for it, in any case', async () => {
  await query({ measureNames: ['revenue'], dimensionNames: ['Product'], filters: { product: ['a'] } });
  expect(received).toMatchObject({ measureNames: ['items.amt_sum'], dimensionNames: ['items.label'], filters: { 'items.label': ['a'] } });
});

test('an unknown field, in a filter too, is refused rather than skipped', async () => {
  const res = await query({ measureNames: ['Revenue'], filters: { canal: ['Sur place'] } });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/"canal" is not a field/);
  expect((await query({ measureNames: ['Margin'] })).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});

test('a label two fields share must be asked by name', async () => {
  const res = await query({ measureNames: ['Revenue'], dimensionNames: ['Country'] });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/items\.country.*shops\.country/);
  expect((await query({ measureNames: ['Revenue'], dimensionNames: ['items.country', 'shops.country'] })).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});

test('the body is validated before anything runs', async () => {
  expect((await query({})).status).toBe(400);
  expect((await query({ measureNames: 'items.amt_sum' })).status).toBe(400);
  expect((await query({ measureNames: ['Revenue'], filters: ['a'] })).status).toBe(400);
  expect((await query({ measureNames: ['Revenue'], filters: { Product: [] } })).status).toBe(400);
  expect((await query({ measureNames: ['Revenue'], filters: { Product: { op: 'like', value: '%' } } })).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});

test('a between filter goes through', async () => {
  await query({ measureNames: ['Revenue'], filters: { Product: { op: 'between', value: ['a', 'm'] } } });
  expect(received.filters).toEqual({ 'items.label': { op: 'between', value: ['a', 'm'] } });
});

test('maxReached says the limit cut the answer', async () => {
  const res = await query({ measureNames: ['Revenue'], dimensionNames: ['Product'], limit: 1 });
  expect(res.body.maxReached).toBe(true);
});

test('defaults the limit when none is given', async () => {
  await query({ measureNames: ['items.amt_sum'] });
  expect(received.limit).toBe(5000);
  expect(received.dimensionNames).toEqual([]);
});

test('an error keeps its message, never its SQL', async () => {
  answer = (res) => res.status(500).json({ error: 'Query failed: timeout', sql: 'SELECT secret' });
  const res = await query({ measureNames: ['Revenue'] });
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'Query failed: timeout' });
});

test('a token without the `query` scope is refused', async () => {
  const res = await query({ measureNames: ['items.amt_sum'] }, readToken);
  expect(res.status).toBe(403);
  expect(spy).not.toHaveBeenCalled();
});

test('a model the caller cannot see answers 404, even with a wrong field name', async () => {
  spy.mockRestore();
  expect((await query({ measureNames: ['items.amt_sum'] }, strangerToken)).status).toBe(404);
  const res = await query({ measureNames: ['nope'] }, strangerToken);
  expect(res.status).toBe(404);
  expect(JSON.stringify(res.body)).not.toMatch(/nope|field/);
});
