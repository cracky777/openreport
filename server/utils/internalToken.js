/**
 * Short-lived JWT for in-process callers that need to issue authenticated
 * HTTP requests against this same server (e.g. the cache warmer firing
 * `/api/models/:id/query` on behalf of a schedule's owner).
 *
 * Single scope today: `cache_warm`. Add more if other callers appear.
 *
 * NEVER use these tokens for human auth — they bypass passport/session
 * on the basis of a header value. The scope check is the safety net.
 *
 * The cloud edition has its own `renderToken` for Puppeteer renders;
 * keeping a separate token here means the OSS scheduler doesn't need to
 * pull cloud-only deps and the two scopes don't accidentally cross.
 */

const jwt = require('jsonwebtoken');
const db = require('../db');

const HEADER = 'x-or-internal-token';
const SCOPE = 'cache_warm';
const TTL_SECONDS = 5 * 60; // a warm pass shouldn't take longer than a few seconds; 5 min is plenty of headroom

// Dedicated secret, distinct from SESSION_SECRET so a leak of one can't forge
// the other. Mandatory in every environment: these tokens bypass passport (on a
// loopback-only basis), so we refuse to boot rather than run on a guessable or
// shared value. Generate with: openssl rand -hex 32.
function resolveSecret() {
  const secret = process.env.INTERNAL_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    console.error('[startup] FATAL: INTERNAL_TOKEN_SECRET must be set to a strong value (>= 16 chars). Generate one with: openssl rand -hex 32');
    process.exit(1);
  }
  if (secret === process.env.SESSION_SECRET) {
    console.error('[startup] FATAL: INTERNAL_TOKEN_SECRET must differ from SESSION_SECRET.');
    process.exit(1);
  }
  return secret;
}
const SECRET = resolveSecret();

// A genuine in-process caller connects straight to the app socket on localhost.
// Requests proxied in from nginx/Caddy also arrive on loopback but carry
// X-Forwarded-* — treat those as external so a public request can never ride
// the internal token.
function isLoopbackRequest(req) {
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) return false;
  const ip = req.socket && req.socket.remoteAddress;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// `organizationId` is optional and ignored in OSS — it's only meaningful
// in cloud where the activeOrg middleware respects a pre-set context. The
// cache warmer reads the report's organization_id and stamps it here so
// the internal HTTP request lands in the right tenant; without this, the
// activeOrg middleware would default to the user's personal org and
// `canAccessModel` would 404 a model that lives in a team org.
function sign({ userId, organizationId }) {
  const payload = { userId, scope: SCOPE };
  if (organizationId) payload.organizationId = organizationId;
  return jwt.sign(payload, SECRET, { expiresIn: TTL_SECONDS });
}

function verify(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.scope !== SCOPE) return null;
    if (!payload.userId) return null;
    return payload;
  } catch {
    return null;
  }
}

// Express middleware. Mounted before the protected routes — when a valid
// internal token is present, we patch req.user / req.isAuthenticated so
// downstream `requireAuth` accepts the request as that user. If the token
// also carries an organizationId, we pre-set req.organizationId so the
// cloud activeOrg middleware preserves it (it has an early return when
// the field is already populated, mirroring the renderToken pattern).
function middleware(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  const token = req.headers[HEADER];
  if (!token) return next();
  // Only in-process loopback callers may present this token.
  if (!isLoopbackRequest(req)) return next();
  const payload = verify(token);
  if (!payload) return next();
  const user = db.prepare(
    'SELECT id, email, display_name, role FROM users WHERE id = ?'
  ).get(payload.userId);
  if (!user) return next();
  req.user = user;
  req.isAuthenticated = () => true;
  if (payload.organizationId) req.organizationId = payload.organizationId;
  next();
}

module.exports = { HEADER, SCOPE, sign, verify, middleware };
