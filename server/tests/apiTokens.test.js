// API tokens and the /api/v1 surface they unlock.
//
// The invariants worth guarding: a token authenticates but never widens access
// (it inherits the owner's own model/report authorization), scopes actually gate,
// a token cannot reach anything outside /api/v1 — including the endpoint that
// mints tokens — and the clear-text value exists only in the mint response.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');
const apiToken = require('../utils/apiToken');
const settings = require('../utils/settingsHelper');
const db = require('../db');

const app = buildApp();

// The API ships off. Every suite below exercises what happens once an admin has
// turned it on and opened it to every role; the gate itself has its own suite.
beforeEach(() => {
  settings.setApiEnabled(true);
  settings.setApiMinRole('viewer');
});

function mint(userId, scopes = ['read', 'refresh']) {
  return apiToken.create({ userId, name: `t-${Math.random().toString(36).slice(2, 8)}`, scopes }).token;
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe('minting and revoking', () => {
  let user;
  beforeAll(() => { user = seedUser({ role: 'editor', email: 'mint@api.io' }); });

  test('the clear-text token comes back once and is never stored', async () => {
    const res = await request(app).post('/api/api-tokens').set('x-test-user', user)
      .send({ name: 'etl', scopes: 'read,refresh' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^orp_/);

    // Only the digest is persisted — a dump of the table yields nothing usable.
    const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(res.body.id);
    expect(row.token_hash).toBe(apiToken.hash(res.body.token));
    expect(JSON.stringify(row)).not.toContain(res.body.token);

    // Listing never replays it either.
    const list = await request(app).get('/api/api-tokens').set('x-test-user', user);
    expect(JSON.stringify(list.body)).not.toContain(res.body.token);
    expect(list.body.tokens.find((t) => t.id === res.body.id).token_hint).toBe(res.body.token.slice(-4));
  });

  test('unknown scopes and empty names are refused', async () => {
    const bad = await request(app).post('/api/api-tokens').set('x-test-user', user)
      .send({ name: 'x', scopes: 'read,write' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/write/);

    const noName = await request(app).post('/api/api-tokens').set('x-test-user', user).send({ scopes: 'read' });
    expect(noName.status).toBe(400);
  });

  test('a revoked token stops working immediately', async () => {
    const created = await request(app).post('/api/api-tokens').set('x-test-user', user)
      .send({ name: 'short-lived', scopes: 'read' });
    const token = created.body.token;
    expect((await request(app).get('/api/v1/whoami').set(bearer(token))).status).toBe(200);

    const del = await request(app).delete(`/api/api-tokens/${created.body.id}`).set('x-test-user', user);
    expect(del.status).toBe(200);

    const after = await request(app).get('/api/v1/whoami').set(bearer(token));
    expect(after.status).toBe(401);
    expect(after.body.error).toMatch(/revoked/i);
  });

  test('one user cannot revoke another user’s token', async () => {
    const other = seedUser({ role: 'editor', email: 'other@api.io' });
    const created = apiToken.create({ userId: user, name: 'mine', scopes: ['read'] });
    const res = await request(app).delete(`/api/api-tokens/${created.id}`).set('x-test-user', other);
    expect(res.status).toBe(404);
    expect((await request(app).get('/api/v1/whoami').set(bearer(created.token))).status).toBe(200);
  });

  test('an expired token is refused', async () => {
    const past = new Date(Date.now() - 86400_000).toISOString().replace('T', ' ').slice(0, 19);
    const { token } = apiToken.create({ userId: user, name: 'stale', scopes: ['read'], expiresAt: past });
    const res = await request(app).get('/api/v1/whoami').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('garbage and non-token bearers are refused, not ignored', async () => {
    expect((await request(app).get('/api/v1/whoami').set(bearer('orp_nope'))).status).toBe(401);
    const internal = require('../utils/internalToken').sign({ userId: 'u1' });
    expect((await request(app).get('/api/v1/whoami').set(bearer(internal))).status).toBe(401);
  });

  test('no bearer at all is a 401 from requireAuth, not a crash', async () => {
    expect((await request(app).get('/api/v1/whoami')).status).toBe(401);
  });
});

describe('scopes', () => {
  let user, model;
  beforeAll(() => {
    user = seedUser({ role: 'editor', email: 'scope@api.io' });
    model = seedModel({ userId: user, datasourceId: seedDatasource({ userId: user }) });
  });

  test('a read-only token can list but not refresh', async () => {
    const token = mint(user, ['read']);
    expect((await request(app).get('/api/v1/models').set(bearer(token))).status).toBe(200);

    const res = await request(app).post(`/api/v1/models/${model}/refresh`).set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/refresh/);
  });

  test('a refresh-only token cannot list', async () => {
    const token = mint(user, ['refresh']);
    const res = await request(app).get('/api/v1/models').set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/read/);
  });

  test('whoami reports the token’s scopes, and null for a session', async () => {
    const token = mint(user, ['read']);
    expect((await request(app).get('/api/v1/whoami').set(bearer(token))).body.scopes).toEqual(['read']);
    expect((await request(app).get('/api/v1/whoami').set('x-test-user', user)).body.scopes).toBeNull();
  });
});

describe('a token never widens its owner’s access', () => {
  let owner, stranger, model, report;
  beforeAll(() => {
    owner = seedUser({ role: 'editor', email: 'owner@api.io' });
    stranger = seedUser({ role: 'editor', email: 'stranger@api.io' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    report = seedReport({ userId: owner, modelId: model });
  });

  test('someone else’s model is a 404, not a 403 — ids stay unprobeable', async () => {
    const token = mint(stranger);
    expect((await request(app).post(`/api/v1/models/${model}/refresh`).set(bearer(token))).status).toBe(404);
    expect((await request(app).post(`/api/v1/reports/${report}/refresh`).set(bearer(token))).status).toBe(404);
  });

  test('listing only ever returns the owner’s own rows', async () => {
    const token = mint(stranger, ['read']);
    const models = await request(app).get('/api/v1/models').set(bearer(token));
    expect(models.body.models.map((m) => m.id)).not.toContain(model);
    const reports = await request(app).get('/api/v1/reports').set(bearer(token));
    expect(reports.body.reports.map((r) => r.id)).not.toContain(report);
  });

  test('a token whose owner was deleted is dead', async () => {
    const doomed = seedUser({ role: 'editor', email: 'doomed@api.io' });
    const token = mint(doomed);
    db.prepare('DELETE FROM users WHERE id = ?').run(doomed);
    expect((await request(app).get('/api/v1/whoami').set(bearer(token))).status).toBe(401);
  });
});

describe('the token surface stops at /api/v1', () => {
  let user, model;
  beforeAll(() => {
    user = seedUser({ role: 'admin', email: 'reach@api.io' });
    model = seedModel({ userId: user, datasourceId: seedDatasource({ userId: user }) });
  });

  // The whole point of mounting apiToken.middleware on v1 alone: even an
  // admin's token must not reach the browser-only routers, so a route added
  // elsewhere can never inherit token access by accident.
  test.each([
    ['get', '/api/models'],
    ['get', '/api/reports'],
    ['get', '/api/datasources'],
    ['get', '/api/admin/users'],
    ['get', '/api/api-tokens'],
    ['post', '/api/api-tokens'],
  ])('%s %s refuses a valid token', async (method, path) => {
    const res = await request(app)[method](path).set(bearer(mint(user)));
    expect(res.status).toBe(401);
  });

  test('a token cannot rebuild through the browser rollup route', async () => {
    const res = await request(app).post(`/api/rollups/run-now/${model}`).set(bearer(mint(user)));
    expect(res.status).toBe(401);
  });
});

describe('a live session is never downgraded to token scopes', () => {
  test('a session request on v1 keeps full access even alongside a narrow token', async () => {
    const user = seedUser({ role: 'editor', email: 'session@api.io' });
    const res = await request(app).get('/api/v1/models')
      .set('x-test-user', user)
      .set(bearer(mint(user, ['refresh'])));
    expect(res.status).toBe(200);
  });
});

describe('the instance gate', () => {
  let admin, editor, viewer;
  beforeAll(() => {
    admin = seedUser({ role: 'admin', email: 'gate-admin@api.io' });
    editor = seedUser({ role: 'editor', email: 'gate-editor@api.io' });
    viewer = seedUser({ role: 'viewer', email: 'gate-viewer@api.io' });
  });

  test('off by default on a fresh instance', () => {
    db.prepare("DELETE FROM app_settings WHERE key IN ('api_enabled', 'api_min_role')").run();
    expect(settings.isApiEnabled()).toBe(false);
    expect(settings.getApiMinRole()).toBe('admin');
  });

  test('with the API off, an existing token stops working — nothing to revoke', async () => {
    const token = mint(admin);
    expect((await request(app).get('/api/v1/whoami').set(bearer(token))).status).toBe(200);

    settings.setApiEnabled(false);
    const res = await request(app).get('/api/v1/whoami').set(bearer(token));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/disabled/i);
  });

  test('with the API off, minting is refused but listing still works', async () => {
    settings.setApiEnabled(false);
    const create = await request(app).post('/api/api-tokens').set('x-test-user', admin)
      .send({ name: 'nope', scopes: 'read' });
    expect(create.status).toBe(403);

    const list = await request(app).get('/api/api-tokens').set('x-test-user', admin);
    expect(list.status).toBe(200);
    expect(list.body.enabled).toBe(false);
    expect(list.body.canCreate).toBe(false);
  });

  test('a user under the role floor cannot mint', async () => {
    settings.setApiMinRole('editor');
    const denied = await request(app).post('/api/api-tokens').set('x-test-user', viewer)
      .send({ name: 'x', scopes: 'read' });
    expect(denied.status).toBe(403);

    for (const uid of [editor, admin]) {
      const ok = await request(app).post('/api/api-tokens').set('x-test-user', uid)
        .send({ name: 'x', scopes: 'read' });
      expect(ok.status).toBe(201);
    }
  });

  // The floor is re-read on every call, so tightening it (or demoting someone)
  // kills the tokens already in the wild without anyone revoking them.
  test('raising the floor kills a token already issued', async () => {
    const token = mint(viewer, ['read']);
    expect((await request(app).get('/api/v1/whoami').set(bearer(token))).status).toBe(200);

    settings.setApiMinRole('editor');
    const res = await request(app).get('/api/v1/whoami').set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  test('demoting the owner kills their token just the same', async () => {
    settings.setApiMinRole('editor');
    const user = seedUser({ role: 'editor', email: 'demoted@api.io' });
    const token = mint(user, ['read']);
    expect((await request(app).get('/api/v1/whoami').set(bearer(token))).status).toBe(200);

    db.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").run(user);
    expect((await request(app).get('/api/v1/whoami').set(bearer(token))).status).toBe(403);
  });

  test('a browser session is untouched by the gate', async () => {
    settings.setApiEnabled(false);
    const res = await request(app).get('/api/v1/models').set('x-test-user', admin);
    expect(res.status).toBe(200);
  });

  test('the admin settings round-trip and reject an unknown role', async () => {
    const saved = await request(app).put('/api/admin/settings/api').set('x-test-user', admin)
      .send({ enabled: true, minRole: 'editor' });
    expect(saved.body).toEqual({ apiEnabled: true, apiMinRole: 'editor' });

    const bad = await request(app).put('/api/admin/settings/api').set('x-test-user', admin)
      .send({ minRole: 'superuser' });
    expect(bad.status).toBe(400);
    expect(settings.getApiMinRole()).toBe('editor');
  });

  test('a non-admin cannot flip the switch', async () => {
    const res = await request(app).put('/api/admin/settings/api').set('x-test-user', editor)
      .send({ enabled: false });
    expect(res.status).toBe(403);
    expect(settings.isApiEnabled()).toBe(true);
  });
});

describe('the admin inventory', () => {
  let admin, editor, editorToken;
  beforeAll(() => {
    admin = seedUser({ role: 'admin', email: 'inv-admin@api.io' });
    editor = seedUser({ role: 'editor', email: 'inv-editor@api.io' });
  });
  beforeEach(() => {
    editorToken = apiToken.create({ userId: editor, name: 'their-etl', scopes: ['read'] });
  });

  test('an admin sees every token, with its owner — and never a secret', async () => {
    const res = await request(app).get('/api/admin/api-tokens').set('x-test-user', admin);
    expect(res.status).toBe(200);

    const row = res.body.tokens.find((t) => t.id === editorToken.id);
    expect(row.owner_email).toBe('inv-editor@api.io');
    expect(row.name).toBe('their-etl');
    // The inventory is for auditing, not for borrowing someone's credentials.
    expect(JSON.stringify(res.body)).not.toContain(editorToken.token);
    expect(row.token_hash).toBeUndefined();
  });

  test('a non-admin cannot read the inventory', async () => {
    const res = await request(app).get('/api/admin/api-tokens').set('x-test-user', editor);
    expect(res.status).toBe(403);
  });

  test('an admin can cut one integration without touching the switch', async () => {
    expect((await request(app).get('/api/v1/whoami').set(bearer(editorToken.token))).status).toBe(200);

    const del = await request(app).delete(`/api/admin/api-tokens/${editorToken.id}`).set('x-test-user', admin);
    expect(del.status).toBe(200);

    expect((await request(app).get('/api/v1/whoami').set(bearer(editorToken.token))).status).toBe(401);
    // The API itself is untouched — the owner's other tokens keep working.
    const survivor = mint(editor, ['read']);
    expect((await request(app).get('/api/v1/whoami').set(bearer(survivor))).status).toBe(200);
  });

  test('revoking twice, or an unknown id, is a 404', async () => {
    await request(app).delete(`/api/admin/api-tokens/${editorToken.id}`).set('x-test-user', admin);
    for (const id of [editorToken.id, 'no-such-token']) {
      const res = await request(app).delete(`/api/admin/api-tokens/${id}`).set('x-test-user', admin);
      expect(res.status).toBe(404);
    }
  });

  test('a non-admin cannot revoke someone else’s token through the admin route', async () => {
    const other = seedUser({ role: 'editor', email: 'inv-other@api.io' });
    const res = await request(app).delete(`/api/admin/api-tokens/${editorToken.id}`).set('x-test-user', other);
    expect(res.status).toBe(403);
    expect((await request(app).get('/api/v1/whoami').set(bearer(editorToken.token))).status).toBe(200);
  });

  test('there is no admin path to mint a token for someone else', () => {
    // Guards the design decision, not an implementation detail: an admin-issued
    // token would forge an identity and break the audit trail.
    const stack = require('../routes/admin').stack || [];
    const mintRoutes = stack.filter((l) => l.route?.path === '/api-tokens' && l.route.methods.post);
    expect(mintRoutes).toHaveLength(0);
  });
});
