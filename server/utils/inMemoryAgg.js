/**
 * Pure in-memory aggregation over a pre-grouped dataset.
 *
 * Given a dataset that was produced by SQL with a SUPERSET of group-by
 * dimensions (e.g. cached at warm time with `[year, month, country]` even
 * though the requesting visual only needs `[year]`), this module:
 *   1. Filters rows down to those matching the user's slicer / drill / etc.
 *      filter set.
 *   2. Re-groups the surviving rows by the requested dimension subset.
 *   3. Re-aggregates each measure column according to its declared type.
 *
 * Supported measure types are the additive / monoidal ones: SUM, COUNT,
 * COUNT_NOT_NULL (count, count_*), MIN, MAX. AVG is supported when the
 * caller passes BOTH the SUM and the COUNT components separately at warm
 * time (we can't recover an average from already-averaged sub-groups).
 * COUNT_DISTINCT, MEDIAN, PERCENTILE, STDDEV, custom expressions etc. are
 * NOT supported — the eligibility detector upstream rejects them so the
 * /query route falls back to the regular cache + DB path.
 *
 * The function intentionally has zero coupling to the query builder, the
 * settings layer, or any I/O. Keep it that way — it's the easiest thing
 * to test in this whole feature, and a regression here corrupts every
 * pre-aggregated visual silently.
 *
 * Contract on inputs:
 *   - `dataset.rows`: array of plain objects keyed by alias
 *   - `dataset.dims`: array of dim aliases that are present in every row
 *   - `dataset.measures`: { alias → { type: 'sum'|'count'|'min'|'max', sourceField? } }
 *   - `request.dims`: subset of dataset.dims that the requester wants
 *   - `request.filters`: { dimAlias → array_of_allowed_values }
 *   - `request.measures`: subset of dataset.measure aliases
 *
 * Returns a fresh array of rows; the input dataset is not mutated.
 */

// Resolve a dim/measure NAME into the actual key under which it lives in
// the dataset rows. SQL aliases columns by `label || name` (see the
// route's selectParts), so when the user renamed a measure the cache
// stores rows keyed by the label while everything upstream still
// references it by its model name. The dataset carries an optional
// `rowKeys: { name → alias }` map; when missing we fall back to the
// name itself (the no-rename case, e.g. `name === label`).
function rowKeyFor(dataset, name) {
  if (dataset && dataset.rowKeys && dataset.rowKeys[name] != null) {
    return dataset.rowKeys[name];
  }
  return name;
}

function rowMatchesFilters(dataset, row, filters) {
  if (!filters) return true;
  for (const [dim, allowed] of Object.entries(filters)) {
    if (!Array.isArray(allowed) || allowed.length === 0) continue;
    const v = row[rowKeyFor(dataset, dim)];
    // Equality is loose: SQL might bring back numeric IDs or strings
    // depending on the dialect, and the user's filter values come from
    // the slicer UI as strings. String-coerce both before comparing so
    // `2025` and `"2025"` are treated the same — the same coercion the
    // server uses when injecting the IN list into the WHERE clause.
    const sv = v == null ? '' : String(v);
    if (!allowed.some((a) => String(a) === sv)) return false;
  }
  return true;
}

// Build a stable key for the requested dims so two rows with the same
// `(year, country)` collapse into one bucket. JSON.stringify alone would
// be fine but we also need the dims in deterministic order — fix that
// upstream when we build the request object.
function groupKey(dataset, row, dims) {
  if (dims.length === 0) return '__';
  const out = new Array(dims.length);
  for (let i = 0; i < dims.length; i++) {
    const v = row[rowKeyFor(dataset, dims[i])];
    out[i] = v == null ? '__null__' : String(v);
  }
  return out.join('|');
}

function aggregate({ dataset, request }) {
  if (!dataset || !Array.isArray(dataset.rows)) {
    throw new Error('inMemoryAgg.aggregate: dataset.rows must be an array');
  }
  const reqDims = Array.isArray(request.dims) ? request.dims : [];
  const reqMeasures = Array.isArray(request.measures) ? request.measures : [];
  const filters = request.filters || {};
  const measures = dataset.measures || {};

  // Verify the request is satisfiable. Caller should've vetted this with
  // the eligibility detector but a sanity check costs nothing.
  for (const d of reqDims) {
    if (!dataset.dims.includes(d)) {
      throw new Error(`inMemoryAgg.aggregate: requested dim "${d}" not in dataset`);
    }
  }
  for (const m of reqMeasures) {
    if (!measures[m]) {
      throw new Error(`inMemoryAgg.aggregate: requested measure "${m}" not in dataset`);
    }
  }
  for (const fdim of Object.keys(filters)) {
    if (!dataset.dims.includes(fdim)) {
      throw new Error(`inMemoryAgg.aggregate: filter dim "${fdim}" not in dataset`);
    }
  }

  // Initialise an aggregator per group. Each measure starts as `null` so
  // the first row defines the seed value (matters for MIN/MAX where 0 is
  // a valid datum and we can't use it as sentinel). Output rows are
  // keyed by the alias (the SQL column name) so callers downstream see
  // the exact same shape they would from a fresh SQL call.
  const groups = new Map();
  for (const row of dataset.rows) {
    if (!rowMatchesFilters(dataset, row, filters)) continue;
    const k = groupKey(dataset, row, reqDims);
    let bucket = groups.get(k);
    if (!bucket) {
      bucket = { dims: {}, measures: {} };
      for (const d of reqDims) {
        const alias = rowKeyFor(dataset, d);
        bucket.dims[alias] = row[alias];
      }
      for (const m of reqMeasures) bucket.measures[rowKeyFor(dataset, m)] = null;
      groups.set(k, bucket);
    }
    for (const m of reqMeasures) {
      const def = measures[m];
      const alias = rowKeyFor(dataset, m);
      const v = row[alias];
      if (v == null) continue;
      const num = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(num)) continue;
      const cur = bucket.measures[alias];
      switch (def.type) {
        case 'sum':
        case 'count':
          bucket.measures[alias] = (cur == null ? 0 : cur) + num;
          break;
        case 'min':
          bucket.measures[alias] = cur == null ? num : Math.min(cur, num);
          break;
        case 'max':
          bucket.measures[alias] = cur == null ? num : Math.max(cur, num);
          break;
        default:
          throw new Error(`inMemoryAgg.aggregate: unsupported measure type "${def.type}" for "${m}"`);
      }
    }
  }

  // Materialise the buckets back to the same flat shape the SQL path
  // returns. Callers should treat this as drop-in equivalent.
  const out = new Array(groups.size);
  let i = 0;
  for (const bucket of groups.values()) {
    out[i++] = { ...bucket.dims, ...bucket.measures };
  }
  return out;
}

// Whether a dataset can serve a given request. The caller uses this BEFORE
// touching the actual rows so we never load a 100k-row dataset just to
// realise we can't reduce it. Cheap structural check.
function canServe({ dataset, request }) {
  if (!dataset || !Array.isArray(dataset.dims)) return false;
  const reqDims = Array.isArray(request.dims) ? request.dims : [];
  const reqMeasures = Array.isArray(request.measures) ? request.measures : [];
  const filters = request.filters || {};
  for (const d of reqDims) if (!dataset.dims.includes(d)) return false;
  for (const fdim of Object.keys(filters)) if (!dataset.dims.includes(fdim)) return false;
  const measures = dataset.measures || {};
  for (const m of reqMeasures) {
    const def = measures[m];
    if (!def || !['sum', 'count', 'min', 'max'].includes(def.type)) return false;
  }
  return true;
}

module.exports = { aggregate, canServe };
