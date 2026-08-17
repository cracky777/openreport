// The authentication chain itself: bcrypt, the session cookie, the rate
// limiters and the internal-token guard. None of it ran in a test before — the
// route harness replaces req.user with a header, so passport never executed.
//
// Two constraints shape this file, both discovered by running it:
//
//   1. The limiters are created when routes/auth.js loads, and require() caches
//      the module. Building a "fresh" app does NOT give fresh counters — every
//      test in this file shares one budget. So the tests that must not spend it
//      come first, and only the registration-cap test posts to /register.
//   2. /register logs the new user in. A test about login therefore can't start
//      from a registered account, or it is already authenticated before login
//      is ever called. Users are seeded straight into the table instead.
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { buildRealAuthApp } = require('./helpers/realAuthApp');
const internalToken = require('../utils/internalToken');
const { db } = require('./helpers/testApp');

const app = buildRealAuthApp();
const tokenApp = buildRealAuthApp({ withInternalToken: true });
const uniqueEmail = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}@test.local`;

// No HTTP: /register is rate-limited and would auto-login the account.
function seedRealUser(password, role = 'viewer') {
  const id = uuid();
  const email = uniqueEmail('u');
  db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)')
    .run(id, email, bcrypt.hashSync(password, 4), 'Test', role);
  return { id, email };
}

describe('Login', () => {
  test('the right password opens a session that later requests carry', async () => {
    const { id, email } = seedRealUser('correct horse');
    const agent = request.agent(app);

    expect((await agent.get('/whoami')).body.authenticated).toBe(false);
    const login = await agent.post('/api/auth/login').send({ email, password: 'correct horse' });
    expect(login.status).toBe(200);

    const after = await agent.get('/whoami');
    expect(after.body.authenticated).toBe(true);
    expect(after.body.id).toBe(id);
  });

  test('a successful login does not spend the attempt budget', async () => {
    // skipSuccessfulRequests — without it someone signing in ten times a day
    // would lock themselves out. Runs early, while the budget is untouched.
    const { email } = seedRealUser('correct horse');
    for (let i = 0; i < 12; i++) {
      const res = await request(app).post('/api/auth/login').send({ email, password: 'correct horse' });
      expect(res.status).toBe(200);
    }
  });

  test('the right password on the wrong account is still refused', async () => {
    const { email } = seedRealUser('correct horse');
    seedRealUser('battery staple');
    const res = await request(app).post('/api/auth/login').send({ email, password: 'battery staple' });
    expect(res.status).toBe(401);
  });

  test('the stored password is a bcrypt hash, never the password', () => {
    const { email } = seedRealUser('correct horse');
    const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email);
    expect(row.password_hash).not.toContain('correct horse');
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
  });

  test('logging out drops the session', async () => {
    const { email } = seedRealUser('correct horse');
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password: 'correct horse' });
    expect((await agent.get('/whoami')).body.authenticated).toBe(true);
    await agent.post('/api/auth/logout');
    expect((await agent.get('/whoami')).body.authenticated).toBe(false);
  });
});

describe('Internal token', () => {
  // Before the limiter tests below: these don't touch /login or /register.
  test('a valid token promotes an unauthenticated loopback caller', async () => {
    const { id } = seedRealUser('correct horse');
    const res = await request(tokenApp).get('/whoami').set(internalToken.HEADER, internalToken.sign({ userId: id }));
    expect(res.body.id).toBe(id);
  });

  test('a malformed token is ignored', async () => {
    const res = await request(tokenApp).get('/whoami').set(internalToken.HEADER, 'not.a.jwt');
    expect(res.body.authenticated).toBe(false);
    expect(res.body.id).toBeNull();
  });

  test('a token signed with another secret is ignored', async () => {
    const jwt = require('jsonwebtoken');
    const { id } = seedRealUser('correct horse');
    const forged = jwt.sign({ userId: id, scope: internalToken.SCOPE }, 'a-different-secret-0123456789');
    const res = await request(tokenApp).get('/whoami').set(internalToken.HEADER, forged);
    expect(res.body.id).toBeNull();
  });

  test('a token with the wrong scope is ignored', () => {
    const jwt = require('jsonwebtoken');
    const wrongScope = jwt.sign({ userId: 'someone', scope: 'not-the-scope' }, process.env.INTERNAL_TOKEN_SECRET);
    expect(internalToken.verify(wrongScope)).toBeNull();
  });
});

describe('Rate limiters', () => {
  // Last: these deliberately exhaust the shared budgets.
  test('failed logins are eventually refused with 429', async () => {
    const { email } = seedRealUser('correct horse');
    const statuses = [];
    for (let i = 0; i < 14; i++) {
      statuses.push((await request(app).post('/api/auth/login').send({ email, password: `guess${i}` })).status);
    }
    // The point is the transition, not the exact cap: several attempts are let
    // through, then the limiter takes over and stays on.
    expect(statuses).toContain(401);
    expect(statuses).toContain(429);
    expect(statuses[statuses.length - 1]).toBe(429);
    expect(statuses.indexOf(429)).toBeGreaterThan(statuses.lastIndexOf(401));
  });

  test('registration is capped', async () => {
    const statuses = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await request(app).post('/api/auth/register').send({ email: uniqueEmail('mass'), password: 'correct horse' })).status);
    }
    expect(statuses).toContain(201);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
