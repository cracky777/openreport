// What a workspace role is worth in OSS. An admin/editor member writes the
// workspace's reports and builds new ones on the models those reports use;
// a viewer only reads. Publishing stays with whoever owns the model, so the
// public path the canBuildOnModel hardening closed stays closed.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();

function setup(role) {
  const owner = seedUser({ role: 'editor' });
  const member = seedUser({ role: 'viewer' });
  const ds = seedDatasource({ userId: owner });
  const model = seedModel({ userId: owner, datasourceId: ds });
  const ws = seedWorkspace({ ownerId: owner });
  db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, member, role);
  const report = seedReport({ userId: owner, modelId: model, workspaceId: ws, widgets: {
    s1: { type: 'scorecard', dataBinding: {}, config: {}, data: { value: 4242 } },
  } });
  return { owner, member, model, ws, report };
}

describe('Workspace editor', () => {
  test('renames and deletes a report of the workspace', async () => {
    const { member, report } = setup('editor');
    const put = await request(app).put(`/api/reports/${report}`).set('x-test-user', member).send({ title: 'Team edit' });
    expect(put.status).toBe(200);
    expect(db.prepare('SELECT title FROM reports WHERE id = ?').get(report).title).toBe('Team edit');
    const del = await request(app).delete(`/api/reports/${report}`).set('x-test-user', member);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT 1 FROM reports WHERE id = ?').get(report)).toBeUndefined();
  });

  test("builds a new report on the workspace's model, in the workspace or in their own space", async () => {
    const { member, model, ws } = setup('editor');
    const inWs = await request(app).post('/api/reports').set('x-test-user', member)
      .send({ title: 'Team view', modelId: model, workspaceId: ws });
    expect(inWs.status).toBe(201);
    const own = await request(app).post('/api/reports').set('x-test-user', member)
      .send({ title: 'My view', modelId: model });
    expect(own.status).toBe(201);
  });

  test("sees the workspace's model in the model list, without owning it", async () => {
    const { member, model, owner } = setup('editor');
    const res = await request(app).get('/api/models').set('x-test-user', member);
    expect(res.status).toBe(200);
    const listed = res.body.models.find((m) => m.id === model);
    expect(listed).toBeTruthy();
    expect(listed.user_id).toBe(owner);
  });

  test('cannot publish the report: exposing the data is the model owner\'s call', async () => {
    const { member, report } = setup('editor');
    const res = await request(app).put(`/api/reports/${report}`).set('x-test-user', member).send({ is_public: true });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT is_public FROM reports WHERE id = ?').get(report).is_public).toBe(0);
  });

  test('cannot edit the model itself', async () => {
    const { member, model } = setup('editor');
    const res = await request(app).put(`/api/models/${model}`).set('x-test-user', member).send({ name: 'Renamed' });
    expect(res.status).toBe(403);
  });

  test('a copy keeps the workspace but not the owner\'s data snapshot', async () => {
    const { member, report, ws } = setup('editor');
    const res = await request(app).post(`/api/reports/${report}/duplicate`).set('x-test-user', member);
    expect(res.status).toBe(201);
    const copy = db.prepare('SELECT user_id, workspace_id, widgets FROM reports WHERE id = ?').get(res.body.report.id);
    expect(copy.user_id).toBe(member);
    expect(copy.workspace_id).toBe(ws);
    expect(JSON.parse(copy.widgets).s1.data).toBeUndefined();
  });

  test('being editor of an unrelated workspace opens nothing on the model', async () => {
    const { model } = setup('editor');
    const other = seedUser({ role: 'editor' });
    const elsewhere = seedUser({ role: 'viewer' });
    const otherWs = seedWorkspace({ ownerId: other });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(otherWs, elsewhere, 'editor');
    const otherDs = seedDatasource({ userId: other });
    const otherModel = seedModel({ userId: other, datasourceId: otherDs });
    seedReport({ userId: other, modelId: otherModel, workspaceId: otherWs });
    // `model` is only used by the first workspace, where `elsewhere` is nobody.
    const res = await request(app).post('/api/reports').set('x-test-user', elsewhere)
      .send({ title: 'x', modelId: model, workspaceId: otherWs });
    expect(res.status).toBe(403);
    const list = await request(app).get('/api/models').set('x-test-user', elsewhere);
    expect(list.body.models.map((m) => m.id)).toEqual([otherModel]);
  });
});

describe('Workspace viewer', () => {
  test('reads the report but cannot write it (403, not 404: it is visible)', async () => {
    const { member, report } = setup('viewer');
    const get = await request(app).get(`/api/reports/${report}`).set('x-test-user', member);
    expect(get.status).toBe(200);
    const put = await request(app).put(`/api/reports/${report}`).set('x-test-user', member).send({ title: 'Nope' });
    expect(put.status).toBe(403);
    const del = await request(app).delete(`/api/reports/${report}`).set('x-test-user', member);
    expect(del.status).toBe(403);
  });

  test("cannot build on the workspace's model and does not see it listed", async () => {
    const { member, model } = setup('viewer');
    const create = await request(app).post('/api/reports').set('x-test-user', member)
      .send({ title: 'x', modelId: model });
    expect(create.status).toBe(403);
    const list = await request(app).get('/api/models').set('x-test-user', member);
    expect(list.body.models.find((m) => m.id === model)).toBeUndefined();
  });
});

describe('Outside the workspace', () => {
  test('a reader of a public report still cannot build on its model', async () => {
    const { model, owner } = setup('viewer');
    seedReport({ userId: owner, modelId: model, isPublic: 1 });
    const stranger = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/reports').set('x-test-user', stranger)
      .send({ title: 'implant', modelId: model });
    expect(res.status).toBe(403);
  });
});
