/**
 * Row-Level Security helpers.
 *
 * RLS rules live on the model row as a JSON blob:
 *   { enabled, table, primaryKey, rules: { <rowKey>: ["email-pattern", ...] } }
 *
 * - `table` is the RLS-bearing table (must connect to every queried table
 *   via the join graph — `tablesReachableFrom` checks this server-side
 *   before letting the query run).
 * - `rules` is a dict from row-key (a value of `primaryKey`) → list of
 *   patterns. A pattern can be a literal email, a glob with `*` wildcards,
 *   `*` to match any authenticated user, or `group:<name>` to grant the
 *   key to every member of that group (membership resolved by the caller —
 *   this module stays pure and never touches the database).
 *
 * `getAllowedRlsKeys(rls, email, groupNames)` returns the row-key values
 * the requester is allowed to see — the live-query path then folds these
 * into the WHERE as `<rls-table>.<primaryKey> IN (<keys>)`.
 */

// Compute the set of tables reachable from a starting table via the join graph.
// Used to verify the RLS table can constrain every queried table — otherwise an
// unconnected table would slip through via cross join.
function tablesReachableFrom(startTable, joins) {
  const reachable = new Set([startTable]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of joins || []) {
      if (reachable.has(j.from_table) && !reachable.has(j.to_table)) { reachable.add(j.to_table); changed = true; }
      if (reachable.has(j.to_table) && !reachable.has(j.from_table)) { reachable.add(j.from_table); changed = true; }
    }
  }
  return reachable;
}

// Convert a glob-style pattern (with * as wildcard) to a case-insensitive RegExp.
// Examples:
//   "alice@openreport.io"   → matches that exact email
//   "*@openreport.io"       → any email in the openreport.io domain
//   "alice*"                → emails starting with "alice"
//   "*admin*"               → emails containing "admin"
//   "*"                     → matches any authenticated user
const regexCache = new Map();
function patternToRegex(pattern) {
  const key = String(pattern);
  let re = regexCache.get(key);
  if (!re) {
    const escaped = key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    re = new RegExp(`^${escaped}$`, 'i');
    regexCache.set(key, re);
  }
  return re;
}

function emailMatchesPattern(email, pattern) {
  if (!pattern) return false;
  try { return patternToRegex(pattern).test(email || ''); } catch { return false; }
}

// One rule pattern against one requester. `group:<name>` compares the name
// (case-insensitive, exact) against the requester's group memberships; an
// empty name after the prefix matches nothing. Everything else goes through
// the email matcher — so `group:` never falls back to being read as an
// email glob, which would silently grant nothing-or-everything on a typo.
function patternMatchesPrincipal(pattern, email, groupNames) {
  const p = String(pattern || '');
  if (/^group:/i.test(p)) {
    const want = p.slice(6).trim().toLowerCase();
    if (!want) return false;
    return (groupNames || []).some((g) => String(g).toLowerCase() === want);
  }
  return emailMatchesPattern(email, p);
}

// Given an rls config { enabled, table, primaryKey, rules: { rowKey: [patterns...] } }
// return the list of allowed row-key values for a given requester (email +
// group memberships), or null if RLS is not active on the config.
function getAllowedRlsKeys(rls, email, groupNames = []) {
  if (!rls || !rls.enabled || !rls.rules) return null;
  const allowed = [];
  for (const [rowKey, patterns] of Object.entries(rls.rules)) {
    if (!Array.isArray(patterns)) continue;
    if (patterns.some((p) => patternMatchesPrincipal(p, email, groupNames))) {
      allowed.push(rowKey);
    }
  }
  return allowed;
}

module.exports = {
  tablesReachableFrom,
  patternToRegex,
  emailMatchesPattern,
  patternMatchesPrincipal,
  getAllowedRlsKeys,
};
