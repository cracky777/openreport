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
const MAX_TTL_SECONDS = 365 * 24 * 60 * 60;     // hard ceiling: a year

function resolveSecret() {
  return process.env.EMBED_TOKEN_SECRET || process.env.INTERNAL_TOKEN_SECRET;
}

function sign({ reportId, email, groups, lockedFilters, expiresIn }) {
  if (!reportId) throw new Error('reportId is required');
  const ttl = Math.min(Math.max(parseInt(expiresIn, 10) || DEFAULT_TTL_SECONDS, 60), MAX_TTL_SECONDS);
  const payload = { scope: SCOPE, reportId };
  if (email) payload.email = String(email).trim().toLowerCase();
  if (Array.isArray(groups) && groups.length) payload.groups = groups.map(String);
  if (Array.isArray(lockedFilters) && lockedFilters.length) payload.lockedFilters = lockedFilters;
  return jwt.sign(payload, resolveSecret(), { expiresIn: ttl });
}

function verify(token) {
  try {
    const payload = jwt.verify(token, resolveSecret());
    if (payload.scope !== SCOPE || !payload.reportId) return null;
    return payload;
  } catch {
    return null;
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
