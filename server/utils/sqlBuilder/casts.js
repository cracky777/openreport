/**
 * SQL cast + literal-list helpers for the live-query path.
 *
 * Lived inline in routes/models.js (lines 53-325 historically) — every one
 * is a pure function with no DB / Express dependency, so the route file was
 * doing double duty as a SQL-builder library. Extracted so:
 *   - rollupPlanner.js can eventually share these instead of carrying its
 *     own DuckDB-only `qIdent`/`scalarClause` reimplementation
 *   - per-dialect cast behaviour becomes unit-testable without spinning up
 *     a fake req/res
 *   - the route file becomes ~270 lines lighter
 *
 * Dialect-aware. Default behaviour on an unknown `dbType` matches
 * PostgreSQL — same convention as `utils/sqlDialect.js`.
 */

const { quoteLiteral } = require('../sqlDialect');

const NUMERIC_TYPES = new Set(['integer', 'decimal', 'number']);

// Cast an expression to a string type using the dialect's expected keyword.
// PostgreSQL / SQL Server / DuckDB accept VARCHAR; MySQL refuses VARCHAR
// and wants CHAR; BigQuery wants STRING. Used everywhere we coerce values
// to text for IN / LIKE / equality comparisons.
function castToString(expr, dbType) {
  if (dbType === 'mysql') return `CAST(${expr} AS CHAR)`;
  if (dbType === 'bigquery') return `CAST(${expr} AS STRING)`;
  return `CAST(${expr} AS VARCHAR)`;
}

// Convert a (possibly text) column expression into a numeric SQL value
// using the dialect's CAST keyword. `type` is 'integer' / 'decimal' /
// 'number' (the legacy alias, treated as decimal). For decimals we wrap
// REPLACE(expr, ',', '.') first so French comma decimals like "12,34"
// parse cleanly — REPLACE on a native numeric column implicitly stringifies,
// works on every supported dialect.
function castToNumber(expr, dbType, type) {
  const wantsInt = type === 'integer';
  // For decimals, tolerate comma decimals; for integers, trust clean digits
  // (REPLACE on an int that happens to contain "12,000" thousands would lose
  // the decimal, which is the safer outcome).
  const cleaned = wantsInt ? expr : `REPLACE(${expr}, ',', '.')`;
  if (dbType === 'mysql') {
    return wantsInt ? `CAST(${cleaned} AS SIGNED)` : `CAST(${cleaned} AS DECIMAL(38,10))`;
  }
  if (dbType === 'azure_sql' || dbType === 'mssql') {
    return wantsInt ? `CAST(${cleaned} AS INT)` : `CAST(${cleaned} AS DECIMAL(38,10))`;
  }
  if (dbType === 'bigquery') {
    return wantsInt ? `CAST(${cleaned} AS INT64)` : `CAST(${cleaned} AS NUMERIC)`;
  }
  // PostgreSQL / Azure PostgreSQL / DuckDB
  return wantsInt ? `CAST(${cleaned} AS INTEGER)` : `CAST(${cleaned} AS NUMERIC)`;
}

