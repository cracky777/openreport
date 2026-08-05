// Model access contract (Option B de-fork): mutation goes through canWriteModel
// — the owner or a global admin only. A non-owner editor is refused with 403
// (the model exists, they just can't write it), which is distinct from a
// non-accessible READ returning 404 (no existence leak). The cloud edition
// replaces canWriteModel with an org write-role check; this locks the OSS base.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, db } = require('./helpers/testApp');

const app = buildApp();

function setup() {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner });
  const model = seedModel({ userId: owner, datasourceId: ds });
  return { owner, ds, model };
}

describe('Model write access (canWriteModel)', () => {
  test('the owner can rename their model', async () => {
    const { owner, model } = setup();
    const res = await request(app).put(`/api/models/${model}`).set('x-test-user', owner).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
  });

  test('a global admin can write any model', async () => {
    const { model } = setup();
    const admin = seedUser({ role: 'admin' });
    const res = await request(app).put(`/api/models/${model}`).set('x-test-user', admin).send({ name: 'AdminRename' });
    expect(res.status).toBe(200);
  });

  test('a non-owner editor is refused (403) and the model is unchanged', async () => {
    const { model } = setup();
    const stranger = seedUser({ role: 'editor' });
    const res = await request(app).put(`/api/models/${model}`).set('x-test-user', stranger).send({ name: 'PWNED' });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT name FROM models WHERE id = ?').get(model).name).not.toBe('PWNED');
  });

  test('a non-owner editor cannot delete the model (403, still exists)', async () => {
    const { model } = setup();
    const stranger = seedUser({ role: 'editor' });
    const res = await request(app).delete(`/api/models/${model}`).set('x-test-user', stranger);
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT 1 FROM models WHERE id = ?').get(model)).toBeTruthy();
  });

  test('a non-accessible model READS as 404, not 403 (reads never leak existence)', async () => {
    const { model } = setup();
    const stranger = seedUser({ role: 'viewer' });
    const res = await request(app).get(`/api/models/${model}`).set('x-test-user', stranger);
    expect(res.status).toBe(404);
  });

  test('the owner can still read their own model', async () => {
    const { owner, model } = setup();
    const res = await request(app).get(`/api/models/${model}`).set('x-test-user', owner);
    expect(res.status).toBe(200);
  });
});
