/**
 * Join-keyword derivation for the FROM clause.
 *
 * Only one helper for now — but placed in its own file so the natural
 * follow-ups (snowflake-bridging BFS, greedy join picker — see the
 * `routes/models.js:1870-2004` block flagged for extraction) have an
 * obvious home.
 */

// Pick the SQL JOIN keyword for a relation based on its cardinality. The
// UI now expresses joins as cardinality (1 / * on each end) rather than a
// raw LEFT/INNER/RIGHT pill — the SQL dialect is derived here:
//   *:1 / 1:* → LEFT JOIN  (keep all rows on the "many" side, decorate with dim)
//   1:1       → INNER JOIN (no fan-out, both sides match by definition)
//   *:*       → INNER JOIN (semantically a bridge — emit something usable but
//                           the canvas should warn the user)
// Falls back to the legacy `type` field on joins that pre-date cardinality.
function deriveJoinKeyword(j) {
  const c = j && j.cardinality;
  if (c && c.from && c.to) {
    if (c.from === '1' && c.to === '1') return 'INNER';
    if (c.from === '*' && c.to === '*') return 'INNER';
    return 'LEFT';
  }
  // The model's `type` is stored verbatim from the editor's payload and lands
  // in the FROM clause unquoted — it's a keyword, not an identifier, so there
  // is nothing to quote. Whitelist it: anything else is a way to append SQL of
  // one's choosing to the join.
  const declared = String(j?.type || '').toUpperCase();
  return JOIN_KEYWORDS.has(declared) ? declared : 'LEFT';
}

const JOIN_KEYWORDS = new Set(['LEFT', 'INNER', 'RIGHT', 'FULL', 'CROSS']);

module.exports = { deriveJoinKeyword };
