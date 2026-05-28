/**
 * columnTypeResolver — best-effort, process-cached source-schema lookup.
 *
 * Why this exists:
 *   A measure created before `addMeasure` stamped `dataType` (or via a path
 *   where `col.data_type` was unavailable) carries NO `dataType`, and the
 *   model's `column_types` override map has no entry for it either. The
 *   /query SQL builder then can't tell an INTERVAL column from a number, so
 *   it emits `SUM("col")` / `HAVING SUM("col") <= 30` against a Postgres
 *   `interval` and the DB rejects it with
 *   `operator does not exist: interval <= integer`.
 *
 *   The only ground truth that needs no model re-save is the source DB's
 *   own catalog. `dbConnector`'s per-dialect `getColumns(table)` already
 *   reads `information_schema.columns` (PG / Azure-PG / DuckDB → exact
 *   `'interval'`; BigQuery → field type lowercased; MySQL / MSSQL have no
 *   interval column type so the set is simply empty there — matching the
 *   `supportsExtractEpoch` gate in models.js).
 *
 * Scope is deliberately narrow: it ONLY reports which (table, column) pairs
 * are INTERVAL-typed. Everything else is left to the existing type
 * inference so blast radius stays zero. Any failure degrades silently to
 * "nothing is interval" — i.e. exactly today's behaviour, no regression.
 */

const { createConnection } = require('./dbConnector');
const { quoteCol } = require('./sqlDialect');

// key: `${datasourceId}::${table}` → Map<column_name, data_type lowercased>
const _schemaCache = new Map();

// Datasources whose interval columns can be flattened with EXTRACT(EPOCH …).
// MySQL / MSSQL have no interval column type; BigQuery's INTERVAL has no
// EPOCH extract (its values are flattened by the row post-processor). So
// only these benefit from resolving interval-ness at SQL-build time.
const EXTRACT_EPOCH_DBS = new Set(['postgres', 'azure_postgres', 'duckdb']);

/**
 * Resolve which of the given (table, column) pairs are INTERVAL-typed in
 * the source schema.
 *
 * @param {object} datasource  row from the `datasources` table
 * @param {Array<{table:string, column:string}>} cols
 * @returns {Promise<Set<string>>}  set of `"table.column"` that are interval
 */
async function resolveIntervalColumns(datasource, cols) {
  const out = new Set();
  if (!datasource || !EXTRACT_EPOCH_DBS.has(datasource.db_type)) return out;

  // Distinct tables we still need to introspect (cache miss).
  const wantTables = new Set();
  for (const c of cols) {
    if (!c || !c.table || !c.column) continue;
    const ck = `${datasource.id}::${c.table}`;
    if (!_schemaCache.has(ck)) wantTables.add(c.table);
  }

  if (wantTables.size > 0) {
    let conn;
    try {
      conn = createConnection(datasource);
      for (const table of wantTables) {
        const ck = `${datasource.id}::${table}`;
        try {
          const rows = await conn.getColumns(table);
          // Only cache when we actually got rows back. Empty results (and
          // outright failures, see catch below) leave the cache slot
          // unset so the NEXT /query retries — a transient PG hiccup at
          // process start used to poison the cache with an empty Map and
          // pin every subsequent query to "no interval columns known" for
          // the rest of the process's life (observed: a column the user
          // KNEW was interval came back as nothing, every SUM/AVG crashed
          // with "cannot cast type interval to numeric" until restart).
          if (!Array.isArray(rows) || rows.length === 0) continue;
          const m = new Map();
          for (const r of rows) {
            if (r && r.column_name != null) {
              m.set(String(r.column_name), String(r.data_type || '').toLowerCase());
            }
          }
          _schemaCache.set(ck, m);
        } catch (e) {
          // Per-table failure → leave the cache slot empty so we retry
          // on the next /query. A transient failure (timeout, dropped
          // connection at boot) used to be cached as an empty Map and
          // then pin every subsequent probe to "no interval columns".
          console.warn('[columnType] getColumns failed for', table, '-', e.message);
        }
      }
    } catch (e) {
      console.warn('[columnType] connection failed -', e.message);
    } finally {
      try { conn?.close(); } catch { /* throwaway pool */ }
    }
  }

  for (const c of cols) {
    if (!c || !c.table || !c.column) continue;
    const m = _schemaCache.get(`${datasource.id}::${c.table}`);
    if (m && m.get(String(c.column)) === 'interval') {
      out.add(`${c.table}.${c.column}`);
    }
  }
  return out;
}

