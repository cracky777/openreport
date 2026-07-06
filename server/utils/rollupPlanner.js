/**
 * Aggregate-aware runtime planner.
 *
 * Called at the top of POST /api/models/:id/query. Decides whether the
 * request can be served from a materialised rollup instead of the source
 * fact table, and if so builds + executes the rollup SQL.
 *
 * Filter model (global filter VALUES are baked — keeps rollups small):
 *   - The report's global filter bar is BAKED into the rollup at build.
 *     We split the request's widgetFilters into the global portion
 *     (field+op matches a `settings.reportFilters` rule — the client
 *     already applied this widget's exclusions) and the rest. The global
 *     portion's normalized hash must equal a rollup's `base_filter_hash`,
 *     else it's a different data slice → MISS → live fact query (the
 *     accepted "change the global bar = rebuild" tradeoff).
 *   - N-1 / period comparison: the YoY query the client fires has the
 *     year-like / full-date filter shifted -1, so its globalPart hashes
 *     differently. The builder ALSO bakes that shifted slice
 *     (rollupBuilder.planRollupsForModel), so the N-1 query HITs its own
 *     baked rollup with a correct value (critical for override / filter-
 *     ignoring measures — a baked rollup missing the shifted period would
 *     return a WRONG number, not just be slow).
 *   - Cross-filter / drill / widget-own filters are NOT baked: their dims
 *     are in the grain and re-applied as runtime WHERE on the rollup.
 *
 * Re-aggregation:
 *   - We ALWAYS GROUP BY the requested display dims and recombine.
 *   - additive (sum/count→SUM, min→MIN, max→MAX): valid for any rollup
 *     whose grain ⊇ (displayDims ∪ runtime-filter dims).
 *   - non-additive (avg / ratio / `_calc.%`): recomposed from additive
 *     atoms after the GROUP BY, correct at any grain ⊇ the rollup grain.
 *
 * Other deliberate misses (fall through to fact):
 *   - RLS-restricted requester (rollup built under the trigger user's
 *     visibility; serving a row-limited user would leak)
 *   - rollup stored in 'source' mode (not implemented in v1)
 *   - any unsupported widgetFilter op
 */

const db = require('../db');
const rollupBuilder = require('./rollupBuilder');
const rollupDuckDB = require('./rollupDuckDB');
const { recomposeMeasure, factsForMeasure, effectiveMeasureName } = require('./measureType');

function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function qLit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Coerce a filter value to the column's type so DuckDB comparisons hit
// the right path (numeric dims compared as numbers, everything else as
// quoted literals — DuckDB auto-casts 'YYYY-MM-DD' to DATE).
function litFor(dimType, v) {
  if (dimType === 'number' && v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v))) {
    return String(Number(v));
  }
  return qLit(v);
}

// One widgetFilter rule → SQL fragment against the rollup column.
// Returns null for unsupported ops (caller treats that as "can't serve").
function scalarClause(colName, dimType, op, value, values) {
  const col = qIdent(colName);
  const list = Array.isArray(values) ? values : (Array.isArray(value) ? value : null);
  switch (op) {
    case '=':
    case 'eq':
      return `${col} = ${litFor(dimType, value)}`;
    case '!=':
    case '<>':
    case 'neq':
      return `${col} <> ${litFor(dimType, value)}`;
    case '>':
    case 'gt':
      return `${col} > ${litFor(dimType, value)}`;
    case '<':
    case 'lt':
      return `${col} < ${litFor(dimType, value)}`;
    case '>=':
    case 'gte':
      return `${col} >= ${litFor(dimType, value)}`;
    case '<=':
    case 'lte':
      return `${col} <= ${litFor(dimType, value)}`;
    case 'in':
      if (!list || list.length === 0) return null;
      return `${col} IN (${list.map((v) => litFor(dimType, v)).join(', ')})`;
    case 'not_in':
      if (!list || list.length === 0) return null;
      return `${col} NOT IN (${list.map((v) => litFor(dimType, v)).join(', ')})`;
    case 'between':
      if (!list || list.length < 2) return null;
      return `${col} BETWEEN ${litFor(dimType, list[0])} AND ${litFor(dimType, list[1])}`;
    case 'is_null':
      return `${col} IS NULL`;
    case 'is_not_null':
      return `${col} IS NOT NULL`;
    case 'contains':
      return `${col} LIKE ${qLit(`%${value}%`)}`;
    case 'not_contains':
      return `${col} NOT LIKE ${qLit(`%${value}%`)}`;
    case 'starts_with':
      return `${col} LIKE ${qLit(`${value}%`)}`;
    case 'ends_with':
      return `${col} LIKE ${qLit(`%${value}`)}`;
    default:
      return null; // top_n / bottom_n handled post-query; unknown → can't serve
  }
}

