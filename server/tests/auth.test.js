const request = require('supertest');
const { buildApp } = require('./helpers/testApp');

const app = buildApp();

// The first account ever registered becomes the sole admin; everyone after is a
// viewer. Getting this wrong lets a made-up "phantom admin" login seize the one
// admin slot — a documented gotcha. setupEnv gives this file a fresh isolated
// DB, so "first" genuinely is first. (Kept under the 5/h registerLimiter cap.)
describe('POST /api/auth/register', () => {
  // Cloud signup (OPENREPORT_CLOUD=1) gates registration on accepted legal
  // clauses; OSS ignores the field. Send them by default so this shared suite
  // is green under both editions — individual tests can still override.
  const reg = (body) => request(app).post('/api/auth/register')
    .send({ legalAcceptances: { terms: true, privacy: true, legal: true }, ...body });

  test('the very first user becomes admin', async () => {
    const res = await reg({ email: 'first@auth.io', password: 'pw' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('admin');
  });

  test('every subsequent user is a viewer', async () => {
    const res = await reg({ email: 'second@auth.io', password: 'pw' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('viewer');
  });

  test('a duplicate email is rejected (409)', async () => {
    const res = await reg({ email: 'first@auth.io', password: 'pw' });
    expect(res.status).toBe(409);
  });

  test('missing password is rejected (400)', async () => {
    const res = await reg({ email: 'nopass@auth.io' });
    expect(res.status).toBe(400);
  });
});
