const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');

// Build or Chat: the face of the app a user opens on, kept on their account.
describe('the UI mode of an account', () => {
  const app = buildApp();
  let uid;
  beforeAll(() => { uid = seedUser({ role: 'editor' }); });

  test('unset by default, kept once chosen, read back with the account', async () => {
    expect((await request(app).get('/api/auth/me').set('x-test-user', uid)).body.user.ui_mode).toBeNull();
    const res = await request(app).put('/api/auth/me/ui-mode').set('x-test-user', uid).send({ mode: 'chat' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ui_mode: 'chat' });
    expect((await request(app).get('/api/auth/me').set('x-test-user', uid)).body.user.ui_mode).toBe('chat');
  });

  test('only the two faces exist', async () => {
    expect((await request(app).put('/api/auth/me/ui-mode').set('x-test-user', uid).send({ mode: 'kiosk' })).status).toBe(400);
    expect((await request(app).put('/api/auth/me/ui-mode').set('x-test-user', uid).send({})).status).toBe(400);
    expect((await request(app).put('/api/auth/me/ui-mode').send({ mode: 'chat' })).status).toBe(401);
  });
});
