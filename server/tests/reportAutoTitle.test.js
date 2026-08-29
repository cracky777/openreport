// A title the APP generated is made unique; a title the USER typed is defended.
//
// "New report" on a model always proposes "<model> — Report", so the second one
// failed with a conflict about a name nobody had chosen — the product arguing
// with itself. Suffixing is only right for generated names: when someone types
// a title that is already taken, the error is the useful answer.
const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

const setup = async () => {
  const u = seedUser({ role: 'editor' });
  const ds = (await request(app).post('/api/datasources').use(as(u))
    .send({ name: `ds-${Math.random()}`, dbType: 'duckdb', dbName: ':memory:' })).body.datasource.id;
  const model = (await request(app).post('/api/models').use(as(u))
    .send({ name: `m-${Math.random()}`, datasourceId: ds })).body.model.id;
  const ws = async (name) => (await request(app).post('/api/workspaces').use(as(u)).send({ name })).body.workspace.id;
  return { u, model, wsA: await ws(`A-${Math.random()}`), wsB: await ws(`B-${Math.random()}`) };
};

const mk = (u, model, title, workspaceId, autoTitle) => request(app).post('/api/reports').use(as(u))
  .send({ title, modelId: model, workspaceId, ...(autoTitle ? { autoTitle: true } : {}) });

describe('Report titles', () => {
  test('a generated title is suffixed instead of rejected', async () => {
    const { u, model, wsA } = await setup();
    const first = await mk(u, model, 'Sales — Report', wsA, true);
    expect(first.status).toBe(201);
    expect(first.body.report.title).toBe('Sales — Report');

    const second = await mk(u, model, 'Sales — Report', wsA, true);
    expect(second.status).toBe(201);
    expect(second.body.report.title).toBe('Sales — Report (2)');

    const third = await mk(u, model, 'Sales — Report', wsA, true);
    expect(third.body.report.title).toBe('Sales — Report (3)');
  });

  test('the suffix counter is per workspace', async () => {
    const { u, model, wsA, wsB } = await setup();
    await mk(u, model, 'Sales — Report', wsA, true);
    const elsewhere = await mk(u, model, 'Sales — Report', wsB, true);
    // A different workspace is a different namespace: no suffix is owed.
    expect(elsewhere.body.report.title).toBe('Sales — Report');
  });

  test('a typed title still conflicts, and only within its workspace', async () => {
    const { u, model, wsA, wsB } = await setup();
    expect((await mk(u, model, 'Ventes', wsA)).status).toBe(201);
    // Same name, other workspace — allowed.
    expect((await mk(u, model, 'Ventes', wsB)).status).toBe(201);
    // Same name, same workspace — the user chose it, so they get told.
    expect((await mk(u, model, 'Ventes', wsA)).status).toBe(409);
  });
});
