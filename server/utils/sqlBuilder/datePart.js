/**
 * Date-part SQL expression builder + date-format / type-override readers.
 *
 * Powers the year/month/week/day-of-week/month-name/day-name dimensions
 * the user can pin on the canvas. Same expression is emitted in:
 *   - the SELECT projection (so the rollup grain matches what the runtime
 *     query asks for)
 *   - the WHERE / HAVING when the user clicks a year cell to drill, so
 *     the filter targets `YEAR(col)` not the raw timestamp string
 *
 * Reads the `column_types` override map (JSON on the model row) so a
 * varchar column holding 'DD/MM/YYYY' values is parsed back into a real
 * DATE before EXTRACT/YEAR sees it.
 */

const { quoteCol } = require('../sqlDialect');
const { castToDate } = require('./casts');

// Read the date format hint stored on a (table, column) override entry.
// `columnTypes` may carry plain strings ('date') or objects ({type, format})
// and missing entries default to 'auto'.
function getDateFormat(table, column, columnTypes) {
  if (!columnTypes) return 'auto';
  const entry = columnTypes[`${table}.${column}`];
  if (!entry || typeof entry === 'string') return 'auto';
  return entry.format || 'auto';
}

// Read just the type override (e.g. 'integer', 'decimal', 'date') for a
// (table, column). Handles both the simple string form and the object
// form. Returns null when no override is set.
function getOverrideType(table, column, columnTypes) {
  if (!columnTypes) return null;
  const entry = columnTypes[`${table}.${column}`];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry.type || null;
}

// Build the SQL expression for a date-part dimension (year, month, week,
// day-of-week, month/day name) honouring the per-dialect EXTRACT/YEAR/etc.
// syntax AND the column's date-format override (so a text column with
// 'DD/MM/YYYY' values is parsed before the part is extracted).
//
// Returns null when the dim has no datePart. Used by both the SELECT
// projection and the WHERE / HAVING filter generation, so drill-down on
// a year column actually filters by the YEAR(...) expression rather than
// the raw timestamp string.
function buildDatePartExpr(dim, dbType, columnTypes) {
  if (!dim || !dim.datePart) return null;
  const col = quoteCol(dim.table, dim.column, dbType);
  // Re-use castToDate for the inner parsing so non-ISO text dates are
  // normalised before EXTRACT/strftime sees them.
  const dateExpr = castToDate(col, dbType, getDateFormat(dim.table, dim.column, columnTypes));
  if (dbType === 'duckdb') {
    switch (dim.datePart) {
      case 'num_year': return `EXTRACT(YEAR FROM ${dateExpr})`;
      case 'num_month': return `EXTRACT(MONTH FROM ${dateExpr})`;
      case 'name_month': return `STRFTIME(${dateExpr}, '%B')`;
      case 'num_week': return `EXTRACT(WEEK FROM ${dateExpr})`;
      case 'num_day_of_week': return `EXTRACT(DOW FROM ${dateExpr})`;
      case 'name_day': return `STRFTIME(${dateExpr}, '%A')`;
      default: return col;
    }
  }
  if (dbType === 'mysql') {
    switch (dim.datePart) {
      case 'num_year': return `YEAR(${dateExpr})`;
      case 'num_month': return `MONTH(${dateExpr})`;
      case 'name_month': return `MONTHNAME(${dateExpr})`;
      case 'num_week': return `WEEK(${dateExpr})`;
      case 'num_day_of_week': return `DAYOFWEEK(${dateExpr})`;
      case 'name_day': return `DAYNAME(${dateExpr})`;
      default: return col;
    }
  }
  if (dbType === 'azure_sql' || dbType === 'mssql') {
    switch (dim.datePart) {
      case 'num_year': return `YEAR(${dateExpr})`;
      case 'num_month': return `MONTH(${dateExpr})`;
      case 'name_month': return `DATENAME(MONTH, ${dateExpr})`;
      case 'num_week': return `DATEPART(WEEK, ${dateExpr})`;
      case 'num_day_of_week': return `DATEPART(WEEKDAY, ${dateExpr})`;
      case 'name_day': return `DATENAME(WEEKDAY, ${dateExpr})`;
      default: return col;
    }
  }
  // BigQuery shares EXTRACT with PostgreSQL but not the rest, and falling
  // through to the PG branch made three parts unusable: it has no `TO_CHAR`
  // (names come from FORMAT_DATE) and no `DOW` part (it is DAYOFWEEK). The
  // queries came back as `Function not found: TO_CHAR` and `A valid date part
  // name is required but found DOW` — an error on the visual, not a wrong
  // number, so year/month kept working and nobody suspected the rest.
  //
  // `castToDate` always hands us a DATE here (PARSE_DATE or a CAST), so
  // FORMAT_DATE is the right formatter — no need to guess TIMESTAMP vs DATE.
  if (dbType === 'bigquery') {
    switch (dim.datePart) {
      case 'num_year': return `EXTRACT(YEAR FROM ${dateExpr})`;
      case 'num_month': return `EXTRACT(MONTH FROM ${dateExpr})`;
      case 'name_month': return `FORMAT_DATE('%B', ${dateExpr})`;
      case 'num_week': return `EXTRACT(WEEK FROM ${dateExpr})`;
      // 1 = Sunday … 7 = Saturday. Each dialect numbers this its own way
      // (PG starts at 0, SQL Server follows DATEFIRST) — the part is meant to
      // group and sort within one connection, never to be compared across two.
      case 'num_day_of_week': return `EXTRACT(DAYOFWEEK FROM ${dateExpr})`;
      case 'name_day': return `FORMAT_DATE('%A', ${dateExpr})`;
      default: return col;
    }
  }

  // PostgreSQL / Azure PostgreSQL
  switch (dim.datePart) {
    case 'num_year': return `EXTRACT(YEAR FROM ${dateExpr})`;
    case 'num_month': return `EXTRACT(MONTH FROM ${dateExpr})`;
    case 'name_month': return `TO_CHAR(${dateExpr}, 'Month')`;
    case 'num_week': return `EXTRACT(WEEK FROM ${dateExpr})`;
    case 'num_day_of_week': return `EXTRACT(DOW FROM ${dateExpr})`;
    case 'name_day': return `TO_CHAR(${dateExpr}, 'Day')`;
    default: return col;
  }
}

