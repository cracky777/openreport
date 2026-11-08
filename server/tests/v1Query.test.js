// The semantic query API (POST /api/v1/models/:id/query, scope `query`).
//
// Guarded here: the scope gates; a model the caller cannot see answers 404;
// the body is validated; and only the documented fields reach the widget
// query handler, with the row limit capped (browser-only switches such as
// sqlOnly or bypassCache never get through).
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');
const apiToken = require('../utils/apiToken');
const settings = require('../utils/settingsHelper');
const modelsRouter = require('../routes/models');

const app = buildApp();

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const mint = (userId, scopes) => apiToken.create({ userId, name: `t-${Math.random().toString(36).slice(2, 8)}`, scopes }).token;

let owner; let stranger; let model; let queryToken; let readToken; let strangerToken;
let spy; let received;

beforeAll(() => {
  settings.setApiEnabled(true);
  settings.setApiMinRole('viewer');
  owner = seedUser({ role: 'editor', email: 'q-owner@corp.io' });
  stranger = seedUser({ role: 'editor', email: 'q-stranger@corp.io' });
  const ds = seedDatasource({ userId: owner });
  model = seedModel({ userId: owner, datasourceId: ds });
  queryToken = mint(owner, ['query']);
  readToken = mint(owner, ['read']);
  strangerToken = mint(stranger, ['query']);
});

beforeEach(() => {
  received = null;
  // The compiler itself is covered by the /query suites; here only what v1 hands it.
  spy = jest.spyOn(modelsRouter, 'queryHandler').mockImplementation((req, res) => {
    received = req.body;
    res.json({ rows: [{ 'items.label': 'a', 'items.amt_sum': 3 }] });
  });
});
afterEach(() => spy.mockRestore());

const query = (body, t = queryToken, id = model) => request(app).post(`/api/v1/models/${id}/query`).set(bearer(t)).send(body);

test('runs a query with the `query` scope and forwards only the documented fields', async () => {
  const res = await query({
    measureNames: ['items.amt_sum'],
    dimensionNames: ['items.label'],
    filters: { 'items.label': ['a'] },
    limit: 999999,
    sqlOnly: true,
    bypassCache: true,
    widgetFilters: [{ field: 'x' }],
  });
  expect(res.status).toBe(200);
  expect(res.body.rows).toHaveLength(1);
  expect(received).toEqual({
    measureNames: ['items.amt_sum'],
    dimensionNames: ['items.label'],
    filters: { 'items.label': ['a'] },
    limit: 5000,
  });
});

test('a token without the `query` scope is refused', async () => {
  const res = await query({ measureNames: ['items.amt_sum'] }, readToken);
  expect(res.status).toBe(403);
  expect(spy).not.toHaveBeenCalled();
});

test('the body is validated before anything runs', async () => {
  expect((await query({})).status).toBe(400);
  expect((await query({ measureNames: 'items.amt_sum' })).status).toBe(400);
  expect((await query({ measureNames: ['items.amt_sum'], filters: ['a'] })).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});

test('defaults the limit when none is given', async () => {
  await query({ measureNames: ['items.amt_sum'] });
  expect(received.limit).toBe(5000);
  expect(received.dimensionNames).toEqual([]);
});

test('the real handler answers 404 for a model the caller cannot see', async () => {
  spy.mockRestore();
  const res = await query({ measureNames: ['items.amt_sum'] }, strangerToken);
  expect(res.status).toBe(404);
});
