// Aggregate-expression assembly for the /query SQL compiler — extracted verbatim
// from routes/models.js (god-file split). Pure functions: no req/res/db, no
// closure state. `dbType` is threaded in explicitly (it used to be captured from
// the handler closure). Covered by tests/sqlSnapshot + tests/measureAgg.
const { quoteCol, normalizeAggregation } = require('../sqlDialect');
const { castToNumber } = require('./casts');
const { getOverrideType } = require('./datePart');

// Walk a SQL expression and replace each top-level aggregate (SUM/AVG/
// MIN/MAX/COUNT) by `transform(fn, arg)`. Paren-aware: tracks depth so a
// CASE WHEN containing `IN (...)` inside the aggregate doesn't trick the
// matcher into terminating early. Skips string literals so an expression
// like `'SUM(x)'` stays untouched. The same primitive backs both the
// NUMERIC cast (for integer-division avoidance) and the CASE WHEN wrap
// (for filtered-measure intersection mode).
function transformAggregates(expression, fns, transform) {
  if (!expression) return expression;
  const s = String(expression);
  const fnRegex = new RegExp(`^(${fns.join('|')})\\(`, 'i');
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) { out += s.slice(i); break; }
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    // Aggregates are word-boundaried; skip if previous char is alpha/_
    const prev = i > 0 ? s[i - 1] : '';
    const atBoundary = !/[A-Za-z0-9_]/.test(prev);
    const m = atBoundary ? s.slice(i).match(fnRegex) : null;
    if (!m) { out += s[i]; i++; continue; }
    const fn = m[1];
    let depth = 1;
    let j = i + m[0].length;
    let inStr = false;
    while (j < s.length && depth > 0) {
      const ch = s[j];
      if (inStr) {
        if (ch === "'") inStr = false;
      } else if (ch === "'") {
        inStr = true;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    if (depth !== 0) { out += s[i]; i++; continue; }
    const arg = s.slice(i + m[0].length, j);
    out += transform(fn, arg);
    i = j + 1;
  }
  return out;
}

// Wrap each top-level aggregate so its result is in a decimal/numeric
// type — prevents the integer-division-truncates-to-0 trap when the
// user writes a / inside a custom expression. Dialect-aware so it works
// on every supported backend:
//   - PG / Azure PG / DuckDB: CAST(... AS NUMERIC) — arbitrary precision
//   - MySQL / MSSQL / Azure SQL: CAST(... AS DECIMAL(38,10)). MySQL refuses
//     CAST AS NUMERIC without precision; MSSQL/Azure DEFAULT NUMERIC to scale
//     0, silently truncating the decimals — pin the scale on both.
//   - BigQuery: CAST(... AS NUMERIC) — BQ already returns FLOAT64 from
//     `/` so this is mostly defensive, but harmless
// SUM/AVG/MIN/MAX get the argument cast (preserves decimal precision);
// COUNT gets cast on its return value (it ignores its argument's type).
function dialectNumericCast(inner, dbType) {
  if (dbType === 'mysql' || dbType === 'mssql' || dbType === 'azure_sql') {
    return `CAST(${inner} AS DECIMAL(38,10))`;
  }
  return `CAST(${inner} AS NUMERIC)`;
}
function applyNumericCast(expression, dbType) {
  return transformAggregates(
    expression,
    ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'],
    (fn, arg) => fn.toUpperCase() === 'COUNT'
      ? dialectNumericCast(`${fn}(${arg})`, dbType)
      : `${fn}(${dialectNumericCast(arg, dbType)})`,
  );
}

// PostgreSQL's `SUM(real)` returns `real` — 24-bit mantissa, ~7 significant
// digits — and T-SQL does the same. Harmless for a number the user reads
// directly, not for an atom that a later division amplifies: a sub-total
// rebuilt from a truncated sum lands a couple of units away from the single row
// it sums, which reads as a bug. MySQL and BigQuery already widen SUM to
// DOUBLE/FLOAT64, and old MySQL has no CAST AS DOUBLE, so leave their SQL alone.
// DOUBLE rather than NUMERIC on purpose: DuckDB's NUMERIC is DECIMAL(18,3),
// which would both round and overflow on a large sum.
const WIDE_FLOAT = {
  postgres: 'DOUBLE PRECISION',
  azure_postgres: 'DOUBLE PRECISION',
  duckdb: 'DOUBLE',
  mssql: 'FLOAT',
  azure_sql: 'FLOAT',
};
function widenFloat(inner, dbType) {
  const t = WIDE_FLOAT[dbType];
  return t ? `CAST(${inner} AS ${t})` : inner;
}

// Single source for a measure's aggregate SQL expression (the block that was
// copy-pasted 5× across the /query handler): numeric CAST on a column the user
// overrode to a numeric type, then SUM/AVG/MIN/MAX(col), then interval →
// EXTRACT(EPOCH …) flattening on the dialects that support it. COUNT stays at
// each call site (dialect-specific COUNT(col)/COUNT(*) shapes). `caseWhenSql`
// wraps the column in a CASE for conditional-filter measures. Returns the
// expression string (no alias). NB: the HAVING path keeps its own copy — its
// COUNT/effAgg handling diverges.
function buildMeasureAggExpr(m, { dbType, columnTypes, caseWhenSql = null }) {
  const rawCol = quoteCol(m.table, m.column, dbType);
  const ovType = getOverrideType(m.table, m.column, columnTypes);
  const isInterval = String(m.dataType || '').toLowerCase() === 'interval' || ovType === 'interval';
  let colExpr = rawCol;
  if (ovType === 'integer' || ovType === 'decimal' || ovType === 'number') {
    colExpr = castToNumber(rawCol, dbType, ovType, m.dataType);
  } else if (m.widenFloat && !isInterval) {
    // Set only on the synthetic atoms of an average — see widenFloat above.
    colExpr = widenFloat(rawCol, dbType);
  }
  const agg = normalizeAggregation(m.aggregation).toUpperCase();
  const aggExpr = caseWhenSql
    ? `${agg}(CASE WHEN ${caseWhenSql} THEN ${colExpr} END)`
    : `${agg}(${colExpr})`;
  const supportsExtractEpoch = dbType === 'postgres' || dbType === 'azure_postgres' || dbType === 'duckdb';
  return (isInterval && supportsExtractEpoch) ? `EXTRACT(EPOCH FROM ${aggExpr})` : aggExpr;
}

module.exports = { transformAggregates, dialectNumericCast, applyNumericCast, buildMeasureAggExpr };
