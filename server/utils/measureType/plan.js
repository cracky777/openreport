/* Rollup component planning, runtime recompose, and fact/override analysis.
 * Part of the measureType decomposition engine — see ./index.js for the
 * module-level contract. Split out of the former single-file measureType.js
 * (pure relocation, no logic change). ROLLUP-CACHE.md §6 documents the math.
 */

const {
  decomposeMeasure,
  collectComponentsForVisual,
  sqlAggForAdditive,
  avgAliasBase,
  hllAliasBase,
} = require('./decompose');
const { additiveTypeForMeasure, findMeasureByName } = require('./detect');
const { compileExpression } = require('./exprParse');

// Given the measure DEFs a rollup must serve + the full measure pool,
// returns everything the builder and planner need:
//   outputs:       [{ name, label, spec, supported }]
//   fireNames:     measure names to request from /query by name
//   extraMeasures: synthetic AVG components to pass as extraMeasures
//   atoms:         [{ col, agg }] physical component columns + re-agg fn
function componentPlanForMeasures(outputDefs, allMeasures, opts) {
  const hllReady = !!(opts && opts.hllReady);
  const outputs = [];
  const fireNames = new Set();
  const extraByAlias = new Map();
  const atomByCol = new Map(); // col -> agg ('sum'|'min'|'max') | {agg, lgK}

  for (const m of outputDefs) {
    if (!m || !m.name) continue;
    const label = m.label || m.name;
    // Override-mode filtered measures (or anything referencing one) can't
    // be safely re-aggregated from atoms — never materialise them; the
    // planner MISSes → live query (always correct). See isOverrideTainted.
    if (isOverrideTainted(m, allMeasures)) {
      outputs.push({ name: m.name, label, spec: null, supported: false });
      continue;
    }
    const spec = decomposeMeasure(m, allMeasures);
    if (!spec) {
      outputs.push({ name: m.name, label, spec: null, supported: false });
      continue;
    }
    // DISTINCT measures need the DataSketches DuckDB extension to
    // materialise their HLL sketch atoms. If the extension didn't load
    // (offline / unreachable community repo), drop the output to
    // `supported:false` so the planner MISSes → live SQL (correct,
    // unaccelerated). Generic for every DISTINCT shape — never
    // materialise an HLL atom we can't read back.
    if (spec.type === 'distinct' && !hllReady) {
      outputs.push({ name: m.name, label, spec: null, supported: false });
      continue;
    }
    let supported = true;
    if (spec.type === 'simple') {
      fireNames.add(m.name);
      atomByCol.set(m.name, sqlAggForAdditive(spec.innerType));
    } else {
      if (spec.type === 'expression' && !compileExpression(spec.rawExpression)) {
        supported = false;
      }
      const { baseMeasureNames, syntheticMeasures } = collectComponentsForVisual([spec]);
      for (const b of baseMeasureNames) {
        fireNames.add(b);
        const bd = allMeasures.find((x) => x && x.name === b);
        atomByCol.set(b, sqlAggForAdditive(additiveTypeForMeasure(bd, allMeasures)));
      }
      for (const s of syntheticMeasures) {
        if (s.kind === 'hll') {
          // HLL sketch atom: stored as BLOB in the rollup, re-aggregated
          // via datasketch_hll_union(lgK, sketch) and unwrapped by
          // datasketch_hll_estimate(...) — the planner branches on
          // `agg === 'HLL_UNION'` and reads `lgK` from the atom. The
          // builder branches on `aggregation: 'hll'` to fetch (grain ∪
          // col) deduped rows and run `datasketch_hll(lgK, col)` in
          // DuckDB at staging→rollup time.
          extraByAlias.set(s.alias, {
            name: s.alias, aggregation: s.kind, column: s.column, table: s.table, lgK: s.lgK,
          });
          atomByCol.set(s.alias, { agg: 'HLL_UNION', lgK: s.lgK });
          continue;
        }
        extraByAlias.set(s.alias, {
          name: s.alias, aggregation: s.kind, column: s.column, table: s.table, dataType: s.dataType,
        });
        atomByCol.set(s.alias, 'SUM');
      }
    }
    outputs.push({ name: m.name, label, spec, supported });
  }

  return {
    outputs,
    fireNames: [...fireNames],
    extraMeasures: [...extraByAlias.values()],
    // Atoms can carry extra metadata (lgK for HLL) — accept both the
    // legacy string form ('SUM' / 'MIN' / 'MAX') and the object form
    // (`{agg, lgK}`) here.
    atoms: [...atomByCol.entries()].map(([col, meta]) => (
      typeof meta === 'string' ? { col, agg: meta } : { col, ...meta }
    )),
  };
}

