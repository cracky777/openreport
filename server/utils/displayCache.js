/**
 * Display-grain cache (Phase 4).
 *
 * Replaces preAggCache. Each entry holds the rows of ONE SQL that fired
 * with `GROUP BY GROUPING SETS` covering every display grain the widget
 * could reach — each drill level × each subset of cross-filter dims
 * potentially propagated from other widgets on the same report.
 *
 * Each row carries a `_grain` bitmask emitted by SQL's GROUPING_ID(d1,
 * d2, … dn) in the same dim order the cache stored under `dataset.dims`.
 * A bit is 0 when the dim is grouped (= part of this row's grain) and 1
 * when it's aggregated (= not part of this row's grain). At runtime the
 * route computes the expected bitmask from `(dimensionNames ∪ filter
 * keys)`, filters cache rows by `_grain === expected`, then by the
 * active filter values. NO aggregation happens in JS — every row's
 * measures are already at the SQL-computed display grain.
 *
 * Contract on a stored dataset:
 *   {
 *     dims: ['year', 'quarter', …],    // ordered list used in GROUPING_ID
 *     rows: [
 *       { year: 2026, quarter: null, …, _grain: 14, perdu: 100, traite: 500 },
 *       …
 *     ],
 *     // Optional: SQL alias map for dims/measures whose label !== name.
 *     // Same idea as inMemoryAgg.rowKeys.
 *     rowKeys: { name → alias },
 *   }
 *
 * Cache key (independent of dims / filters): SHA-256 of
 *   `datasourceId | modelId | shape | rlsContext`
 * where `shape` is the widget's intrinsic identity (its measures,
 * widgetFilters, reportExtras) — same idea as preAggCache.stableShape.
 *
 * Lifecycle:
 *   - Set by the cacheWarmer once per `cache_warm` schedule run.
 *   - Read by the /query route BEFORE the SQL-keyed queryCache.
 *   - Invalidated on model save (drops every entry for the model) and on
 *     datasource update (drops every entry for the datasource).
 */

const crypto = require('crypto');
const { LRUCache } = require('lru-cache');
const {
  isQueryCacheEnabled,
  getQueryCacheTtlMs,
} = require('./settingsHelper');

const cache = new LRUCache({
  max: 1000,
  ttl: 60_000,
  ttlAutopurge: true,
});
const indexByModel = new Map();
const indexByDatasource = new Map();
const indexByOrg = new Map(); // orgId → Set<key> (cloud only)

// Same hook pattern as queryCache/preAggCache — cloud installs a resolver
// at boot to gate writes against per-org RAM quotas. OSS leaves it null
// and every set() is allowed.
let _orgQuotaResolver = null;
function setOrgQuotaResolver(fn) {
  _orgQuotaResolver = typeof fn === 'function' ? fn : null;
}

function indexAdd(map, id, key) {
  let s = map.get(id);
  if (!s) { s = new Set(); map.set(id, s); }
  s.add(key);
}

// Stable widget identity. Mirrors preAggCache.stableShape but drops the
// dims slot (dims aren't in the key — the GROUPING SETS shape covers
// every dim combo the widget will request at runtime).
function stableShape({ measures, widgetFilters, reportExtras }) {
  const sortedMeasures = (measures || []).slice().sort();
  const stableJson = (obj) => {
    if (obj == null) return 'null';
    if (Array.isArray(obj)) return `[${obj.map(stableJson).join(',')}]`;
    if (typeof obj === 'object') {
      const keys = Object.keys(obj).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
    }
    return JSON.stringify(obj);
  };
  return [
    sortedMeasures.join(','),
    stableJson(widgetFilters || []),
    stableJson(reportExtras || {}),
  ].join('||');
}

function buildKey({ datasourceId, modelId, shape, rlsContext }) {
  const h = crypto.createHash('sha256');
  h.update(String(datasourceId || ''));
  h.update('');
  h.update(String(modelId || ''));
  h.update('');
  h.update(String(shape || ''));
  h.update('');
  h.update(rlsContext ? JSON.stringify(rlsContext) : '');
  return h.digest('hex');
}

