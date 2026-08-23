// OIDC SSO. The IdP is mocked at the openid-client boundary; everything on
// our side of it runs for real: env gating, PKCE/state parking in the
// session, single-use flow state, claim→user mapping and provisioning rules
// (first user admin, configured role never admin, unusable password).
jest.mock('openid-client', () => {
  const shared = { claims: { sub: 'sso-subject-1', iss: 'https://idp.example', email: 'sso.user@idp.io', name: 'SSO User' }, lastChecks: null };
  class Client {
    authorizationUrl(o) { return `https://idp.example/auth?state=${o.state}&challenge=${o.code_challenge}`; }
    callbackParams(req) { return { code: 'the-code', state: (req.query || {}).state }; }
    async callback(uri, params, checks) {
      shared.lastChecks = { uri, params, checks };
      if (params.state !== checks.state) throw new Error('state mismatch');
      return { claims: () => shared.claims };
    }
  }
  return {
    __shared: shared,
    Issuer: { discover: jest.fn(async () => ({ Client })) },
    generators: { state: () => 'st-1', nonce: () => 'no-1', codeVerifier: () => 'cv-1', codeChallenge: (v) => `cc-${v}` },
  };
});

const express = require('express');
const request = require('supertest');
const { db, seedUser } = require('./helpers/testApp');
const oidc = require('../utils/oidc');
const { __shared } = require('openid-client');

const OIDC_ENV = {
  OIDC_ISSUER_URL: 'https://idp.example',
  OIDC_CLIENT_ID: 'openreport',
  OIDC_CLIENT_SECRET: 's3cret',
  OIDC_REDIRECT_URL: 'http://localhost:3001/api/auth/oidc/callback',
};
const clearEnv = () => { for (const k of [...Object.keys(OIDC_ENV), 'OIDC_DEFAULT_ROLE', 'OIDC_AUTO_PROVISION']) delete process.env[k]; };

// Session persists across requests of one agent, like a real cookie session.
function buildAuthApp() {
  const session = {};
  const logins = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    req.isAuthenticated = () => false;
    req.login = (u, cb) => { logins.push(u); cb(null); };
    next();
  });
  app.use('/api/auth', require('../routes/auth'));
  return { app, session, logins };
}

describe('unconfigured (no OIDC env)', () => {
  beforeAll(clearEnv);
  test('config reports disabled; login is a 404', async () => {
    const { app } = buildAuthApp();
    const cfg = await request(app).get('/api/auth/oidc/config');
    expect(cfg.body).toEqual({ enabled: false, label: 'Sign in with SSO' });
    expect((await request(app).get('/api/auth/oidc/login')).status).toBe(404);
    expect((await request(app).get('/api/auth/oidc/callback')).status).toBe(404);
  });
});

describe('provisioning rules (findOrCreateOidcUser)', () => {
  beforeAll(() => Object.assign(process.env, OIDC_ENV));
  afterAll(clearEnv);

  // `sub` is mandatory in OIDC and is the identity we bind to; `iss` defaults
  // to the configured issuer when the IdP omits it from the userinfo claims.
  const claims = (over) => ({ sub: `sub-${over.email || 'x'}`, iss: 'https://idp.example', ...over });

  test('the very first user of a fresh install becomes admin', () => {
    expect(db.prepare('SELECT COUNT(*) c FROM users').get().c).toBe(0);
    const { user, created } = oidc.findOrCreateOidcUser(claims({ email: 'boot@idp.io' }), db);
    expect(created).toBe(true);
    expect(user.role).toBe('admin');
  });

  test('later users get the configured role, never admin', () => {
    process.env.OIDC_DEFAULT_ROLE = 'editor';
    expect(oidc.findOrCreateOidcUser(claims({ email: 'ed@idp.io' }), db).user.role).toBe('editor');
    process.env.OIDC_DEFAULT_ROLE = 'admin'; // misconfiguration must not mint admins
    expect(oidc.findOrCreateOidcUser(claims({ email: 'sneaky@idp.io' }), db).user.role).toBe('viewer');
    delete process.env.OIDC_DEFAULT_ROLE;
  });

  test('in cloud mode even the first SSO user is not an admin', () => {
    process.env.OPENREPORT_CLOUD = '1';
    db.prepare('DELETE FROM users').run();
    const { user } = oidc.findOrCreateOidcUser(claims({ email: 'first@tenant.io' }), db);
    expect(user.role).toBe('viewer'); // 'admin' is the platform operator's role
    delete process.env.OPENREPORT_CLOUD;
  });

  test('claims without a usable email are rejected', () => {
    expect(() => oidc.findOrCreateOidcUser(claims({ name: 'No Mail' }), db)).toThrow(/no email/i);
  });

  test('claims without a subject are rejected', () => {
    expect(() => oidc.findOrCreateOidcUser({ email: 'nosub@idp.io' }, db)).toThrow(/subject/i);
  });

  test('auto-provision off: unknown emails are rejected, known ones pass', () => {
    const uid = seedUser({ role: 'editor', email: 'known@corp.io' });
    process.env.OIDC_AUTO_PROVISION = '0';
    expect(() => oidc.findOrCreateOidcUser(claims({ email: 'stranger@idp.io' }), db)).toThrow(/ask an admin/i);
    const { user, created } = oidc.findOrCreateOidcUser(claims({ email: 'known@corp.io', email_verified: true }), db);
    expect(created).toBe(false);
    expect(user.id).toBe(uid);
    delete process.env.OIDC_AUTO_PROVISION;
  });

  test('provisioned users are email-verified with an unusable random password', () => {
    const { user } = oidc.findOrCreateOidcUser(claims({ email: 'fresh@idp.io', name: 'Fresh' }), db);
    const row = db.prepare('SELECT email_verified, password_hash, display_name, oidc_sub FROM users WHERE id = ?').get(user.id);
    expect(row.email_verified).toBe(1);
    expect(row.password_hash).toMatch(/^\$2/); // bcrypt of random bytes — never a known value
    expect(row.display_name).toBe('Fresh');
    expect(row.oidc_sub).toBe('sub-fresh@idp.io'); // bound to the IdP subject
  });
});

