// Rights on datasources and models follow the workspace (utils/workspaceAccess.js):
// a source or a model lives in one workspace, a model can be shared into
// others, and the role held there decides. Two rules on top: a new workspace
// holds nothing, and the global admin manages everything but reads data only
// where a workspace gave them a role.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, db } = require('./helpers/testApp');
const { ensurePersonalWorkspace } = require('../utils/personalWorkspace');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

const addMember = (wsId, userId, role) => db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(wsId, userId, role);
const as = (user) => ({
  get: (url) => request(app).get(`/api${url}`).set('x-test-user', user),
  post: (url, body) => request(app).post(`/api${url}`).set('x-test-user', user).send(body || {}),
  put: (url, body) => request(app).put(`/api${url}`).set('x-test-user', user).send(body || {}),
  del: (url) => request(app).delete(`/api${url}`).set('x-test-user', user),
});
const RLS = { enabled: true, table: 'items', primaryKey: 'label', rules: { a: ['*'] } };

let admin; let owner; let boss; let ed; let vw; let team; let ds; let model;
beforeAll(() => {
  admin = seedUser({ role: 'admin' });
  owner = seedUser({ role: 'editor' });
  boss = seedUser({ role: 'editor' });
  ed = seedUser({ role: 'editor' });
  vw = seedUser({ role: 'viewer' });
  team = seedWorkspace({ ownerId: boss, name: 'team' });
  addMember(team, owner, 'editor');
  addMember(team, ed, 'editor');
  addMember(team, vw, 'viewer');
  ds = seedDatasource({ userId: owner });
  model = seedModel({ userId: owner, datasourceId: ds, rls: RLS });
});

describe('a new workspace holds nothing', () => {
  test('the owner sees their own model at home; the team sees nothing of it yet', async () => {
    const mine = await as(owner).get('/models');
    expect(mine.body.models.map((m) => m.id)).toContain(model);
    expect(mine.body.models.find((m) => m.id === model)).toMatchObject({ access: 'manage', workspace_id: ensurePersonalWorkspace(owner) });
    expect((await as(ed).get('/models')).body.models).toEqual([]);
    expect((await as(boss).get('/datasources')).body.datasources).toEqual([]);
    expect((await as(ed).post(`/models/${model}/query`, { dimensionNames: ['items.label'], sqlOnly: true })).status).toBe(404);
  });
});

describe('the global admin', () => {
  test('lists and edits every model and source, reads no data without a role', async () => {
    const list = await as(admin).get('/models');
    expect(list.body.models.find((m) => m.id === model)).toMatchObject({ access: 'manage' });
    expect((await as(admin).get('/datasources')).body.datasources.find((d) => d.id === ds)).toMatchObject({ access: 'manage' });
    expect((await as(admin).put(`/models/${model}`, { description: 'seen by admin' })).status).toBe(200);
    expect((await as(admin).post(`/models/${model}/query`, { dimensionNames: ['items.label'], sqlOnly: true })).status).toBe(404);
    expect((await as(admin).post(`/datasources/${ds}/query`, { sql: 'SELECT 1' })).status).toBe(403);
    // Every workspace is listed for them, those they hold no role in apart.
    const ws = await as(admin).get('/workspaces');
    expect(ws.body.otherWorkspaces.map((w) => w.id)).toContain(team);
    expect((await as(owner).get('/workspaces')).body.otherWorkspaces).toEqual([]);
  });
});

