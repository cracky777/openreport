// RLS by groups. `group:<name>` patterns grant a row key to every member of
// the group; membership is resolved at query time so onboarding/offboarding
// touches one membership row instead of every model's rules. Three layers:
// the pure matcher, the /query compiler (SQL-level scoping), and the
// admin-only management routes.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedGroup, db } = require('./helpers/testApp');
const { patternMatchesPrincipal, getAllowedRlsKeys } = require('../utils/rls');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

describe('patternMatchesPrincipal — group refs vs email patterns', () => {
  test('group:<name> matches membership case-insensitively, never the email', () => {
    expect(patternMatchesPrincipal('group:Sales', 'x@y.io', ['sales'])).toBe(true);
    expect(patternMatchesPrincipal('GROUP:sales', 'x@y.io', ['Sales'])).toBe(true);
    expect(patternMatchesPrincipal('group:Sales', 'group:sales', [])).toBe(false);
  });
  test('empty group name after the prefix matches nothing', () => {
    expect(patternMatchesPrincipal('group:', 'x@y.io', ['sales', ''])).toBe(false);
  });
  test('email patterns still work, including globs and *', () => {
    expect(patternMatchesPrincipal('*@y.io', 'x@y.io', [])).toBe(true);
    expect(patternMatchesPrincipal('*', 'anyone@z.io', [])).toBe(true);
    expect(patternMatchesPrincipal('a@y.io', 'x@y.io', ['a@y.io'])).toBe(false);
  });
});

describe('getAllowedRlsKeys with groups', () => {
  const rls = {
    enabled: true, table: 't', primaryKey: 'k',
    rules: {
      c1: ['group:Sales'],
      c2: ['bob@x.io'],
      shared: ['group:Sales', 'bob@x.io'],
    },
  };
  test('a group member collects every key its group grants', () => {
    expect(getAllowedRlsKeys(rls, 'alice@x.io', ['sales']).sort()).toEqual(['c1', 'shared']);
  });
  test('email and group grants combine for one requester', () => {
    expect(getAllowedRlsKeys(rls, 'bob@x.io', ['Sales']).sort()).toEqual(['c1', 'c2', 'shared']);
  });
  test('no membership, no email match → empty (deny-all downstream)', () => {
    expect(getAllowedRlsKeys(rls, 'stranger@x.io', [])).toEqual([]);
  });
  test('omitted groups argument keeps the historical email-only behaviour', () => {
    expect(getAllowedRlsKeys(rls, 'bob@x.io').sort()).toEqual(['c2', 'shared']);
  });
});

describe('/models/:id/query — group membership scopes the SQL', () => {
  let owner, member, outsider, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor', email: 'owner@grp.io' });
    member = seedUser({ role: 'viewer', email: 'member@grp.io' });
    outsider = seedUser({ role: 'viewer', email: 'outsider@grp.io' });
    seedGroup({ name: 'Sales EU', memberIds: [member] });
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    model = seedModel({
      userId: owner, datasourceId: ds,
      rls: { enabled: true, table: 'items', primaryKey: 'client_id', rules: { c1: ['group:sales eu'], c2: ['someone@else.io'] } },
    });
    seedReport({ userId: owner, modelId: model, isPublic: 1 });
  });

  const sqlFor = async (uid) => {
    const res = await request(app).post(`/api/models/${model}/query`)
      .set('x-test-user', uid)
      .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true });
    expect(res.status).toBe(200);
    return res.body.sql;
  };

  test('a group member is scoped to the granted key', async () => {
    const s = await sqlFor(member);
    expect(s).toContain("'c1'");
    expect(s).not.toContain("'c2'");
    expect(s).toMatch(/client_id[\s\S]*IN \(/);
  });

  test('a non-member viewer is denied every row (1 = 0)', async () => {
    const s = await sqlFor(outsider);
    expect(s).toMatch(/1 = 0/);
  });

  test('removing the membership revokes access without touching the model', async () => {
    const extra = seedUser({ role: 'viewer', email: 'temp@grp.io' });
    const gid = db.prepare("SELECT id FROM groups WHERE name = 'Sales EU'").get().id;
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(gid, extra);
    expect(await sqlFor(extra)).toContain("'c1'");
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(gid, extra);
    expect(await sqlFor(extra)).toMatch(/1 = 0/);
  });
});

describe('/admin/groups — admin-only management', () => {
  let admin, editor;
  beforeAll(() => {
    admin = seedUser({ role: 'admin', email: 'boss@grp.io' });
    editor = seedUser({ role: 'editor', email: 'ed@grp.io' });
  });

  test('non-admin callers are rejected', async () => {
    for (const [method, url] of [
      ['get', '/api/admin/groups'],
      ['post', '/api/admin/groups'],
      ['delete', '/api/admin/groups/x'],
    ]) {
      const res = await request(app)[method](url).set('x-test-user', editor).send({ name: 'nope' });
      expect(res.status).toBe(403);
    }
  });

  test('create, duplicate rejection (case-insensitive), membership lifecycle, delete', async () => {
    const created = await request(app).post('/api/admin/groups').set('x-test-user', admin).send({ name: 'Finance' });
    expect(created.status).toBe(201);
    const gid = created.body.group.id;

    const dup = await request(app).post('/api/admin/groups').set('x-test-user', admin).send({ name: 'finance' });
    expect(dup.status).toBe(409);

    const bad = await request(app).post('/api/admin/groups').set('x-test-user', admin).send({ name: '  ' });
    expect(bad.status).toBe(400);

    const add = await request(app).post(`/api/admin/groups/${gid}/members`).set('x-test-user', admin).send({ email: 'ED@GRP.IO' });
    expect(add.status).toBe(201);
    expect(add.body.member.id).toBe(editor);

    const ghost = await request(app).post(`/api/admin/groups/${gid}/members`).set('x-test-user', admin).send({ email: 'nobody@grp.io' });
    expect(ghost.status).toBe(404);

    const list = await request(app).get(`/api/admin/groups/${gid}/members`).set('x-test-user', admin);
    expect(list.status).toBe(200);
    expect(list.body.members.map((m) => m.id)).toEqual([editor]);

    const rm = await request(app).delete(`/api/admin/groups/${gid}/members/${editor}`).set('x-test-user', admin);
    expect(rm.status).toBe(200);

    const del = await request(app).delete(`/api/admin/groups/${gid}`).set('x-test-user', admin);
    expect(del.status).toBe(200);
    const listAfter = await request(app).get('/api/admin/groups').set('x-test-user', admin);
    expect(listAfter.body.groups.find((g) => g.id === gid)).toBeUndefined();
  });
});
