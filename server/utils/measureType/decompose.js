/* Measure decomposition into rollup atoms + stable atom aliasing.
 * Part of the measureType decomposition engine — see ./index.js for the
 * module-level contract. Split out of the former single-file measureType.js
 * (pure relocation, no logic change). ROLLUP-CACHE.md §6 documents the math.
 */

const crypto = require('crypto');
const {
  additiveTypeForMeasure,
  detectTrivialAggregate,
  detectRatio,
  detectCountDistinct,
  findMeasureByName,
} = require('./detect');
const { extractRefs, compileExpression, EXPR_REF_PATTERN } = require('./exprParse');

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
  const simple = additiveTypeForMeasure(measure, allMeasures);
  if (simple) return { type: 'simple', innerType: simple };
  // AVG decomposes to SUM + COUNT of the same column.
  if (measure.aggregation === 'avg' && measure.column) {
    // Carry dataType so the synthetic SUM component gets the SAME
    // interval→EXTRACT(EPOCH) treatment models.js applies to a normal
    // measure on an INTERVAL column. Without it the numerator is
    // SUM(interval) → not coercible to a number → atom stored NULL →
    // AVG broken.
    return { type: 'avg', column: measure.column, table: measure.table || '', dataType: measure.dataType };
  }
  // Custom-mode trivial single-aggregate fast path. A user who writes
  // `AVG("schema"."table"."col")` or `SUM("table"."col")` in custom mode
  // wanted the equivalent of the structured aggregation, but the rest of
  // the decomposer used to bail to decomposeAsExpression (which needs
  // `${ref}` placeholders) → spec=null → rollup MISS → every fetch goes
  // live. Detect the pattern here and re-enter as the equivalent
  // structured measure so the AVG/SUM/MIN/MAX decomposition kicks in.
  // COUNT(*) is treated like aggregation:'count' (COUNT(*) at SQL time);
  // COUNT(col) is NOT promoted — the structured 'count' path emits
  // COUNT(*), changing the semantic the user wrote.
  if (measure.aggregation === 'custom') {
    const triv = detectTrivialAggregate(measure.expression);
    if (triv) {
      // Re-enter with a virtual structured measure carrying the same
      // identity (name/label/dataType) so the recursive call lands on
      // the structured path above (simple / avg). NOT cached — the
      // re-entry is cheap and avoids mutating the stored measure.
      const virtual = {
        ...measure,
        aggregation: triv.agg,
        table: triv.table || measure.table,
        column: triv.column,
      };
      const spec = decomposeMeasure(virtual, allMeasures);
      if (spec) return spec;
    }
  }
  // Ratio of two additive (or recursively decomposable) measures.
  if (measure.aggregation === 'custom') {
    // Fast path: recognise the ratio pattern (numRef / denRef [* scale])
    // and store explicit num/den keys + scale + hasGuard so the runtime
    // doesn't have to compile a JS expression for these very common
    // shapes. Falls through to the general expression decomposer below
    // if the pattern doesn't match.
    const ratio = detectRatio(measure.expression);
    if (ratio) {
      const numMeasure = findMeasureByName(ratio.numRef, allMeasures);
      const denMeasure = findMeasureByName(ratio.denRef, allMeasures);
      if (numMeasure && denMeasure) {
        const numSpec = decomposeMeasure(numMeasure, allMeasures);
        const denSpec = decomposeMeasure(denMeasure, allMeasures);
        if (numSpec && denSpec) {
          return {
            type: 'ratio',
            numRef: ratio.numRef,
            denRef: ratio.denRef,
            guard: ratio.guard,
            guardThen: ratio.guardThen,
            hasGuard: ratio.hasGuard,
            scale: ratio.scale,
            numSpec,
            denSpec,
          };
        }
      }
    }
    // COUNT(DISTINCT col) — non-additive in the classic sense, but
    // re-aggregatable across partitions via mergeable HyperLogLog
    // sketches. Decompose only if the expression is a clean
    // `COUNT(DISTINCT "tbl"."col")`; arithmetic / wrappers around it
    // fall through to decomposeAsExpression (which rejects DISTINCT
    // refs anywhere) → live SQL keeps doing the exact count.
    //
    // Whether HLL is actually USED for the recognition is decided at
    // the plan layer: `componentPlanForMeasures({hllReady})` reads
    // `isHllReady(db)` on the destination DuckDB and marks distinct
    // outputs `supported:false` when the DataSketches extension
    // failed to load (air-gapped install, repo unreachable, …). The
    // spec itself stays recognised; only the materialisation is
    // gated. Three layers of defence — extension load is a no-op on
    // failure, plan opts mark the output, the build path try/catches
    // the staging→rollup transition — so a recognised spec on a host
    // without the extension is always safe.
    const distinct = detectCountDistinct(measure.expression);
    if (distinct) {
      return {
        type: 'distinct',
        kind: 'hll',
        column: distinct.column,
        table: distinct.table,
        lgK: 12,
      };
    }
    // General path: any custom expression whose ${refs} are all simple
    // additive measures can be re-evaluated at any grain from their
    // component sums. Handles arbitrary math (COS, LOG, division,
    // CASE, …) — see transpileSqlToJs for the supported SQL subset.
    return decomposeAsExpression(measure, allMeasures);
  }
  return null;
}

