/**
 * Single source of truth for "is this measure additive?" — used by the
 * pre-agg path (runtime cache lookup + warm-time eligibility).
 *
 * A measure is additive when its rows can be re-aggregated in-memory
 * after filtering: SUM, COUNT, MIN, MAX. AVG, COUNT(DISTINCT …),
 * MEDIAN, percentiles and most custom expressions are not.
 *
 * For `aggregation: 'custom'` measures we still try to recognise the
 * trivial wrappers a user typically writes — `COUNT(col)`, `SUM(col)`,
 * `MIN(col)`, `MAX(col)`, plus `COUNT(*)`. Anything richer (DISTINCT,
 * arithmetic, multiple aggregates, CASE, etc.) drops back to null and
 * the visual falls through to the SQL-keyed cache or the source DB.
 *
 * Lives in server/utils so both routes/models.js (and its cloud shadow)
 * and cacheWarmer.js (OSS + cloud) can share the exact same logic — a
 * mismatch between warm-time and runtime eligibility would silently
 * break the pre-agg cache for half the visuals.
 */

// Bare word for a column ref, with optional schema/table prefix and
// optional double / single quotes. Matches:
//   col, "col", schema.table."col", `col`, 'col', etc.
// Whitespace allowed around dots.
const COL_REF = '[\\w."\\\'`\\s]+';

const TRIVIAL_PATTERNS = [
  // COUNT(*) and COUNT(col) — the latter rejected if it's COUNT(DISTINCT …)
  { type: 'count', re: new RegExp(`^\\s*COUNT\\s*\\(\\s*\\*\\s*\\)\\s*$`, 'i') },
  { type: 'count', re: new RegExp(`^\\s*COUNT\\s*\\(\\s*${COL_REF}\\s*\\)\\s*$`, 'i') },
  { type: 'sum', re: new RegExp(`^\\s*SUM\\s*\\(\\s*${COL_REF}\\s*\\)\\s*$`, 'i') },
  { type: 'min', re: new RegExp(`^\\s*MIN\\s*\\(\\s*${COL_REF}\\s*\\)\\s*$`, 'i') },
  { type: 'max', re: new RegExp(`^\\s*MAX\\s*\\(\\s*${COL_REF}\\s*\\)\\s*$`, 'i') },
];

function inferAdditiveTypeFromExpression(expr) {
  if (!expr || typeof expr !== 'string') return null;
  const s = expr.trim();
  if (!s) return null;
  // DISTINCT inside a COUNT (or anywhere) breaks additivity — reject
  // before pattern-matching so `COUNT(DISTINCT user_id)` doesn't fall
  // through to the COUNT(col) regex with `DISTINCT user_id` as the col.
  if (/\bDISTINCT\b/i.test(s)) return null;
  for (const { type, re } of TRIVIAL_PATTERNS) {
    if (re.test(s)) return type;
  }
  return null;
}

function additiveTypeForAggregation(agg) {
  switch (agg) {
    case 'sum': return 'sum';
    case 'count': return 'count';
    case 'min': return 'min';
    case 'max': return 'max';
    default: return null;
  }
}

// Public API. Pass the model measure object — `aggregation` is the
// primary signal, with `expression` consulted only for `aggregation:
// 'custom'` to recover the additive trivial cases.
function additiveTypeForMeasure(m) {
  if (!m) return null;
  if (m.aggregation === 'custom') {
    return inferAdditiveTypeFromExpression(m.expression);
  }
  return additiveTypeForAggregation(m.aggregation);
}

module.exports = {
  additiveTypeForMeasure,
  additiveTypeForAggregation,
  inferAdditiveTypeFromExpression,
};
