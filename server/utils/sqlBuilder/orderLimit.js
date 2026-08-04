// ORDER BY + LIMIT for a top-N / bottom-N override — dialect-aware NULLS
// handling and the OFFSET…FETCH vs LIMIT split. Extracted from routes/models.js
// where the identical cascade appeared twice (main query + x-grain subquery).
// `topN` is { aggExpr, direction, n }. Covered by tests/orderLimit.
function buildTopNOrderLimit(topN, dbType) {
  // NULL-handling on ORDER BY is dialect-specific. Postgres / DuckDB / BigQuery
  // accept "NULLS LAST" inline; MySQL emulates with "<col> IS NULL"; SQL Server
  // / Azure SQL have neither (aggregates over a non-empty group rarely NULL).
  const supportsNullsLast = dbType === 'postgres' || dbType === 'duckdb' || dbType === 'bigquery';
  let out;
  if (dbType === 'mysql') {
    out = ` ORDER BY ${topN.aggExpr} IS NULL, ${topN.aggExpr} ${topN.direction}`;
  } else if (supportsNullsLast) {
    out = ` ORDER BY ${topN.aggExpr} ${topN.direction} NULLS LAST`;
  } else {
    out = ` ORDER BY ${topN.aggExpr} ${topN.direction}`;
  }
  // SQL Server / Azure SQL: OFFSET/FETCH instead of LIMIT.
  if (dbType === 'mssql' || dbType === 'azure_sql') {
    out += ` OFFSET 0 ROWS FETCH NEXT ${topN.n} ROWS ONLY`;
  } else {
    out += ` LIMIT ${topN.n}`;
  }
  return out;
}

module.exports = { buildTopNOrderLimit };