describe('a model in a team workspace', () => {
  beforeAll(async () => {
    const moved = await as(owner).put(`/models/${model}/workspace`, { workspaceId: team });
    expect(moved.status).toBe(200);
  });

  test('editors edit and query, viewers only query, nobody but an admin deletes or sets RLS', async () => {
    expect((await as(ed).get('/models')).body.models.find((m) => m.id === model)).toMatchObject({ access: 'edit', workspace_id: team });
    expect((await as(ed).put(`/models/${model}`, { description: 'by an editor' })).status).toBe(200);
    expect((await as(ed).put(`/models/${model}`, { rls: { enabled: false } })).status).toBe(403);
    expect((await as(ed).del(`/models/${model}`)).status).toBe(403);
    expect((await as(ed).post(`/models/${model}/query`, { dimensionNames: ['items.label'], sqlOnly: true })).status).toBe(200);
    expect((await as(vw).get('/models')).body.models).toEqual([]);
    expect((await as(vw).get(`/models/${model}`)).status).toBe(200);
    expect((await as(vw).post(`/models/${model}/query`, { dimensionNames: ['items.label'], sqlOnly: true })).status).toBe(200);
    expect((await as(vw).put(`/models/${model}`, { description: 'x' })).status).toBe(403);
  });

  test('RLS filters the editor and spares the workspace admin, never the global admin by default', async () => {
    const q = { dimensionNames: ['items.label'], sqlOnly: true };
    expect((await as(ed).post(`/models/${model}/query`, q)).body.sql).toMatch(/IN \('a'\)/);
    expect((await as(boss).post(`/models/${model}/query`, q)).body.sql).not.toMatch(/IN \('a'\)/);
    expect((await as(admin).post(`/models/${model}/query`, q)).status).toBe(404);
    addMember(team, admin, 'editor');
    expect((await as(admin).post(`/models/${model}/query`, q)).body.sql).toMatch(/IN \('a'\)/);
  });

  test('the source behind the model is readable by its editors, its rows and settings are not', async () => {
    expect((await as(ed).get('/datasources')).body.datasources.find((d) => d.id === ds)).toMatchObject({ access: 'read' });
    expect((await as(ed).get(`/datasources/${ds}`)).status).toBe(200);
    expect((await as(ed).post(`/datasources/${ds}/query`, { sql: 'SELECT 1' })).status).toBe(403);
    expect((await as(ed).put(`/datasources/${ds}`, { name: 'renamed', dbType: 'postgres', host: 'h', dbName: 'd' })).status).toBe(403);
    expect((await as(ed).del(`/datasources/${ds}`)).status).toBe(403);
  });

  test('creating there: a source takes a workspace admin, a model an editor', async () => {
    const body = { name: 'team duck', dbType: 'duckdb', dbName: ':memory:', workspaceId: team };
    expect((await as(ed).post('/datasources', body)).status).toBe(403);
    const created = await as(boss).post('/datasources', body);
    expect(created.status).toBe(201);
    expect(created.body.datasource.workspace_id).toBe(team);
    const m = await as(ed).post('/models', { name: 'team model', datasourceId: created.body.datasource.id, workspaceId: team });
    expect(m.status).toBe(201);
    expect(db.prepare('SELECT workspace_id FROM models WHERE id = ?').get(m.body.model.id).workspace_id).toBe(team);
    // A viewer does not even see the source: 404, not a hint that it exists.
    expect((await as(vw).post('/models', { name: 'nope', datasourceId: created.body.datasource.id, workspaceId: team })).status).toBe(404);
  });
});

