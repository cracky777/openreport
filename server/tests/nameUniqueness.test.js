// Name uniqueness: a datasource / model / workspace can't reuse a name in the
// caller's scope (per-user in OSS), and a report can't reuse a title within the
// same workspace. Case-insensitive, 409 on conflict, rename excludes itself.
const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

describe('Name uniqueness (409)', () => {
  test('datasources: duplicate name (case-insensitive) is rejected', async () => {
    const u = seedUser({ role: 'editor' });
    const mk = (name) => request(app).post('/api/datasources').use(as(u)).send({ name, dbType: 'duckdb', dbName: ':memory:' });
    expect((await mk('Sales DB')).status).toBe(201);
    expect((await mk('Sales DB')).status).toBe(409);
    expect((await mk('sales db')).status).toBe(409); // case-insensitive
    // A different user has their own scope
    const other = seedUser({ role: 'editor' });
    expect((await request(app).post('/api/datasources').use(as(other)).send({ name: 'Sales DB', dbType: 'duckdb', dbName: ':memory:' })).status).toBe(201);
  });

  test('models: duplicate name is rejected; rename to own name is allowed', async () => {
    const u = seedUser({ role: 'editor' });
    const ds = (await request(app).post('/api/datasources').use(as(u)).send({ name: 'DS', dbType: 'duckdb', dbName: ':memory:' })).body.datasource.id;
    const mk = (name) => request(app).post('/api/models').use(as(u)).send({ name, datasourceId: ds });
    const m1 = await mk('Model A');
    expect(m1.status).toBe(201);
    expect((await mk('Model A')).status).toBe(409);
    // Renaming Model A to its own name is fine (excludes itself)
    expect((await request(app).put(`/api/models/${m1.body.model.id}`).use(as(u)).send({ name: 'Model A' })).status).toBe(200);
  });

  test('workspaces: duplicate name is rejected', async () => {
    const u = seedUser({ role: 'editor' });
    const mk = (name) => request(app).post('/api/workspaces').use(as(u)).send({ name });
    expect((await mk('Team')).status).toBe(201);
    expect((await mk('Team')).status).toBe(409);
  });

  test('reports: duplicate title within a workspace is rejected, but allowed across workspaces', async () => {
    const u = seedUser({ role: 'editor' });
    const ds = (await request(app).post('/api/datasources').use(as(u)).send({ name: 'RDS', dbType: 'duckdb', dbName: ':memory:' })).body.datasource.id;
    const model = (await request(app).post('/api/models').use(as(u)).send({ name: 'RM', datasourceId: ds })).body.model.id;
    const ws1 = (await request(app).post('/api/workspaces').use(as(u)).send({ name: 'WS1' })).body.workspace.id;
    const ws2 = (await request(app).post('/api/workspaces').use(as(u)).send({ name: 'WS2' })).body.workspace.id;
    const mk = (title, workspaceId) => request(app).post('/api/reports').use(as(u)).send({ title, modelId: model, workspaceId });
    expect((await mk('Q1', ws1)).status).toBe(201);
    expect((await mk('Q1', ws1)).status).toBe(409);   // same ws → conflict
    expect((await mk('Q1', ws2)).status).toBe(201);   // other ws → fine
    // The default title never conflicts
    expect((await mk(undefined, ws1)).status).toBe(201);
    expect((await mk(undefined, ws1)).status).toBe(201);
  });
});