// Validate a single value as a date using the requested format hint. The
// format codes mirror the dropdown options offered to the user when
// overriding a column to type='date':
//   - 'auto'         tries ISO, then EU (DD/MM/YYYY), then US (MM/DD/YYYY)
//   - 'iso'          strict YYYY-MM-DD (or longer ISO 8601)
//   - 'dd/mm/yyyy'   day first, slash separator (also accepts 2-digit year)
//   - 'mm/dd/yyyy'   month first, slash separator
//   - 'dd-mm-yyyy'   dash separator
//   - 'dd.mm.yyyy'   dot separator
//   - 'yyyymmdd'     compact ISO (no separators)
// All checks reject pure-numeric values up-front to avoid scoring random
// IDs or counts as "valid dates".
function isValidDate(v, fmt) {
  if (v == null) return false;
  if (v instanceof Date) return !isNaN(v.getTime());
  const s = String(v).trim();
  if (!s) return false;
  // yyyymmdd is the only format that legitimately consists of pure digits;
  // every other path rejects them up-front.
  const purelyNumeric = /^-?\d+(\.\d+)?$/.test(s);
  if (purelyNumeric && fmt !== 'yyyymmdd') return false;

  const tryEu = (sep) => {
    const m = s.match(new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{2,4})$`));
    if (!m) return false;
    const dd = +m[1], mm = +m[2];
    const yyyy = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return false;
    const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    return !isNaN(Date.parse(iso));
  };
  const tryUs = (sep) => {
    const m = s.match(new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{2,4})$`));
    if (!m) return false;
    const mm = +m[1], dd = +m[2];
    const yyyy = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    return !isNaN(Date.parse(iso));
  };
  const tryIso = () => /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s));
  const tryYyyymmdd = () => {
    const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return false;
    const mm = +m[2], dd = +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    return !isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}`));
  };

  switch (fmt) {
    case 'iso':         return tryIso();
    case 'dd/mm/yyyy':  return tryEu('\\/');
    case 'mm/dd/yyyy':  return tryUs('\\/');
    case 'dd-mm-yyyy':  return tryEu('-');
    case 'dd.mm.yyyy':  return tryEu('\\.');
    case 'yyyymmdd':    return tryYyyymmdd();
    case 'auto':
    default: {
      if (tryIso()) return true;
      if (tryEu('[\\/.\\-]')) return true;
      if (tryUs('[\\/.\\-]')) return true;
      if (/[A-Za-z]/.test(s)) return !isNaN(Date.parse(s));
      return false;
    }
  }
}

// The SQL expression that projects a dimension: a date-part function when the
// dim carries a `datePart` grain (year/month/…), otherwise the plain quoted
// column. Same expression must appear in SELECT and in any WHERE/HAVING that
// targets the dim, so filtering a "num_year" dim hits YEAR(col) not the raw
// timestamp. Extracted from routes/models.js where it was inlined identically
// at every dimension site.
function buildDimensionExpr(dim, dbType, columnTypes) {
  return dim.datePart
    ? buildDatePartExpr(dim, dbType, columnTypes)
    : quoteCol(dim.table, dim.column, dbType);
}

module.exports = {
  getDateFormat,
  getOverrideType,
  buildDatePartExpr,
  buildDimensionExpr,
  isValidDate,
};
