// `cacheOnly` is the promise the AI assistant rests on: a request carrying it
// is answered from the rollup store or not at all. Every assertion here counts
// calls to createConnection rather than checking for a crash — the interval
// probe swallows its own errors, so a throwing mock alone would prove nothing.
jest.mock('../utils/dbConnector', () => ({
  ...jest.requireActual('../utils/dbConnector'),
  createConnection: jest.fn(() => { throw new Error('source must not be reached'); }),
}));
jest.mock('../utils/rollupPlanner', () => ({
  tryServeFromRollup: jest.fn(),
  tryServeSlicerDistinct: jest.fn(),
}));

const request = require('supertest');
const { createConnection } = require('../utils/dbConnector');
const rollupPlanner = require('../utils/rollupPlanner');
const { clearSchemaCache } = require('../utils/columnTypeResolver');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => { jest.restoreAllMocks(); });

describe('/models/:id/query with cacheOnly', () => {
  let owner, model;
  const BODY = { dimensionNames: ['items.label'], measureNames: ['items.amt_sum'] };

  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    // postgres has extractEpoch, so the interval probe would open a connection.
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    model = seedModel({ userId: owner, datasourceId: ds });
    seedReport({ userId: owner, modelId: model });
  });

  beforeEach(() => {
    createConnection.mockClear();
    rollupPlanner.tryServeFromRollup.mockReset();
    rollupPlanner.tryServeSlicerDistinct.mockReset();
    rollupPlanner.tryServeFromRollup.mockResolvedValue({ hit: false, reason: 'no-rollup:items' });
    rollupPlanner.tryServeSlicerDistinct.mockResolvedValue({ hit: false, reason: 'no-rollup:items' });
    clearSchemaCache();
  });

  const query = (body) => request(app).post(`/api/models/${model}/query`).set('x-test-user', owner).send(body);

  test('control: without cacheOnly a planner MISS reaches the source', async () => {
    await query(BODY);
    expect(createConnection).toHaveBeenCalled();
  });

  test('a MISS returns the miss shape and never opens a connection', async () => {
    const res = await query({ ...BODY, cacheOnly: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rows: [],
      rowCount: 0,
      _cache: { hit: false, cacheOnly: true, reason: 'no-rollup:items' },
    });
    expect(createConnection).not.toHaveBeenCalled();
  });

  test('a slicer-distinct MISS is held back too', async () => {
    const res = await query({ dimensionNames: ['items.label'], measureNames: [], distinct: true, cacheOnly: true });
    expect(res.status).toBe(200);
    expect(res.body._cache).toEqual({ hit: false, cacheOnly: true, reason: 'no-rollup:items' });
    expect(createConnection).not.toHaveBeenCalled();
  });

  test.each([
    ['bypassCache', { bypassCache: true }],
    ['sqlOnly', { sqlOnly: true }],
    ['_rollupBuilder', { _rollupBuilder: true }],
  ])('cacheOnly wins over %s', async (_name, extra) => {
    const res = await query({ ...BODY, ...extra, cacheOnly: true });
    expect(res.status).toBe(200);
    expect(res.body._cache.cacheOnly).toBe(true);
    expect(res.body.sql).toBeUndefined();
    expect(rollupPlanner.tryServeFromRollup).toHaveBeenCalledTimes(1);
    expect(createConnection).not.toHaveBeenCalled();
  });

  test('a HIT returns the rollup rows', async () => {
    rollupPlanner.tryServeFromRollup.mockResolvedValue({
      hit: true, rows: [{ label: 'a', amt: 3 }], tableName: 'r_x_g1', match: 'exact', sql: 'SELECT 1',
    });
    const res = await query({ ...BODY, cacheOnly: true });
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([{ label: 'a', amt: 3 }]);
    expect(res.body._cache.fromRollup).toBe('r_x_g1');
    expect(createConnection).not.toHaveBeenCalled();
  });

  test('only the literal boolean arms the flag', async () => {
    await query({ ...BODY, cacheOnly: 'true' });
    expect(createConnection).toHaveBeenCalled();
  });
});

// The planner is mocked above, so the RLS case asserts what the route hands
// it: a restricted viewer must reach the planner flagged rlsApplies (the real
// planner turns that into MISS:rls-restricted) and still never touch the source.
describe('cacheOnly for an RLS-restricted viewer', () => {
  test('planner is told RLS applies and the miss is returned as-is', async () => {
    const owner = seedUser({ role: 'editor', email: 'owner@co.io' });
    const viewer = seedUser({ role: 'viewer', email: 'alice@co.io' });
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    const model = seedModel({
      userId: owner,
      datasourceId: ds,
      rls: { enabled: true, table: 'items', primaryKey: 'client_id', rules: { c1: ['alice@co.io'] } },
    });
    seedReport({ userId: owner, modelId: model, isPublic: 1 });
    createConnection.mockClear();
    rollupPlanner.tryServeFromRollup.mockReset();
    rollupPlanner.tryServeFromRollup.mockResolvedValue({ hit: false, reason: 'rls-restricted' });

    const res = await request(app).post(`/api/models/${model}/query`).set('x-test-user', viewer)
      .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], cacheOnly: true });

    expect(res.status).toBe(200);
    expect(res.body._cache).toEqual({ hit: false, cacheOnly: true, reason: 'rls-restricted' });
    expect(rollupPlanner.tryServeFromRollup.mock.calls[0][0].rlsApplies).toBe(true);
    expect(createConnection).not.toHaveBeenCalled();
  });
});
