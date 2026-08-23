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
 *   OIDC_ALLOW_EMAIL_LINKING  set to 1 to let a first SSO login attach to an
 *                       existing password account on the email alone. Only for
 *                       an IdP you trust that does not send email_verified.
 *
 * The account is bound to the IdP (issuer, subject) pair on first link, and
 * matched on it afterwards: an email is a label a subject may be able to
 * choose, the subject is not.
 *
 * The IdP is the identity authority for the accounts IT created: those get a
 * random unusable password hash and count as email-verified. It is NOT an
 * authority over accounts that already existed here — see the linking rules.
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
  // The (issuer, subject) pair is the identity. An email is a routable label
  // the IdP may let its own subjects choose — matching on it alone meant
  // anyone who could set the claim (a self-registration realm, a second-tier
  // IdP behind a broker) logged in as the local account holding that address.
  const sub = String(claims.sub || '').trim();
  if (!sub) throw new Error('The identity provider returned no subject identifier');
  const iss = String(claims.iss || process.env.OIDC_ISSUER_URL || '').trim();
  // Explicitly-unverified means the IdP itself says the address is unproven.
  if (claims.email_verified === false) {
    throw new Error('Your identity provider has not verified this email address');
  }

  // Already bound: this account belongs to this subject, whatever its email
  // says today.
  const bound = db.prepare(
    'SELECT id, email, display_name, role FROM users WHERE oidc_iss = ? AND oidc_sub = ?'
  ).get(iss, sub);
  if (bound) return { user: bound, created: false };

  const existing = db.prepare(
    'SELECT id, email, display_name, role, oidc_sub FROM users WHERE email = ? COLLATE NOCASE'
  ).get(email);
  if (existing) {
    // The address is spoken for by a different SSO identity — never hand the
    // account over on an email match.
    if (existing.oidc_sub) {
      throw new Error('This email is already linked to a different SSO identity');
    }
    // First-time link onto a pre-existing local (password) account. This is
    // the takeover step, so it needs the IdP to actually vouch for the
    // address. OIDC_ALLOW_EMAIL_LINKING=1 is the escape hatch for a trusted
    // IdP that simply omits the claim.
    if (claims.email_verified !== true && process.env.OIDC_ALLOW_EMAIL_LINKING !== '1') {
      throw new Error(
        'This email already has an account here, and your identity provider did not confirm the '
        + 'address. Sign in with your password, or ask an admin to enable SSO account linking.'
      );
    }
    db.prepare('UPDATE users SET oidc_iss = ?, oidc_sub = ? WHERE id = ?').run(iss, sub, existing.id);
    delete existing.oidc_sub;
    return { user: existing, created: false };
  }

  if (process.env.OIDC_AUTO_PROVISION === '0') {
    throw new Error('No account for this email — ask an admin to create one');
  }
  // Mirror /register's bootstrap rule: the very first user of a fresh install
  // becomes the admin, later arrivals get the configured (non-admin) role.
  // Never in cloud, where 'admin' is the platform operator's role and the
  // first person through an SSO login is just a customer.
  const isFirst = process.env.OPENREPORT_CLOUD !== '1'
    && db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
  const configured = process.env.OIDC_DEFAULT_ROLE === 'editor' ? 'editor' : 'viewer';
  const role = isFirst ? 'admin' : configured;
  const id = uuidv4();
  const displayName = String(claims.name || claims.preferred_username || email.split('@')[0]).slice(0, 120);
  // Random unusable password: the IdP is the only way into this account.
  const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, display_name, role, email_verified, oidc_iss, oidc_sub)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, email, passwordHash, displayName, role, iss, sub);
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
