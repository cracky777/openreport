// Signed embed tokens. A token is a self-contained grant for ONE report:
// minting requires write access to the underlying model (the data owner's
// bar, same as flipping a report public), the token's identity feeds RLS
// exactly like a logged-in viewer's — never owner/admin, even when the
// owner's own session rides along — and its locked filters are re-applied
// server-side on every query so the hosting page can't peel them off.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedGroup } = require('./helpers/testApp');
const embedToken = require('../utils/embedToken');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

describe('token sign/verify', () => {
  test('roundtrip keeps reportId, identity and locked filters; scope is enforced', () => {
    const t = embedToken.sign({ reportId: 'r1', email: 'A@B.io', groups: ['Sales'], lockedFilters: [{ field: 'f', op: 'eq', value: 'x' }] });
    const p = embedToken.verify(t);
    expect(p.reportId).toBe('r1');
    expect(p.email).toBe('a@b.io'); // normalized
    expect(p.groups).toEqual(['Sales']);
    expect(p.lockedFilters).toEqual([{ field: 'f', op: 'eq', value: 'x' }]);
  });
  test('a tampered token verifies to null', () => {
    const t = embedToken.sign({ reportId: 'r1' });
    expect(embedToken.verify(t.slice(0, -2) + 'xx')).toBeNull();
    expect(embedToken.verify('garbage')).toBeNull();
  });
  test('an internal cache_warm token never passes as an embed token', () => {
    const internal = require('../utils/internalToken').sign({ userId: 'u1' });
    expect(embedToken.verify(internal)).toBeNull();
  });
});

describe('minting — write access to the MODEL, not the report', () => {
  let modelOwner, reportAuthor, admin, report;
  beforeAll(() => {
    modelOwner = seedUser({ role: 'editor', email: 'owner@emb.io' });
    reportAuthor = seedUser({ role: 'editor', email: 'author@emb.io' });
    admin = seedUser({ role: 'admin', email: 'root@emb.io' });
    const ds = seedDatasource({ userId: modelOwner });
    const model = seedModel({ userId: modelOwner, datasourceId: ds });
    // The author's own report on someone else's model — they may write the
    // report, but the data isn't theirs to sign out.
    report = seedReport({ userId: reportAuthor, modelId: model });
  });

  test('report author without model write gets 403', async () => {
    const res = await request(app).post(`/api/reports/${report}/embed-token`).set('x-test-user', reportAuthor).send({});
    expect(res.status).toBe(403);
  });
  test('model owner and global admin can mint; response carries url + expiry', async () => {
    for (const uid of [modelOwner, admin]) {
      const res = await request(app).post(`/api/reports/${report}/embed-token`).set('x-test-user', uid)
        .send({ email: 'viewer@corp.io', expiresIn: 7200 });
      expect(res.status).toBe(201);
      expect(res.body.url).toContain(`/embed/${report}?token=`);
      expect(embedToken.verify(res.body.token).reportId).toBe(report);
    }
  });
  test('malformed locked filters are rejected at mint time', async () => {
    const res = await request(app).post(`/api/reports/${report}/embed-token`).set('x-test-user', modelOwner)
      .send({ lockedFilters: [{ op: 'eq', value: 'x' }] });
    expect(res.status).toBe(400);
  });
  test('anonymous minting is rejected', async () => {
    const res = await request(app).post(`/api/reports/${report}/embed-token`).send({});
    expect([401, 403]).toContain(res.status);
  });
});

describe('embed access + RLS + locked filters on /query', () => {
  let owner, model, privateReport, otherReport, otherModel;
  const RULES = { c1: ['alice@corp.io', 'group:Sales'], c2: ['bob@corp.io'] };
  beforeAll(() => {
    owner = seedUser({ role: 'editor', email: 'down@emb.io' });
    seedGroup({ name: 'Sales', memberIds: [] });
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    model = seedModel({
      userId: owner, datasourceId: ds,
      rls: { enabled: true, table: 'items', primaryKey: 'client_id', rules: RULES },
    });
    privateReport = seedReport({ userId: owner, modelId: model, isPublic: 0 });
    otherModel = seedModel({ userId: owner, datasourceId: ds });
    otherReport = seedReport({ userId: owner, modelId: otherModel, isPublic: 0 });
  });

  const mint = (opts) => embedToken.sign({ reportId: privateReport, ...opts });
  const q = (token, body = {}) => {
    const r = request(app).post(`/api/models/${model}/query`);
    if (token) r.set(embedToken.HEADER, token);
    return r.send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true, ...body });
  };

  test('a private report opens with its token — and only that report', async () => {
    const token = mint({});
    const ok = await request(app).get(`/api/reports/${privateReport}`).set(embedToken.HEADER, token);
    expect(ok.status).toBe(200);
    const other = await request(app).get(`/api/reports/${otherReport}`).set(embedToken.HEADER, token);
    expect(other.status).toBe(403);
  });

  test('no token, no access (report stayed private)', async () => {
    expect((await request(app).get(`/api/reports/${privateReport}`)).status).toBe(403);
    expect((await q(null)).status).toBe(404); // model unreachable anonymously
  });

  test('token email feeds RLS like a viewer session', async () => {
    const res = await q(mint({ email: 'alice@corp.io' }));
    expect(res.status).toBe(200);
    expect(res.body.sql).toContain("'c1'");
    expect(res.body.sql).not.toContain("'c2'");
  });

  test('token groups match group: rules without any DB membership', async () => {
    const res = await q(mint({ groups: ['sales'] }));
    expect(res.status).toBe(200);
    expect(res.body.sql).toContain("'c1'");
  });

  test('a token with no matching identity is denied every row', async () => {
    const res = await q(mint({ email: 'stranger@nowhere.io' }));
    expect(res.body.sql).toMatch(/1 = 0/);
  });

  test("the owner's own session never bypasses RLS on an embed request", async () => {
    const res = await request(app).post(`/api/models/${model}/query`)
      .set('x-test-user', owner)
      .set(embedToken.HEADER, mint({ email: 'alice@corp.io' }))
      .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true });
    expect(res.body.sql).toContain("'c1'");
    expect(res.body.sql).toMatch(/client_id[\s\S]*IN \(/);
  });

  test('locked filters are appended server-side even when the client omits them', async () => {
    const token = mint({ email: 'alice@corp.io', lockedFilters: [{ field: 'items.label', op: 'eq', value: 'LOCKED' }] });
    const res = await q(token, { widgetFilters: [] });
    expect(res.status).toBe(200);
    expect(res.body.sql).toContain("'LOCKED'");
  });

  test("a token can't reach a model outside its report", async () => {
    const res = await request(app).post(`/api/models/${otherModel}/query`)
      .set(embedToken.HEADER, mint({}))
      .send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true });
    expect(res.status).toBe(404);
  });
});

