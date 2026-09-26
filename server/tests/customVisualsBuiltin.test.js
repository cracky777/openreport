// Visuals OpenReport ships (server/custom-visuals/<id>/) install into a
// workspace library on demand — the Power BI import asks for the ones a report
// needs — with the same shape and the same gate as an uploaded package.
const request = require('supertest');
const { buildApp, seedUser, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();

describe('built-in visuals', () => {
  let owner; let viewer; let ws;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    viewer = seedUser({ role: 'viewer' });
    ws = seedWorkspace({ ownerId: owner });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, viewer, 'viewer');
  });

  test('the catalogue lists what ships', async () => {
    const res = await request(app).get('/api/workspaces/builtin-visuals').set('x-test-user', viewer);
    expect(res.status).toBe(200);
    expect(res.body.visuals).toContainEqual(expect.objectContaining({ id: 'sankey', name: 'Sankey' }));
  });

  test('a workspace admin installs one; it is then served like any library visual', async () => {
    const res = await request(app).post(`/api/workspaces/${ws}/visuals/builtin/sankey`).set('x-test-user', owner);
    expect(res.status).toBe(201);
    expect(res.body.visual).toMatchObject({ id: 'sankey', origin: 'builtin', hasIcon: true });
    expect(res.body.visual.manifest.dataSchema.dimensions.map((d) => d.role)).toEqual(['source', 'target', 'color']);

    const list = await request(app).get(`/api/workspaces/${ws}/visuals`).set('x-test-user', viewer);
    expect(list.body.visuals).toContainEqual(expect.objectContaining({ id: 'sankey', origin: 'builtin' }));

    const bundle = await request(app).get(`/api/workspaces/${ws}/visuals/sankey/bundle.js`).set('x-test-user', viewer);
    expect(bundle.status).toBe(200);
    expect(bundle.headers['x-openreport-visual-origin']).toBe('builtin');
    expect(bundle.text).toContain('OpenReportRegisterVisual');

    // Installing again is idempotent.
    const again = await request(app).post(`/api/workspaces/${ws}/visuals/builtin/sankey`).set('x-test-user', owner);
    expect(again.status).toBe(201);
  });

  test('a member who is not an admin cannot install; an unknown id is refused', async () => {
    const res = await request(app).post(`/api/workspaces/${ws}/visuals/builtin/sankey`).set('x-test-user', viewer);
    expect(res.status).toBe(403);
    const nope = await request(app).post(`/api/workspaces/${ws}/visuals/builtin/does-not-exist`).set('x-test-user', owner);
    expect(nope.status).toBe(404);
    // No path tricks: the id has to be a library id.
    const tricky = await request(app).post(`/api/workspaces/${ws}/visuals/builtin/..%2Fsankey`).set('x-test-user', owner);
    expect([400, 404]).toContain(tricky.status);
  });
});
