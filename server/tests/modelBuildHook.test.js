// Authoring a report on a model is not editing that model. The two questions
// share an answer in OSS — owner or global admin — which is exactly why they
// were once asked with a single function, and why the cloud edition broke when
// it answered the stricter one: an org viewer who is editor on a workspace is a
// legitimate report author, but must never be able to edit the model.
//
// The split is only observable through the hooks, so that is what this pins.
const request = require('supertest');
const cloudHooks = require('../cloudHooks');
const { buildApp, seedUser, seedDatasource, seedModel } = require('./helpers/testApp');

const app = buildApp();

let owner, other, modelId;
beforeEach(() => {
  owner = seedUser({ role: 'editor' });
  other = seedUser({ role: 'editor' });
  modelId = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
});
afterEach(() => {
  cloudHooks.canBuildOnModel = null;
  cloudHooks.canWriteModel = null;
});

const post = (user, data) => request(app).post('/api/reports').set('x-test-user', user).send(data);

test('OSS keeps its own answer: a stranger cannot author on someone else’s model', async () => {
  expect((await post(other, { title: 'A', modelId })).status).toBe(403);
  expect((await post(owner, { title: 'B', modelId })).status).toBe(201);
});

test('the authoring hook is what creation consults, not the write hook', async () => {
  // The cloud shape: allowed to author, refused to edit the model.
  cloudHooks.canBuildOnModel = () => true;
  cloudHooks.canWriteModel = () => false;
  expect((await post(other, { title: 'C', modelId })).status).toBe(201);
});

test('publishing still asks for write on the model, never merely authoring', async () => {
  // Publishing exposes the data behind the model — /query answers anonymous
  // callers for a public report — so authoring rights must not be enough.
  cloudHooks.canBuildOnModel = () => true;
  cloudHooks.canWriteModel = () => false;
  const created = await post(other, { title: 'D', modelId });
  expect(created.status).toBe(201);

  const res = await request(app)
    .put(`/api/reports/${created.body.report.id}`)
    .set('x-test-user', other)
    .send({ is_public: true });
  expect(res.status).toBe(403);
});
