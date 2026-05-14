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
  QUERY_CACHE_TTL_DEFAULT_MS,
  getQueryCacheMaxEntries,
} = require('./settingsHelper');

const cache = new LRUCache({
  // `max` and `ttl` here are the LRU's CEILING / FALLBACK — actual values
  // come from the admin-configured settings (`query_cache_max_entries`,
  // `query_cache_ttl_ms`) and are re-read on every `set()` call so admin
  // changes take effect without a restart. Without a constructor ttl,
  // `ttlAutopurge` couldn't tick; without a constructor max, the LRU
  // would never evict on its own. Keep both aligned with the same
  // defaults `settingsHelper.js` exposes — that way an admin reading the
  // code sees the same numbers they see in the UI.
  max: getQueryCacheMaxEntries(),
  ttl: QUERY_CACHE_TTL_DEFAULT_MS,
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

// Convert an array of row-objects into columnar form. Dict-encodes
// string columns when the cardinality is low enough that the dict
// overhead is amortised (avg value ≥ 2 chars AND ≥ 2× reuse). Plain
// arrays for numeric / boolean / high-cardinality columns. Same
// heuristic as the legacy inMemoryAgg.toColumnarDataset — kept inline
// here to avoid a cross-module dependency now that displayCache is the
// only consumer.
function rowsToColumnar(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { columns: {}, rowCount: 0 };
  }
  const rowCount = rows.length;
  const keys = new Set();
  for (const r of rows) {
    if (r) for (const k of Object.keys(r)) keys.add(k);
  }
  const columns = {};
  for (const key of keys) {
    let sample;
    for (let i = 0; i < rowCount; i++) {
      const v = rows[i] ? rows[i][key] : undefined;
      if (v != null) { sample = v; break; }
    }
    const isString = typeof sample === 'string';
    if (!isString) {
      const arr = new Array(rowCount);
      for (let i = 0; i < rowCount; i++) arr[i] = rows[i] ? (rows[i][key] ?? null) : null;
      columns[key] = arr;
      continue;
    }
    const dict = [];
    const dictMap = new Map();
    const idx = new Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
      const v = rows[i] ? rows[i][key] : null;
      if (v == null) { idx[i] = -1; continue; }
      let di = dictMap.get(v);
      if (di === undefined) {
        di = dict.length;
        dict.push(v);
        dictMap.set(v, di);
      }
      idx[i] = di;
    }
    const avgValueLen = dict.reduce((s, v) => s + (v ? String(v).length : 0), 0) / Math.max(1, dict.length);
    const reuseFactor = rowCount / Math.max(1, dict.length);
    if (avgValueLen >= 2 && reuseFactor >= 2) {
      columns[key] = { dict, idx };
    } else {
      const arr = new Array(rowCount);
      for (let i = 0; i < rowCount; i++) arr[i] = rows[i] ? (rows[i][key] ?? null) : null;
      columns[key] = arr;
    }
  }
  return { columns, rowCount };
}

// Read a single cell from a columnar grain bucket. Mirrors the legacy
// inMemoryAgg.cellAt — handles both plain-array and dict-encoded
// columns. Returns undefined when the column doesn't exist in this
// bucket (e.g. asking for a dim that wasn't in this grouping set).
function cellAt(bucket, rowIdx, key) {
  const col = bucket.columns ? bucket.columns[key] : undefined;
  if (col === undefined) return undefined;
  if (Array.isArray(col)) return col[rowIdx];
  const di = col.idx ? col.idx[rowIdx] : -1;
  if (di == null || di < 0) return null;
  return col.dict ? col.dict[di] : null;
}

