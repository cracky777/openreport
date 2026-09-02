// Un connecteur écrit mais jamais exécuté contre son moteur est une hypothèse,
// pas une fonctionnalité. Il reste visible — l'utilisateur doit savoir qu'il
// arrive — mais l'enregistrer doit être impossible : griser une option dans un
// <select> n'engage que le navigateur, et POST /api/datasources reste ouvert à
// qui écrit la requête à la main.
const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const PREVIEWS = ['redshift', 'mssql', 'snowflake', 'clickhouse', 'databricks', 'oracle'];

let user;
beforeEach(() => {
  user = seedUser({ role: 'editor' });
  delete process.env.OPENREPORT_PREVIEW_CONNECTORS;
});
afterAll(() => { delete process.env.OPENREPORT_PREVIEW_CONNECTORS; });

const post = (body) => request(app).post('/api/datasources').set('x-test-user', user).send(body);
const base = { name: 'essai', host: 'db.example.com', dbName: 'analytics', dbUser: 'u', dbPassword: 'p' };

describe('un connecteur en préversion ne s’enregistre pas', () => {
  test.each(PREVIEWS)('%s est refusé, avec un message qui dit la sortie', async (dbType) => {
    const res = await post({ ...base, dbType });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/preview/i);
    expect(res.body.error).toContain('OPENREPORT_PREVIEW_CONNECTORS');
  });

  test('le test de connexion est fermé aussi', async () => {
    const res = await request(app).post('/api/datasources/test').set('x-test-user', user)
      .send({ ...base, dbType: 'snowflake' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/preview/i);
  });

  test('les connecteurs éprouvés passent', async () => {
    for (const dbType of ['postgres', 'mysql', 'azure_sql', 'bigquery']) {
      const res = await post({ ...base, name: 'ok-' + dbType, dbType });
      expect(res.status).toBe(201);
    }
  });
});

describe('lever le garde-fou est explicite', () => {
  test('un nom précis n’ouvre que celui-là', async () => {
    process.env.OPENREPORT_PREVIEW_CONNECTORS = 'snowflake';
    expect((await post({ ...base, name: 'sf', dbType: 'snowflake' })).status).toBe(201);
    expect((await post({ ...base, name: 'rs', dbType: 'redshift' })).status).toBe(400);
  });

  test('« all » les ouvre tous', async () => {
    process.env.OPENREPORT_PREVIEW_CONNECTORS = 'all';
    for (const dbType of PREVIEWS) {
      expect((await post({ ...base, name: 'all-' + dbType, dbType })).status).toBe(201);
    }
  });
});

describe('le catalogue annoncé au client suit le déploiement', () => {
  test('tout est verrouillé par défaut', async () => {
    const res = await request(app).get('/api/datasources/connectors').set('x-test-user', user);
    expect(res.status).toBe(200);
    expect(res.body.preview.sort()).toEqual([...PREVIEWS].sort());
    expect(res.body.unavailable.sort()).toEqual([...PREVIEWS].sort());
  });

  test('un connecteur ouvert sort de la liste des verrouillés sans quitter la préversion', async () => {
    process.env.OPENREPORT_PREVIEW_CONNECTORS = 'snowflake';
    const res = await request(app).get('/api/datasources/connectors').set('x-test-user', user);
    expect(res.body.unavailable).not.toContain('snowflake');
    expect(res.body.preview).toContain('snowflake');
  });

  test('« connectors » n’est pas lu comme un identifiant de datasource', async () => {
    const res = await request(app).get('/api/datasources/connectors').set('x-test-user', user);
    expect(res.body).toHaveProperty('preview');
    expect(res.body).not.toHaveProperty('datasource');
  });
});
