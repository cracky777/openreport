/**
 * In-memory query result cache. Wraps the dialect connectors so a repeat
 * query (same datasource + identical SQL + identical RLS context) is
 * served from RAM instead of round-tripping to the source DB.
 *
 * Design:
 *   - Key = SHA-256 of `${datasourceId}|${sql}|${rlsKey}`. The SQL is
 *     post-built (the QueryBuilder already inlined every filter, so two
 *     visually identical UI states produce the same key).
 *   - Value = `{ rows, builtAt, queryDurationMs }`. We store rows as-is —
 *     they're already JSON-clean from the connector layer (Date → ISO).
 *   - Eviction = LRU + TTL (configurable in app_settings; default 5 min).
 *   - Invalidation = explicit flush (admin button), implicit on model
 *     or datasource updates, or per-entry bypass when a widget refresh
 *     is user-initiated.
 *
 * Cloud mode mirrors this with the same API but a Redis-backed adapter
 * (see cloud/utils/queryCache.js). Both expose the same `get`, `set`,
 * `invalidateModel`, `invalidateDatasource`, `flush` shape so the route
 * handler doesn't care which one it's talking to.
 */

const crypto = require('crypto');
const { LRUCache } = require('lru-cache');
const {
  isQueryCacheEnabled,
  getQueryCacheTtlMs,
  getQueryCacheMaxEntries,
} = require('./settingsHelper');

// Per-key indexing so we can invalidate "every entry for model X" or
// "every entry for datasource Y" without scanning the LRU. Each entry
// also records a model-id hint when the caller provides it.
const cache = new LRUCache({
  max: 5000, // hard ceiling — actual cap comes from settings on each set
  ttl: 60_000, // overridden per-entry on set
  ttlAutopurge: true,
  // Approximate sizing — caller can pass `size` in setOpts if known
});
const indexByModel = new Map();      // modelId → Set<key>
const indexByDatasource = new Map(); // datasourceId → Set<key>
const indexByOrg = new Map();        // orgId → Set<key> (cloud only — OSS never populates this)

// Per-org RAM quota hook. Cloud installs `setOrgQuotaResolver(orgId => maxBytes)`
// at boot so `set()` can refuse new entries when the calling org has filled
// its plan's `cacheRamLimits.maxBytes`. OSS leaves the resolver null and
// every set() succeeds — no orgs to gate.
let _orgQuotaResolver = null;
function setOrgQuotaResolver(fn) {
  _orgQuotaResolver = typeof fn === 'function' ? fn : null;
}

function indexAdd(map, id, key) {
  if (!id) return;
  let set = map.get(id);
  if (!set) { set = new Set(); map.set(id, set); }
  set.add(key);
}

function buildKey({ datasourceId, sql, rlsContext }) {
  const h = crypto.createHash('sha256');
  h.update(String(datasourceId || ''));
  h.update('\0');
  h.update(String(sql || ''));
  h.update('\0');
  h.update(rlsContext ? JSON.stringify(rlsContext) : '');
  return h.digest('hex');
}

function get(opts) {
  if (!isQueryCacheEnabled()) return null;
  const key = buildKey(opts);
  return cache.get(key) ?? null;
}

function set(opts, payload) {
  if (!isQueryCacheEnabled()) return;
  const ttl = getQueryCacheTtlMs();
  if (ttl <= 0) return;
  // Hard org-RAM quota: when the cloud has installed a resolver and the
  // caller tagged the entry with an orgId, refuse the write if it would
  // push that org over its plan's cache budget. Silent failure — the
  // route still serves the row from the live query, the dashboard's
  // RamBar shows red, and the user gets nudged to upgrade.
  if (opts.orgId && _orgQuotaResolver) {
    const max = _orgQuotaResolver(opts.orgId);
    if (max != null && max > 0) {
      const used = bytesForOrg(opts.orgId);
      const incoming = entryBytes(payload);
      if (used + incoming > max) return;
    }
  }
  const key = buildKey(opts);
  cache.set(key, payload, { ttl });
  if (opts.modelId) indexAdd(indexByModel, opts.modelId, key);
  if (opts.datasourceId) indexAdd(indexByDatasource, opts.datasourceId, key);
  if (opts.orgId) indexAdd(indexByOrg, opts.orgId, key);
}

function invalidateKey(opts) {
  const key = buildKey(opts);
  cache.delete(key);
}

function invalidateModel(modelId) {
  if (!modelId) return 0;
  const set = indexByModel.get(modelId);
  if (!set) return 0;
  let n = 0;
  for (const key of set) { cache.delete(key); n++; }
  indexByModel.delete(modelId);
  return n;
}

function invalidateDatasource(datasourceId) {
  if (!datasourceId) return 0;
  const set = indexByDatasource.get(datasourceId);
  if (!set) return 0;
  let n = 0;
  for (const key of set) { cache.delete(key); n++; }
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

// Estimate the byte footprint of an entry by JSON-stringifying it.
// Lossy (UTF-8 byte vs char-count, V8 representation overhead) but
// good enough for admin telemetry — within ~20% of actual heap.
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
  const set = indexByModel.get(modelId);
  if (!set) return 0;
  let n = 0;
  for (const key of set) {
    const v = cache.get(key);
    if (v) n += entryBytes(v);
  }
  return n;
}

function entriesForModel(modelId) {
  if (!modelId) return 0;
  const set = indexByModel.get(modelId);
  if (!set) return 0;
  let n = 0;
  for (const key of set) {
    if (cache.get(key)) n++;
  }
  return n;
}

// Per-entry breakdown. queryCache keys are SHA256(SQL+RLS) so we can't
// recover the originating widget from the key alone — we surface bytes +
// row count + builtAt and leave the caller to correlate via the cache
// inspector route (which uses planForReport to expected-shape match).
function inspectModel(modelId) {
  if (!modelId) return [];
  const set = indexByModel.get(modelId);
  if (!set) return [];
  const out = [];
  for (const key of set) {
    const v = cache.get(key);
    if (!v) continue;
    out.push({
      keyHash: String(key).slice(0, 12),
      bytes: entryBytes(v),
      builtAt: v.builtAt || null,
      rowCount: Array.isArray(v.rows) ? v.rows.length : 0,
      queryDurationMs: v.queryDurationMs || null,
    });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

function bytesForOrg(orgId) {
  if (!orgId) return 0;
  const set = indexByOrg.get(orgId);
  if (!set) return 0;
  let n = 0;
  // Prune stale keys (model/datasource invalidation deletes the entry but
  // can't reach into indexByOrg). Lazy cleanup keeps the index honest
  // without a full reverse-index walk.
  for (const key of set) {
    const v = cache.get(key);
    if (v) n += entryBytes(v);
    else set.delete(key);
  }
  return n;
}

// Most recent `builtAt` ISO timestamp across all live entries for a model.
// Returns null when nothing is cached. Surfaced on the report card so the
// user knows when the data was last warmed.
function latestBuiltAtForModel(modelId) {
  if (!modelId) return null;
  const set = indexByModel.get(modelId);
  if (!set) return null;
  let latest = null;
  for (const key of set) {
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
    maxConfigured: getQueryCacheMaxEntries(),
    ttlMs: getQueryCacheTtlMs(),
    enabled: isQueryCacheEnabled(),
    bytes: totalBytes(),
  };
}

module.exports = {
  buildKey,
  get,
  set,
  invalidateKey,
  invalidateModel,
  invalidateDatasource,
  flush,
  stats,
  totalBytes,
  bytesForModel,
  inspectModel,
  bytesForOrg,
  entriesForModel,
  latestBuiltAtForModel,
  setOrgQuotaResolver,
};