function isSyntheticTopN(f) {
  return f && (f.op === 'top_n' || f.op === 'bottom_n');
}

const _emptyVal = (v) => v === null || v === undefined || v === '';

// In-memory equivalent of a measure-filter HAVING clause, applied to the
// already-recomposed measure value. Mirrors models.js buildScalarClause's
// NUMERIC semantics exactly so a rollup-served widget filters identically
// to the live SQL path (HAVING runs before top_n/limit).
//
//   true  → row passes (keep)
//   false → row filtered out
//   'noop'  → threshold empty: live emits no clause, so neither do we
//   'unsupported' → op we can't replicate 1:1 → caller MISSes to live
//
// SQL HAVING semantics: a NULL aggregate makes every comparison UNKNOWN,
// so the row is excluded for eq/neq/gt/gte/lt/lte/between alike.
function numericHavingMatch(rawVal, op, value, values) {
  const num = (x) => { const y = Number(x); return Number.isFinite(y) ? y : null; };
  switch (op) {
    case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': {
      if (_emptyVal(value)) return 'noop';
      const t = num(value);
      if (t === null) return 'noop';
      const n = num(rawVal);
      if (n === null) return false; // NULL <op> x → UNKNOWN → excluded
      switch (op) {
        case 'eq':  return n === t;
        case 'neq': return n !== t;
        case 'gt':  return n > t;
        case 'gte': return n >= t;
        case 'lt':  return n < t;
        default:    return n <= t; // lte
      }
    }
    case 'between': {
      const list = Array.isArray(values) ? values : (Array.isArray(value) ? value : null);
      const a = list && list[0]; const b = list && list[1];
      if (_emptyVal(a) || _emptyVal(b)) return 'noop';
      const lo = num(a); const hi = num(b);
      if (lo === null || hi === null) return 'noop';
      const n = num(rawVal);
      if (n === null) return false;
      return n >= lo && n <= hi;
    }
    // in / not_in / contains / is_empty… on an aggregate are rare and
    // live builds them with string semantics — replicate exactly by
    // staying on the live path rather than risk a divergent rollup.
    default:
      return 'unsupported';
  }
}

// Report's global-filter-bar rule definitions (field+op identify a rule).
// Used to split the runtime widgetFilters into the baked-global portion
// vs the rest.
function loadReportFilters(reportId) {
  if (!reportId) return [];
  try {
    const r = db.prepare('SELECT settings FROM reports WHERE id = ?').get(String(reportId));
    if (!r) return [];
    const s = JSON.parse(r.settings || '{}');
    return Array.isArray(s.reportFilters) ? s.reportFilters : [];
  } catch { return []; }
}

/**
 * @returns {{hit:true, rows:Array, tableName:string, match:string, sql:string}}
 *          | {hit:false, reason:string}
 */