// Build an expression spec from a custom measure whose `${refs}` are all
// simple additive measures. Returns null when:
//   - the measure isn't `aggregation: 'custom'` with a string expression
//   - no `${ref}` placeholders are present (purely-constant expression
//     can't be re-grouped meaningfully — fire it through SQL instead)
//   - any ref resolves to a non-simple measure (ratio of ratios, AVG,
//     COUNT DISTINCT, etc.) — we'd need nested recomposition which the
//     current bucket evaluator doesn't do
//   - the expression doesn't transpile cleanly (unknown function,
//     suspicious identifier, etc.)
function decomposeAsExpression(measure, allMeasures) {
  if (!measure || measure.aggregation !== 'custom') return null;
  const expression = measure.expression;
  if (!expression || typeof expression !== 'string') return null;
  const refNames = extractRefs(expression);
  if (refNames.length === 0) return null;
  // Phase A+B widening (2026-05): the previous gate refused EVERY
  // function call except NULLIF. The transpiler is now the single
  // source of truth on what's safely re-evaluable at the rollup grain
  // — its step-11 bare-identifier scan rejects any unknown name (so a
  // typo / a non-whitelisted SQL function still falls back to live).
  // Applying `f(ΣA, ΣB, …)` at the group grain is mathematically exact
  // for every f in the math whitelist (pure of additive sums), so we
  // let the transpiler decide; the gate here only fast-fails when an
  // obviously unknown function name appears in the expression, to
  // produce a planner `MISS: non-decomposable:<measure>` early instead
  // of compiling-then-throwing at recompose time.
  {
    const ALLOWED_FUNCS = new Set([
      // Transpiler-rewritten by name (handled before SQL_TO_JS_FUNCS):
      'CAST', 'NULLIF', 'COALESCE', 'IFNULL', 'IF', 'MOD', 'ROUND',
      // Pure math whitelist (SQL_TO_JS_FUNCS keys), evaluated on the
      // additive sums at the requested grain:
      'ABS', 'SIGN', 'SQRT', 'EXP', 'LN', 'LOG', 'LOG2', 'LOG10',
      'POW', 'POWER', 'FLOOR', 'CEIL', 'CEILING', 'TRUNC',
      'COS', 'SIN', 'TAN', 'ACOS', 'ASIN', 'ATAN', 'ATAN2',
      'COSH', 'SINH', 'TANH',
      'GREATEST', 'LEAST',
    ]);
    let scan = String(expression);
    let prev;
    do { prev = scan; scan = scan.replace(/CAST\s*\(/gi, '('); } while (scan !== prev);
    scan = scan.replace(EXPR_REF_PATTERN, '_R_');
    const callRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let m;
    while ((m = callRe.exec(scan)) !== null) {
      if (!ALLOWED_FUNCS.has(m[1].toUpperCase())) return null;
    }
  }
  const refs = [];
  for (const name of refNames) {
    const compM = findMeasureByName(name, allMeasures);
    if (!compM) return null;
    // Fast path: simple additive ref (SUM/COUNT/MIN/MAX, or a custom
    // expression that reduces to a single additive). One atom per ref.
    const innerType = additiveTypeForMeasure(compM, allMeasures);
    if (innerType) {
      refs.push({ name, innerType });
      continue;
    }
    // Phase C (2026-05-20): a ref can also be a fully-decomposable
    // AVG or ratio measure. We carry the nested spec; at recompose
    // time the wrapper recurses (sum_for_avg / count_for_avg, or
    // num/den + guard) and feeds the resolved scalar into _v before
    // calling the compiled fn. Mathematically exact at any grain —
    // the wrapping function f(AVG(a), SUM(b)) operates on numbers
    // once AVG is resolved, and AVG is itself reconstructable from
    // its component atoms at the requested grain. Other spec types
    // (a custom expression as a nested ref, DISTINCT, …) are still
    // rejected here — keeps recursion depth bounded and avoids
    // accidental cycles via co-referencing custom expressions.
    const nested = decomposeMeasure(compM, allMeasures);
    if (!nested) return null;
    if (nested.type !== 'avg' && nested.type !== 'ratio') return null;
    refs.push({ name, innerType: 'nested', spec: nested });
  }
  // Compile up-front to validate the expression; the compiled function is
  // cached in _exprCache by raw string so the runtime gets it for free.
  const fn = compileExpression(expression);
  if (!fn) return null;
  return { type: 'expression', refs, rawExpression: expression };
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
      const aliasBase = avgAliasBase(spec);
      synthetic.push({ alias: `${aliasBase}_sum`, column: spec.column, table: spec.table, kind: 'sum', dataType: spec.dataType });
      // Denominator MUST be COUNT(<column>) — count of NON-NULL values —
      // so AVG = SUM(x)/COUNT(x) matches SQL AVG semantics (NULLs skipped
      // by both SUM and COUNT). Plain `count` is COUNT(*) in models.js
      // (counts NULL-x rows too) → would understate the average whenever
      // the averaged column has NULLs. `count_col` is a dedicated kind
      // handled as COUNT(col) and never used by user `count` measures.
      synthetic.push({ alias: `${aliasBase}_count`, column: spec.column, table: spec.table, kind: 'count_col', dataType: spec.dataType });
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
      return;
    }
    if (spec.type === 'distinct') {
      // One mergeable HyperLogLog sketch column per (table, column, lgK).
      // The builder fires `datasketch_hll(lgK, col)` over the deduped
      // (grain ∪ col) tuples it pulled from the source; the planner emits
      // `datasketch_hll_estimate(datasketch_hll_union(lgK, sketch))` to
      // get the approximate cardinality at any requested grain.
      const aliasBase = hllAliasBase(spec);
      synthetic.push({
        alias: aliasBase,
        column: spec.column,
        table: spec.table,
        kind: 'hll',
        lgK: spec.lgK || 12,
      });
      return;
    }
    if (spec.type === 'expression') {
      // Each ref is either a simple additive (one atom in the model)
      // or a Phase C nested decomposition (avg / ratio — its own
      // synthetic / base components, collected by recursing).
      for (const r of spec.refs) {
        if (r.spec) visit(r.spec);
        else baseNames.add(r.name);
      }
    }
  };
  for (const s of specs) visit(s);
  return { baseMeasureNames: [...baseNames], syntheticMeasures: synthetic };
}

