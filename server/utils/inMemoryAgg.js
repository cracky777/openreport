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

const { compileExpression } = require('./measureType');

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

// Read a single cell from a dataset. Supports two storage layouts:
//   - Legacy row-objects: `dataset.rows[rowIdx][alias]`
//   - Columnar (preferred — emits significantly smaller JSON / heap):
//       `dataset.columns[alias]` is either a plain array of values OR a
//       `{ dict, idx }` pair (low-cardinality string interning).
function cellAt(dataset, rowIdx, alias) {
  if (dataset.columns) {
    const col = dataset.columns[alias];
    if (col === undefined) return undefined;
    if (Array.isArray(col)) return col[rowIdx];
    // Dict-encoded column
    const di = col.idx ? col.idx[rowIdx] : -1;
    if (di == null || di < 0) return null;
    return col.dict ? col.dict[di] : null;
  }
  const row = dataset.rows ? dataset.rows[rowIdx] : null;
  return row ? row[alias] : undefined;
}

function datasetRowCount(dataset) {
  if (!dataset) return 0;
  if (typeof dataset.rowCount === 'number') return dataset.rowCount;
  return Array.isArray(dataset.rows) ? dataset.rows.length : 0;
}

function rowMatchesFilters(dataset, rowIdx, filters) {
  if (!filters) return true;
  for (const [dim, allowed] of Object.entries(filters)) {
    if (!Array.isArray(allowed) || allowed.length === 0) continue;
    const v = cellAt(dataset, rowIdx, rowKeyFor(dataset, dim));
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
function groupKey(dataset, rowIdx, dims) {
  if (dims.length === 0) return '__';
  const out = new Array(dims.length);
  for (let i = 0; i < dims.length; i++) {
    const v = cellAt(dataset, rowIdx, rowKeyFor(dataset, dims[i]));
    out[i] = v == null ? '__null__' : String(v);
  }
  return out.join('|');
}

// Convert a legacy row-objects dataset into the columnar form. String
// columns with low cardinality become dict-encoded ({dict, idx}). Numeric
// / boolean / high-cardinality columns become plain arrays. The output
// drops `rows` and adds `columns` + `rowCount`.
function toColumnarDataset(dataset) {
  if (!dataset || dataset.columns) return dataset; // already columnar
  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const rowCount = rows.length;
  if (rowCount === 0) {
    return { ...dataset, columns: {}, rowCount: 0, rows: undefined };
  }
  // Discover the set of column keys present in the dataset (union over rows
  // in case some rows have missing keys — they'll get `null` in those slots).
  const keys = new Set();
  for (const r of rows) {
    if (r) for (const k of Object.keys(r)) keys.add(k);
  }
  const columns = {};
  for (const key of keys) {
    // Sniff the column type by scanning until we find a non-null value.
    let sample;
    for (let i = 0; i < rowCount; i++) {
      const v = rows[i]?.[key];
      if (v != null) { sample = v; break; }
    }
    const isString = typeof sample === 'string';
    if (!isString) {
      // Numeric / boolean / mixed — store as plain array.
      const arr = new Array(rowCount);
      for (let i = 0; i < rowCount; i++) arr[i] = rows[i]?.[key] ?? null;
      columns[key] = arr;
      continue;
    }
    // String column → try dict encoding. Bail out to a plain array if the
    // cardinality is high enough that the dict overhead overtakes the
    // saving on the idx array.
    const dict = [];
    const dictMap = new Map();
    const idx = new Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
      const v = rows[i]?.[key];
      if (v == null) { idx[i] = -1; continue; }
      let di = dictMap.get(v);
      if (di === undefined) {
        di = dict.length;
        dict.push(v);
        dictMap.set(v, di);
      }
      idx[i] = di;
    }
    // Heuristic: dict wins as long as the average string is longer than 2
    // chars AND we get at least 2× reuse on average. Otherwise the dict
    // pays its own overhead without enough payoff.
    const avgValueLen = dict.reduce((s, v) => s + (v ? String(v).length : 0), 0) / Math.max(1, dict.length);
    const reuseFactor = rowCount / Math.max(1, dict.length);
    if (avgValueLen >= 2 && reuseFactor >= 2) {
      columns[key] = { dict, idx };
    } else {
      const arr = new Array(rowCount);
      for (let i = 0; i < rowCount; i++) arr[i] = rows[i]?.[key] ?? null;
      columns[key] = arr;
    }
  }
  return {
    ...dataset,
    columns,
    rowCount,
    rows: undefined,
  };
}

function aggregate({ dataset, request }) {
  if (!dataset || (!Array.isArray(dataset.rows) && !dataset.columns)) {
    throw new Error('inMemoryAgg.aggregate: dataset must have rows or columns');
  }
  const reqDims = Array.isArray(request.dims) ? request.dims : [];
  const reqMeasures = Array.isArray(request.measures) ? request.measures : [];
  const filters = request.filters || {};
  const measures = dataset.measures || {};
  const rowCount = datasetRowCount(dataset);

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

  // Initialise an aggregator per group. Simple measures (sum/count/min/max)
  // get a single accumulator; composite types (avg/ratio) get a pair of
  // additive sub-accumulators that we combine at output time.
  //   - 'avg':   { sum, count }     →  sum / count
  //   - 'ratio': { num, den }       →  num / den (with optional div-by-zero guard)
  // Sub-accumulators start as `null` so the first row seeds the value —
  // critical for MIN/MAX where 0 is a valid datum.
  const groups = new Map();
  // Component accumulators are additive (sum-like). Helper keeps the
  // null-seed semantics consistent across types.
  const addToAccum = (cur, n) => (cur == null ? 0 : cur) + n;

  for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
    if (!rowMatchesFilters(dataset, rowIdx, filters)) continue;
    const k = groupKey(dataset, rowIdx, reqDims);
    let bucket = groups.get(k);
    if (!bucket) {
      bucket = { dims: {}, measures: {} };
      for (const d of reqDims) {
        const alias = rowKeyFor(dataset, d);
        bucket.dims[alias] = cellAt(dataset, rowIdx, alias);
      }
      for (const m of reqMeasures) {
        const def = measures[m];
        if (def.type === 'ratio') bucket.measures[m] = { num: null, den: null };
        else if (def.type === 'avg') bucket.measures[m] = { sum: null, count: null };
        else if (def.type === 'expression') {
          // One slot per ref — each is an additive sub-accumulator that
          // mimics its declared innerType (sum/count/min/max).
          const slots = {};
          for (const r of (def.refs || [])) slots[r.name] = null;
          bucket.measures[m] = slots;
        }
        else bucket.measures[m] = null;
      }
      groups.set(k, bucket);
    }
    for (const m of reqMeasures) {
      const def = measures[m];
      if (def.type === 'ratio') {
        const nv = cellAt(dataset, rowIdx, def.numKey);
        const dv = cellAt(dataset, rowIdx, def.denKey);
        if (nv != null) {
          const n = typeof nv === 'number' ? nv : Number(nv);
          if (Number.isFinite(n)) bucket.measures[m].num = addToAccum(bucket.measures[m].num, n);
        }
        if (dv != null) {
          const n = typeof dv === 'number' ? dv : Number(dv);
          if (Number.isFinite(n)) bucket.measures[m].den = addToAccum(bucket.measures[m].den, n);
        }
        continue;
      }
      if (def.type === 'avg') {
        const sv = cellAt(dataset, rowIdx, def.sumKey);
        const cv = cellAt(dataset, rowIdx, def.countKey);
        if (sv != null) {
          const n = typeof sv === 'number' ? sv : Number(sv);
          if (Number.isFinite(n)) bucket.measures[m].sum = addToAccum(bucket.measures[m].sum, n);
        }
        if (cv != null) {
          const n = typeof cv === 'number' ? cv : Number(cv);
          if (Number.isFinite(n)) bucket.measures[m].count = addToAccum(bucket.measures[m].count, n);
        }
        continue;
      }
      if (def.type === 'expression') {
        // Each ref is fired by SQL under an alias stored in def.refKeys.
        // Accumulate per ref using its declared innerType — sums/counts
        // add, mins/maxes take the running min/max.
        const slots = bucket.measures[m];
        const refKeys = def.refKeys || {};
        for (const r of (def.refs || [])) {
          const key = refKeys[r.name] || r.name;
          const rv = cellAt(dataset, rowIdx, key);
          if (rv == null) continue;
          const n = typeof rv === 'number' ? rv : Number(rv);
          if (!Number.isFinite(n)) continue;
          const cur = slots[r.name];
          switch (r.innerType) {
            case 'sum':
            case 'count':
              slots[r.name] = addToAccum(cur, n);
              break;
            case 'min':
              slots[r.name] = cur == null ? n : Math.min(cur, n);
              break;
            case 'max':
              slots[r.name] = cur == null ? n : Math.max(cur, n);
              break;
            // Unknown innerType — ignored (canServe should've rejected).
          }
        }
        continue;
      }
      // Simple types — fall back to the single-accumulator path.
      const alias = rowKeyFor(dataset, m);
      const v = cellAt(dataset, rowIdx, alias);
      if (v == null) continue;
      const num = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(num)) continue;
      const cur = bucket.measures[m];
      switch (def.type) {
        case 'sum':
        case 'count':
          bucket.measures[m] = addToAccum(cur, num);
          break;
        case 'min':
          bucket.measures[m] = cur == null ? num : Math.min(cur, num);
          break;
        case 'max':
          bucket.measures[m] = cur == null ? num : Math.max(cur, num);
          break;
        default:
          throw new Error(`inMemoryAgg.aggregate: unsupported measure type "${def.type}" for "${m}"`);
      }
    }
  }

  // Materialise the buckets back to the same flat shape the SQL path
  // returns. Composite measures (avg/ratio) collapse their sub-accumulators
  // to a final scalar here so downstream consumers can't tell the rows
  // came from the cache instead of fresh SQL.
  const out = new Array(groups.size);
  let i = 0;
  for (const bucket of groups.values()) {
    const flat = { ...bucket.dims };
    for (const m of reqMeasures) {
      const def = measures[m];
      const alias = rowKeyFor(dataset, m);
      if (def.type === 'ratio') {
        const { num, den } = bucket.measures[m];
        const n = num == null ? 0 : num;
        const d = den == null ? 0 : den;
        // Optional `* <number>` multiplier captured by detectRatio (e.g.
        // `${a} / ${b} * 100` for a percentage). Defaults to 1 so legacy
        // entries without the field still divide cleanly.
        const scale = typeof def.scale === 'number' && def.scale !== 0 ? def.scale : 1;
        // hasGuard mirrors the original SQL's div-by-zero handling
        // (`CASE WHEN den = 0 THEN 1 ELSE den` or NULLIF). Without a
        // guard we return null when the denominator is zero — matches
        // a SQL fresh path that would produce NULL via NULLIF or error.
        let raw;
        if (def.hasGuard) raw = d === 0 ? n : n / d;
        else raw = d === 0 ? null : n / d;
        flat[alias] = raw == null ? null : raw * scale;
        continue;
      }
      if (def.type === 'avg') {
        const { sum, count } = bucket.measures[m];
        const s = sum == null ? 0 : sum;
        const c = count == null ? 0 : count;
        flat[alias] = c === 0 ? null : s / c;
        continue;
      }
      if (def.type === 'expression') {
        const fn = compileExpression(def.rawExpression);
        if (!fn) { flat[alias] = null; continue; }
        // Coerce null sub-accumulators to 0 so an expression like
        // `${a} + ${b}` doesn't propagate NaN when one side never had a
        // row. The transpiled JS uses bare arithmetic — null * 100 ===
        // 0 but null + 5 === 5 in JS (because null coerces to 0), so the
        // result IS already well-defined; we coerce explicitly to make
        // the contract obvious and uniform across operators.
        const _v = {};
        for (const r of (def.refs || [])) {
          const v = bucket.measures[m][r.name];
          _v[r.name] = v == null ? 0 : v;
        }
        let result;
        try { result = fn(_v); } catch { result = null; }
        flat[alias] = (typeof result === 'number' && Number.isFinite(result)) ? result : null;
        continue;
      }
      flat[alias] = bucket.measures[m];
    }
    out[i++] = flat;
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
    if (!def) return false;
    if (def.type === 'ratio') {
      // Composite measure — both component columns must be present in
      // every row, and the dataset must have stored them as additive
      // sub-totals (we sum them at aggregate time).
      if (!def.numKey || !def.denKey) return false;
      continue;
    }
    if (def.type === 'avg') {
      if (!def.sumKey || !def.countKey) return false;
      continue;
    }
    if (def.type === 'expression') {
      // Must have at least one ref, every ref must declare a supported
      // additive innerType, and the raw expression string must be there
      // so the runtime can compile (and cache) the evaluator.
      if (!Array.isArray(def.refs) || def.refs.length === 0) return false;
      for (const r of def.refs) {
        if (!r || !r.name) return false;
        if (!['sum', 'count', 'min', 'max'].includes(r.innerType)) return false;
      }
      if (typeof def.rawExpression !== 'string' || def.rawExpression.length === 0) return false;
      continue;
    }
    if (!['sum', 'count', 'min', 'max'].includes(def.type)) return false;
  }
  return true;
}

module.exports = { aggregate, canServe, toColumnarDataset, datasetRowCount };
