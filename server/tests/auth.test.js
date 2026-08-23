const request = require('supertest');
const { buildApp } = require('./helpers/testApp');

const app = buildApp();

// The first account ever registered becomes the sole admin; everyone after is a
// viewer. Getting this wrong lets a made-up "phantom admin" login seize the one
// admin slot — a documented gotcha. setupEnv gives this file a fresh isolated
// DB, so "first" genuinely is first. (Kept under the 5/h registerLimiter cap.)
// SECURITY: there used to be no password policy at all — "a" was accepted and
// hashed. Exercised directly so it costs no registerLimiter budget.
describe('password policy', () => {
  const { validatePassword } = require('../routes/auth');

  test('rejects short, non-string and absurdly long passwords', () => {
    expect(validatePassword('a')).toMatch(/at least 12 characters/i);
    expect(validatePassword('short')).toMatch(/at least 12 characters/i);
    expect(validatePassword(undefined)).toMatch(/must be text/i);
    expect(validatePassword({ $ne: null })).toMatch(/must be text/i);
    expect(validatePassword('x'.repeat(201))).toMatch(/too long/i);
  });

  test('accepts a normal passphrase', () => {
    expect(validatePassword('a-long-enough-passphrase')).toBeNull();
  });
});

describe('POST /api/auth/register', () => {
  // Cloud signup (OPENREPORT_CLOUD=1) gates registration on accepted legal
  // clauses; OSS ignores the field. Send them by default so this shared suite
  // is green under both editions — individual tests can still override.
  // Registration enforces a length floor; these tests are about the role
  // rules, so they use a compliant password throughout.
  const PASSWORD = 'a-long-enough-passphrase';
  const reg = (body) => request(app).post('/api/auth/register')
    .send({ legalAcceptances: { terms: true, privacy: true, legal: true }, ...body });

  test('the very first user becomes admin', async () => {
    const res = await reg({ email: 'First@Auth.io', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.email).toBe('first@auth.io'); // stored canonically
  });

  test('every subsequent user is a viewer', async () => {
    const res = await reg({ email: 'second@auth.io', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('viewer');
  });

  // SECURITY: a CASE VARIANT must collide too. RLS patterns and workspace
  // shares match emails case-insensitively, so "FIRST@AUTH.IO" as a second
  // account would inherit first@auth.io's row-level grants.
  test('a duplicate email is rejected (409), case-insensitively', async () => {
    const res = await reg({ email: 'FIRST@AUTH.IO', password: PASSWORD });
    expect(res.status).toBe(409);
  });

  test('missing password is rejected (400)', async () => {
    const res = await reg({ email: 'nopass@auth.io' });
    expect(res.status).toBe(400);
  });

});