// Materialize a single row object from a columnar bucket at index i.
// Used at the end of tryServeWithReason to return the small subset of
// rows that survive the filter pass.
function materializeRow(bucket, rowIdx) {
  const out = {};
  if (!bucket || !bucket.columns) return out;
  for (const key of Object.keys(bucket.columns)) {
    out[key] = cellAt(bucket, rowIdx, key);
  }
  return out;
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
  // O(1) lookup of the grain's columnar bucket.
  const grainBucket = dataset.rowsByGrain && dataset.rowsByGrain[expectedGrain];
  if (!grainBucket || grainBucket.rowCount === 0) {
    // The warmer didn't include this combination in its GROUPING SETS.
    // Caller falls back to queryCache / DB.
    if (expectedGrain === 0 && !grainBucket) {
      // Total grain (all dims grouped) — treat the absence as a normal
      // miss with the same reason key the no-rows case uses.
      return { hit: false, reason: 'grain-not-warmed', details: { expectedGrain, datasetDims: dimList } };
    }
    if (!grainBucket || grainBucket.rowCount === 0) {
      return { hit: false, reason: 'grain-not-warmed', details: { expectedGrain, datasetDims: dimList } };
    }
  }

  // Walk the columnar bucket by index. For each row, check filter
  // values via cellAt — no full-row materialization until we know the
  // row passes. Then materialize only the survivors. Reduces both the
  // GC pressure (no intermediate row objects for filtered-out rows)
  // and the time spent JSON-reading the dict every cell.
  const rowCount = grainBucket.rowCount;
  const aliasesForFilters = filterDimKeys.map((d) => ({
    d,
    alias: (dataset.rowKeys && dataset.rowKeys[d]) || d,
    allowed: filters[d],
  }));
  const out = [];
  for (let i = 0; i < rowCount; i++) {
    let ok = true;
    for (const { alias, allowed } of aliasesForFilters) {
      const v = cellAt(grainBucket, i, alias);
      const sv = v == null ? '' : String(v);
      if (!allowed.some((a) => String(a) === sv)) { ok = false; break; }
    }
    if (!ok) continue;
    out.push(materializeRow(grainBucket, i));
  }
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
//
// At write time we PRE-INDEX rows by their `_grain` value into a
// `rowsByGrain` map so lookups (which always start by selecting rows
// at a single grain) skip the linear scan over the full dataset. The
// raw `rows` array is dropped from the stored dataset to avoid double-
// counting bytes in JSON.stringify — `rowsByGrain` references the same
// row objects.
// Build a columnar dataset ONCE so multiple set() calls can store it
// under different cache keys without duplicating the per-grain row
// buckets in RAM. All the heavy lifting (grain index + dict-encoding)
// happens here; the subsequent set() calls just wrap a tiny entry
// envelope (timestamp + widgetId) around the SAME shared columnar
// reference. The `_bucketId` tag lets the inspect endpoint identify
// entries that share a dataset so the reported bytes don't double-count.
function buildSharedDataset(rawDataset) {
  let rowsByGrain = Object.create(null);
  let totalRows = 0;
  if (Array.isArray(rawDataset.rows)) {
    const grouped = Object.create(null);
    for (const r of rawDataset.rows) {
      if (r == null) continue;
      const g = r._grain;
      if (g == null) continue;
      if (!grouped[g]) grouped[g] = [];
      const { _grain, ...body } = r;
      grouped[g].push(body);
      totalRows++;
    }
    for (const g of Object.keys(grouped)) {
      rowsByGrain[g] = rowsToColumnar(grouped[g]);
    }
  }
  return {
    _bucketId: crypto.randomBytes(8).toString('hex'),
    dims: rawDataset.dims,
    rowKeys: rawDataset.rowKeys,
    rowsByGrain,
    rowCount: totalRows,
  };
}

// `opts.widgetId` (optional) — the spec identity the warmer wrote the
// entry for. Stored on the entry as a label so the inspect endpoint can
// match entries to widgets WITHOUT having to replay the warmer's
// hash-key computation. Two specs that hash to the same cache key (e.g.
// two coalesced widgets in the same bucket) get separate keys here so
// the label is unambiguous.
//
// The `dataset` arg can be EITHER a raw `{ dims, rowKeys, rows }` (the
// columnar conversion happens inline) OR a pre-built shared dataset
// from `buildSharedDataset()` (the warmer uses this to dedupe RAM
// across the widgets coalesced into one bucket SQL).
//
// Returns `{ stored, reason? }` so the caller (the warmer) can see why a
// write was rejected and surface it in the warm result. Previously these
// guard-clause early-returns were silent — the warmer counted `stored++`
// after every call regardless of whether anything actually landed in
// the LRU, so a globally disabled queryCache (or TTL=0, or the org-RAM
// quota blocking the write) looked like a successful warm with an empty
// cache. Tedious to diagnose; this status return makes it explicit.
function set(opts, dataset) {
  if (!isQueryCacheEnabled()) {
    return { stored: false, reason: 'cache-disabled' };
  }
  const ttl = getQueryCacheTtlMs();
  if (ttl <= 0) {
    return { stored: false, reason: 'ttl-zero' };
  }
  // Either a pre-built shared dataset (warmer's coalesced path) or a
  // single-use raw dataset. Detect and route accordingly: shared
  // datasets are stored BY REFERENCE so N specs in one bucket share
  // the columnar rowsByGrain memory.
  let storedDataset;
  let totalRows;
  if (dataset && dataset.rowsByGrain && typeof dataset.rowsByGrain === 'object') {
    storedDataset = dataset;
    totalRows = typeof dataset.rowCount === 'number'
      ? dataset.rowCount
      : Object.values(dataset.rowsByGrain).reduce((s, b) => s + (b.rowCount || 0), 0);
  } else {
    storedDataset = buildSharedDataset(dataset);
    totalRows = storedDataset.rowCount;
  }
  const entry = {
    dataset: storedDataset,
    builtAt: new Date().toISOString(),
    // Tag the entry with the widget identity the warmer wrote it for.
    // The inspect endpoint matches widgets to entries via this label
    // instead of recomputing the hash key — robust against subtle RLS
    // context or widgetFilters serialization differences between
    // warm-time and inspect-time.
    widgetId: opts.widgetId || null,
  };
  if (opts.orgId && _orgQuotaResolver) {
    const max = _orgQuotaResolver(opts.orgId);
    if (max != null && max > 0) {
      const used = bytesForOrg(opts.orgId);
      const incoming = entryBytes(entry);
      if (used + incoming > max) {
        return { stored: false, reason: 'org-quota-exceeded' };
      }
    }
  }
  const key = buildKey(opts);
  cache.set(key, entry, { ttl });
  if (opts.modelId) indexAdd(indexByModel, opts.modelId, key);
  if (opts.datasourceId) indexAdd(indexByDatasource, opts.datasourceId, key);
  if (opts.orgId) indexAdd(indexByOrg, opts.orgId, key);
  return { stored: true, rowCount: totalRows };
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

// Sum entry bytes deduped by `_bucketId` — multiple coalesced widgets
// share a single columnar dataset object in RAM, so counting each
// reference's `entryBytes` (which is a full JSON.stringify) inflates the
// total by N. Group by bucket and count the shared content once.
function _dedupedBytes(entries) {
  let n = 0;
  const seen = new Set();
  for (const v of entries) {
    const bid = v?.dataset?._bucketId || null;
    if (bid) {
      if (seen.has(bid)) continue;
      seen.add(bid);
    }
    n += entryBytes(v);
  }
  return n;
}

function totalBytes() {
  return _dedupedBytes(cache.values());
}

function bytesForModel(modelId) {
  if (!modelId) return 0;
  const s = indexByModel.get(modelId);
  if (!s) return 0;
  const entries = [];
  for (const key of s) {
    const v = cache.get(key);
    if (v) entries.push(v);
  }
  return _dedupedBytes(entries);
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
    const grainKeys = ds.rowsByGrain ? Object.keys(ds.rowsByGrain).map(Number).sort((a, b) => a - b) : [];
    out.push({
      keyHash: String(key).slice(0, 12),
      bytes: entryBytes(v),
      builtAt: v.builtAt || null,
      dims: Array.isArray(ds.dims) ? ds.dims : [],
      // Stored as the running total at `set` time — cheaper than walking
      // each columnar bucket to recount.
      rowCount: typeof ds.rowCount === 'number' ? ds.rowCount : 0,
      // Distinct grain bitmasks present — surfaces WHICH drill / cross-
      // filter combinations the warmer actually populated.
      grains: grainKeys,
      // Widget identity the warmer tagged on this entry — `null` if the
      // entry was set without an explicit widgetId (legacy paths).
      widgetId: v.widgetId || null,
      // Shared-dataset tag — entries with the same `bucketId` reference
      // the SAME columnar rowsByGrain object in RAM. Used by the inspect
      // endpoint to dedupe reported bytes across coalesced widgets.
      bucketId: ds._bucketId || null,
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
  buildSharedDataset,
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
