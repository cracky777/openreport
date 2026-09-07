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
    // The resolver (glibc inet_aton) also accepts PER-OCTET octal and hex, so
    // these reach 127.0.0.1 while matching no pattern on the dotted form.
    '0177.0.0.1',               // 127.0.0.1, octal first octet
    '0x7f.0.0.1',               // 127.0.0.1, hex first octet
    '[::ffff:7f00:1]',          // the IPv4-mapped form written as hex groups
    '[fd00:ec2::254]',          // IPv6 unique-local (fc00::/7)
    '[fe80::a9fe:a9fe]',        // IPv6 link-local — the v6 metadata address
    '100.64.0.1',               // RFC 6598 carrier-grade NAT
    '0.0.0.0',                  // reaches localhost on Linux
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

// La chaîne de connexion Oracle désigne sa cible ailleurs que dans `host` : la
// garde doit la lire aussi, sinon elle ne borde que la porte d'entrée
// officielle. Même bascule de politique que le reste du fichier.
describe('enforced — la connect string Oracle passe par la même liste', () => {
  // Oracle est en préversion : sans l'ouvrir, chaque création répondrait 400
  // pour la mauvaise raison et les refus attendus deviendraient de faux succès.
  beforeAll(() => {
    process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS = '1';
    process.env.OPENREPORT_PREVIEW_CONNECTORS = 'oracle';
  });
  afterAll(() => {
    delete process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS;
    delete process.env.OPENREPORT_PREVIEW_CONNECTORS;
  });

  const oracle = { ...base, dbType: 'oracle', host: 'db.example.com', port: 1521 };

  test('easy connect vers une adresse interne — refusé à la création', async () => {
    const res = await post(user, { ...oracle, name: 'o1', extraConfig: { connectString: '169.254.169.254:1521/x' } });
    expect(res.status).toBe(400);
  });

  test('descripteur (HOST=…) interne — refusé', async () => {
    const res = await post(user, { ...oracle, name: 'o2', extraConfig: { connectString: '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=127.0.0.1)(PORT=1521)))' } });
    expect(res.status).toBe(400);
  });

  test('descripteur illisible — refusé plutôt que cru sur parole', async () => {
    const res = await post(user, { ...oracle, name: 'o3', extraConfig: { connectString: '(FOO=bar)' } });
    expect(res.status).toBe(400);
  });

  test('un alias TNS nu passe — il se résout via la conf du serveur', async () => {
    const res = await post(user, { ...oracle, name: 'o4', extraConfig: { connectString: 'prod_alias' } });
    expect(res.status).toBe(201);
  });

  test('la mise à jour est bordée aussi — y compris la valeur héritée', async () => {
    const created = await post(user, { ...oracle, name: 'o5' });
    expect(created.status).toBe(201);
    const id = created.body.datasource.id;
    const put = await request(app).put(`/api/datasources/${id}`).set('x-test-user', user)
      .send({ name: 'o5', dbName: 'd', extraConfig: { connectString: '//10.0.0.5/x' } });
    expect(put.status).toBe(400);
  });
});

describe('OSS par défaut — la connect string interne reste permise', () => {
  beforeAll(() => { process.env.OPENREPORT_PREVIEW_CONNECTORS = 'oracle'; });
  afterAll(() => { delete process.env.OPENREPORT_PREVIEW_CONNECTORS; });
  test('même 127.0.0.1 : un opérateur seul chez lui', async () => {
    const res = await post(user, { ...base, dbType: 'oracle', name: 'o-def', host: 'db.example.com', extraConfig: { connectString: '127.0.0.1:1521/x' } });
    expect(res.status).toBe(201);
  });
});
