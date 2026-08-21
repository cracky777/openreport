/**
 * OIDC single sign-on — Authorization Code + PKCE against any spec-compliant
 * IdP (Keycloak, Entra ID, Google, Authentik, ...). Configured entirely via
 * env so a self-hosted deploy can turn it on without touching the DB:
 *
 *   OIDC_ISSUER_URL     e.g. https://idp.example.com/realms/main — discovery
 *                       runs against <issuer>/.well-known/openid-configuration
 *   OIDC_CLIENT_ID
 *   OIDC_CLIENT_SECRET  optional (public clients rely on PKCE alone)
 *   OIDC_REDIRECT_URL   the public callback, e.g.
 *                       https://reports.example.com/api/auth/oidc/callback
 *   OIDC_BUTTON_LABEL   login-page button text (default "Sign in with SSO")
 *   OIDC_DEFAULT_ROLE   role for auto-provisioned users: viewer|editor
 *                       (never admin — an IdP typo must not mint admins)
 *   OIDC_AUTO_PROVISION set to 0 to only let ALREADY-EXISTING users in
 *
 * The IdP is the identity authority: provisioned users get a random unusable
 * password hash, and their email is trusted as verified (the IdP owns it).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function isEnabled() {
  return !!(process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID && process.env.OIDC_REDIRECT_URL);
}

function buttonLabel() {
  return process.env.OIDC_BUTTON_LABEL || 'Sign in with SSO';
}

// Discovery is one network round-trip; memoize the resulting client but drop
// the memo on failure so a booting IdP doesn't wedge SSO until a restart.
let clientPromise = null;
function getClient() {
  if (!isEnabled()) return Promise.reject(new Error('OIDC is not configured'));
  if (!clientPromise) {
    const { Issuer } = require('openid-client');
    clientPromise = Issuer.discover(process.env.OIDC_ISSUER_URL).then((issuer) => new issuer.Client({
      client_id: process.env.OIDC_CLIENT_ID,
      ...(process.env.OIDC_CLIENT_SECRET ? { client_secret: process.env.OIDC_CLIENT_SECRET } : { token_endpoint_auth_method: 'none' }),
      redirect_uris: [process.env.OIDC_REDIRECT_URL],
      response_types: ['code'],
    }));
    clientPromise.catch(() => { clientPromise = null; });
  }
  return clientPromise;
}

// Map verified IdP claims to a local user row. Returns the user, creating it
// when auto-provisioning is on. Throws on claims without a usable email —
// every access feature (RLS patterns, workspace shares) keys on it.
function findOrCreateOidcUser(claims, db) {
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('The identity provider returned no email for this account');
  }
  const existing = db.prepare('SELECT id, email, display_name, role FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (existing) return { user: existing, created: false };

  if (process.env.OIDC_AUTO_PROVISION === '0') {
    throw new Error('No account for this email — ask an admin to create one');
  }
  // Mirror /register's bootstrap rule: the very first user of a fresh install
  // becomes the admin, later arrivals get the configured (non-admin) role.
  const isFirst = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
  const configured = process.env.OIDC_DEFAULT_ROLE === 'editor' ? 'editor' : 'viewer';
  const role = isFirst ? 'admin' : configured;
  const id = uuidv4();
  const displayName = String(claims.name || claims.preferred_username || email.split('@')[0]).slice(0, 120);
  // Random unusable password: the IdP is the only way into this account.
  const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, display_name, role, email_verified)
              VALUES (?, ?, ?, ?, ?, 1)`).run(id, email, passwordHash, displayName, role);
  return { user: { id, email, display_name: displayName, role }, created: true };
}

// Start the code flow: park state/nonce/PKCE verifier in the caller's session
// (the callback must see the SAME session cookie) and hand back the IdP URL.
async function buildAuthUrl(session) {
  const client = await getClient();
  const { generators } = require('openid-client');
  const state = generators.state();
  const nonce = generators.nonce();
  const verifier = generators.codeVerifier();
  session.oidc = { state, nonce, verifier };
  return client.authorizationUrl({
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: generators.codeChallenge(verifier),
    code_challenge_method: 'S256',
  });
}

// Finish the code flow: verify state/nonce/PKCE against what buildAuthUrl
// parked, exchange the code, and map the verified claims to a local user.
// The parked values are single-use — dropped before the exchange so a replayed
// callback can't be validated twice.
async function completeLogin(req, db) {
  const client = await getClient();
  const parked = req.session && req.session.oidc;
  if (!parked) throw new Error('Login flow expired — start again from the login page');
  delete req.session.oidc;
  const params = client.callbackParams(req);
  const tokenSet = await client.callback(process.env.OIDC_REDIRECT_URL, params, {
    state: parked.state,
    nonce: parked.nonce,
    code_verifier: parked.verifier,
  });
  return findOrCreateOidcUser(tokenSet.claims(), db);
}

module.exports = { isEnabled, buttonLabel, getClient, findOrCreateOidcUser, buildAuthUrl, completeLogin };