// Generate the SQL expression that converts a (possibly text) column into
// a real DATE for the current dialect, honouring the user-chosen date
// format if any. `fmt` mirrors the values stored in columnTypes:
//   'auto' / 'iso' / 'dd/mm/yyyy' / 'mm/dd/yyyy' / 'dd-mm-yyyy' / 'dd.mm.yyyy' / 'yyyymmdd'
// When the format is 'auto' (or unknown), each dialect falls back to its
// permissive default — usually CAST(... AS DATE) — which works for ISO
// strings and native date columns.
function castToDate(expr, dbType, fmt) {
  const f = fmt || 'auto';

  if (dbType === 'azure_sql' || dbType === 'mssql') {
    // SQL Server style codes consumed by CONVERT/TRY_CONVERT.
    const code = ({
      iso: 23,
      'dd/mm/yyyy': 103,
      'mm/dd/yyyy': 101,
      'dd-mm-yyyy': 105, // Italian style — DD-MM-YYYY
      'dd.mm.yyyy': 104, // German style — DD.MM.YYYY
      yyyymmdd: 112,
    })[f];
    if (code) return `TRY_CONVERT(date, ${expr}, ${code})`;
    return `TRY_CONVERT(date, ${expr})`;
  }

  if (dbType === 'mysql') {
    const m = ({
      iso: '%Y-%m-%d',
      'dd/mm/yyyy': '%d/%m/%Y',
      'mm/dd/yyyy': '%m/%d/%Y',
      'dd-mm-yyyy': '%d-%m-%Y',
      'dd.mm.yyyy': '%d.%m.%Y',
      yyyymmdd: '%Y%m%d',
    })[f];
    if (m) return `STR_TO_DATE(${expr}, '${m}')`;
    return `CAST(${expr} AS DATE)`;
  }

  if (dbType === 'bigquery') {
    const m = ({
      iso: '%Y-%m-%d',
      'dd/mm/yyyy': '%d/%m/%Y',
      'mm/dd/yyyy': '%m/%d/%Y',
      'dd-mm-yyyy': '%d-%m-%Y',
      'dd.mm.yyyy': '%d.%m.%Y',
      yyyymmdd: '%Y%m%d',
    })[f];
    if (m) return `PARSE_DATE('${m}', ${expr})`;
    return `CAST(${expr} AS DATE)`;
  }

  if (dbType === 'duckdb') {
    const m = ({
      iso: '%Y-%m-%d',
      'dd/mm/yyyy': '%d/%m/%Y',
      'mm/dd/yyyy': '%m/%d/%Y',
      'dd-mm-yyyy': '%d-%m-%Y',
      'dd.mm.yyyy': '%d.%m.%Y',
      yyyymmdd: '%Y%m%d',
    })[f];
    if (m) return `CAST(STRPTIME(${expr}, '${m}') AS DATE)`;
    return `CAST(${expr} AS DATE)`;
  }

  // PostgreSQL / Azure PostgreSQL — TO_DATE for explicit formats.
  const m = ({
    iso: 'YYYY-MM-DD',
    'dd/mm/yyyy': 'DD/MM/YYYY',
    'mm/dd/yyyy': 'MM/DD/YYYY',
    'dd-mm-yyyy': 'DD-MM-YYYY',
    'dd.mm.yyyy': 'DD.MM.YYYY',
    yyyymmdd: 'YYYYMMDD',
  })[f];
  if (m) return `TO_DATE(${expr}, '${m}')`;
  return `CAST(${expr} AS DATE)`;
}

// Convert a list of user-supplied values into native SQL literals when the
// column type lets us — emitting `IN (2024, 2025)` against a numeric column
// is far faster than `CAST(col AS VARCHAR) IN ('2024', '2025')` because
// indexes survive and the engine doesn't materialise per-row casts. Returns
// null when the values can't all be coerced cleanly, signalling the caller
// to fall back to the cast-then-string path.
function literalsForType(values, dimType) {
  if (NUMERIC_TYPES.has(dimType)) {
    const out = [];
    for (const v of values) {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      out.push(String(n));
    }
    return out;
  }
  if (dimType === 'boolean') {
    const out = [];
    for (const v of values) {
      const s = String(v).trim().toLowerCase();
      if (['true', 't', 'yes', 'y', '1'].includes(s)) out.push('TRUE');
      else if (['false', 'f', 'no', 'n', '0'].includes(s)) out.push('FALSE');
      else return null;
    }
    return out;
  }
  return null;
}

// Build an `IN`/`NOT IN` clause without an unconditional CAST: native
// literals when the dim is numeric/boolean and the values parse, plain
// quoted strings when the dim is already a string, CAST as the last resort
// for unknown types or value/type mismatches. Single-value lists collapse
// to `=` / `<>` — semantically identical, lighter to read, and on some
// engines avoids a tiny IN-list overhead.
function buildInList(colExpr, dimType, list, dbType, negate) {
  if (!list || list.length === 0) return null;
  const single = list.length === 1;
  const inOp = negate ? 'NOT IN' : 'IN';
  const eqOp = negate ? '<>' : '=';
  const native = literalsForType(list, dimType);
  if (native) {
    return single ? `${colExpr} ${eqOp} ${native[0]}` : `${colExpr} ${inOp} (${native.join(', ')})`;
  }
  const quote = (v) => quoteLiteral(v, dbType);
  if (dimType === 'string') {
    return single ? `${colExpr} ${eqOp} ${quote(list[0])}` : `${colExpr} ${inOp} (${list.map(quote).join(', ')})`;
  }
  const cast = castToString(colExpr, dbType);
  return single ? `${cast} ${eqOp} ${quote(list[0])}` : `${cast} ${inOp} (${list.map(quote).join(', ')})`;
}

// Effective comparison type for a dim. Date-part dims (year, month name,
// etc.) aren't `type='date'` themselves — they're computed numbers/strings
// derived from the underlying date — so derive the type from the date-part
// flavour to keep the IN clause numeric-vs-string aligned.
function effectiveDimType(dim) {
  if (!dim) return 'string';
  if (dim.datePart) return dim.datePart.startsWith('name_') ? 'string' : 'integer';
  return dim.type || 'string';
}

module.exports = {
  NUMERIC_TYPES,
  castToString,
  castToNumber,
  castToDate,
  literalsForType,
  buildInList,
  effectiveDimType,
};
