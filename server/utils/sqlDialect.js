/**
 * Dialect-aware identifier quoting.
 *
 * Each supported backend has its own quoting convention. Using `"name"`
 * everywhere works on PG/MSSQL/DuckDB but breaks on MySQL (treats it as a
 * string literal unless ANSI_QUOTES is on — and many shared-hosting MySQL
 * servers run without it) and BigQuery (always a string literal there).
 *
 * Pattern is the same as Cube.js / Metabase / SQLAlchemy / Calcite:
 *   - one map { dbType → { open, close, escape } }
 *   - one `quoteIdent` function that walks it
 *
 * Default falls back to PostgreSQL conventions, so any code path that
 * forgets to pass `dbType` still produces valid PG/DuckDB SQL.
 */

const DIALECTS = {
  postgres:       { open: '"', close: '"', esc: (s) => s.replace(/"/g, '""') },
  azure_postgres: { open: '"', close: '"', esc: (s) => s.replace(/"/g, '""') },
  duckdb:         { open: '"', close: '"', esc: (s) => s.replace(/"/g, '""') },
  // MSSQL/Azure SQL accept `"name"` only when QUOTED_IDENTIFIER is ON (which
  // is the default since SQL Server 2000, but linked-server connections can
  // flip it off). Square brackets are unambiguous — always allowed.
  mssql:          { open: '[', close: ']', esc: (s) => s.replace(/]/g, ']]') },
  azure_sql:      { open: '[', close: ']', esc: (s) => s.replace(/]/g, ']]') },
  mysql:          { open: '`', close: '`', esc: (s) => s.replace(/`/g, '``') },
  bigquery:       { open: '`', close: '`', esc: (s) => s.replace(/`/g, '\\`') },
};

function dialectFor(dbType) {
  return DIALECTS[dbType] || DIALECTS.postgres;
}

// Quote a single identifier (table, column, alias, schema part…).
function quoteIdent(name, dbType) {
  const d = dialectFor(dbType);
  return d.open + d.esc(String(name)) + d.close;
}

// Quote a possibly schema-qualified table name. "schema.table" → split on
// the dot and quote each part. Avoids `"schema.table"` (one identifier
// containing a dot) which would fail on every dialect.
function quoteTable(name, dbType) {
  const s = String(name);
  if (s.includes('.')) {
    return s.split('.').map((p) => quoteIdent(p, dbType)).join('.');
  }
  return quoteIdent(s, dbType);
}

// Shorthand for the very common `<table>.<column>` reference — saves a
// dozen template literals across the SQL builder. Both parts are quoted
// per the dialect.
function quoteCol(table, column, dbType) {
  return `${quoteTable(table, dbType)}.${quoteIdent(column, dbType)}`;
}

// Escape a value for use inside a single-quoted string literal. Dialect-
// aware: MySQL (default mode) and BigQuery interpret backslashes as escape
// sequences, so a user-supplied `\'` would terminate the string and inject
// SQL after — we double backslashes there. PG / DuckDB / MSSQL treat `\`
// as literal (with PG's standard_conforming_strings=on, default since 9.1),
// so we leave them alone and only double the single quotes.
//
// Returns the raw escaped string (no surrounding quotes). Callers wrap
// with their own `'<escaped>'`.
function escapeLiteral(value, dbType) {
  const s = String(value);
  if (dbType === 'mysql' || dbType === 'bigquery') {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "''");
  }
  return s.replace(/'/g, "''");
}

// Convenience wrapper returning a complete quoted literal — `'foo''bar'`.
function quoteLiteral(value, dbType) {
  return `'${escapeLiteral(value, dbType)}'`;
}

// Whitelist of aggregation function names accepted from user input.
// Anything else in `m.aggregation` would be concatenated verbatim into
// the emitted SQL (e.g. `${agg.toUpperCase()}(col)`), which is an
// injection vector — `aggregation: "1) UNION SELECT secret--"` would
// otherwise land directly in the query.
const VALID_AGGREGATIONS = new Set(['sum', 'avg', 'count', 'min', 'max', 'custom']);

function normalizeAggregation(agg, fallback = 'sum') {
  const lower = String(agg || '').toLowerCase();
  return VALID_AGGREGATIONS.has(lower) ? lower : fallback;
}

module.exports = {
  quoteIdent,
  quoteTable,
  quoteCol,
  escapeLiteral,
  quoteLiteral,
  normalizeAggregation,
  dialectFor,
};
