/**
 * Server-side mirror of `client/src/utils/reportFilterRules.js`. Same
 * contract — used by the cache warmer to build per-widget widgetFilters
 * the same way the client does, so the preAggCache shape key matches
 * byte-for-byte between warm and runtime.
 *
 * Kept as a duplicate (rather than imported) because OSS doesn't share a
 * common module between `client/` and `server/`. The two files MUST stay
 * in lockstep — if you change one, change the other.
 */
function prepareGlobalRulesForWidget(rules, widgetId) {
  if (!Array.isArray(rules)) return [];
  const out = [];
  for (const r of rules) {
    if (!r) continue;
    if (Array.isArray(r.exclusions) && r.exclusions.includes(widgetId)) continue;
    const { exclusions: _exclusions, ...rest } = r;
    out.push(rest);
  }
  return out;
}

module.exports = { prepareGlobalRulesForWidget };
