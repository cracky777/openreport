// Instance-wide public-sharing policy. Three levels: everyone (default,
// per-model write bar unchanged), admins (only global admins may flip a
// report public), disabled (nobody may — and the kill switch stops serving
// ALREADY-public reports anonymously; signed embed tokens keep working,
// each one was individually minted by the data owner).
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');
const { setPublicSharingPolicy } = require('../utils/settingsHelper');
const embedToken = require('../utils/embedToken');

const app = buildApp();
let owner, admin, model, ds;
beforeAll(() => {
  owner = seedUser({ role: 'editor', email: 'own@pol.io' });
  admin = seedUser({ role: 'admin', email: 'adm@pol.io' });
  ds = seedDatasource({ userId: owner, dbType: 'postgres' });
  model = seedModel({ userId: owner, datasourceId: ds });
});
afterEach(() => setPublicSharingPolicy('everyone'));

const flipPublic = (reportId, uid) =>
  request(app).put(`/api/reports/${reportId}`).set('x-test-user', uid).send({ is_public: 1 });

test("everyone (default): the model owner flips their report public", async () => {
  const r = seedReport({ userId: owner, modelId: model });
  expect((await flipPublic(r, owner)).status).toBe(200);
});

test('admins: owner-editor is refused, admin passes; making private stays allowed', async () => {
  setPublicSharingPolicy('admins');
  const r = seedReport({ userId: owner, modelId: model });
  expect((await flipPublic(r, owner)).status).toBe(403);
  expect((await flipPublic(r, admin)).status).toBe(200);
  const priv = await request(app).put(`/api/reports/${r}`).set('x-test-user', owner).send({ is_public: 0 });
  expect(priv.status).toBe(200);
});

test('disabled: even the admin cannot flip a report public', async () => {
  setPublicSharingPolicy('disabled');
  const r = seedReport({ userId: owner, modelId: model });
  expect((await flipPublic(r, admin)).status).toBe(403);
});

test('disabled is a kill switch: already-public reports stop serving anonymously, embeds keep working', async () => {
  const r = seedReport({ userId: owner, modelId: model, isPublic: 1 });
  expect((await request(app).get(`/api/reports/${r}`)).status).toBe(200);

  setPublicSharingPolicy('disabled');
  expect((await request(app).get(`/api/reports/${r}`)).status).toBe(403);
  // the public path into the model dies with it
  const q = await request(app).post(`/api/models/${model}/query`)
    .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true });
  expect(q.status).toBe(404);
  // …but a signed embed token is its own grant
  const t = embedToken.sign({ reportId: r });
  expect((await request(app).get(`/api/reports/${r}`).set(embedToken.HEADER, t)).status).toBe(200);
  // and the signed-in owner still sees their own report
  expect((await request(app).get(`/api/reports/${r}`).set('x-test-user', owner)).status).toBe(200);
});

test('admin settings endpoint: authz + validation + persistence', async () => {
  const bad = await request(app).put('/api/admin/settings/public-sharing').set('x-test-user', owner).send({ policy: 'admins' });
  expect(bad.status).toBe(403);
  const nope = await request(app).put('/api/admin/settings/public-sharing').set('x-test-user', admin).send({ policy: 'whatever' });
  expect(nope.status).toBe(400);
  const ok = await request(app).put('/api/admin/settings/public-sharing').set('x-test-user', admin).send({ policy: 'admins' });
  expect(ok.body.publicSharingPolicy).toBe('admins');
  const got = await request(app).get('/api/admin/settings').set('x-test-user', admin);
  expect(got.body.publicSharingPolicy).toBe('admins');
  // exposed to every signed-in client for UI gating
  const me = await request(app).get('/api/auth/me').set('x-test-user', owner);
  expect(me.body.instance.publicSharingPolicy).toBe('admins');
});
