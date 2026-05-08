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

// Mirror of the session-store fallback in server/index.js — dev installs
// without a .env still get a working internal token (sessions wouldn't
// fail there either). In production the operator is expected to set
// SESSION_SECRET; if they forget, the dev fallback is used and the
// token-signed traffic is still self-consistent on a single instance.
function getSecret() {
  return process.env.SESSION_SECRET || 'dev-secret-change-me';
}

function sign({ userId }) {
  return jwt.sign({ userId, scope: SCOPE }, getSecret(), { expiresIn: TTL_SECONDS });
}

function verify(token) {
  try {
    const payload = jwt.verify(token, getSecret());
    if (payload.scope !== SCOPE) return null;
    if (!payload.userId) return null;
    return payload;
  } catch {
    return null;
  }
}

// Express middleware. Mounted before the protected routes — when a valid
// internal token is present, we patch req.user / req.isAuthenticated so
// downstream `requireAuth` accepts the request as that user.
function middleware(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  const token = req.headers[HEADER];
  if (!token) return next();
  const payload = verify(token);
  if (!payload) return next();
  const user = db.prepare(
    'SELECT id, email, display_name, role FROM users WHERE id = ?'
  ).get(payload.userId);
  if (!user) return next();
  req.user = user;
  req.isAuthenticated = () => true;
  next();
}

module.exports = { HEADER, SCOPE, sign, verify, middleware };
