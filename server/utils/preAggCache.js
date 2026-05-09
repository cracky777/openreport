/**
 * Pre-aggregated dataset cache.
 *
 * Sibling to `queryCache` — same idea (in-memory LRU keyed by SHA-256 of
 * a stable identity string) but the values are richer: each entry holds
 * the rows produced by a SQL with EXTRA dimensions added to GROUP BY,
 * plus the metadata needed to slice + re-aggregate them at runtime.
 *
 * A pre-agg entry covers many possible /query requests: any combination
 * of (subset of dims) × (filters on the dims) × (subset of measures) is
 * served from the same dataset, as long as
 *   1. all requested dims are present in `dims`
 *   2. all filter dims are present in `dims`
 *   3. all requested measures are listed in `measures` AND additive
 *      (sum / count / min / max — see inMemoryAgg.canServe)
 *
 * Hit path therefore avoids the source DB entirely. Miss path falls back
 * to the regular query cache → DB.
 *
 * Key shape:
 *   sha256(datasourceId | modelId | shapeJson | rlsJson)
 * where `shapeJson` is the stringified base shape — i.e. the visual's
 * intrinsic identity (its widget filters / measure aggs / report extras)
 * minus the slicer / drill / interaction filters it inherits at runtime.
 * That way the same visual stays at the same key regardless of which
 * filters the user has open.
 *
 * Lifecycle:
 *   - Set by `cacheWarmer` when a `cache_warm` schedule fires.
 *   - Read by the `/query` route before the regular cache.
 *   - Invalidated on model save (drops every entry for the model) and
 *     on datasource update (drops every entry for the datasource), same
 *     contract as queryCache.
 */

const crypto = require('crypto');
const { LRUCache } = require('lru-cache');
const { canServe, aggregate } = require('./inMemoryAgg');
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

// Same hook pattern as queryCache: cloud installs a resolver at boot to
// gate writes against per-org RAM quotas; OSS leaves it null and every
// set() is allowed.
let _orgQuotaResolver = null;
function setOrgQuotaResolver(fn) {
  _orgQuotaResolver = typeof fn === 'function' ? fn : null;
}

function indexAdd(map, id, key) {
  if (!id) return;
  let s = map.get(id);
  if (!s) { s = new Set(); map.set(id, s); }
  s.add(key);
}

// Build a stable JSON shape from the visual's intrinsic identity. Order
// matters — array sort + Object.keys-sort guarantee that two visuals
// with the same logical shape produce byte-identical strings.
//
// `dims` is intentionally NOT part of the key. A visual that drills
// from year → month → week sends a different `dimensionNames` for each
// level, but the pre-agg DATASET (with the full hierarchy + slicer
// dims) can serve all of them. `canServe` validates the dim-subset
// match at lookup time. Including dims here would force one pre-agg
// per drill level, which defeats the purpose.
//
// The accepted `dims` field is preserved on the API for symmetry with
// the runtime call sites; we just don't fold it into the digest.
function stableShape({ measures, baseFilters, widgetFilters, reportExtras }) {
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
    stableJson(baseFilters || {}),
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

// Try to serve a request from a pre-agg dataset. Returns null on miss
// (caller falls back to regular cache + DB) or { rows, builtAt } on hit.
function tryServe(opts, request) {
  if (!isQueryCacheEnabled()) return null;
  const key = buildKey(opts);
  const entry = cache.get(key);
  if (!entry) return null;
  if (!canServe({ dataset: entry.dataset, request })) return null;
  const rows = aggregate({ dataset: entry.dataset, request });
  return { rows, builtAt: entry.builtAt, fromPreAgg: true };
}

// Store a pre-agg dataset. `dataset` follows the inMemoryAgg shape:
// `{ dims: [...], measures: { alias: { type } }, rows: [...] }`.
function set(opts, dataset) {
  if (!isQueryCacheEnabled()) return;
  const ttl = getQueryCacheTtlMs();
  if (ttl <= 0) return;
  const entry = { dataset, builtAt: new Date().toISOString() };
  // Hard org-RAM quota: refuse the write if it would push the org over
  // its plan's cache budget. Same contract as queryCache.set.
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

function bytesForOrg(orgId) {
  if (!orgId) return 0;
  const s = indexByOrg.get(orgId);
  if (!s) return 0;
  let n = 0;
  // Lazy cleanup of stale keys (model/datasource invalidation can't
  // reach indexByOrg). Same approach as queryCache.bytesForOrg.
  for (const key of s) {
    const v = cache.get(key);
    if (v) n += entryBytes(v);
    else s.delete(key);
  }
  return n;
}

// Most recent `builtAt` ISO timestamp across all live entries for a model.
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
  tryServe,
  set,
  invalidateModel,
  invalidateDatasource,
  flush,
  stats,
  totalBytes,
  bytesForModel,
  bytesForOrg,
  entriesForModel,
  latestBuiltAtForModel,
  setOrgQuotaResolver,
};
