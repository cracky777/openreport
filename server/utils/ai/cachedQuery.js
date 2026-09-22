// The assistant's only way to data. It asks this server's own /query over
// loopback AS THE REQUESTING USER, so access checks, extras gating and RLS are
// the one existing gate rather than a second copy of it — always with
// `cacheOnly`, which /query answers from the rollup store or not at all.
//
// The internal token that carries the user's identity is also what unlocks the
// rollup builder's powers on /query. So the body below is assembled field by
// field from validated values; the model's arguments are never spread into it.

const internalToken = require('../internalToken');
const { reportExtras } = require('../rollupPlanning');

const MAX_ROWS = 200;
const DEFAULT_ROWS = 50;
const MAX_CELL_CHARS = 200;
const MAX_FILTER_VALUES = 50;
const SCALAR_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
const LIST_OPS = new Set(['in', 'not_in', 'between']);

function cleanValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length <= MAX_CELL_CHARS) return v;
  return undefined;
}

// Names are looked up in the effective model and nothing else: an unknown
// name is an error handed back to the model, never a string passed along.
function buildBody({ report, effective, args }) {
  const a = args && typeof args === 'object' ? args : {};
  const dims = Array.isArray(a.dimensions) ? a.dimensions : [];
  const measures = Array.isArray(a.measures) ? a.measures : [];
  const dimNames = new Set(effective.dimensions.map((d) => d.name));
  const measureNames = new Set(effective.measures.map((m) => m.name));

  if (dims.length > 4 || measures.length > 6) return { error: 'Too many fields: at most 4 dimensions and 6 measures' };
  for (const n of dims) if (!dimNames.has(n)) return { error: `Unknown dimension: ${String(n).slice(0, 80)}` };
  for (const n of measures) if (!measureNames.has(n)) return { error: `Unknown measure: ${String(n).slice(0, 80)}` };

  // The planner only serves aggregates, plus the one-dimension distinct list.
  const distinct = measures.length === 0 && dims.length === 1;
  if (measures.length === 0 && !distinct) return { error: 'Ask for at least one measure, or exactly one dimension to list its values' };

  const widgetFilters = [];
  const filters = Array.isArray(a.filters) ? a.filters : [];
  if (filters.length > 5) return { error: 'Too many filters: at most 5' };
  for (const f of filters) {
    if (!f || !dimNames.has(f.field)) return { error: `Unknown filter field: ${String(f && f.field).slice(0, 80)}` };
    const values = (Array.isArray(f.values) ? f.values : []).map(cleanValue);
    if (values.length === 0 || values.length > MAX_FILTER_VALUES || values.includes(undefined)) {
      return { error: `Invalid filter values for ${f.field}` };
    }
    if (SCALAR_OPS.has(f.op)) widgetFilters.push({ field: f.field, isMeasure: false, op: f.op, value: values[0], values: [] });
    else if (LIST_OPS.has(f.op)) widgetFilters.push({ field: f.field, isMeasure: false, op: f.op, value: '', values });
    else return { error: `Unsupported filter operator: ${String(f.op).slice(0, 20)}` };
  }

  const limit = Math.min(Math.max(1, Math.round(Number(a.limit)) || DEFAULT_ROWS), MAX_ROWS);
  return {
    body: {
      dimensionNames: dims,
      measureNames: measures,
      widgetFilters,
      distinct,
      limit,
      // A conversation about a model, from the landing page, has no report
      // (`id: null`): the key is then absent altogether rather than null. It
      // only ever comes from the scope the ROUTE built — never from the
      // model's arguments, which could otherwise name someone else's report
      // and load its persisted extras.
      ...(report.id ? { reportId: report.id } : {}),
      cacheOnly: true,
      ...reportExtras(report.settings),
    },
  };
}

async function defaultFireQuery({ user, orgId, modelId, body }) {
  const token = internalToken.sign({ userId: user.id, organizationId: orgId || null });
  const res = await fetch(`${internalToken.appBase()}/api/models/${modelId}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [internalToken.HEADER]: token },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && json.error) || `query failed (${res.status})`);
  return json;
}

function truncateCell(v) {
  return typeof v === 'string' && v.length > MAX_CELL_CHARS ? `${v.slice(0, MAX_CELL_CHARS)}…` : v;
}

/**
 * @returns {Promise<{rows: object[], truncated: boolean} | {miss: string} | {error: string}>}
 */
async function queryCached({ user, orgId, report, effective, args }, deps = {}) {
  const built = buildBody({ report, effective, args });
  if (built.error) return { error: built.error };

  const fireQuery = deps.fireQuery || defaultFireQuery;
  let json;
  try {
    json = await fireQuery({ user, orgId, modelId: report.model_id, body: built.body });
  } catch {
    return { error: 'The cache could not be queried' };
  }

  // Fail closed. A response that does not say it came from the rollup store is
  // treated as a leak-in-waiting and dropped — this also covers a /query that
  // does not know the flag (an older or shadowed route) and ran live.
  const cache = (json && json._cache) || {};
  if (cache.cacheOnly === true && cache.hit === false) return { miss: cache.reason || 'not-cached' };
  if (!(cache.hit === true && cache.fromRollup)) return { error: 'The answer did not come from the cache and was discarded' };

  // Only the rows go on: `sql` names physical tables and `_rls` carries the
  // user's e-mail and allowed keys.
  const all = Array.isArray(json.rows) ? json.rows : [];
  const rows = all.slice(0, built.body.limit).map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k] = truncateCell(v);
    return out;
  });
  // /query already applied the limit, so a full page is the only sign that
  // more rows exist.
  return { rows, truncated: all.length >= built.body.limit };
}

module.exports = { queryCached, buildBody, fireQuery: defaultFireQuery, MAX_ROWS };
