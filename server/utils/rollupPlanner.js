/**
 * Aggregate-aware runtime planner.
 *
 * Called at the top of POST /api/models/:id/query. Decides whether the
 * request can be served from a materialised rollup instead of the source
 * fact table, and if so builds + executes the rollup SQL.
 *
 * Filter model (see project memory `rollup-table-cache-architecture`,
 * the 2026-05 revision):
 *   - The report's GLOBAL filter bar is BAKED into the rollup at build.
 *     We split the request's widgetFilters into the global portion
 *     (field+op matches a `settings.reportFilters` rule — the client
 *     already applied exclusions) and the rest. The global portion's
 *     normalized hash must equal the rollup's `base_filter_hash`, else
 *     it's a different data slice → MISS → live fact query (this is the
 *     accepted "changing the global bar = rebuild" tradeoff).
 *   - Cross-filter / drill / widget-own filters are NOT baked: their
 *     dims are in the grain and we re-apply them at query time.
 *
 * Re-aggregation:
 *   - We ALWAYS GROUP BY the requested display dims and recombine.
 *   - additive (sum/count→SUM, min→MIN, max→MAX): valid for any rollup
 *     whose grain ⊇ (displayDims ∪ runtime-filter dims).
 *   - non-additive (avg / ratio / `_calc.%`): only when the rollup grain
 *     == displayDims exactly (no aggregation collapses rows) and no
 *     runtime filter sits on a non-displayed dim; otherwise MISS.
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
const { recomposeMeasure } = require('./measureType');

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

// Report's global-filter-bar rule definitions (field+op identify a rule;
// values are the current selection). Used to split the runtime
// widgetFilters into the baked-global portion vs the rest.
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
  // exclusions, so whatever global rule is present here genuinely
  // applies) is BAKED into the rollup; the rest is applied at runtime.
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
  const runtimeFilterDims = [
    ...runtimePart.map((f) => f.field),
    ...objFilterKeys,
  ];
  const grainDims = [...new Set([...dimensionNames, ...runtimeFilterDims])];
  if (measureNames.length === 0) return { hit: false, reason: 'no-measures' };

  // grainDims may be empty here: a scorecard (no display dims) whose
  // only filters are the baked global bar. That's still servable —
  // findBestRollup with an empty wanted-set matches ANY rollup under
  // the same base_filter_hash (the additive atoms summed over the whole
  // rollup = the grand total of the baked slice). No GROUP BY is emitted
  // below, so we get one recomposed row. This is what keeps scorecards
  // off Postgres on every drill/cross-filter refresh.
  const rollup = rollupBuilder.findBestRollup({ modelId: mid, grainDims, baseFilterHash, orgId });
  if (!rollup) return { hit: false, reason: 'no-rollup' };
  if (rollup.storageMode !== 'duckdb') return { hit: false, reason: 'source-storage-unsupported' };

  // The manifest carries the recompose recipe: per-output decomposed
  // spec + the physical additive atom columns with their re-agg fn.
  const manifest = rollup.measures || { outputs: [], atoms: [] };
  const outputByName = new Map((manifest.outputs || []).map((o) => [o.name, o]));
  const reqOutputs = [];
  for (const mn of measureNames) {
    const o = outputByName.get(mn);
    if (!o || !o.supported || !o.spec) {
      return { hit: false, reason: `non-decomposable:${mn}` };
    }
    reqOutputs.push(o);
  }
  const atoms = manifest.atoms || [];
  if (atoms.length === 0) return { hit: false, reason: 'no-atoms' };

  // SELECT: display dims aliased to label||name + every atom re-aggregated
  // by its stored fn (SUM / MIN / MAX). Recompose happens in JS per row.
  const dimSelects = dimensionNames.map((dn) => {
    const d = allDimensions.find((x) => x.name === dn);
    return `${qIdent(dn)} AS ${qIdent((d && d.label) || dn)}`;
  });
  const atomSelects = atoms.map(
    (a) => `${a.agg}(${qIdent(a.col)}) AS ${qIdent(a.col)}`
  );

  // WHERE — runtime filters ONLY (global already baked into the rollup).
  const whereParts = [];
  for (const [dn, vals] of Object.entries(filters || {})) {
    if (!Array.isArray(vals) || vals.length === 0) continue;
    const d = allDimensions.find((x) => x.name === dn);
    const dimType = d ? d.type : 'string';
    whereParts.push(
      `${qIdent(dn)} IN (${vals.map((v) => litFor(dimType, v)).join(', ')})`
    );
  }
  for (const f of runtimePart) {
    const d = allDimensions.find((x) => x.name === f.field);
    const dimType = d ? d.type : 'string';
    const clause = scalarClause(f.field, dimType, f.op, f.value, f.values);
    if (clause === null) return { hit: false, reason: `unsupported-op:${f.op}` };
    whereParts.push(clause);
  }

  let sql = `SELECT ${[...dimSelects, ...atomSelects].join(', ')} FROM ${qIdent(rollup.tableName)}`;
  if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(' AND ')}`;
  if (dimensionNames.length > 0) {
    sql += ` GROUP BY ${dimensionNames.map((dn) => qIdent(dn)).join(', ')}`;
    const first = dimensionNames[0];
    const d = allDimensions.find((x) => x.name === first);
    sql += ` ORDER BY ${qIdent((d && d.label) || first)}`;
  }
  const lim = Math.min(Number(limit) || 1000, 1_000_000);
  sql += ` LIMIT ${lim}`;

  let rawRows;
  try {
    rawRows = await rollupDuckDB.query(sql);
  } catch (err) {
    return { hit: false, reason: `duckdb-error:${err.message}` };
  }

  // Recompose: project dims (already aliased to label) + recombine each
  // requested measure from the aggregated atoms. Raw atom columns are
  // dropped — the response shape matches the normal /query path.
  const dimLabels = dimensionNames.map((dn) => {
    const d = allDimensions.find((x) => x.name === dn);
    return (d && d.label) || dn;
  });
  let rows = rawRows.map((raw) => {
    const out = {};
    for (const lbl of dimLabels) out[lbl] = raw[lbl];
    const getAtom = (col) => {
      const v = raw[col];
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    for (const o of reqOutputs) {
      out[o.label] = recomposeMeasure(o.spec, o.name, getAtom);
    }
    return out;
  });

  // top_n / bottom_n applied in memory, same as the fact path.
  const topN = wf.find(isSyntheticTopN);
  if (topN && topN.field) {
    const n = Math.max(1, Math.floor(topN.value || 0));
    if (n > 0 && rows.length > n) {
      const o = outputByName.get(topN.field);
      const key = o ? o.label : topN.field;
      const dir = topN.op === 'top_n' ? 'desc' : 'asc';
      rows = [...rows].sort((a, b) => {
        const va = Number(a[key]); const vb = Number(b[key]);
        const na = Number.isFinite(va) ? va : 0;
        const nb = Number.isFinite(vb) ? vb : 0;
        return dir === 'desc' ? nb - na : na - nb;
      }).slice(0, n);
    }
  }

  return { hit: true, rows, tableName: rollup.tableName, match: rollup.match, sql };
}

module.exports = { tryServeFromRollup };