// ─── Rollup component planning + runtime recompose ──────────────────────
// Used by the rollup builder (what additive component columns to
// materialise) and the rollup planner (how to recombine them at any
// grain). This is the same math the deleted inMemoryAgg did, sourced
// from a DuckDB GROUP BY instead of an in-RAM columnar dataset.

// SQL re-aggregation function for an additive component at a coarser
// grain. sum & count both fold with SUM (count-of-counts = total count);
// min/max fold with themselves.
function sqlAggForAdditive(t) {
  if (t === 'min') return 'MIN';
  if (t === 'max') return 'MAX';
  return 'SUM'; // sum, count
}

// Stable alias base for an AVG measure's SUM/COUNT components. The SINGLE
// source of truth — collectComponentsForVisual calls THIS so the build
// alias and the runtime-recompose lookup can never diverge.
//
// MUST stay ≤ 63 chars: PostgreSQL truncates every result-set column
// alias to NAMEDATALEN (63 bytes). The old `_avg_<schema>_<table>_<col>`
// scheme produced 70+ char aliases on real models (e.g.
// `_avg_nyukom_appel_entrant_f_appel_entrant_agg_duree_sonnerie_totale_sum`),
// so PG truncated the SELECT alias, the build response key no longer
// matched the atom name, and buildRollupToDuckDB stored NULL → every
// AVG-from-rollup returned null. A short stable hash of table.column
// keeps the full alias (`_avg_<16hex>_sum`/`_count`) ~27 chars.
function avgAliasBase(spec) {
  const key = `${spec.table || ''}.${spec.column}`;
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `_avg_${h}`;
}

// Stable alias for an HLL sketch atom — same `<short-hash>` shape as
// `avgAliasBase`, so two DISTINCT measures targeting the same column
// share ONE sketch column in the rollup (idempotent). lgK is part of
// the hash because two specs with the same column but different
// precisions can't share the underlying sketch (HLL sketches are not
// mergeable across lg_k values).
function hllAliasBase(spec) {
  const key = `${spec.table || ''}.${spec.column}|lgk=${spec.lgK || 12}`;
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `_hll_${h}`;
}


module.exports = {
  decomposeMeasure,
  decomposeAsExpression,
  collectComponentsForVisual,
  sqlAggForAdditive,
  avgAliasBase,
  hllAliasBase,
};
