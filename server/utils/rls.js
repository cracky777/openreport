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
 *   email patterns. A pattern can be a literal email, a glob with `*`
 *   wildcards, or `*` to match any authenticated user.
 *
 * `getAllowedRlsKeys(rls, email)` returns the row-key values the requester
 * is allowed to see — the live-query path then folds these into the WHERE
 * as `<rls-table>.<primaryKey> IN (<keys>)`.
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

// Given an rls config { enabled, table, primaryKey, rules: { rowKey: [patterns...] } }
// return the list of allowed row-key values for a given user email, or null if no rule matched.
function getAllowedRlsKeys(rls, email) {
  if (!rls || !rls.enabled || !rls.rules) return null;
  const allowed = [];
  for (const [rowKey, patterns] of Object.entries(rls.rules)) {
    if (!Array.isArray(patterns)) continue;
    if (patterns.some((p) => emailMatchesPattern(email, p))) {
      allowed.push(rowKey);
    }
  }
  return allowed;
}

module.exports = {
  tablesReachableFrom,
  patternToRegex,
  emailMatchesPattern,
  getAllowedRlsKeys,
};