// Compute the GROUPING_ID bitmask for a given set of "grain dims" against
// the dataset's ordered dim list. Mirrors the SQL semantics:
//   - dim[i] in grain → bit = 0
//   - dim[i] NOT in grain → bit = 1 (aggregated for this row)
// High-order bit = dim[0]. This matches Postgres/BigQuery/MS SQL/DuckDB
// GROUPING_ID behavior; MySQL 8.0's GROUPING(d1, d2, …) returns the same
// bitmask shape.
function grainBitmask(dimList, grainDims) {
  if (!Array.isArray(dimList) || dimList.length === 0) return 0;
  const grainSet = new Set(grainDims || []);
  let bm = 0;
  const n = dimList.length;
  for (let i = 0; i < n; i++) {
    if (!grainSet.has(dimList[i])) {
      bm |= (1 << (n - 1 - i));
    }
  }
  return bm;
}

// Look up a widget's display dataset and return ONLY the rows that match
// the request's grain + filter values. The runtime never aggregates —
// the cache already holds the SQL-computed values at every grain the
// widget could possibly display.
//
// On miss returns `{ hit: false, reason }` so the caller can attach the
// reason to `_cache.preAggReason` in the response — same diagnostic
// pattern as preAggCache.tryServeWithReason.
function tryServeWithReason(opts, request) {
  if (!isQueryCacheEnabled()) return { hit: false, reason: 'cache-disabled' };
  const key = buildKey(opts);
  const entry = cache.get(key);
  if (!entry) return { hit: false, reason: 'no-entry' };

  const dataset = entry.dataset || {};
  const dimList = Array.isArray(dataset.dims) ? dataset.dims : [];
  const reqDims = Array.isArray(request.dims) ? request.dims : [];
  const filters = request.filters || {};
  const filterDimKeys = Object.keys(filters).filter((d) => {
    const v = filters[d];
    return Array.isArray(v) && v.length > 0;
  });

  // Grain = the dims that have a non-aggregated value in the row we want.
  // That's the union of "dims the widget displays" and "dims it filters
  // on" — the SQL warmer must have included a grouping set with EXACTLY
  // this combination.
  const grainDims = [...new Set([...reqDims, ...filterDimKeys])];
  for (const d of grainDims) {
    if (!dimList.includes(d)) {
      return {
        hit: false,
        reason: 'missing-grain-dim',
        details: { missingDim: d, datasetDims: dimList },
      };
    }
  }

  const expectedGrain = grainBitmask(dimList, grainDims);
  const allRows = Array.isArray(dataset.rows) ? dataset.rows : [];

  // First pass: keep only rows at the expected grain. SQL's GROUPING_ID
  // emits one bitmask value per grouping set; the warmer stores it under
  // `_grain` on every row.
  const grainRows = [];
  for (const r of allRows) {
    if (r && r._grain === expectedGrain) grainRows.push(r);
  }
  if (grainRows.length === 0 && expectedGrain !== 0) {
    // We have an entry but no rows at this grain — the warmer didn't
    // include this combination in its GROUPING SETS. Caller falls back
    // to queryCache / DB.
    return {
      hit: false,
      reason: 'grain-not-warmed',
      details: { expectedGrain, datasetDims: dimList },
    };
  }

  // Second pass: filter rows by the active filter values. Filters can
  // only target dims that are part of the grain (we just verified they
  // were); for those, drop rows whose value isn't in the allowed list.
  let finalRows = grainRows;
  if (filterDimKeys.length > 0) {
    finalRows = grainRows.filter((r) => {
      for (const d of filterDimKeys) {
        const allowed = filters[d];
        const alias = (dataset.rowKeys && dataset.rowKeys[d]) || d;
        const v = r[alias];
        const sv = v == null ? '' : String(v);
        if (!allowed.some((a) => String(a) === sv)) return false;
      }
      return true;
    });
  }

  // Strip the `_grain` column from returned rows — it's an internal
  // helper, the client shouldn't see it.
  const out = finalRows.map((r) => {
    const { _grain, ...rest } = r;
    return rest;
  });
  return { hit: true, rows: out, builtAt: entry.builtAt };
}

// Convenience wrapper: same as tryServeWithReason but discards the
// reason, matching the simpler preAggCache.tryServe signature.
function tryServe(opts, request) {
  const r = tryServeWithReason(opts, request);
  return r.hit ? { rows: r.rows, builtAt: r.builtAt } : null;
}

