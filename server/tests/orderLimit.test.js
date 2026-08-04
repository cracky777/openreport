// Unit coverage for utils/sqlBuilder/buildTopNOrderLimit — the top-N ORDER BY /
// LIMIT cascade shared by the main query and the x-grain subquery. The golden
// SQL snapshots don't exercise a top_n filter, so this locks every dialect
// branch (NULLS handling + OFFSET…FETCH vs LIMIT) the extraction merged.
const { buildTopNOrderLimit } = require('../utils/sqlBuilder/orderLimit');

const topN = { aggExpr: 'SUM("t"."amt")', direction: 'DESC', n: 10 };

describe('buildTopNOrderLimit', () => {
  test('postgres / duckdb / bigquery: NULLS LAST + LIMIT', () => {
    for (const dbType of ['postgres', 'duckdb', 'bigquery']) {
      expect(buildTopNOrderLimit(topN, dbType))
        .toBe(' ORDER BY SUM("t"."amt") DESC NULLS LAST LIMIT 10');
    }
  });

  test('mysql: emulates NULLS LAST with "expr IS NULL" + LIMIT', () => {
    expect(buildTopNOrderLimit(topN, 'mysql'))
      .toBe(' ORDER BY SUM("t"."amt") IS NULL, SUM("t"."amt") DESC LIMIT 10');
  });

  test('mssql / azure_sql: no NULLS hint + OFFSET…FETCH instead of LIMIT', () => {
    for (const dbType of ['mssql', 'azure_sql']) {
      expect(buildTopNOrderLimit(topN, dbType))
        .toBe(' ORDER BY SUM("t"."amt") DESC OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY');
    }
  });
});
