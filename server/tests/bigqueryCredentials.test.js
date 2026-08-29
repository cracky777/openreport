// The BigQuery service-account key survives an edit.
//
// The key is a secret: it is withheld from every read, so an edit form has
// nothing to send back for it. Replacing extra_config wholesale therefore
// DELETED the key on any save that touched the connection, and the datasource
// stopped authenticating with nothing on screen to say why. The password had
// carried an "empty means keep" rule for years; extra_config had none.
const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');
const db = require('../db');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

const KEY_A = JSON.stringify({ type: 'service_account', client_email: 'first@x.iam.gserviceaccount.com' });
const KEY_B = JSON.stringify({ type: 'service_account', client_email: 'rotated@x.iam.gserviceaccount.com' });

// Read the row directly: the API never hands the key back, which is the point.
const storedConfig = (id) => {
  const row = db.prepare('SELECT extra_config FROM datasources WHERE id = ?').get(id);
  return JSON.parse(row.extra_config);
};

const create = (uid, extraConfig) => request(app).post('/api/datasources').use(as(uid))
  .send({ name: `bq-${Math.random().toString(36).slice(2)}`, dbType: 'bigquery', dbName: 'proj', extraConfig });

describe('BigQuery service-account key', () => {
  test('an edit that sends no key keeps the stored one', async () => {
    const u = seedUser({ role: 'editor' });
    const made = await create(u, { dataset: 'ds_one', credentials: KEY_A });
    expect(made.status).toBe(201);
    const id = made.body.datasource.id;
    expect(storedConfig(id).credentials).toBeTruthy();

    // Exactly what the form sends back: it was never given the key.
    const put = await request(app).put(`/api/datasources/${id}`).use(as(u))
      .send({ name: made.body.datasource.name, dbType: 'bigquery', dbName: 'proj', extraConfig: { dataset: 'ds_one' } });
    expect(put.status).toBe(200);
    expect(storedConfig(id).credentials).toBeTruthy();
  });

  test('an edit that sends a key replaces it', async () => {
    const u = seedUser({ role: 'editor' });
    const made = await create(u, { dataset: 'ds_one', credentials: KEY_A });
    const id = made.body.datasource.id;
    const before = storedConfig(id).credentials;

    const put = await request(app).put(`/api/datasources/${id}`).use(as(u))
      .send({ name: made.body.datasource.name, dbType: 'bigquery', dbName: 'proj', extraConfig: { dataset: 'ds_two', credentials: KEY_B } });
    expect(put.status).toBe(200);
    const after = storedConfig(id);
    expect(after.credentials).toBeTruthy();
    expect(after.credentials).not.toBe(before); // rotated, not kept
    expect(after.dataset).toBe('ds_two');
  });

  test('the key is never handed back, but the dataset is', async () => {
    const u = seedUser({ role: 'editor' });
    const made = await create(u, { dataset: 'ds_one', credentials: KEY_A });
    const id = made.body.datasource.id;

    // The list is what populates the edit form.
    const list = await request(app).get('/api/datasources').use(as(u));
    const mine = list.body.datasources.find((d) => d.id === id);
    expect(mine.extra_config.credentials).toBeUndefined();
    // Withholding this one blanked the dataset on every save.
    expect(mine.extra_config.dataset).toBe('ds_one');
  });
});