async function tryServeFromRollup(opts) {
  const {
    model, modelId, orgId, reportId,
    dimensionNames = [],
    measureNames = [],
    measureAggOverrides = {},
    filters = {},
    widgetFilters = [],
    havingGrainDims,
    allDimensions = [],
    allMeasures = [],
    limit,
    rlsApplies,
  } = opts;

  if (rlsApplies) return { hit: false, reason: 'rls-restricted' };
  const mid = modelId || (model && model.id);
  if (!mid) return { hit: false, reason: 'no-model' };
  // X-grain HAVING (bar/line/combo with legend + measure filter) needs the
  // measure-filter to be evaluated at the X-axis grain, not the full
  // (X × legend) grain that the visual returns. The planner's in-memory
  // HAVING below applies to recomposed rows AT THE REQUESTED GRAIN — it
  // has no notion of "filter at a coarser grain than the result". Rather
  // than re-implement it here we bail when x-grain is requested and let
  // the live SQL path emit its proper IN-subquery. Bumping x-grain into
  // the planner is a worthwhile follow-up but it's a non-trivial extension
  // of the recompose-and-filter pipeline.
  if (Array.isArray(havingGrainDims)
      && havingGrainDims.length > 0
      && havingGrainDims.length < (dimensionNames || []).length) {
    return { hit: false, reason: 'x-grain-having-unsupported' };
  }

  // Split widgetFilters: the global portion (field+op matches a report
  // global-filter rule — the client already applied this widget's
  // exclusions) is BAKED into the rollup; the rest is applied at runtime.
  // The N-1 query (year shifted) has its own baked rollup with a matching
  // shifted hash (builder bakes it), so this split + hash works for it.
  const reportFilters = loadReportFilters(reportId);
  const globalKeys = new Set(
    reportFilters
      .filter((r) => r && !r.isMeasure && r.field && r.op)
      .map((r) => `${r.field}|${r.op}`)
  );
  const wf = Array.isArray(widgetFilters) ? widgetFilters : [];
  const globalPart = [];
  const runtimePart = [];
  for (const f of wf) {
    if (!f || f.isMeasure || isSyntheticTopN(f) || !f.field || !f.op) continue;
    if (globalKeys.has(`${f.field}|${f.op}`)) globalPart.push(f);
    else runtimePart.push(f);
  }
  const baseFilterHash = rollupBuilder.baseFilterHashOf(globalPart);

  // Runtime (non-baked) filter dims fold into the requested grain so the
  // rollup carries them; the baked global dims do NOT.
  const objFilterKeys = Object.keys(filters || {}).filter(
    (k) => Array.isArray(filters[k]) && filters[k].length > 0
  );
  // Runtime filter dims (slicer / cross-filter / widget-own fixed). These
  // are applied PER FACT, and ONLY if that fact actually has a rollup
  // grain containing the dim (⇒ the dim is conformed/joined to that
  // fact). A filter dim with no join to a fact must be a NO-OP for that
  // fact — NOT force a MISS→live "refresh" of an unrelated visual. This
  // is standard BI behaviour (a slicer only filters visuals related to
  // its dimension) and it keeps unrelated visuals served from cache.
  const runtimeFilterDims = [...new Set([
    ...runtimePart.map((f) => f.field),
    ...objFilterKeys,
  ])];
  if (measureNames.length === 0) return { hit: false, reason: 'no-measures' };

  // Per-fact grain universe = union of grain_dims over EVERY rollup of
  // that fact. Empty ⇒ the fact has no rollups (or unreadable) ⇒ stay
  // permissive (don't scope) so behaviour is unchanged for those facts
  // (they MISS→live anyway). Cached per call.
  const _fguCache = new Map();
  const factGrainUniverse = (factTable) => {
    if (_fguCache.has(factTable)) return _fguCache.get(factTable);
    const set = new Set();
    try {
      const rows = db.prepare(
        `SELECT grain_dims FROM rollups
         WHERE model_id = ? AND fact_table = ?
           AND (organization_id IS ? OR organization_id = ?)`
      ).all(mid, factTable || '', orgId || null, orgId || null);
      for (const r of rows) {
        let g; try { g = JSON.parse(r.grain_dims || '[]'); } catch { g = []; }
        for (const d of g) set.add(d);
      }
    } catch { /* permissive on error */ }
    _fguCache.set(factTable, set);
    return set;
  };

  // grainDims may be empty: a scorecard whose only filters are the baked
  // global bar. findBestRollup with an empty wanted-set matches any
  // rollup under the same base_filter_hash; summing its additive atoms =
  // the grand total of that baked slice. No GROUP BY → one recomposed row.
  // Resolve each requested measure to its fact table, then group.
  // Constellation models keep one rollup per fact (joining facts fans
  // out cartesian); a widget mixing facts is served by FULL OUTER
  // JOINing the per-fact rollups on the conformed grain dims.
  // factTable -> [{ eff, respKey }]. `eff` is the EFFECTIVE measure key
  // (effectiveMeasureName — `<name>@@<agg>` when the visual overrides the
  // model aggregation); the builder materialised the rollup output under
  // that exact key, so we look it up under it (override served from
  // cache, not bypassed — generic for every agg type). `respKey` is the
  // key the response must use: the BASE measure's label||name, identical
  // to what the live /query path emits, so the client is agnostic to the
  // override.
  const factToMeasures = new Map();
  for (const mn of measureNames) {
    const def = allMeasures.find((m) => m && m.name === mn);
    if (!def) return { hit: false, reason: `measure-not-model:${mn}` };
    const eff = effectiveMeasureName(
      mn, def.aggregation, measureAggOverrides && measureAggOverrides[mn]
    );
    const respKey = def.label || def.name;
    const facts = factsForMeasure(def, allMeasures);
    if (facts.length !== 1) return { hit: false, reason: `cross-fact:${mn}` };
    const f = facts[0];
    if (!factToMeasures.has(f)) factToMeasures.set(f, []);
    factToMeasures.get(f).push({ eff, respKey, reqName: mn });
  }

  // Per fact-group: smallest rollup whose grain ⊇ requested grain AND
  // whose baked-global-filter hash matches the request's (incl. the N-1
  // shifted slice — the builder bakes it separately).
  const groups = []; // { rollup, outputs:[{name,label,spec}], atoms:[{col,agg}] }
  let anyMatch = 'exact';
  for (const [factTable, mns] of factToMeasures) {
    // Scope runtime filter dims to THIS fact: keep only those present in
    // some rollup grain of the fact (conformed/joined). Drop the rest —
    // they don't apply to this fact (no join) so they must neither force
    // the requested grain nor be re-applied in WHERE. fgu empty ⇒ no
    // rollups for the fact ⇒ stay permissive (unchanged: it MISSes→live).
    const fgu = factGrainUniverse(factTable);
    const allowed = fgu.size > 0
      ? new Set(runtimeFilterDims.filter((d) => fgu.has(d)))
      : new Set(runtimeFilterDims);
    const grainDims = [...new Set([...dimensionNames, ...allowed])];
    const rollup = rollupBuilder.findBestRollup({
      modelId: mid, grainDims, baseFilterHash, factTable, orgId,
    });
    if (!rollup) {
      if (process.env.ROLLUP_LOG !== '0') {
        try {
          const cand = db.prepare(
            `SELECT base_filter_hash AS bf, grain_dims AS g, base_filters AS bfs FROM rollups
             WHERE model_id = ? AND fact_table = ?
               AND (organization_id IS ? OR organization_id = ?)`
          ).all(mid, factTable, orgId || null, orgId || null);
          console.log(
            `[rollup] no-rollup fact=${factTable} wantBf=${baseFilterHash} ` +
            `wantGrain=[${grainDims.join(',')}]\n` +
            `  runtime globalPart(norm)=${JSON.stringify(rollupBuilder.normalizeFilterRules(globalPart))}\n` +
            `  candidates=` +
            JSON.stringify(cand.map((c) => ({
              bf: c.bf,
              grain: JSON.parse(c.g || '[]'),
              baked: rollupBuilder.normalizeFilterRules(JSON.parse(c.bfs || '[]')),
            })))
          );
        } catch { /* diagnostic only */ }
      }
      return { hit: false, reason: `no-rollup:${factTable}` };
    }
    if (rollup.storageMode !== 'duckdb') return { hit: false, reason: 'source-storage-unsupported' };
    const man = rollup.measures || { outputs: [], atoms: [] };
    const byName = new Map((man.outputs || []).map((o) => [o.name, o]));
    const outs = [];
    for (const { eff, respKey, reqName } of mns) {
      const o = byName.get(eff);
      if (!o || !o.supported || !o.spec) return { hit: false, reason: `non-decomposable:${eff}` };
      // Carry the response key separately: o.label is the rollup-internal
      // (possibly synthetic) identity; respKey is what the client expects.
      // reqName = the originally requested measure name (what a synthetic
      // top_n/bottom_n widgetFilter targets in `field`).
      outs.push({ o, respKey, reqName });
    }
    if (!(man.atoms || []).length) return { hit: false, reason: `no-atoms:${factTable}` };
    if (rollup.match !== 'exact') anyMatch = 'superset';
    groups.push({ rollup, outputs: outs, atoms: man.atoms, allowed });
  }

  // WHERE — runtime filters ONLY (the global bar is already baked).
  //
  // The `filters` object carries the merged slicer + cross-highlight
  // selections from the Editor (the cross-highlight is folded into
  // reportFilters in Editor.jsx so the cross-filter dim arrives here
  // alongside slicer dims). The `runtimePart` array carries the rest of
  // the widget filters (drill, widget-own filters, the un-baked portion
  // of widgetFilters).
  //
  // For BOTH paths: a filter dim that isn't in this rollup's grain
  // (= not a column in the rollup table) can't be applied as SQL WHERE.
  // The previous behaviour was a silent drop — serving UNFILTERED data
  // from the rollup. Wrong for a cross-filter click (user clicked
  // "Wednesday" on a Day Name TreeMap → expects the rest of the
  // dashboard to filter by Wednesday): the live-SQL path would apply
  // the filter via the join graph and return correctly filtered numbers.
  // So when a filter targets a dim not in the rollup grain, MISS →
  // live SQL handles it.
  const whereSqlFor = (allowed) => {
    const parts = [];
    for (const [dn, vals] of Object.entries(filters || {})) {
      if (!Array.isArray(vals) || vals.length === 0) continue;
      if (!allowed.has(dn)) {
        return { error: `filter-not-in-grain:${dn}` };
      }
      const d = allDimensions.find((x) => x.name === dn);
      const dimType = d ? d.type : 'string';
      parts.push(`${qIdent(dn)} IN (${vals.map((v) => litFor(dimType, v)).join(', ')})`);
    }
    for (const f of runtimePart) {
      if (!allowed.has(f.field)) {
        return { error: `runtime-filter-not-in-grain:${f.field}` };
      }
      const d = allDimensions.find((x) => x.name === f.field);
      const dimType = d ? d.type : 'string';
      const clause = scalarClause(f.field, dimType, f.op, f.value, f.values);
      if (clause === null) return { error: `unsupported-op:${f.op}` };
      parts.push(clause);
    }
    return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '' };
  };
  for (const g of groups) {
    const w = whereSqlFor(g.allowed);
    if (w.error) return { hit: false, reason: w.error };
    g.whereSql = w.sql;
  }
  const dimNameCols = dimensionNames.map((dn) => qIdent(dn));
  const groupSql = dimNameCols.length ? ` GROUP BY ${dimNameCols.join(', ')}` : '';

  // One aggregate subquery per fact-group, dims by NAME so FULL JOIN
  // USING aligns the conformed grain across facts.
  //
  // HLL atoms (`agg: 'HLL_UNION'`) take a different SQL shape than
  // additive atoms (SUM/MIN/MAX): the rollup column stores a BLOB
  // sketch built at warm time by `datasketch_hll(lgK, col)`, and we
  // serve a cardinality estimate by `datasketch_hll_union(lgK, sketch)`
  // (merge sketches across the requested grain) then wrapping the
  // merged sketch with `datasketch_hll_estimate(…)` so the row arrives
  // at the recompose layer as a scalar — indistinguishable for the
  // post-processing from a plain additive SUM/MIN/MAX result.
  const subFor = (g) => {
    const aselects = g.atoms.map((a) => {
      if (a.agg === 'HLL_UNION') {
        const lgK = a.lgK || 12;
        return `datasketch_hll_estimate(datasketch_hll_union(${lgK}, ${qIdent(a.col)})) AS ${qIdent(a.col)}`;
      }
      return `${a.agg}(${qIdent(a.col)}) AS ${qIdent(a.col)}`;
    });
    return `SELECT ${[...dimNameCols, ...aselects].join(', ')} FROM ${qIdent(g.rollup.tableName)}${g.whereSql || ''}${groupSql}`;
  };

  let fromSql;
  if (groups.length === 1) {
    fromSql = `(${subFor(groups[0])}) g0`;
  } else if (dimNameCols.length > 0) {
    fromSql = groups
      .map((g, i) => `(${subFor(g)}) g${i}`)
      .reduce((acc, cur, i) => (i === 0 ? cur : `${acc} FULL JOIN ${cur} USING (${dimNameCols.join(', ')})`));
  } else {
    // Scorecard across facts: each subquery is one grand-total row.
    fromSql = groups
      .map((g, i) => `(${subFor(g)}) g${i}`)
      .reduce((acc, cur, i) => (i === 0 ? cur : `${acc} CROSS JOIN ${cur}`));
  }

  // Atom column names are globally unique (measure names / AVG aliases),
  // so after the join they're referenceable unqualified. USING coalesces
  // the dim columns automatically.
  const labelByName = new Map(allDimensions.map((x) => [x.name, x.label]));
  const labelFor = (dn) => labelByName.get(dn) || dn;
  const dimLabels = dimensionNames.map(labelFor);
  const finalDimSelects = dimensionNames.map((dn) => `${qIdent(dn)} AS ${qIdent(labelFor(dn))}`);
  const finalAtomSelects = [];
  for (const g of groups) for (const a of g.atoms) finalAtomSelects.push(qIdent(a.col));

  let sql = `SELECT ${[...finalDimSelects, ...finalAtomSelects].join(', ')} FROM ${fromSql}`;
  if (dimNameCols.length > 0) sql += ` ORDER BY ${dimNameCols[0]}`;
  // Don't pre-truncate with the arbitrary LIMIT when a top_n/bottom_n is in
  // play: the in-memory rank (below) must see ALL rollup rows first, otherwise
  // the true top-N can be cut off by this LIMIT. Rollup rows are one-per-grain,
  // so the 1M cap still bounds the scan.
  const hasTopN = wf.some(isSyntheticTopN);
  const lim = hasTopN ? 1_000_000 : Math.min(Number(limit) || 1000, 1_000_000);
  sql += ` LIMIT ${lim}`;

  // All groups' tables must live in the SAME generation file (one
  // connection can't FULL JOIN across two DuckDB files). A successful
  // full build writes every fact's rollup into one gen file, so this
  // holds in the normal case; only a partially-failed build leaves a
  // widget's facts split across gens → transient MISS until the next
  // build reunifies them.
  const gens = [...new Set(groups.map((g) => rollupDuckDB.genOfTableName(g.rollup.tableName)))];
  if (gens.length !== 1 || !gens[0]) {
    return { hit: false, reason: `mixed-gen:${gens.join('|')}` };
  }

  let rawRows;
  try {
    rawRows = await rollupDuckDB.query(mid, gens[0], sql, orgId);
  } catch (err) {
    return { hit: false, reason: `duckdb-error:${err.message}` };
  }

  // Each entry: { o: <manifest output>, respKey: <client-facing key> }.
  const reqOutputs = [];
  for (const g of groups) for (const pair of g.outputs) reqOutputs.push(pair);
  let rows = rawRows.map((raw) => {
    const out = {};
    for (const lbl of dimLabels) out[lbl] = raw[lbl];
    const getAtom = (col) => {
      const v = raw[col];
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    for (const { o, respKey } of reqOutputs) {
      out[respKey] = recomposeMeasure(o.spec, o.name, getAtom);
    }
    return out;
  });

  // Measure filters = HAVING. The rollup row IS the aggregated group, and
  // out[respKey] is the recomposed measure (already AVG-overridden +
  // interval-flattened to seconds, same number the live HAVING compares).
  // Apply them here, in memory, BEFORE top_n — exactly the SQL order
  // (HAVING then ORDER BY/LIMIT). Anything we can't replicate 1:1
  // (unmappable field, op live builds with string semantics) MISSes to
  // live so a rollup result never diverges from the live result.
  const measurePart = wf.filter(
    (f) => f && f.isMeasure && !isSyntheticTopN(f) && f.field && f.op
  );
  for (const f of measurePart) {
    const pair = reqOutputs.find(
      (x) => x.reqName === f.field || x.o.name === f.field || x.respKey === f.field
    );
    if (!pair) return { hit: false, reason: `measure-filter-unmappable:${f.field}` };
    const key = pair.respKey;
    let probe = numericHavingMatch(0, f.op, f.value, f.values);
    if (probe === 'unsupported') return { hit: false, reason: `measure-filter-op:${f.op}` };
    if (probe === 'noop') continue; // live emits no clause → no-op here too
    rows = rows.filter((r) => numericHavingMatch(r[key], f.op, f.value, f.values) === true);
  }

  // top_n / bottom_n applied in memory, same as the fact path.
  const topN = wf.find(isSyntheticTopN);
  if (topN && topN.field) {
    const n = Math.max(1, Math.floor(topN.value || 0));
    if (n > 0 && rows.length > n) {
      // top_n widgetFilter `field` = the originally-requested measure
      // name (client sets `field: <measureName>`). Match it against the
      // requested name first (robust to label/override differences), then
      // fall back to the manifest output name / response key. Rows are
      // keyed by respKey, so that's what we sort on.
      const pair = reqOutputs.find(
        (x) => x.reqName === topN.field
          || x.o.name === topN.field
          || x.respKey === topN.field
      );
      const key = pair ? pair.respKey : topN.field;
      const dir = topN.op === 'top_n' ? 'desc' : 'asc';
      rows = [...rows].sort((a, b) => {
        const va = Number(a[key]); const vb = Number(b[key]);
        const na = Number.isFinite(va) ? va : 0;
        const nb = Number.isFinite(vb) ? vb : 0;
        return dir === 'desc' ? nb - na : na - nb;
      }).slice(0, n);
    }
  }

  return {
    hit: true,
    rows,
    tableName: groups.map((g) => g.rollup.tableName).join('+'),
    match: anyMatch,
    sql,
  };
}