// Test / admin hook: drop cached schema (e.g. after a model's datasource
// changes shape). Not wired to a route yet — exported for completeness.
function clearSchemaCache() {
  _schemaCache.clear();
}

// Extract candidate (table, column) pairs from a custom SQL expression by
// matching the canonical quoted forms the wizard / editor produces:
//   - 3-part:  "schema"."table"."col"
//   - 2-part:  "table"."col"
// Used by the /query route to extend the interval probe so a column that's
// referenced ONLY inside a custom expression (no structured measure on it)
// still gets its dataType resolved — otherwise preWrapIntervalRefs below
// wouldn't know to wrap it.
function extractColumnRefsFromExpression(expression) {
  const refs = [];
  if (!expression) return refs;
  const s = String(expression);
  // Match 3-part first, then 2-part separately so the 2-part regex doesn't
  // also fire on the last two segments of a 3-part match.
  const seen = new Set();
  const re3 = /"([^"]+)"\."([^"]+)"\."([^"]+)"/g;
  let m;
  while ((m = re3.exec(s)) !== null) {
    const table = `${m[1]}.${m[2]}`;
    const column = m[3];
    const key = `${table}.${column}`;
    if (!seen.has(key)) { seen.add(key); refs.push({ table, column }); }
  }
  // For 2-part, scan and skip positions that overlap a 3-part match (rough
  // but cheap — the cost of a false positive is just an extra probe call).
  const taken = new Set();
  const re3check = /"[^"]+"\."[^"]+"\."[^"]+"/g;
  while ((m = re3check.exec(s)) !== null) {
    for (let i = m.index; i < m.index + m[0].length; i++) taken.add(i);
  }
  const re2 = /"([^"]+)"\."([^"]+)"/g;
  while ((m = re2.exec(s)) !== null) {
    if (taken.has(m.index)) continue;
    const table = m[1];
    const column = m[2];
    const key = `${table}.${column}`;
    if (!seen.has(key)) { seen.add(key); refs.push({ table, column }); }
  }
  return refs;
}

// Pre-wrap interval-column references in a custom SQL expression with
// EXTRACT(EPOCH FROM …) so SUM/AVG/MIN/MAX on them returns a NUMERIC value
// instead of an interval — and so a downstream CAST AS NUMERIC doesn't blow
// up ("cannot cast type interval to numeric" in Postgres). Idempotent:
// negative lookbehind skips refs already inside an EXTRACT(EPOCH FROM …)
// wrap, so calling the function twice is harmless.
//
// Same dialect gate as elsewhere — only PG / Azure-PG / DuckDB expose
// EXTRACT(EPOCH …); MySQL / MSSQL have no interval column type; BigQuery's
// INTERVAL has no EPOCH extract (row post-processor flattens those).
function preWrapIntervalRefs(expression, columnTypes, dbType) {
  if (!expression) return expression;
  if (dbType !== 'postgres' && dbType !== 'azure_postgres' && dbType !== 'duckdb') {
    return expression;
  }
  let result = String(expression);
  for (const [key, info] of Object.entries(columnTypes || {})) {
    if (!info || info.type !== 'interval') continue;
    // key is "<table>.<col>" where <table> may itself be "<schema>.<table>".
    // The column is everything after the LAST dot.
    const lastDot = key.lastIndexOf('.');
    if (lastDot <= 0) continue;
    const table = key.slice(0, lastDot);
    const col = key.slice(lastDot + 1);
    const quoted = quoteCol(table, col, dbType);
    const escaped = quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<!EXTRACT\\(EPOCH FROM\\s)${escaped}`, 'g');
    result = result.replace(re, `EXTRACT(EPOCH FROM ${quoted})`);
  }
  return result;
}

module.exports = {
  resolveIntervalColumns,
  clearSchemaCache,
  extractColumnRefsFromExpression,
  preWrapIntervalRefs,
};