// Recombine one decomposed measure for a single output row. `getAtom`
// returns the already-grain-aggregated numeric value of a component
// column. `refName` is the measure name whose column holds a `simple`
// value (only used for the simple/leaf case).
function recomposeMeasure(spec, refName, getAtom) {
  if (!spec) return null;
  if (spec.type === 'simple') {
    const v = getAtom(refName);
    return (v === undefined) ? null : v;
  }
  if (spec.type === 'avg') {
    const base = avgAliasBase(spec);
    const s = getAtom(`${base}_sum`);
    const c = getAtom(`${base}_count`);
    return c ? (s / c) : null;
  }
  if (spec.type === 'distinct') {
    // The planner SQL wraps the merged sketch with
    // `datasketch_hll_estimate(datasketch_hll_union(lgK, sketch))` so
    // the atom we receive is already the scalar cardinality estimate
    // (a number, not the BLOB sketch). Pass it through unchanged.
    const v = getAtom(hllAliasBase(spec));
    return (v === undefined) ? null : v;
  }
  if (spec.type === 'ratio') {
    const n = recomposeMeasure(spec.numSpec, spec.numRef, getAtom);
    const d = recomposeMeasure(spec.denSpec, spec.denRef, getAtom);
    // SQL NULL propagation: A/<anything-NULL> and <NULL>/B are NULL.
    if (n == null || d == null) return null;
    let divisor;
    if (d === 0) {
      // Reproduce the denominator's div-by-zero guard exactly, as the
      // live SQL does:
      //   guard 'case'  → CASE WHEN den=0 THEN <guardThen> ELSE den END
      //                   ⇒ divisor = guardThen (numeric, e.g. 1)
      //   guard 'nullif'→ NULLIF(den,0) ⇒ den/NULL ⇒ NULL
      //   guard 'none'  → real /0 ⇒ undefined
      // Legacy manifests built before this change have no `spec.guard`;
      // they fall through to `null` here — i.e. exactly the prior
      // behaviour, so no regression until the rollup is re-warmed.
      if (spec.guard === 'case') {
        divisor = (spec.guardThen != null ? spec.guardThen : 1);
      } else {
        return null;
      }
    } else {
      divisor = d;
    }
    if (!divisor) return null; // guardThen could itself be 0
    let v = n / divisor;
    if (spec.scale && spec.scale !== 1) v *= spec.scale;
    return Number.isFinite(v) ? v : null;
  }
  if (spec.type === 'expression') {
    const fn = compileExpression(spec.rawExpression);
    if (!fn) return null;
    const _v = {};
    for (const r of spec.refs) {
      if (r.spec) {
        // Phase C nested ref: resolve avg / ratio at the requested
        // grain from its own atoms, then feed the scalar into _v.
        const v = recomposeMeasure(r.spec, r.name, getAtom);
        _v[r.name] = (v === undefined) ? null : v;
      } else {
        const a = getAtom(r.name);
        _v[r.name] = (a === undefined) ? null : a;
      }
    }
    let v;
    try { v = fn(_v); } catch { return null; }
    // NaN / +-Infinity bubble up from JS arithmetic where SQL would
    // have produced NULL (e.g. `100 / NULLIF(0, 0)` → `100 / null` →
    // `Infinity` in JS, NULL in SQL). Normalise to null so the cached
    // value matches the live query at the same grain.
    if (typeof v === 'number' && !Number.isFinite(v)) return null;
    return (v == null) ? null : v;
  }
  return null;
}

// Fact table(s) a custom-SQL expression reads DIRECTLY, parsed from its
// raw column references. The UI generates fully-qualified, double-quoted
// refs like `"schema"."fact"."col"` (or `"fact"."col"`); the fact table
// is every quoted part except the trailing column, dot-joined — the same
// `schema.table` form `measure.table` carries for model measures, so the
// builder's fact-grouping and the planner's findBestRollup line up.
//
// Only QUOTED multi-part runs are matched. `${ref}` placeholders (handled
// by recursion) and bare function names like `COUNT` carry no quotes and
// are correctly ignored, so a ratio-of-refs isn't mis-attributed here.
function tablesInExpression(expr) {
  if (!expr || typeof expr !== 'string') return [];
  const out = new Set();
  // A run = one quoted ident followed by ≥1 (`.` quoted ident). Requires
  // at least two parts so a lone quoted alias is never read as a table.
  const RUN = /"(?:[^"]|"")*"(?:\s*\.\s*"(?:[^"]|"")*")+/g;
  const PART = /"((?:[^"]|"")*)"/g;
  let run;
  while ((run = RUN.exec(expr)) !== null) {
    const parts = [];
    let p;
    PART.lastIndex = 0;
    while ((p = PART.exec(run[0])) !== null) parts.push(p[1].replace(/""/g, '"'));
    if (parts.length >= 2) out.add(parts.slice(0, -1).join('.'));
  }
  return [...out];
}

// Fact table(s) a measure DEF reads directly (not via `${ref}`s). Prefers
// the explicit `.table` (model measures); falls back to parsing the raw
// SQL of a custom expression (calc/extra measures where the fact is
// embedded in the expression and `.table` is empty).
function factTablesFromDef(measure) {
  if (!measure) return [];
  if (measure.table) return [measure.table];
  if (measure.aggregation === 'custom' && measure.expression) {
    return tablesInExpression(measure.expression);
  }
  return [];
}