/**
 * Slicer-distinct fast path: a filter widget asks for the distinct
 * values of a single dim under the current filter context. The main
 * planner (above) bails on no-measures requests; this function
 * specifically handles that shape by picking ANY rollup whose grain
 * already contains the dim and SELECT-DISTINCTing it.
 *
 * Caller contract:
 *   - `dimensionName` is the single dim the slicer is bound to.
 *   - `filters` / `widgetFilters` follow the same split convention as
 *     the main planner (global → baked into baseFilterHash, runtime →
 *     applied as WHERE on the rollup).
 *   - On HIT, returns the same `{hit, rows, tableName, match}` shape
 *     so the route handler can reuse its response-building path.
 *   - On MISS, returns `{hit:false, reason}` so the caller falls
 *     through to live SQL (skipping queryCache, since stale slicer
 *     values would otherwise survive a cache rebuild within the same
 *     server process).
 *
 * @returns {{hit:true, rows:Array, tableName:string, match:string, sql:string}}
 *          | {hit:false, reason:string}
 */
async function tryServeSlicerDistinct(opts) {
  const {
    modelId, orgId, reportId,
    dimensionName,
    filters = {},
    widgetFilters = [],
    allDimensions = [],
    limit,
    rlsApplies,
  } = opts;

  if (rlsApplies) return { hit: false, reason: 'rls-restricted' };
  if (!modelId) return { hit: false, reason: 'no-model' };
  if (!dimensionName) return { hit: false, reason: 'no-dim' };

  // Same global/runtime split as the main planner — keeps the
  // baked-filter hash semantics consistent.
  const reportFilters = loadReportFilters(reportId);
  const globalKeys = new Set(
    reportFilters
      .filter((r) => r && !r.isMeasure && r.field && r.op)
      .map((r) => `${r.field}|${r.op}`)
  );
  const wf = Array.isArray(widgetFilters) ? widgetFilters : [];
  const globalPart = [];
  const runtimePart = [];
  for (const f of wf) {
    if (!f || f.isMeasure || isSyntheticTopN(f) || !f.field || !f.op) continue;
    if (globalKeys.has(`${f.field}|${f.op}`)) globalPart.push(f);
    else runtimePart.push(f);
  }
  const baseFilterHash = rollupBuilder.baseFilterHashOf(globalPart);

  // Candidates: any rollup matching the model/org AND base filter hash
  // whose grain CONTAINS the slicer dim. Prefer the smallest one (least
  // rows = fastest DISTINCT scan). Cross-fact arbitrary — a dim has the
  // same value universe regardless of which fact's rollup it sits in.
  const rows = db.prepare(
    `SELECT id, table_name, grain_dims, row_count, storage_mode
     FROM rollups
     WHERE model_id = ?
       AND base_filter_hash = ?
       AND (organization_id IS ? OR organization_id = ?)`
  ).all(modelId, baseFilterHash, orgId || null, orgId || null);

  let best = null;
  for (const row of rows) {
    let grain;
    try { grain = JSON.parse(row.grain_dims || '[]'); } catch { continue; }
    if (!Array.isArray(grain) || !grain.includes(dimensionName)) continue;
    if (row.storage_mode !== 'duckdb') continue;
    if (!best || (row.row_count || 0) < (best.row_count || 0)) {
      best = { ...row, grain };
    }
  }
  if (!best) return { hit: false, reason: `no-rollup-with-dim:${dimensionName}` };

  // WHERE — filter dims that ALSO sit in the rollup's grain (otherwise
  // their column doesn't exist in the table). Same MISS-on-not-in-grain
  // rule as the main planner: a cross-filter click on a dim that this
  // rollup doesn't carry must fall back to live SQL via the join graph
  // rather than serving unfiltered values.
  const grainSet = new Set(best.grain);
  const whereParts = [];
  for (const [dn, vals] of Object.entries(filters || {})) {
    if (!Array.isArray(vals) || vals.length === 0) continue;
    if (!grainSet.has(dn)) {
      return { hit: false, reason: `filter-not-in-grain:${dn}` };
    }
    const d = allDimensions.find((x) => x.name === dn);
    const dimType = d ? d.type : 'string';
    whereParts.push(`${qIdent(dn)} IN (${vals.map((v) => litFor(dimType, v)).join(', ')})`);
  }
  for (const f of runtimePart) {
    if (!grainSet.has(f.field)) {
      return { hit: false, reason: `runtime-filter-not-in-grain:${f.field}` };
    }
    const d = allDimensions.find((x) => x.name === f.field);
    const dimType = d ? d.type : 'string';
    const clause = scalarClause(f.field, dimType, f.op, f.value, f.values);
    if (clause === null) return { hit: false, reason: `unsupported-op:${f.op}` };
    whereParts.push(clause);
  }
  const whereSql = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';

  // Output column under the dim's label (or name fallback) — exactly
  // what live /query emits for a distinct slicer query, so the
  // FilterWidget's `data.values` extraction works unchanged.
  const d = allDimensions.find((x) => x.name === dimensionName);
  const respKey = (d && d.label) || dimensionName;
  const lim = Math.min(Number(limit) || 1000, 1_000_000);
  const sql = `SELECT DISTINCT ${qIdent(dimensionName)} AS ${qIdent(respKey)} `
    + `FROM ${qIdent(best.table_name)}${whereSql} `
    + `ORDER BY ${qIdent(dimensionName)} LIMIT ${lim}`;

  // Drop the gen out of the table name suffix so rollupDuckDB.query
  // opens the right per-gen file (its second arg is the gen token).
  const gen = rollupDuckDB.genOfTableName(best.table_name);
  if (!gen) return { hit: false, reason: 'legacy-gen' };

  let resultRows;
  try {
    resultRows = await rollupDuckDB.query(modelId, gen, sql, orgId);
  } catch (err) {
    return { hit: false, reason: `duckdb-error:${err.message}` };
  }

  return {
    hit: true,
    rows: resultRows,
    tableName: best.table_name,
    match: 'slicer',
    sql,
  };
}

module.exports = { tryServeFromRollup, tryServeSlicerDistinct };