// SECURITY: an email is a label the IdP's own subjects may be able to choose.
// Taking over the local account that holds it must not be one claim away.
describe('account linking (findOrCreateOidcUser)', () => {
  beforeAll(() => Object.assign(process.env, OIDC_ENV));
  afterAll(() => { clearEnv(); delete process.env.OIDC_ALLOW_EMAIL_LINKING; });

  const claims = (over) => ({ iss: 'https://idp.example', ...over });

  test('an unverified email cannot claim an existing password account', () => {
    seedUser({ role: 'admin', email: 'ceo@corp.io' });
    expect(() => oidc.findOrCreateOidcUser(claims({ sub: 'attacker', email: 'ceo@corp.io' }), db))
      .toThrow(/did not confirm the address/i);
    expect(db.prepare('SELECT oidc_sub FROM users WHERE email = ?').get('ceo@corp.io').oidc_sub).toBeNull();
  });

  test('an explicitly unverified email is refused outright', () => {
    expect(() => oidc.findOrCreateOidcUser(claims({ sub: 's1', email: 'nobody@idp.io', email_verified: false }), db))
      .toThrow(/not verified/i);
  });

  test('a verified email links once, and binds the account to that subject', () => {
    const uid = seedUser({ role: 'editor', email: 'linkme@corp.io' });
    const { user, created } = oidc.findOrCreateOidcUser(
      claims({ sub: 'real-subject', email: 'LINKME@CORP.IO', email_verified: true }), db);
    expect(created).toBe(false);
    expect(user.id).toBe(uid);
    expect(user.role).toBe('editor'); // SSO never changes an existing role
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(uid).oidc_sub).toBe('real-subject');

    // A DIFFERENT subject presenting the same verified email is now refused —
    // the account belongs to the first identity that linked it.
    expect(() => oidc.findOrCreateOidcUser(
      claims({ sub: 'someone-else', email: 'linkme@corp.io', email_verified: true }), db))
      .toThrow(/already linked/i);
  });

  test('a linked account is found by subject even after the IdP changes its email', () => {
    const uid = seedUser({ role: 'viewer', email: 'before@corp.io' });
    oidc.findOrCreateOidcUser(claims({ sub: 'stable-sub', email: 'before@corp.io', email_verified: true }), db);
    const { user, created } = oidc.findOrCreateOidcUser(
      claims({ sub: 'stable-sub', email: 'after@corp.io', email_verified: true }), db);
    expect(created).toBe(false);
    expect(user.id).toBe(uid);
  });

  test('OIDC_ALLOW_EMAIL_LINKING=1 re-opens linking for a trusted IdP that omits the claim', () => {
    const uid = seedUser({ role: 'editor', email: 'trusted@corp.io' });
    process.env.OIDC_ALLOW_EMAIL_LINKING = '1';
    const { user } = oidc.findOrCreateOidcUser(claims({ sub: 'no-claim-sub', email: 'trusted@corp.io' }), db);
    expect(user.id).toBe(uid);
    delete process.env.OIDC_ALLOW_EMAIL_LINKING;
  });
});

describe('login → callback flow', () => {
  beforeAll(() => Object.assign(process.env, OIDC_ENV));
  afterAll(clearEnv);

  test('login parks single-use flow state and redirects to the IdP; callback logs in and consumes it', async () => {
    const { app, session, logins } = buildAuthApp();

    const start = await request(app).get('/api/auth/oidc/login');
    expect(start.status).toBe(302);
    expect(start.headers.location).toBe('https://idp.example/auth?state=st-1&challenge=cc-cv-1');
    expect(session.oidc).toEqual({ state: 'st-1', nonce: 'no-1', verifier: 'cv-1' });

    const cb = await request(app).get('/api/auth/oidc/callback?code=the-code&state=st-1');
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/');
    expect(logins).toHaveLength(1);
    expect(logins[0].email).toBe('sso.user@idp.io');
    // PKCE verifier travelled into the token exchange
    expect(__shared.lastChecks.checks).toEqual({ state: 'st-1', nonce: 'no-1', code_verifier: 'cv-1' });
    // flow state is single-use
    expect(session.oidc).toBeUndefined();

    const replay = await request(app).get('/api/auth/oidc/callback?code=the-code&state=st-1');
    expect(replay.status).toBe(302);
    expect(replay.headers.location).toMatch(/sso_error=.*expired/i);
    expect(logins).toHaveLength(1);
  });

  test('a failed exchange (state mismatch) bounces back to the login page, not a 500', async () => {
    const { app, logins } = buildAuthApp();
    await request(app).get('/api/auth/oidc/login');
    const cb = await request(app).get('/api/auth/oidc/callback?code=the-code&state=WRONG');
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toMatch(/^\/login\?sso_error=/);
    expect(logins).toHaveLength(0);
  });

  test('claims without email bounce back with the mapping error', async () => {
    const saved = __shared.claims;
    __shared.claims = { name: 'Mailless' };
    const { app, logins } = buildAuthApp();
    await request(app).get('/api/auth/oidc/login');
    const cb = await request(app).get('/api/auth/oidc/callback?code=the-code&state=st-1');
    expect(cb.headers.location).toMatch(/sso_error=.*email/i);
    expect(logins).toHaveLength(0);
    __shared.claims = saved;
  });
});
