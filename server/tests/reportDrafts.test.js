// A report created blank from the "New report" dialog is a draft until its
// first save: no list shows it, leaving the editor deletes it, a day-old one is
// purged. A report saved meanwhile is never deleted by the draft route.
const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');
const db = require('../db');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

async function setup() {
  const u = seedUser({ role: 'editor' });
  const ds = (await request(app).post('/api/datasources').use(as(u)).send({ name: `DS ${Math.random()}`, dbType: 'duckdb', dbName: ':memory:' })).body.datasource.id;
  const model = (await request(app).post('/api/models').use(as(u)).send({ name: `M ${Math.random()}`, datasourceId: ds })).body.model.id;
  const ws = (await request(app).post('/api/workspaces').use(as(u)).send({ name: `WS ${Math.random()}` })).body.workspace.id;
  const create = (body) => request(app).post('/api/reports').use(as(u)).send({ modelId: model, workspaceId: ws, ...body });
  const listIds = async () => (await request(app).get('/api/reports').use(as(u))).body.reports.map((r) => r.id);
  const wsIds = async () => (await request(app).get(`/api/workspaces/${ws}`).use(as(u))).body.reports.map((r) => r.id);
  return { u, model, ws, create, listIds, wsIds };
}

describe('Report drafts', () => {
  test('a draft is listed nowhere until its first save, then in its workspace', async () => {
    const { u, ws, create, listIds, wsIds } = await setup();
    const res = await create({ title: 'Draft one', draft: true });
    expect(res.status).toBe(201);
    const id = res.body.report.id;
    expect(res.body.report.draft).toBe(1);
    expect(await listIds()).not.toContain(id);
    expect(await wsIds()).not.toContain(id);
    // The editor still opens it.
    expect((await request(app).get(`/api/reports/${id}`).use(as(u))).status).toBe(200);

    const saved = await request(app).put(`/api/reports/${id}`).use(as(u)).send({ title: 'Draft one', layout: [], widgets: {}, settings: {} });
    expect(saved.status).toBe(200);
    expect(saved.body.report.draft).toBe(0);
    expect(saved.body.report.workspace_id).toBe(ws);
    expect(await listIds()).toContain(id);
    expect(await wsIds()).toContain(id);
  });

  test('a report created with content is not a draft', async () => {
    const { create, listIds } = await setup();
    const res = await create({ title: 'Imported-like' });
    expect(res.body.report.draft).toBe(0);
    expect(await listIds()).toContain(res.body.report.id);
  });

  test('the draft route deletes a draft, and never a saved report', async () => {
    const { u, create } = await setup();
    const draft = (await create({ title: 'Left unsaved', draft: true })).body.report.id;
    const del = await request(app).delete(`/api/reports/${draft}/draft`).use(as(u));
    expect(del.body.deleted).toBe(true);
    expect((await request(app).get(`/api/reports/${draft}`).use(as(u))).status).toBe(404);

    // Saved in another tab before this one was left: it stays.
    const kept = (await create({ title: 'Saved elsewhere', draft: true })).body.report.id;
    await request(app).put(`/api/reports/${kept}`).use(as(u)).send({ title: 'Saved elsewhere', layout: [], widgets: {}, settings: {} });
    expect((await request(app).delete(`/api/reports/${kept}/draft`).use(as(u))).body.deleted).toBe(false);
    expect((await request(app).get(`/api/reports/${kept}`).use(as(u))).status).toBe(200);
  });

  test('another user cannot delete someone else\'s draft', async () => {
    const { create } = await setup();
    const draft = (await create({ title: 'Mine', draft: true })).body.report.id;
    const stranger = seedUser({ role: 'editor' });
    expect((await request(app).delete(`/api/reports/${draft}/draft`).use(as(stranger))).status).toBe(404);
    expect(db.prepare('SELECT 1 FROM reports WHERE id = ?').get(draft)).toBeTruthy();
  });

  test('a draft holds no title, and a day-old draft is purged', async () => {
    const { create } = await setup();
    const old = (await create({ title: 'Taken?', draft: true })).body.report.id;
    // Nobody sees the draft, so its name is free for a real report.
    expect((await create({ title: 'Taken?' })).status).toBe(201);

    db.prepare("UPDATE reports SET created_at = datetime('now', '-2 days') WHERE id = ?").run(old);
    await create({ title: 'Trigger', draft: true });
    expect(db.prepare('SELECT 1 FROM reports WHERE id = ?').get(old)).toBeUndefined();
  });

  test('a draft does not block deleting its model, and goes with it', async () => {
    const { u, model, create } = await setup();
    const draft = (await create({ title: 'On the model', draft: true })).body.report.id;
    const del = await request(app).delete(`/api/models/${model}`).use(as(u));
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT 1 FROM reports WHERE id = ?').get(draft)).toBeUndefined();
  });
});
