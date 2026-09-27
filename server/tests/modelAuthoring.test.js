// Authoring a report on a model is not editing that model. A share of the
// model into a workspace lets its editors build reports there — nothing more:
// they may not edit the model, and may not publish a report on it (a public
// report opens /query to anonymous callers, which is the model's owner's call).
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();

let owner, other, modelId, team;
beforeEach(() => {
  owner = seedUser({ role: 'editor' });
  other = seedUser({ role: 'editor' });
  modelId = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
  team = seedWorkspace({ ownerId: owner, name: 'Team' });
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'editor')").run(team, other);
});

const post = (user, data) => request(app).post('/api/reports').set('x-test-user', user).send(data);
const share = () => db.prepare('INSERT INTO workspace_models (workspace_id, model_id) VALUES (?, ?)').run(team, modelId);

test('a stranger cannot author on someone else\'s model', async () => {
  expect((await post(other, { title: 'A', modelId })).status).toBe(403);
  expect((await post(owner, { title: 'B', modelId })).status).toBe(201);
});

test('a share lets the workspace build on the model, not edit it', async () => {
  share();
  expect((await post(other, { title: 'C', modelId, workspaceId: team })).status).toBe(201);
  expect((await request(app).put(`/api/models/${modelId}`).set('x-test-user', other).send({ name: 'renamed' })).status).toBe(403);
});

test('publishing still asks for write on the model, never merely authoring', async () => {
  share();
  const created = await post(other, { title: 'D', modelId, workspaceId: team });
  expect(created.status).toBe(201);
  const res = await request(app)
    .put(`/api/reports/${created.body.report.id}`)
    .set('x-test-user', other)
    .send({ is_public: true });
  expect(res.status).toBe(403);
});
