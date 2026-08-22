// Viewer bookmarks: personal captures of a report view. Pins the personal
// scoping (my list never shows yours, deleting yours is 403), the access
// gate (no report access → 404, anonymous → 401) and the state validation.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');

const app = buildApp();

function seedCtx() {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner });
  const model = seedModel({ userId: owner, datasourceId: ds });
  const report = seedReport({ userId: owner, modelId: model });
  return { owner, report };
}

const STATE = { pageIdx: 0, reportFilters: { 'items.label': ['A'] }, slicerSelections: { 'items.label': ['A'] } };
const post = (user, reportId, body) => request(app)
  .post(`/api/reports/${reportId}/bookmarks`).set('x-test-user', user).send(body);

describe('bookmarks CRUD + scoping', () => {
  test('create, list (own only), delete', async () => {
    const { owner, report } = seedCtx();
    const created = await post(owner, report, { name: 'France only', state: STATE });
    expect(created.status).toBe(201);
    expect(created.body.bookmark.state).toEqual(STATE);

    const list = await request(app).get(`/api/reports/${report}/bookmarks`).set('x-test-user', owner);
    expect(list.body.bookmarks).toHaveLength(1);

    const del = await request(app)
      .delete(`/api/reports/${report}/bookmarks/${created.body.bookmark.id}`).set('x-test-user', owner);
    expect(del.status).toBe(200);
    const after = await request(app).get(`/api/reports/${report}/bookmarks`).set('x-test-user', owner);
    expect(after.body.bookmarks).toHaveLength(0);
  });

  test('bookmarks are personal: another user with report access sees none, deletes nothing', async () => {
    const { owner, report } = seedCtx();
    // Make the report reachable by everyone (public) so access isn't the blocker.
    db.prepare('UPDATE reports SET is_public = 1 WHERE id = ?').run(report);
    const mine = await post(owner, report, { name: 'mine', state: {} });
    const other = seedUser({ role: 'viewer' });
    const list = await request(app).get(`/api/reports/${report}/bookmarks`).set('x-test-user', other);
    expect(list.status).toBe(200);
    expect(list.body.bookmarks).toHaveLength(0);
    const del = await request(app)
      .delete(`/api/reports/${report}/bookmarks/${mine.body.bookmark.id}`).set('x-test-user', other);
    expect(del.status).toBe(403);
  });

  test('no report access → 404; anonymous → 401', async () => {
    const { report } = seedCtx();
    const stranger = seedUser({ role: 'viewer' });
    expect((await request(app).get(`/api/reports/${report}/bookmarks`).set('x-test-user', stranger)).status).toBe(404);
    expect((await request(app).get(`/api/reports/${report}/bookmarks`)).status).toBe(401);
  });

  test('validation: name, state shape, size, per-report cap', async () => {
    const { owner, report } = seedCtx();
    expect((await post(owner, report, { name: '', state: {} })).status).toBe(400);
    expect((await post(owner, report, { name: 'x', state: [] })).status).toBe(400);
    expect((await post(owner, report, { name: 'x', state: { pageIdx: -1 } })).status).toBe(400);
    expect((await post(owner, report, { name: 'x', state: { reportFilters: 'nope' } })).status).toBe(400);
    const huge = { reportFilters: { d: ['x'.repeat(40 * 1024)] } };
    expect((await post(owner, report, { name: 'x', state: huge })).status).toBe(400);

    const ins = db.prepare(`INSERT INTO report_bookmarks (id, report_id, user_id, name, state)
                            VALUES (?, ?, ?, 'b', '{}')`);
    for (let i = 0; i < 50; i++) ins.run(`bm-${i}`, report, owner);
    const capped = await post(owner, report, { name: 'one too many', state: {} });
    expect(capped.status).toBe(400);
    expect(capped.body.error).toMatch(/limit/i);
  });
});