describe('sharing a model into another workspace', () => {
  let cust; let ced; let other; let third; let vw3;
  beforeAll(() => {
    cust = seedUser({ role: 'editor' });
    ced = seedUser({ role: 'editor' });
    vw3 = seedUser({ role: 'viewer' });
    other = seedWorkspace({ ownerId: cust, name: 'other' });
    third = seedWorkspace({ ownerId: cust, name: 'third' });
    addMember(other, ced, 'editor');
    addMember(third, ced, 'editor');
    addMember(third, vw3, 'viewer');
  });

  test('a manager shares it with a workspace they belong to; its editors build, never edit', async () => {
    expect((await as(owner).put(`/models/${model}/shares`, { workspaceIds: [other] })).status).toBe(403);
    addMember(other, owner, 'viewer');
    expect((await as(owner).put(`/models/${model}/shares`, { workspaceIds: [other] })).body.workspaceIds).toEqual([other]);
    expect((await as(ed).put(`/models/${model}/shares`, { workspaceIds: [] })).status).toBe(403);
    expect((await as(ced).get('/models')).body.models.find((m) => m.id === model)).toMatchObject({ access: 'build', shared_in: [other] });
    expect((await as(ced).post('/reports', { modelId: model, workspaceId: other, title: 'on shared' })).status).toBe(201);
    expect((await as(ced).put(`/models/${model}`, { description: 'x' })).status).toBe(403);
    expect((await as(ced).post(`/models/${model}/query`, { dimensionNames: ['items.label'], sqlOnly: true })).status).toBe(200);
  });

  test('a report goes where its model is available, unless whoever places it manages the model', async () => {
    const refused = await as(ced).post('/reports', { modelId: model, workspaceId: third, title: 'elsewhere' });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/not available in this workspace/);
    expect((await as(vw3).post(`/models/${model}/query`, { dimensionNames: ['items.label'], sqlOnly: true })).status).toBe(404);
    addMember(third, owner, 'editor');
    expect((await as(owner).post('/reports', { modelId: model, workspaceId: third, title: 'placed by owner' })).status).toBe(201);
    // The report opens the data to the workspace's readers, as it always did.
    expect((await as(vw3).post(`/models/${model}/query`, { dimensionNames: ['items.label'], sqlOnly: true })).status).toBe(200);
  });

  test('a shared source: the other workspace builds models on it, never holds it', async () => {
    const tds = seedDatasource({ userId: boss });
    db.prepare('UPDATE datasources SET workspace_id = ? WHERE id = ?').run(team, tds);
    expect((await as(ced).get('/datasources')).body.datasources.find((d) => d.id === tds)).toBeUndefined();
    expect((await as(ced).put(`/datasources/${tds}/shares`, { workspaceIds: [other] })).status).toBe(404);
    // boss holds no role in `other`: sharing there is not theirs to do.
    expect((await as(boss).put(`/datasources/${tds}/shares`, { workspaceIds: [other] })).status).toBe(403);
    addMember(other, boss, 'viewer');
    expect((await as(boss).put(`/datasources/${tds}/shares`, { workspaceIds: [other] })).body.workspaceIds).toEqual([other]);
    expect((await as(ced).get('/datasources')).body.datasources.find((d) => d.id === tds)).toMatchObject({ access: 'read', shared_in: [other] });
    const m = await as(ced).post('/models', { name: 'on shared source', datasourceId: tds, workspaceId: other });
    expect(m.status).toBe(201);
    expect(db.prepare('SELECT workspace_id FROM models WHERE id = ?').get(m.body.model.id).workspace_id).toBe(other);
    expect((await as(ced).put(`/datasources/${tds}`, { name: 'mine now', dbType: 'postgres', host: 'h', dbName: 'd' })).status).toBe(403);
    expect((await as(ced).del(`/datasources/${tds}`)).status).toBe(403);
  });

  test('deleting a workspace sends its sources and models home and ends its shares', async () => {
    const shared = seedModel({ userId: cust, datasourceId: seedDatasource({ userId: cust }) });
    db.prepare('UPDATE models SET workspace_id = ? WHERE id = ?').run(third, shared);
    db.prepare('INSERT INTO workspace_models (workspace_id, model_id) VALUES (?, ?)').run(other, shared);
    expect((await as(cust).del(`/workspaces/${third}`)).status).toBe(200);
    expect(db.prepare('SELECT workspace_id FROM models WHERE id = ?').get(shared).workspace_id).toBe(ensurePersonalWorkspace(cust));
    expect(db.prepare('SELECT COUNT(*) as n FROM workspace_models WHERE workspace_id = ?').get(third).n).toBe(0);
  });
});

