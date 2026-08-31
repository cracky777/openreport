/**
 * The dialect table — one row per capability, one column per engine.
 *
 * Every backend difference the SQL compiler cares about used to live as a
 * scattered `dbType === '…'` test at the point of use. The same predicate then
 * existed in several copies (`supportsExtractEpoch` was written out three
 * times), and adding an engine meant finding all of them: the ones missed fell
 * through to PostgreSQL silently, which is how BigQuery ended up emitting
 * PostgreSQL's `TO_CHAR` and `DOW`.
 *
 * So the differences are stated once, as data. Adding an engine is adding one
 * entry to CAPABILITIES and reading the empty cells.
 *
 * Two axes are shaped like code rather than values and stay next to the code
 * that uses them — they are named here so the checklist stays complete:
 *   - date parts (year / month / week / day-of-week / month name / day name)
 *     → utils/sqlBuilder/datePart.js
 *   - parsing a text column into a DATE with an explicit format
 *     → utils/sqlBuilder/casts.js  (castToDate)
 *
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

// Quoting conventions. MySQL treats `"name"` as a string literal unless
// ANSI_QUOTES is on (many shared-hosting servers run without it) and BigQuery
// always does; MSSQL accepts `"name"` only when QUOTED_IDENTIFIER is ON, while
// square brackets are unambiguous.
const QUOTING = {
  ansi:     { open: '"', close: '"', esc: (s) => s.replace(/"/g, '""') },
  bracket:  { open: '[', close: ']', esc: (s) => s.replace(/]/g, ']]') },
  backtick: { open: '`', close: '`', esc: (s) => s.replace(/`/g, '``') },
  // BigQuery escapes a backtick with a backslash instead of doubling it.
  bqtick:   { open: '`', close: '`', esc: (s) => s.replace(/`/g, '\\`') },
};

/**
 * One entry per `dbType`. Aliases (azure_postgres, azure_sql) share the row of
 * the engine they are, so no call site has to test for both.
 *
 *   quoting          how identifiers are delimited — see QUOTING above
 *   escapesBackslash `\` opens an escape sequence inside a string literal, so
 *                    a user-supplied `'` would end the string and inject SQL
 *   textCast         CAST target for text — compares values in IN lists
 *   intCast          CAST target for a column overridden to an integer
 *   decimalCast      CAST target for a column overridden to a decimal
 *   wideFloat        CAST that widens SUM(real) before a later division
 *                    amplifies its truncation; null where SUM already widens
 *   nullsLast        'inline'   — accepts `ORDER BY x DESC NULLS LAST`
 *                    'emulated' — needs `ORDER BY x IS NULL, x DESC`
 *                    null       — no NULL ordering available
 *   pagination       'limit' → `LIMIT n OFFSET m`
 *                    'fetch' → `OFFSET m ROWS FETCH NEXT n ROWS ONLY`
 *   extractEpoch     exposes EXTRACT(EPOCH FROM <interval>), which flattens an
 *                    interval column into seconds
 *   joinUsing        has a `JOIN … USING (…)` clause — T-SQL only has ON
 */
const CAPABILITIES = {
  postgres: {
    quoting: 'ansi', escapesBackslash: false,
    textCast: 'VARCHAR', intCast: 'INTEGER', decimalCast: 'NUMERIC',
    wideFloat: 'DOUBLE PRECISION',
    nullsLast: 'inline', pagination: 'limit', extractEpoch: true, joinUsing: true,
  },
  // Redshift forked PostgreSQL 8.0.2. Two cells diverge: a bare VARCHAR means
  // VARCHAR(256) there and would truncate a longer value before comparing it,
  // and its INTERVAL column type is late and exposes no EPOCH extract.
  redshift: {
    quoting: 'ansi', escapesBackslash: false,
    textCast: 'VARCHAR(65535)', intCast: 'INTEGER', decimalCast: 'NUMERIC',
    wideFloat: 'DOUBLE PRECISION',
    nullsLast: 'inline', pagination: 'limit', extractEpoch: false, joinUsing: true,
  },
  mysql: {
    quoting: 'backtick', escapesBackslash: true,
    // MySQL refuses CAST(x AS VARCHAR) and wants CHAR; a bare NUMERIC there
    // truncates to zero decimals, hence the explicit scale.
    textCast: 'CHAR', intCast: 'SIGNED', decimalCast: 'DECIMAL(38,10)',
    wideFloat: null, // SUM already widens, and old MySQL has no CAST AS DOUBLE
    nullsLast: 'emulated', pagination: 'limit', extractEpoch: false, joinUsing: true,
  },
  mssql: {
    quoting: 'bracket', escapesBackslash: false,
    textCast: 'VARCHAR', intCast: 'INT', decimalCast: 'DECIMAL(38,10)',
    wideFloat: 'FLOAT',
    nullsLast: null, pagination: 'fetch', extractEpoch: false, joinUsing: false,
  },
  bigquery: {
    quoting: 'bqtick', escapesBackslash: true,
    textCast: 'STRING', intCast: 'INT64', decimalCast: 'NUMERIC',
    wideFloat: null, // FLOAT64 already
    nullsLast: 'inline', pagination: 'limit',
    // BigQuery's INTERVAL has no EPOCH extract — those values are flattened by
    // the row post-processor in routes/models.js instead.
    extractEpoch: false, joinUsing: true,
  },
  duckdb: {
    quoting: 'ansi', escapesBackslash: false,
    textCast: 'VARCHAR', intCast: 'INTEGER', decimalCast: 'NUMERIC',
    // DOUBLE rather than NUMERIC: DuckDB's NUMERIC is DECIMAL(18,3), which
    // would both round and overflow on a large sum.
    wideFloat: 'DOUBLE',
    nullsLast: 'inline', pagination: 'limit', extractEpoch: true, joinUsing: true,
  },
};
CAPABILITIES.azure_postgres = CAPABILITIES.postgres;
CAPABILITIES.azure_sql = CAPABILITIES.mssql;

// An unknown dbType falls back to PostgreSQL, exactly as every call site did
// before this table existed. That fallback is what makes a PG-family engine
// cheap to add — and what makes a missing entry invisible. See the header.
function capabilities(dbType) {
  return CAPABILITIES[dbType] || CAPABILITIES.postgres;
}

// Every dbType the table knows. Exported so tests/dialectTable can walk the
// whole table instead of a list that would go stale the day an engine is added.
function dialectTypes() {
  return Object.keys(CAPABILITIES);
}

function dialectFor(dbType) {
  return QUOTING[capabilities(dbType).quoting];
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
  if (capabilities(dbType).escapesBackslash) {
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
  capabilities,
  dialectTypes,
  quoteIdent,
  quoteTable,
  quoteCol,
  escapeLiteral,
  quoteLiteral,
  normalizeAggregation,
  dialectFor,
};