describe('model metadata (GET /models/:id) for anonymous readers', () => {
  let owner, model, privModel, privReport;
  beforeAll(() => {
    owner = seedUser({ role: 'editor', email: 'meta@emb.io' });
    const ds = seedDatasource({ userId: owner });
    model = seedModel({ userId: owner, datasourceId: ds, rls: { enabled: true, table: 'items', primaryKey: 'k', rules: { a: ['x@y.io'] } } });
    seedReport({ userId: owner, modelId: model, isPublic: 1 });
    privModel = seedModel({ userId: owner, datasourceId: ds });
    privReport = seedReport({ userId: owner, modelId: privModel, isPublic: 0 });
  });

  test('a fully anonymous public-report viewer can read the model (was a blanket 401 → blank widgets)', async () => {
    const res = await request(app).get(`/api/models/${model}`);
    expect(res.status).toBe(200);
    // …but never the RLS rules map (other users' email patterns)
    expect(res.body.model.rls).toEqual({});
  });

  test('an embed token grants the model behind its own report; no path stays 404', async () => {
    const token = embedToken.sign({ reportId: privReport });
    const ok = await request(app).get(`/api/models/${privModel}`).set(embedToken.HEADER, token);
    expect(ok.status).toBe(200);
    expect(ok.body.model.rls).toEqual({});
    const noPath = await request(app).get(`/api/models/${privModel}`);
    expect(noPath.status).toBe(404);
  });
});

// SECURITY: an embed link is a bearer string handed to an outside page. It used
// to be valid until it expired — up to a year — with no way to take it back.
describe('embed link revocation', () => {
  let owner; let model; let report;
  beforeEach(() => {
    owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    model = seedModel({ userId: owner, datasourceId: ds });
    report = seedReport({ userId: owner, modelId: model });
  });

  const mint = () => request(app).post(`/api/reports/${report}/embed-token`)
    .set('x-test-user', owner).send({ email: 'partner@client.io' });

  test('a minted link is listed, then stops working the moment it is revoked', async () => {
    const created = await mint();
    expect(created.status).toBe(201);
    const { id, token } = created.body;
    expect(id).toBeTruthy();

    // Works before revocation.
    expect((await request(app).get(`/api/reports/${report}`).set('x-embed-token', token)).status).toBe(200);

    const list = await request(app).get(`/api/reports/${report}/embed-tokens`).set('x-test-user', owner);
    expect(list.status).toBe(200);
    expect(list.body.tokens).toHaveLength(1);
    expect(list.body.tokens[0]).toMatchObject({ id, label: 'partner@client.io', revoked_at: null });

    const revoked = await request(app).delete(`/api/reports/${report}/embed-tokens/${id}`).set('x-test-user', owner);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBe(1);

    // The signature is still valid — the token is refused because it was named
    // and taken back, which is the whole point.
    expect((await request(app).get(`/api/reports/${report}`).set('x-embed-token', token)).status).toBe(403);
  });

  test('every link of a report can be revoked at once', async () => {
    const a = (await mint()).body;
    const b = (await mint()).body;
    const res = await request(app).delete(`/api/reports/${report}/embed-tokens/all`).set('x-test-user', owner);
    expect(res.body.revoked).toBe(2);
    for (const t of [a, b]) {
      expect((await request(app).get(`/api/reports/${report}`).set('x-embed-token', t.token)).status).toBe(403);
    }
  });

  test('managing links needs write access to the model, like minting one', async () => {
    const stranger = seedUser({ role: 'editor' });
    expect((await request(app).get(`/api/reports/${report}/embed-tokens`).set('x-test-user', stranger)).status).toBe(403);
    expect((await request(app).delete(`/api/reports/${report}/embed-tokens/all`).set('x-test-user', stranger)).status).toBe(403);
  });
});
