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
          const m = new Map();
          for (const r of rows || []) {
            if (r && r.column_name != null) {
              m.set(String(r.column_name), String(r.data_type || '').toLowerCase());
            }
          }
          _schemaCache.set(ck, m);
        } catch (e) {
          // Per-table failure → cache an empty map so we don't re-hit the
          // DB every query for a table we can't introspect.
          _schemaCache.set(ck, new Map());
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

module.exports = { resolveIntervalColumns, clearSchemaCache };
