// SSRF host block-list. Two things to pin:
//   1. WHEN enforced (cloud, or OSS opt-in), an internal host is refused on
//      every path that persists it — not just POST /test, which an attacker
//      skips by saving the row and then hitting /:id/tables or /:id/query.
//   2. In DEFAULT OSS (single-operator), a localhost / private-LAN database is
//      the normal setup and must NOT be blocked, or self-hosting breaks.
const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const post = (user, data) => request(app).post('/api/datasources').set('x-test-user', user).send(data);
const base = { name: 'x', dbType: 'postgres', dbName: 'd', dbUser: 'u', dbPassword: 'p', port: 5432 };

let user;
beforeEach(() => { user = seedUser({ role: 'editor' }); });

describe('default OSS — internal hosts are allowed (localhost DB is the norm)', () => {
  // No OPENREPORT_CLOUD, no opt-in flag: the block-list is off.
  test('a localhost datasource is accepted', async () => {
    const res = await post(user, { ...base, name: 'local', host: '127.0.0.1' });
    expect(res.status).toBe(201);
  });
  test('a private-LAN datasource is accepted', async () => {
    const res = await post(user, { ...base, name: 'lan', host: '192.168.1.20' });
    expect(res.status).toBe(201);
  });
});

describe('enforced (cloud / OSS opt-in) — internal hosts are refused', () => {
  beforeAll(() => { process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS = '1'; });
  afterAll(() => { delete process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS; });

  // Each reaches an internal address; a legit DB host never looks like any.
  for (const host of [
    '169.254.169.254',          // cloud metadata, dotted
    '127.0.0.1', 'localhost',
    '10.0.0.5', '192.168.1.1', '172.16.9.9',
    '2130706433',               // 127.0.0.1 as a decimal integer
    '0x7f000001',               // 127.0.0.1 as hex
    '::1',                      // IPv6 loopback
    '[::ffff:169.254.169.254]', // IPv4-mapped metadata address
  ]) {
    test(`create refuses ${host}`, async () => {
      const res = await post(user, { ...base, name: `ds-${host}`, host });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not reachable/i);
    });
  }

  test('a normal public host is still accepted', async () => {
    const res = await post(user, { ...base, name: 'ok', host: 'db.example.com' });
    expect(res.status).toBe(201);
  });

  test('a host change to an internal address is refused at update', async () => {
    const created = await post(user, { ...base, name: 'movable', host: 'db.example.com' });
    expect(created.status).toBe(201);
    const id = created.body.datasource.id;
    const res = await request(app).put(`/api/datasources/${id}`)
      .set('x-test-user', user)
      .send({ ...base, name: 'movable', host: '169.254.169.254' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not reachable/i);
  });
});
