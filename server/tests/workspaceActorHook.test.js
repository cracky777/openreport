// The cloud runs the workspace rules inside each organization through one
// extension point, cloudHooks.workspaceActor: the actor carries the
// organization of the request and the role held in it. This pins what the
// self-hosted code does with such an actor — nothing outside the organization
// is reached, its admin manages without reading rows, and a request with no
// organization reaches nothing.
const request = require('supertest');
const cloudHooks = require('../cloudHooks');
const { buildApp, seedUser, seedDatasource, seedModel, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();

// The column is the cloud's (ensureTenantColumns); the test database gets it here.
beforeAll(() => {
  for (const table of ['datasources', 'models', 'reports', 'workspaces']) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'organization_id');
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN organization_id TEXT`);
  }
  cloudHooks.workspaceActor = (user, req) => ({
    id: user.id,
    role: req.headers['x-org-role'] === 'admin' ? 'admin' : 'member',
    orgId: req.headers['x-org'] || '__no_organization__',
  });
  cloudHooks.canAdminAllWorkspaces = (req) => req.headers['x-org-role'] === 'admin';
});
afterAll(() => {
  cloudHooks.workspaceActor = null;
  cloudHooks.canAdminAllWorkspaces = null;
});

const inOrg = (table, id, org) => db.prepare(`UPDATE ${table} SET organization_id = ? WHERE id = ?`).run(org, id);
function resources(org, ownerId, wsName) {
  const ws = seedWorkspace({ ownerId, name: wsName });
  const ds = seedDatasource({ userId: ownerId });
  const model = seedModel({ userId: ownerId, datasourceId: ds });
  inOrg('workspaces', ws, org);
  inOrg('datasources', ds, org);
  inOrg('models', model, org);
  db.prepare('UPDATE datasources SET workspace_id = ? WHERE id = ?').run(ws, ds);
  db.prepare('UPDATE models SET workspace_id = ? WHERE id = ?').run(ws, model);
  return { ws, ds, model };
}

let a, b, a2, member, orgAdmin;
beforeEach(() => {
  const founder = seedUser({ role: 'editor' });
  member = seedUser({ role: 'editor' });
  orgAdmin = seedUser({ role: 'editor' });
  a = resources('org-a', founder, 'A');
  b = resources('org-b', founder, 'B');
  a2 = seedWorkspace({ ownerId: founder, name: 'A2' });
  inOrg('workspaces', a2, 'org-a');
  // The member is editor on one workspace of each organization.
  const add = db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'editor')");
  add.run(a.ws, member);
  add.run(b.ws, member);
});

const as = (user, org, role) => (method, path) => {
  const r = request(app)[method](path).set('x-test-user', user);
  if (org) r.set('x-org', org);
  if (role) r.set('x-org-role', role);
  return r;
};

test('a member sees the organization of the request, never the other one', async () => {
  const inA = as(member, 'org-a');
  const ids = (await inA('get', '/api/models')).body.models.map((m) => m.id);
  expect(ids).toContain(a.model);
  expect(ids).not.toContain(b.model);
  expect((await inA('get', `/api/models/${b.model}`)).status).toBe(404);
  expect((await inA('get', `/api/datasources/${b.ds}`)).status).toBe(404);
  const inB = as(member, 'org-b');
  expect((await inB('get', '/api/models')).body.models.map((m) => m.id)).toContain(b.model);
});

test('a request with no organization reaches nothing', async () => {
  const none = as(member, null);
  expect((await none('get', '/api/models')).body.models).toEqual([]);
  expect((await none('get', '/api/datasources')).body.datasources).toEqual([]);
});

test('the organization admin manages its resources, within its organization only', async () => {
  const admin = as(orgAdmin, 'org-a', 'admin');
  const listed = (await admin('get', '/api/models')).body.models.find((m) => m.id === a.model);
  expect(listed).toMatchObject({ access: 'manage' });
  expect((await admin('put', `/api/models/${a.model}/shares`).send({ workspaceIds: [a2] })).status).toBe(200);
  expect((await admin('put', `/api/models/${a.model}/shares`).send({ workspaceIds: [b.ws] })).status).toBe(403);
  expect((await admin('delete', `/api/models/${b.model}`)).status).toBe(404);
  const ws = (await admin('get', '/api/workspaces')).body;
  expect(ws.managesAll).toBe(true);
  expect(ws.otherWorkspaces.map((w) => w.id)).toEqual(expect.arrayContaining([a.ws, a2]));
  expect(ws.otherWorkspaces.map((w) => w.id)).not.toContain(b.ws);
});

test('the organization admin does not read rows without a role', async () => {
  const admin = as(orgAdmin, 'org-a', 'admin');
  const res = await admin('post', `/api/datasources/${a.ds}/query`).send({ sql: 'SELECT 1' });
  expect(res.status).toBe(403);
});