describe('sharing a report into another workspace', () => {
  test('its members open it and read its data, never edit it; the model must be available there', async () => {
    const a = seedUser({ role: 'editor' });
    const reader = seedUser({ role: 'viewer' });
    const home = seedWorkspace({ ownerId: a });
    const dest = seedWorkspace({ ownerId: a });
    addMember(dest, reader, 'viewer');
    const d = seedDatasource({ userId: a });
    const m = seedModel({ userId: a, datasourceId: d });
    db.prepare('UPDATE models SET workspace_id = ? WHERE id = ?').run(home, m);
    const r = seedReport({ userId: a, modelId: m, workspaceId: home });
    const q = { dimensionNames: ['items.label'], sqlOnly: true };

    expect((await as(reader).get(`/reports/${r}`)).status).toBe(403);
    // `a` manages the model: the report may go where the model is not.
    expect((await as(a).put(`/reports/${r}/shares`, { workspaceIds: [dest] })).body.workspaceIds).toEqual([dest]);
    const listed = (await as(reader).get(`/workspaces/${dest}`)).body.reports.find((x) => x.id === r);
    expect(listed).toMatchObject({ shared: true, workspace_id: home });
    expect((await as(reader).get(`/reports/${r}`)).status).toBe(200);
    expect((await as(reader).post(`/models/${m}/query`, q)).status).toBe(200);
    expect((await as(reader).put(`/reports/${r}`, { title: 'x' })).status).toBe(403);
    expect((await as(reader).put(`/reports/${r}/shares`, { workspaceIds: [] })).status).toBe(403);

    // An editor who does not manage the model shares only where it is available.
    const e = seedUser({ role: 'editor' });
    addMember(home, e, 'editor');
    addMember(dest, e, 'editor');
    const refused = await as(e).put(`/reports/${r}/shares`, { workspaceIds: [dest] });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/not available in this workspace/);

    // Unsharing closes it again.
    expect((await as(a).put(`/reports/${r}/shares`, { workspaceIds: [] })).status).toBe(200);
    expect((await as(reader).get(`/reports/${r}`)).status).toBe(403);
    expect((await as(reader).post(`/models/${m}/query`, q)).status).toBe(404);
  });

  test('its editors there do everything but delete it; the model keeps its own bar', async () => {
    const a = seedUser({ role: 'editor' });
    const e = seedUser({ role: 'editor' });
    const home = seedWorkspace({ ownerId: a });
    const dest = seedWorkspace({ ownerId: a });
    addMember(dest, e, 'editor');
    const m = seedModel({ userId: a, datasourceId: seedDatasource({ userId: a }) });
    db.prepare('UPDATE models SET workspace_id = ? WHERE id = ?').run(home, m);
    const r = seedReport({ userId: a, modelId: m, workspaceId: home });

    // Before the share, the report does not exist for them.
    expect((await as(e).put(`/reports/${r}`, { title: 'before share' })).status).toBe(404);
    // `a` manages the model, so the report may be shared where the model is not.
    expect((await as(a).put(`/reports/${r}/shares`, { workspaceIds: [dest] })).status).toBe(200);

    expect((await as(e).put(`/reports/${r}`, { title: 'edited from dest', widgets: {}, layout: [] })).status).toBe(200);
    expect(db.prepare('SELECT title FROM reports WHERE id = ?').get(r).title).toBe('edited from dest');
    expect((await as(e).put(`/reports/${r}`, { live_mode: true })).status).toBe(200);
    expect((await as(e).get(`/reports/${r}/shares`)).status).toBe(200);
    // What exposes the model still asks for the model: publishing needs write
    // on it, a placement needs it available where the report goes.
    expect((await as(e).put(`/reports/${r}`, { is_public: true })).status).toBe(403);
    expect((await as(e).put(`/reports/${r}`, { workspace_id: dest })).status).toBe(403);
    // Deleting stays with its own workspace.
    expect((await as(e).del(`/reports/${r}`)).status).toBe(403);
    // A copy is a new report: it goes where its model is available. Once the
    // model is shared there too, a copy made from there lands there.
    const refusedCopy = await as(e).post(`/reports/${r}/duplicate`, { workspaceId: dest });
    expect(refusedCopy.status).toBe(403);
    expect(refusedCopy.body.error).toMatch(/not available in this workspace/);
    db.prepare('INSERT INTO workspace_models (workspace_id, model_id) VALUES (?, ?)').run(dest, m);
    const copy = await as(e).post(`/reports/${r}/duplicate`, { workspaceId: dest });
    expect(copy.status).toBe(201);
    expect(copy.body.report).toMatchObject({ workspace_id: dest, user_id: e });

    // Unsharing takes it back entirely.
    expect((await as(a).put(`/reports/${r}/shares`, { workspaceIds: [] })).status).toBe(200);
    expect((await as(e).put(`/reports/${r}`, { title: 'after unshare' })).status).toBe(404);
  });
});

describe('reports still open the data of their readers', () => {
  test('a public report lets an anonymous caller query, a workspace viewer too', async () => {
    const o = seedUser({ role: 'editor' });
    const d = seedDatasource({ userId: o });
    const m = seedModel({ userId: o, datasourceId: d });
    seedReport({ userId: o, modelId: m, isPublic: 1 });
    expect((await request(app).post(`/api/models/${m}/query`).send({ dimensionNames: ['items.label'], sqlOnly: true })).status).toBe(200);
  });
});
