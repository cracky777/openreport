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

function indexAdd(map, id, key) {
  if (!id) return;
  let set = map.get(id);
  if (!set) { set = new Set(); map.set(id, set); }
  set.add(key);
}
function indexRemove(map, id, key) {
  if (!id) return;
  const set = map.get(id);
  if (!set) return;
  set.delete(key);
  if (set.size === 0) map.delete(id);
}

function buildKey({ datasourceId, sql, rlsContext }) {
  const h = crypto.createHash('sha256');
  h.update(String(datasourceId || ''));
  h.update('');
  h.update(String(sql || ''));
  h.update('');
  h.update(rlsContext ? JSON.stringify(rlsContext) : '');
  return h.digest('hex');
}

function get(opts) {
  if (!isQueryCacheEnabled()) return null;
  const key = buildKey(opts);
  const entry = cache.get(key);
  if (!entry) return null;
  return entry;
}

function set(opts, payload) {
  if (!isQueryCacheEnabled()) return;
  const key = buildKey(opts);
  const ttl = getQueryCacheTtlMs();
  if (ttl <= 0) return;
  // Cap the cache size by tracking insertion order; LRU handles the rest.
  cache.set(key, payload, { ttl });
  if (opts.modelId) indexAdd(indexByModel, opts.modelId, key);
  if (opts.datasourceId) indexAdd(indexByDatasource, opts.datasourceId, key);
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
  return n;
}

function stats() {
  return {
    size: cache.size,
    maxConfigured: getQueryCacheMaxEntries(),
    ttlMs: getQueryCacheTtlMs(),
    enabled: isQueryCacheEnabled(),
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
};
