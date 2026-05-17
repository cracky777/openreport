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
    allDimensions = [],
    allMeasures = [],
    limit,
    rlsApplies,
  } = opts;

  if (rlsApplies) return { hit: false, reason: 'rls-restricted' };
  const mid = modelId || (model && model.id);
  if (!mid) return { hit: false, reason: 'no-model' };

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
    const grainDims = [...new Set([
      ...dimensionNames,
      ...runtimeFilterDims.filter((d) => allowed.has(d)),
    ])];
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

  // WHERE — runtime filters ONLY (the global bar is already baked). Built
  // PER FACT: a filter dim not conformed to a fact (not in its `allowed`
  // set) is a NO-OP for that fact's subquery — the dim isn't even a
  // column in that rollup, and applying it would be wrong (no join).
  // This is what lets an unrelated slicer leave a visual cache-served
  // and unfiltered instead of MISS→live.
  const whereSqlFor = (allowed) => {
    const parts = [];
    for (const [dn, vals] of Object.entries(filters || {})) {
      if (!Array.isArray(vals) || vals.length === 0) continue;
      if (!allowed.has(dn)) continue;
      const d = allDimensions.find((x) => x.name === dn);
      const dimType = d ? d.type : 'string';
      parts.push(`${qIdent(dn)} IN (${vals.map((v) => litFor(dimType, v)).join(', ')})`);
    }
    for (const f of runtimePart) {
      if (!allowed.has(f.field)) continue;
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
  const subFor = (g) => {
    const aselects = g.atoms.map((a) => `${a.agg}(${qIdent(a.col)}) AS ${qIdent(a.col)}`);
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
  const dimLabels = dimensionNames.map((dn) => {
    const d = allDimensions.find((x) => x.name === dn);
    return (d && d.label) || dn;
  });
  const finalDimSelects = dimensionNames.map((dn) => {
    const d = allDimensions.find((x) => x.name === dn);
    return `${qIdent(dn)} AS ${qIdent((d && d.label) || dn)}`;
  });
  const finalAtomSelects = [];
  for (const g of groups) for (const a of g.atoms) finalAtomSelects.push(qIdent(a.col));

  let sql = `SELECT ${[...finalDimSelects, ...finalAtomSelects].join(', ')} FROM ${fromSql}`;
  if (dimNameCols.length > 0) sql += ` ORDER BY ${dimNameCols[0]}`;
  const lim = Math.min(Number(limit) || 1000, 1_000_000);
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

module.exports = { tryServeFromRollup };
