// Unit coverage for utils/sqlBuilder/measureAgg — the aggregate-expression
// helpers extracted verbatim from the /query handler. The golden sqlSnapshot
// suite already locks buildMeasureAggExpr through the main SELECT loop; this
// file additionally pins the numeric-cast branches (custom-expression / HAVING
// paths) that snapshots don't exercise, and proves the `dbType` argument that
// used to be captured from the handler closure is threaded through correctly.
const {
  transformAggregates,
  dialectNumericCast,
  applyNumericCast,
  buildMeasureAggExpr,
} = require('../utils/sqlBuilder/measureAgg');

describe('transformAggregates', () => {
  test('rewrites each top-level aggregate via the transform callback', () => {
    const out = transformAggregates('SUM(a) + AVG(b)', ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'],
      (fn, arg) => `${fn}[${arg}]`);
    expect(out).toBe('SUM[a] + AVG[b]');
  });

  test('is paren-aware — an IN (...) inside a CASE WHEN does not end the match early', () => {
    const expr = "SUM(CASE WHEN x IN (1, 2) THEN y END)";
    const out = transformAggregates(expr, ['SUM'], (fn, arg) => `${fn}<${arg}>`);
    expect(out).toBe("SUM<CASE WHEN x IN (1, 2) THEN y END>");
  });

  test('skips string literals so a quoted SUM(x) stays untouched', () => {
    const out = transformAggregates("'SUM(x)' || SUM(y)", ['SUM'], () => 'HIT');
    expect(out).toBe("'SUM(x)' || HIT");
  });

  test('leaves a word that merely ends in an aggregate name alone (word boundary)', () => {
    const out = transformAggregates('MYSUM(a)', ['SUM'], () => 'HIT');
    expect(out).toBe('MYSUM(a)');
  });
});

describe('dialectNumericCast', () => {
  test('pins DECIMAL(38,10) on mysql / mssql / azure_sql (which truncate a bare NUMERIC)', () => {
    for (const dbType of ['mysql', 'mssql', 'azure_sql']) {
      expect(dialectNumericCast('x', dbType)).toBe('CAST(x AS DECIMAL(38,10))');
    }
  });

  test('uses arbitrary-precision NUMERIC on pg / duckdb / bigquery', () => {
    for (const dbType of ['postgres', 'duckdb', 'bigquery']) {
      expect(dialectNumericCast('x', dbType)).toBe('CAST(x AS NUMERIC)');
    }
  });
});

describe('applyNumericCast', () => {
  test('casts SUM/AVG argument but casts COUNT on its return value', () => {
    expect(applyNumericCast('SUM(a)', 'postgres')).toBe('SUM(CAST(a AS NUMERIC))');
    expect(applyNumericCast('COUNT(a)', 'postgres')).toBe('CAST(COUNT(a) AS NUMERIC)');
  });

  test('threads dbType through to the dialect cast', () => {
    expect(applyNumericCast('SUM(a)', 'mysql')).toBe('SUM(CAST(a AS DECIMAL(38,10)))');
  });
});

describe('buildMeasureAggExpr', () => {
  const cols = {};
  test('standard SUM with no override', () => {
    const m = { table: 'items', column: 'amt', aggregation: 'sum' };
    expect(buildMeasureAggExpr(m, { dbType: 'postgres', columnTypes: cols }))
      .toBe('SUM("items"."amt")');
  });

  test('interval measure flattens via EXTRACT(EPOCH …) on pg but not on mysql', () => {
    const m = { table: 'items', column: 'dur', aggregation: 'sum', dataType: 'interval' };
    expect(buildMeasureAggExpr(m, { dbType: 'postgres', columnTypes: cols }))
      .toBe('EXTRACT(EPOCH FROM SUM("items"."dur"))');
    expect(buildMeasureAggExpr(m, { dbType: 'mysql', columnTypes: cols }))
      .toBe('SUM(`items`.`dur`)');
  });

  test('caseWhenSql wraps the column in a CASE for conditional-filter measures', () => {
    const m = { table: 'items', column: 'amt', aggregation: 'sum' };
    expect(buildMeasureAggExpr(m, { dbType: 'postgres', columnTypes: cols, caseWhenSql: "region = 'EU'" }))
      .toBe('SUM(CASE WHEN region = \'EU\' THEN "items"."amt" END)');
  });
});
