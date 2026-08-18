// Guards for the authorization chain hardened after the external review.
// Each case is an escalation that used to work end to end; the assertions are
// written from the attacker's side so a regression reads as "the attacker won"
// rather than as an opaque status change.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

describe('Report authorization', () => {
  let victim; let attacker; let model; let publicReport;

  beforeEach(() => {
    victim = seedUser({ role: 'editor' });
    attacker = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: victim });
    model = seedModel({ userId: victim, datasourceId: ds });
    // The victim shares one report publicly. That is the legitimate feature —
    // and it is what grants the attacker READ access to the model.
    publicReport = seedReport({ userId: victim, modelId: model, isPublic: 1 });
  });

  test('a third party cannot build a report on a model they only read', async () => {
    const res = await request(app).post('/api/reports')
      .use(as(attacker))
      .send({ title: 'implant', modelId: model });
    expect(res.status).toBe(403);
    // Nothing was written on the way to the refusal.
    const rows = db.prepare('SELECT COUNT(*) c FROM reports WHERE model_id = ? AND user_id = ?').get(model, attacker);
    expect(rows.c).toBe(0);
  });

  test('publishing a report requires write access to the model behind it', async () => {
    // Worst case: the report already points at the victim's model.
    const owned = seedReport({ userId: attacker, modelId: model });
    const res = await request(app).put(`/api/reports/${owned}`)
      .use(as(attacker))
      .send({ is_public: true });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT is_public FROM reports WHERE id = ?').get(owned).is_public).toBe(0);
  });

  test('the model owner can still publish their own report', async () => {
    const res = await request(app).put(`/api/reports/${publicReport}`)
      .use(as(victim))
      .send({ is_public: true });
    expect(res.status).toBe(200);
  });

  test('a report cannot be dropped into a workspace the caller is not in', async () => {
    const victimWs = seedWorkspace({ ownerId: victim });
    const res = await request(app).post('/api/reports')
      .use(as(attacker))
      .send({ title: 'implant-ws', modelId: model, workspaceId: victimWs });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) c FROM reports WHERE workspace_id = ?').get(victimWs).c).toBe(0);
  });

  test('the 409 on a duplicate title does not leak titles from an unreadable workspace', async () => {
    // Both attempts must be refused identically: a 409 on the existing title
    // and a 201 on the absent one would answer "does this title exist here?".
    const victimWs = seedWorkspace({ ownerId: victim });
    seedReport({ userId: victim, modelId: model, workspaceId: victimWs });
    db.prepare('UPDATE reports SET title = ? WHERE workspace_id = ?').run('Project Falcon', victimWs);

    const existing = await request(app).post('/api/reports')
      .use(as(attacker)).send({ title: 'Project Falcon', modelId: model, workspaceId: victimWs });
    const absent = await request(app).post('/api/reports')
      .use(as(attacker)).send({ title: 'Nothing Here', modelId: model, workspaceId: victimWs });

    expect(existing.status).toBe(absent.status);
    expect(existing.status).toBe(403);
  });

  test('a member of the workspace can place a report there', async () => {
    const ws = seedWorkspace({ ownerId: victim });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)')
      .run(ws, attacker, 'editor');
    // …on a model they may write. Membership answers the workspace question
    // only; the model is a separate gate.
    const ownDs = seedDatasource({ userId: attacker });
    const ownModel = seedModel({ userId: attacker, datasourceId: ownDs });
    const res = await request(app).post('/api/reports')
      .use(as(attacker))
      .send({ title: 'legit', modelId: ownModel, workspaceId: ws });
    expect(res.status).toBe(201);
  });
});

describe('Datasource authorization', () => {
  test('the connection test refuses internal hosts (when enforcement is on)', async () => {
    // The block-list is off in default OSS (localhost DBs are legitimate); this
    // asserts the ENFORCED path, so turn it on for the duration of the test.
    process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS = '1';
    const user = seedUser({ role: 'editor' });
    try {
    for (const host of ['127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.5']) {
      const res = await request(app).post('/api/datasources/test')
        .use(as(user))
        .send({ dbType: 'postgres', host, port: 5432, dbName: 'x' });
      expect(res.status).toBe(400);
      // The message must not describe what was found at the other end.
      expect(res.body.message).not.toMatch(/refused|timeout|ECONN/i);
    }
    } finally { delete process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS; }
  });

  test('a DuckDB datasource cannot name a path of its own choosing', async () => {
    const user = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/datasources')
      .use(as(user))
      .send({ name: 'pwn', dbType: 'duckdb', dbName: '/etc/passwd' });
    expect(res.status).toBe(201);
    const stored = db.prepare('SELECT db_name FROM datasources WHERE id = ?').get(res.body.datasource.id).db_name;
    expect(stored).not.toBe('/etc/passwd');
    expect(stored).toContain('duckdb');
  });
});
