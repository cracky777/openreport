/**
 * Signed embed tokens — the grant behind /embed/<reportId>?token=…
 *
 * A token binds THREE things together, server-signed so none can be tampered
 * with by the page that carries it:
 *   - reportId       the single report it opens (nothing else becomes listable
 *                    or reachable — model access flows only through that report)
 *   - identity       email and/or group names fed to RLS exactly like a logged-in
 *                    viewer's; empty identity + RLS rules ⇒ deny-all, and an
 *                    embed principal is NEVER owner/admin so it can't bypass RLS
 *   - lockedFilters  filter rules appended server-side to every /query — the
 *                    host page can't peel them off by editing its own requests
 *
 * Minting requires WRITE access to the report's model (same bar as flipping a
 * report public: whoever owns the data decides it leaves the org).
 *
 * Secret: EMBED_TOKEN_SECRET, falling back to INTERNAL_TOKEN_SECRET so
 * existing deploys get embeds without new configuration. Distinct scope keeps
 * the two token families from ever validating for each other.
 */
const jwt = require('jsonwebtoken');

const HEADER = 'x-embed-token';
const SCOPE = 'embed';
const DEFAULT_TTL_SECONDS = 60 * 60;            // 1 h
// A year was long enough that a token leaked in a browser history, an iframe
// src or a proxy log stayed usable well past the relationship it was issued
// for. 90 days still covers a durable partner embed, and every token is
// revocable (below) regardless of its expiry.
const MAX_TTL_SECONDS = 90 * 24 * 60 * 60;

function resolveSecret() {
  return process.env.EMBED_TOKEN_SECRET || process.env.INTERNAL_TOKEN_SECRET;
}

function sign({ reportId, email, groups, lockedFilters, expiresIn, jti }) {
  if (!reportId) throw new Error('reportId is required');
  const ttl = Math.min(Math.max(parseInt(expiresIn, 10) || DEFAULT_TTL_SECONDS, 60), MAX_TTL_SECONDS);
  // `jti` names the token so it can be revoked before it expires — a signed
  // bearer string handed to a third party is otherwise valid until the day it
  // lapses, whatever happens to the relationship in between.
  const payload = { scope: SCOPE, reportId };
  if (jti) payload.jti = String(jti);
  if (email) payload.email = String(email).trim().toLowerCase();
  if (Array.isArray(groups) && groups.length) payload.groups = groups.map(String);
  if (Array.isArray(lockedFilters) && lockedFilters.length) payload.lockedFilters = lockedFilters;
  return jwt.sign(payload, resolveSecret(), { expiresIn: ttl });
}

function verify(token) {
  try {
    const payload = jwt.verify(token, resolveSecret());
    if (payload.scope !== SCOPE || !payload.reportId) return null;
    if (payload.jti && isRevoked(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Revocations are recorded per token id. A token minted before this existed has
// no jti and can't be named individually — those still stop at their expiry,
// and revokeAllForReport covers them by refusing everything issued earlier.
function isRevoked(jti) {
  try {
    const db = require('../db');
    const row = db.prepare('SELECT revoked_at FROM embed_tokens WHERE jti = ?').get(String(jti));
    return !!(row && row.revoked_at);
  } catch {
    return false; // a storage failure must not lock out every live embed
  }
}

// Router-level middleware: a valid token materialises req.embedPrincipal for
// the downstream access checks (canAccessReport) and the /query identity.
// Invalid/expired tokens leave the request anonymous — the regular checks
// then 403 exactly like a missing token, no special error path to probe.
function middleware(req, _res, next) {
  const token = req.headers[HEADER];
  if (token && !req.embedPrincipal) {
    const payload = verify(token);
    if (payload) {
      req.embedPrincipal = {
        reportId: payload.reportId,
        email: payload.email || '',
        groups: payload.groups || [],
        lockedFilters: payload.lockedFilters || [],
      };
    }
  }
  next();
}

module.exports = { HEADER, SCOPE, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS, sign, verify, middleware };
