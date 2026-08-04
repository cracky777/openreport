// Error-path coverage for POST /models/:id/query. The success SQL is locked by
// the snapshot suites; these pin the 400 branches the SELECT-measure loop and
// its guards emit, so extracting that loop can't silently swallow or move an
// early return. (sqlOnly compiles without touching a DB.)
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

function seed(measures) {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  const model = seedModel({ userId: owner, datasourceId: ds, measures });
  return { owner, model };
}
const run = (owner, model, body) =>
  request(app).post(`/api/models/${model}/query`).set('x-test-user', owner).send({ ...body, sqlOnly: true });

describe('POST /models/:id/query — 400 branches', () => {
  test('a measureName absent from the model is rejected (Missing in model)', async () => {
    const { owner, model } = seed();
    const res = await run(owner, model, { dimensionNames: ['items.label'], measureNames: ['items.ghost'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing in model/);
  });

  test('a dimensionName absent from the model is rejected', async () => {
    const { owner, model } = seed();
    const res = await run(owner, model, { dimensionNames: ['items.ghostdim'], measureNames: ['items.amt_sum'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing in model/);
  });

  test('selecting neither a dimension nor a measure is rejected', async () => {
    const { owner, model } = seed();
    const res = await run(owner, model, { dimensionNames: [], measureNames: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one dimension or measure/i);
  });

  // An in-loop 400 (cyclic custom ref) must halt the handler cleanly — it used
  // to `return` from inside `selectedMeasures.forEach`, which fell through and
  // double-responded ("Cannot set headers after sent"). The for…of conversion
  // makes the early return actually exit.
  test('a cyclic custom-measure reference is rejected once, cleanly', async () => {
    const measures = [{ name: 'items.cyc', aggregation: 'custom', label: 'cyc', expression: '${items.cyc}' }];
    const { owner, model } = seed(measures);
    const res = await run(owner, model, { dimensionNames: ['items.label'], measureNames: ['items.cyc'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Cc]yclic/);
  });
});
