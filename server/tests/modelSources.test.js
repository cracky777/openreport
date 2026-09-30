// A model can read several imported files: its own source, plus LINKED ones
// whose tables it names `alias__table`. Linking is a model editor's call on a
// source they read; the link then counts everywhere a model counts — reading
// the source, refusing its deletion, dropping its cached rollups.
const request = require('supertest');

// Every import runs in a child process (utils/fileImport.js): under a full
// parallel run, the default 5 s is short.
jest.setTimeout(30000);
const { buildApp, seedUser, seedDatasource, seedWorkspace, db } = require('./helpers/testApp');
const { modelIdsUsing, aliasFor } = require('../utils/modelSources');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

async function importFile(uid, name, extra = {}) {
  let req = request(app).post('/api/upload').use(as(uid));
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
  const res = await req.attach('file', Buffer.from('id\n1\n'), name);
  expect(res.status).toBe(201);
  return res.body.datasource.id;
}
async function modelOn(uid, dsId, extra = {}) {
  const res = await request(app).post('/api/models').use(as(uid)).send({ name: `m-${Math.random()}`, datasourceId: dsId, ...extra });
  expect(res.status).toBe(201);
  return res.body.model.id;
}
const link = (uid, modelId, datasourceId) => request(app).post(`/api/models/${modelId}/datasources`).use(as(uid)).send({ datasourceId });

describe('Linking sources to a model', () => {
  test('a linked file shows on the model under its alias', async () => {
    const u = seedUser({ role: 'editor' });
    const articles = await importFile(u, 'articles.csv');
    const ventes = await importFile(u, 'ventes.csv');
    const model = await modelOn(u, articles);

    const res = await link(u, model, ventes);
    expect(res.status).toBe(201);
    expect(res.body.datasource).toEqual({ id: ventes, name: 'ventes', alias: 'ventes' });
    const got = await request(app).get(`/api/models/${model}`).use(as(u));
    expect(got.body.model.linked_datasources).toEqual([{ id: ventes, name: 'ventes', alias: 'ventes' }]);
  });

  test('only imported files combine, each once', async () => {
    const u = seedUser({ role: 'editor' });
    const file = await importFile(u, 'one.csv');
    const other = await importFile(u, 'two.csv');
    const pg = seedDatasource({ userId: u });
    const model = await modelOn(u, file);

    expect((await link(u, model, pg)).status).toBe(400);
    expect((await link(u, model, file)).status).toBe(409);
    expect((await link(u, model, other)).status).toBe(201);
    expect((await link(u, model, other)).status).toBe(409);
    const onPg = await modelOn(u, pg);
    expect((await link(u, onPg, other)).status).toBe(400);
  });

  test('a source the caller cannot read cannot be linked', async () => {
    const u = seedUser({ role: 'editor' });
    const stranger = seedUser({ role: 'editor' });
    const model = await modelOn(u, await importFile(u, 'mine.csv'));
    const theirs = await importFile(stranger, 'theirs.csv');
    expect((await link(u, model, theirs)).status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM model_datasources WHERE model_id = ?').get(model).n).toBe(0);
  });

  test('a viewer of the model cannot link', async () => {
    const owner = seedUser({ role: 'editor' });
    const viewer = seedUser({ role: 'editor' });
    const ws = seedWorkspace({ ownerId: owner, name: 'Team' });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(ws, viewer, 'viewer');
    const a = await importFile(owner, 'ta.csv', { workspaceId: ws });
    const b = await importFile(owner, 'tb.csv', { workspaceId: ws });
    const model = await modelOn(owner, a, { workspaceId: ws });
    expect((await link(viewer, model, b)).status).toBe(403);
  });

  test('the link counts: editors read the source, it cannot be deleted, its rollups follow', async () => {
    const owner = seedUser({ role: 'editor' });
    const editor = seedUser({ role: 'editor' });
    const ws = seedWorkspace({ ownerId: owner, name: 'Team' });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(ws, editor, 'editor');
    const own = await importFile(owner, 'own.csv', { workspaceId: ws });
    // Lives in the owner's personal workspace: the team's editors reach it only through the model.
    const linked = await importFile(owner, 'linked.csv');
    const model = await modelOn(owner, own, { workspaceId: ws });
    expect((await link(owner, model, linked)).status).toBe(201);

    expect((await request(app).get(`/api/datasources/${linked}`).use(as(editor))).status).toBe(200);
    expect(modelIdsUsing(linked)).toEqual([model]);
    const del = await request(app).delete(`/api/datasources/${linked}`).use(as(owner));
    expect(del.status).toBe(409);
  });

  test('unlinking waits until the model holds none of the source\'s tables', async () => {
    const u = seedUser({ role: 'editor' });
    const model = await modelOn(u, await importFile(u, 'base.csv'));
    const other = await importFile(u, 'extra.csv');
    await link(u, model, other);
    db.prepare('UPDATE models SET selected_tables = ? WHERE id = ?').run(JSON.stringify(['base', 'extra__extra']), model);

    const refused = await request(app).delete(`/api/models/${model}/datasources/${other}`).use(as(u));
    expect(refused.status).toBe(409);
    db.prepare('UPDATE models SET selected_tables = ? WHERE id = ?').run(JSON.stringify(['base']), model);
    const done = await request(app).delete(`/api/models/${model}/datasources/${other}`).use(as(u));
    expect(done.status).toBe(200);
    expect(modelIdsUsing(other)).toEqual([]);
  });

  test('deleting the model drops its links', async () => {
    const u = seedUser({ role: 'editor' });
    const model = await modelOn(u, await importFile(u, 'gone.csv'));
    const other = await importFile(u, 'kept.csv');
    await link(u, model, other);
    expect((await request(app).delete(`/api/models/${model}`).use(as(u))).status).toBe(200);
    expect(modelIdsUsing(other)).toEqual([]);
  });

  test('aliases are identifiers, unique in the model, never a DuckDB catalog', async () => {
    const u = seedUser({ role: 'editor' });
    const model = await modelOn(u, await importFile(u, 'alias_base.csv'));
    db.prepare('INSERT INTO model_datasources (model_id, datasource_id, alias) VALUES (?, ?, ?)').run(model, await importFile(u, 'alias_other.csv'), 'ventes');
    expect(aliasFor(model, 'Ventes')).toBe('ventes_2');
    expect(aliasFor(model, 'main')).toBe('main_2');
    expect(aliasFor(model, '2024 export (v2)')).toBe('s_2024_export_v2');
    expect(aliasFor(model, 'Clients & Articles')).toBe('clients_articles');
  });
});