// Store a dataset. The dataset must carry an ordered `dims` list (used
// to compute grain bitmasks at lookup time) and `rows` where every row
// has a `_grain` field set to SQL's GROUPING_ID emitted for that row.
function set(opts, dataset) {
  if (!isQueryCacheEnabled()) return;
  const ttl = getQueryCacheTtlMs();
  if (ttl <= 0) return;
  const entry = { dataset, builtAt: new Date().toISOString() };
  if (opts.orgId && _orgQuotaResolver) {
    const max = _orgQuotaResolver(opts.orgId);
    if (max != null && max > 0) {
      const used = bytesForOrg(opts.orgId);
      const incoming = entryBytes(entry);
      if (used + incoming > max) return;
    }
  }
  const key = buildKey(opts);
  cache.set(key, entry, { ttl });
  if (opts.modelId) indexAdd(indexByModel, opts.modelId, key);
  if (opts.datasourceId) indexAdd(indexByDatasource, opts.datasourceId, key);
  if (opts.orgId) indexAdd(indexByOrg, opts.orgId, key);
}

function invalidateModel(modelId) {
  if (!modelId) return 0;
  const s = indexByModel.get(modelId);
  if (!s) return 0;
  let n = 0;
  for (const k of s) { cache.delete(k); n++; }
  indexByModel.delete(modelId);
  return n;
}

function invalidateDatasource(datasourceId) {
  if (!datasourceId) return 0;
  const s = indexByDatasource.get(datasourceId);
  if (!s) return 0;
  let n = 0;
  for (const k of s) { cache.delete(k); n++; }
  indexByDatasource.delete(datasourceId);
  return n;
}

function flush() {
  const n = cache.size;
  cache.clear();
  indexByModel.clear();
  indexByDatasource.clear();
  indexByOrg.clear();
  return n;
}

function entryBytes(entry) {
  if (!entry) return 0;
  try { return JSON.stringify(entry).length; }
  catch { return 0; }
}

function totalBytes() {
  let n = 0;
  for (const v of cache.values()) n += entryBytes(v);
  return n;
}

function bytesForModel(modelId) {
  if (!modelId) return 0;
  const s = indexByModel.get(modelId);
  if (!s) return 0;
  let n = 0;
  for (const key of s) {
    const v = cache.get(key);
    if (v) n += entryBytes(v);
  }
  return n;
}

function entriesForModel(modelId) {
  if (!modelId) return 0;
  const s = indexByModel.get(modelId);
  if (!s) return 0;
  let n = 0;
  for (const key of s) {
    if (cache.get(key)) n++;
  }
  return n;
}

function inspectModel(modelId) {
  if (!modelId) return [];
  const s = indexByModel.get(modelId);
  if (!s) return [];
  const out = [];
  for (const key of s) {
    const v = cache.get(key);
    if (!v) continue;
    const ds = v.dataset || {};
    out.push({
      keyHash: String(key).slice(0, 12),
      bytes: entryBytes(v),
      builtAt: v.builtAt || null,
      dims: Array.isArray(ds.dims) ? ds.dims : [],
      rowCount: Array.isArray(ds.rows) ? ds.rows.length : 0,
      // Distinct grain values present — useful to see WHICH drill /
      // cross-filter combinations the warmer actually populated.
      grains: ds.rows ? [...new Set(ds.rows.map((r) => r && r._grain))].sort((a, b) => a - b) : [],
    });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

function bytesForOrg(orgId) {
  if (!orgId) return 0;
  const s = indexByOrg.get(orgId);
  if (!s) return 0;
  let n = 0;
  for (const key of s) {
    const v = cache.get(key);
    if (v) n += entryBytes(v);
    else s.delete(key);
  }
  return n;
}

function latestBuiltAtForModel(modelId) {
  if (!modelId) return null;
  const s = indexByModel.get(modelId);
  if (!s) return null;
  let latest = null;
  for (const key of s) {
    const v = cache.get(key);
    if (v && v.builtAt && (latest == null || v.builtAt > latest)) {
      latest = v.builtAt;
    }
  }
  return latest;
}

function stats() {
  return {
    size: cache.size,
    enabled: isQueryCacheEnabled(),
    ttlMs: getQueryCacheTtlMs(),
    bytes: totalBytes(),
  };
}

module.exports = {
  buildKey,
  stableShape,
  grainBitmask,
  tryServe,
  tryServeWithReason,
  set,
  invalidateModel,
  invalidateDatasource,
  flush,
  stats,
  totalBytes,
  bytesForModel,
  bytesForOrg,
  entriesForModel,
  inspectModel,
  latestBuiltAtForModel,
  setOrgQuotaResolver,
};
