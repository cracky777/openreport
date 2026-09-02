// Le bouton « signaler un bug » ne peut pas être testé par le rendu : ce qui
// compte est côté serveur, et tient en une phrase — un lecteur doit pouvoir
// obtenir l'adresse de signalement. C'est justement lui qui voit un visuel
// casser, et la réserver aux administrateurs reviendrait à donner le droit de
// signaler à ceux qui n'en ont pas l'usage.
const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');
const { setSupportEmail } = require('../utils/settingsHelper');

const app = buildApp();

afterEach(() => { setSupportEmail(''); delete process.env.OPENREPORT_SUPPORT_EMAIL; });

describe('adresse de signalement', () => {
  test('un lecteur peut la lire', async () => {
    setSupportEmail('bugs@example.com');
    const viewer = seedUser({ role: 'viewer' });
    const res = await request(app).get('/api/support').set('x-test-user', viewer);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('bugs@example.com');
  });

  test('un anonyme ne la lit pas — une adresse publiée est une adresse récoltée', async () => {
    setSupportEmail('bugs@example.com');
    const res = await request(app).get('/api/support');
    expect(res.status).toBe(401);
  });

  // Sans adresse, l'interface doit pouvoir dire « aucune adresse configurée »
  // plutôt que d'ouvrir un mailto sans destinataire.
  test('non configurée, la réponse est nulle et non une chaîne vide', async () => {
    const viewer = seedUser({ role: 'viewer' });
    const res = await request(app).get('/api/support').set('x-test-user', viewer);
    expect(res.body.email).toBeNull();
  });

  test('l’environnement fournit la valeur d’usine, la base la remplace', async () => {
    process.env.OPENREPORT_SUPPORT_EMAIL = 'usine@example.com';
    const viewer = seedUser({ role: 'viewer' });
    let res = await request(app).get('/api/support').set('x-test-user', viewer);
    expect(res.body.email).toBe('usine@example.com');
    setSupportEmail('admin@example.com');
    res = await request(app).get('/api/support').set('x-test-user', viewer);
    expect(res.body.email).toBe('admin@example.com');
  });

  test('une adresse invalide est refusée plutôt que stockée', async () => {
    const admin = seedUser({ role: 'admin' });
    const bad = await request(app).put('/api/admin/settings/support-email')
      .set('x-test-user', admin).send({ supportEmail: 'pas-une-adresse' });
    expect(bad.status).toBe(400);
    const ok = await request(app).put('/api/admin/settings/support-email')
      .set('x-test-user', admin).send({ supportEmail: 'bugs@example.com' });
    expect(ok.status).toBe(200);
    expect(ok.body.supportEmail).toBe('bugs@example.com');
  });

  test('seul un administrateur la change', async () => {
    const viewer = seedUser({ role: 'viewer' });
    const res = await request(app).put('/api/admin/settings/support-email')
      .set('x-test-user', viewer).send({ supportEmail: 'bugs@example.com' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
