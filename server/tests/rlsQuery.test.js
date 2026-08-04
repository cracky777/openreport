const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();
beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

// RLS is the multi-tenant row boundary. These assert the /query compiler folds
// getAllowedRlsKeys into the fact SQL: owner/admin bypass, a matching viewer is
// scoped to their allowed keys, and a non-matching viewer (or anonymous) is
// denied every row via `1 = 0` — never handed the unfiltered table.
describe('RLS enforcement in /models/:id/query', () => {
  let owner, admin, alice, stranger, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor', email: 'owner@rls.io' });
    admin = seedUser({ role: 'admin', email: 'admin@rls.io' });
    alice = seedUser({ role: 'viewer', email: 'alice@rls.io' });     // matches rule c1
    stranger = seedUser({ role: 'viewer', email: 'nobody@rls.io' }); // matches nothing
    const ds = seedDatasource({ userId: owner, dbType: 'postgres' });
    model = seedModel({
      userId: owner,
      datasourceId: ds,
      rls: { enabled: true, table: 'items', primaryKey: 'client_id', rules: { c1: ['alice@rls.io'], c2: ['bob@rls.io'] } },
    });
    // A public report exposes the model so non-owners can reach /query at all
    // (and thus be subjected to RLS rather than bounced by access control).
    seedReport({ userId: owner, modelId: model, isPublic: 1 });
  });

  const sqlFor = async (uid) => {
    const r = request(app).post(`/api/models/${model}/query`);
    if (uid) r.set('x-test-user', uid);
    const res = await r.send({ dimensionNames: ['items.label'], measureNames: ['items.amt_sum'], sqlOnly: true });
    expect(res.status).toBe(200);
    return res.body.sql;
  };

  test('owner bypasses RLS — no row filter on the RLS key', async () => {
    const s = await sqlFor(owner);
    expect(s).not.toContain('client_id');
    expect(s).not.toMatch(/1 = 0/);
  });

  test('global admin bypasses RLS', async () => {
    const s = await sqlFor(admin);
    expect(s).not.toContain('client_id');
    expect(s).not.toMatch(/1 = 0/);
  });

  test('a matching viewer is scoped to their allowed key only', async () => {
    const s = await sqlFor(alice);
    expect(s).toContain("'c1'");     // alice → c1
    expect(s).not.toContain("'c2'"); // never another client's key
    expect(s).toMatch(/client_id[\s\S]*IN \(/);
  });

  test('a non-matching viewer is denied every row (1 = 0)', async () => {
    const s = await sqlFor(stranger);
    expect(s).toMatch(/1 = 0/);
    expect(s).not.toContain("'c1'");
  });

  test('anonymous (via the public report) is denied — empty email matches no rule', async () => {
    const s = await sqlFor(null);
    expect(s).toMatch(/1 = 0/);
  });
});
