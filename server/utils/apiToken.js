/**
 * API tokens — the machine-facing counterpart to the browser session.
 *
 * A token authenticates as the user who minted it, then goes through the exact
 * same per-resource authorization as a browser request (canAccessModel, RLS,
 * cloudHooks.authz). Nothing here grants access; it only answers "who is this".
 *
 * Deliberately narrow: `middleware` is mounted on the /api/v1 router ONLY, so a
 * token can never reach an undocumented endpoint. Widening a token's reach is
 * then a matter of adding a route to v1 on purpose, not of forgetting that a
 * new route inherited token access by default.
 *
 * The internal loopback token (utils/internalToken.js) is a different thing:
 * one hardcoded scope, refused unless the caller is on localhost.
 */

const crypto = require('crypto');
const db = require('../db');
const { isApiEnabled, canUseApi } = require('./settingsHelper');

const PREFIX = 'orp_';
// read: list models and reports. refresh: rebuild a model's rollups.
// Deliberately no `write` scope — editing a model means feeding SQL to the
// compiler, which is the most sensitive surface in the app. Adding one is a
// decision to take on its own, not a default.
const SCOPES = ['read', 'refresh'];

// A token is 32 random bytes; the stored digest is what a lookup matches on.
function hash(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function generate() {
  return PREFIX + crypto.randomBytes(32).toString('base64url');
}

function parseScopes(raw) {
  const wanted = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = wanted.filter((s) => !SCOPES.includes(s));
  if (bad.length) return { error: `Unknown scope(s): ${bad.join(', ')}` };
  if (!wanted.length) return { error: 'At least one scope is required' };
  return { scopes: [...new Set(wanted)] };
}

/**
 * Mint a token for `userId`. Returns the clear-text token exactly once — it is
 * never recoverable afterwards, only revocable.
 */
function create({ userId, name, scopes, expiresAt }) {
  const token = generate();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO api_tokens (id, user_id, name, token_hash, token_hint, scopes, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, hash(token), token.slice(-4), scopes.join(','), expiresAt || null);
  return { id, token };
}

function listForUser(userId) {
  return db.prepare(`
    SELECT id, name, token_hint, scopes, created_at, last_used_at, expires_at, revoked_at
    FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
}

// Every token on the instance, for the admin who owns the switch that governs
// them — "who is automating what, and which of these is dormant". Deliberately
// read-and-revoke: there is no admin path to MINT a token for someone else,
// because that would forge an identity the admin does not hold and quietly
// break the audit trail.
function listAll() {
  return db.prepare(`
    SELECT t.id, t.name, t.token_hint, t.scopes, t.created_at, t.last_used_at,
           t.expires_at, t.revoked_at, t.user_id,
           u.email AS owner_email, u.display_name AS owner_name, u.role AS owner_role
    FROM api_tokens t
    LEFT JOIN users u ON u.id = t.user_id
    ORDER BY t.last_used_at IS NULL, t.last_used_at DESC, t.created_at DESC
  `).all();
}

// Admin revocation: any token, whoever holds it. Used to cut one integration
// without switching the whole API off or demoting its owner.
function revokeAny(id) {
  return db.prepare(`
    UPDATE api_tokens SET revoked_at = datetime('now')
    WHERE id = ? AND revoked_at IS NULL
  `).run(id).changes > 0;
}

function revoke({ id, userId }) {
  return db.prepare(`
    UPDATE api_tokens SET revoked_at = datetime('now')
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `).run(id, userId).changes > 0;
}

function bearerFrom(req) {
  const header = req.headers.authorization || '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1] : null;
}

// last_used_at is for humans auditing a token, not for accounting — writing it
// on every call would put a disk write in front of every API request. A minute
// of granularity tells you just as much.
const LAST_USED_THROTTLE_MS = 60 * 1000;
function touch(row) {
  const last = row.last_used_at ? new Date(row.last_used_at + 'Z').getTime() : 0;
  if (Date.now() - last < LAST_USED_THROTTLE_MS) return;
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
}

/**
 * Express middleware. A live session always wins — a browser hitting /api/v1
 * keeps its full session rights and is never downgraded to token scopes.
 */
function middleware(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  const token = bearerFrom(req);
  if (!token) return next();
  // Instance kill switch. Checked before the token is even looked up, so
  // turning the API off stops every token at once — nothing to revoke.
  if (!isApiEnabled()) return res.status(503).json({ error: 'The API is disabled on this instance' });

  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hash(token));
  if (!row) return res.status(401).json({ error: 'Invalid API token' });
  if (row.revoked_at) return res.status(401).json({ error: 'API token revoked' });
  if (row.expires_at && new Date(row.expires_at + 'Z') < new Date()) {
    return res.status(401).json({ error: 'API token expired' });
  }

  const user = db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(row.user_id);
  if (!user) return res.status(401).json({ error: 'API token owner no longer exists' });
  // Re-checked on every call rather than trusted from mint time: demoting a
  // user has to kill the tokens they already hold, with nothing to remember.
  if (!canUseApi(user)) return res.status(403).json({ error: 'API access is not allowed for this account' });

  touch(row);
  req.user = user;
  req.isAuthenticated = () => true;
  req.apiTokenScopes = row.scopes.split(',');
  next();
}

/**
 * Gate one route on a scope. A session request carries no scopes and passes —
 * the browser is already limited by the user's own role and resource access.
 */
function requireScope(scope) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!req.apiTokenScopes) return next();
    if (!req.apiTokenScopes.includes(scope)) {
      return res.status(403).json({ error: `API token is missing the '${scope}' scope` });
    }
    next();
  };
}

module.exports = { SCOPES, PREFIX, middleware, requireScope, create, listForUser, listAll, revoke, revokeAny, parseScopes, hash };