// Distinct fact tables a measure reads from, after decomposition. A
// constellation model has several fact tables sharing conformed
// dimensions; a rollup must aggregate ONE fact at a time (joining facts
// together fans out into a cartesian product). This tells the builder
// which fact-group a measure belongs to:
//   - 1 table  → single-fact measure (rollupable in that fact's rollup)
//   - 0 tables → unknown (no `table` on the def — e.g. a bare COUNT(*));
//                treated as cross/unrollable in v1
//   - >1 tables→ cross-fact (ratio/expr whose refs span facts) — v1
//                falls back to the live query for these
function factsForMeasure(measure, allMeasures, _seen) {
  if (!measure) return [];
  const seen = _seen || new Set();
  if (measure.name) {
    if (seen.has(measure.name)) return [];
    seen.add(measure.name);
  }
  const spec = decomposeMeasure(measure, allMeasures);
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  if (!spec) return factTablesFromDef(measure);
  if (spec.type === 'simple') return factTablesFromDef(measure);
  if (spec.type === 'avg') return spec.table ? [spec.table] : factTablesFromDef(measure);
  if (spec.type === 'distinct') return spec.table ? [spec.table] : factTablesFromDef(measure);
  if (spec.type === 'ratio') {
    const n = findMeasureByName(spec.numRef, allMeasures);
    const d = findMeasureByName(spec.denRef, allMeasures);
    return uniq([
      ...factsForMeasure(n, allMeasures, seen),
      ...factsForMeasure(d, allMeasures, seen),
    ]);
  }
  if (spec.type === 'expression') {
    const out = [];
    for (const r of spec.refs) {
      out.push(...factsForMeasure(findMeasureByName(r.name, allMeasures), allMeasures, seen));
    }
    return uniq(out);
  }
  return factTablesFromDef(measure);
}

// True if a measure is "override-tainted": it (or any measure it
// transitively references) drops the widget/global filter on its rule
// fields via `overrideFilters` (the /query path emits it as a correlated
// subquery — see routes/models.js). Such a measure is NOT safely
// re-aggregatable from rollup atoms: its value deliberately ignores
// filters the atoms were grouped/baked by, so serving it from a rollup
// at any grain/filter ≠ the bake would return a WRONG number. The rollup
// builder marks these `supported:false` → planner MISS → live query
// (always correct, just not accelerated). INTERSECTION-mode filtered
// measures (`filterRules` WITHOUT `overrideFilters`) are SAFE — their
// `CASE WHEN` is inside the aggregate and the global WHERE still applies,
// so they're additive and bake/re-aggregate correctly; they are NOT
// tainted by this check.
function isOverrideTainted(measure, allMeasures, _seen) {
  if (!measure) return false;
  const seen = _seen || new Set();
  if (measure.name) {
    if (seen.has(measure.name)) return false;
    seen.add(measure.name);
  }
  if (Array.isArray(measure.filterRules) && measure.filterRules.length > 0
      && measure.overrideFilters) {
    return true;
  }
  const spec = decomposeMeasure(measure, allMeasures);
  if (!spec) return false;
  if (spec.type === 'ratio') {
    return isOverrideTainted(findMeasureByName(spec.numRef, allMeasures), allMeasures, seen)
      || isOverrideTainted(findMeasureByName(spec.denRef, allMeasures), allMeasures, seen);
  }
  if (spec.type === 'expression') {
    return spec.refs.some((r) =>
      isOverrideTainted(findMeasureByName(r.name, allMeasures), allMeasures, seen));
  }
  return false;
}

// Per-widget aggregation override → a stable "effective measure" key.
// A widget can display a model measure with a different aggregation
// (`measureAggOverrides[name]` in /query; models.js applies it ONLY when
// the model agg isn't 'custom'). The rollup builder materialises a
// synthetic measure under this key (decomposed with the overridden agg —
// e.g. sum/count/min/max → that additive atom; avg → the usual
// _avg_*_sum/_count atoms), and the planner looks the manifest output up
// under the SAME key, so an aggregation-overridden widget is served from
// the rollup (correct AND cached) instead of bypassing it.
//
// Returns `baseName` when there is no real override (no override, same as
// model agg, or model agg is 'custom' — mirrors models.js exactly), else
// `<baseName>@@<overrideAgg>`. Generic for ALL aggregation types.
function effectiveMeasureName(baseName, modelAgg, overrideAgg) {
  if (!overrideAgg) return baseName;
  if (modelAgg === 'custom') return baseName;
  if (overrideAgg === modelAgg) return baseName;
  return `${baseName}@@${overrideAgg}`;
}

module.exports = {
  componentPlanForMeasures,
  recomposeMeasure,
  factsForMeasure,
  isOverrideTainted,
  effectiveMeasureName,
};
