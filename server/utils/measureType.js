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

// ─── Phase 3: non-additive measure decomposition ────────────────────────
// AVG, ratios of additive measures, etc. can't be re-aggregated in-memory
// from already-aggregated values, but they CAN be re-aggregated from their
// underlying additive components. `decomposeMeasure` returns a spec that
// tells the warmer + aggregate runtime what to store and how to recompose
// the final value at drill / cross-filter time.

// Ratio patterns recognised in `aggregation: 'custom'` measures. All three
// produce `{ numRef, denRef, hasGuard }` — the denominator's div-by-zero
// guard is dropped at recompose time (we apply it ourselves in
// inMemoryAgg).
//
// Pattern 1: ${A} / ${B}
// Pattern 2: ${A} / NULLIF(${B}, 0)
// Pattern 3: ${A} / CASE WHEN ${B} = 0 THEN <anything> ELSE ${B} END
const REF = '[A-Za-z0-9_.$\\-]+';
const RATIO_PATTERNS = [
  { hasGuard: false, re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*\\$\\{(${REF})\\}\\s*$`) },
  { hasGuard: true, re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*NULLIF\\s*\\(\\s*\\$\\{(${REF})\\}\\s*,\\s*0\\s*\\)\\s*$`, 'i') },
  { hasGuard: true, re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*CASE\\s+WHEN\\s+\\$\\{(${REF})\\}\\s*=\\s*0\\s+THEN\\s+[^\\s]+\\s+ELSE\\s+\\$\\{(${REF})\\}\\s+END\\s*$`, 'i') },
];

function detectRatio(expression) {
  if (!expression || typeof expression !== 'string') return null;
  for (const { hasGuard, re } of RATIO_PATTERNS) {
    const m = expression.match(re);
    if (!m) continue;
    const numRef = m[1];
    const denRef = m[2];
    // Pattern 3 has a backref-style third capture — both denominator refs
    // must point to the same measure for the recompose to be valid.
    if (m[3] && m[3] !== denRef) return null;
    return { numRef, denRef, hasGuard };
  }
  return null;
}

// Resolve a `${name}` ref to its measure object in the model + report
// extras pool. Used during decomposition to walk ratio chains.
function findMeasureByName(name, allMeasures) {
  if (!Array.isArray(allMeasures)) return null;
  return allMeasures.find((m) => m && m.name === name) || null;
}

// Returns a decomposition spec describing how to store + recompose a
// measure in the pre-agg cache, or `null` if non-decomposable (the visual
// then falls back to the SQL-keyed cache or the DB).
//
// Spec shape:
//   { type: 'simple', innerType: 'sum'|'count'|'min'|'max' }
//     — fire the measure as-is at warm; aggregate combines with `innerType`.
//
//   { type: 'avg', column, table }
//     — fire SUM(col) + COUNT(col) at warm under synthetic aliases;
//       aggregate divides totals.
//
//   { type: 'ratio', numRef, denRef, hasGuard, numSpec, denSpec }
//     — both refs must themselves be decomposable (recursively).
//       At warm, store the underlying simples; at recompose, sum num + den
//       and divide.
function decomposeMeasure(measure, allMeasures) {
  if (!measure) return null;
  const simple = additiveTypeForMeasure(measure);
  if (simple) return { type: 'simple', innerType: simple };
  // AVG decomposes to SUM + COUNT of the same column. Trivial expressions
  // like `aggregation: 'custom'` with `AVG(col)` aren't recognised here —
  // users should use `aggregation: 'avg'` in the model for those.
  if (measure.aggregation === 'avg' && measure.column) {
    return { type: 'avg', column: measure.column, table: measure.table || '' };
  }
  // Ratio of two additive (or recursively decomposable) measures.
  if (measure.aggregation === 'custom') {
    const ratio = detectRatio(measure.expression);
    if (!ratio) return null;
    const numMeasure = findMeasureByName(ratio.numRef, allMeasures);
    const denMeasure = findMeasureByName(ratio.denRef, allMeasures);
    if (!numMeasure || !denMeasure) return null;
    const numSpec = decomposeMeasure(numMeasure, allMeasures);
    const denSpec = decomposeMeasure(denMeasure, allMeasures);
    if (!numSpec || !denSpec) return null;
    return {
      type: 'ratio',
      numRef: ratio.numRef,
      denRef: ratio.denRef,
      hasGuard: ratio.hasGuard,
      numSpec,
      denSpec,
    };
  }
  return null;
}

// Collect the set of base measures (by name) that need to actually be
// fired by the warmer's SQL so the pre-agg dataset has the raw components
// it needs to recompose every visual measure at runtime.
//
// Returns:
//   { baseMeasureNames: [...names from the model],
//     syntheticMeasures: [{ alias, column, table, type: 'sum'|'count' }] }
//
// `baseMeasureNames` get sent verbatim to /query (they exist in the model
// + report extras). `syntheticMeasures` need to be injected as inline
// extraMeasures because they're decompositions of AVG that don't have a
// named definition (e.g. SUM(amount) component of AVG(amount)).
function collectComponentsForVisual(specs) {
  const baseNames = new Set();
  const synthetic = [];
  const visit = (spec) => {
    if (!spec) return;
    if (spec.type === 'simple') return; // handled by the visual measure itself, fired normally
    if (spec.type === 'avg') {
      const aliasBase = `_avg_${spec.table || ''}_${spec.column}`.replace(/[^A-Za-z0-9_]/g, '_');
      synthetic.push({ alias: `${aliasBase}_sum`, column: spec.column, table: spec.table, kind: 'sum' });
      synthetic.push({ alias: `${aliasBase}_count`, column: spec.column, table: spec.table, kind: 'count' });
      return;
    }
    if (spec.type === 'ratio') {
      // The ratio's components are named measures in the model — the
      // warmer should fire them directly. Recurse in case a component is
      // itself decomposable (rare but possible).
      if (spec.numSpec.type === 'simple') baseNames.add(spec.numRef);
      else visit(spec.numSpec);
      if (spec.denSpec.type === 'simple') baseNames.add(spec.denRef);
      else visit(spec.denSpec);
    }
  };
  for (const s of specs) visit(s);
  return { baseMeasureNames: [...baseNames], syntheticMeasures: synthetic };
}

module.exports = {
  additiveTypeForMeasure,
  additiveTypeForAggregation,
  inferAdditiveTypeFromExpression,
  decomposeMeasure,
  detectRatio,
  collectComponentsForVisual,
};
