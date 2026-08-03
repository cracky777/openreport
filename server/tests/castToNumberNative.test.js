const { castToNumber } = require('../utils/sqlBuilder/casts');

// Regression guard: a "decimal" type override on a column that is ALREADY
// numeric natively must NOT wrap the column in REPLACE(col, ',', '.') — that's
// a hard binder error on DuckDB (`replace(DOUBLE, …)`) and pointless elsewhere.
describe('castToNumber — REPLACE only on text columns', () => {
  const COL = '"data_3"."Sales"';

  test('decimal on a TEXT column REPLACEs on a string cast (French comma decimals)', () => {
    const sql = castToNumber(COL, 'duckdb', 'decimal', 'varchar');
    // REPLACE always runs on a string cast so it is binder-safe on every type.
    expect(sql).toBe(`CAST(REPLACE(CAST(${COL} AS VARCHAR), ',', '.') AS NUMERIC)`);
  });

  test('decimal on a native DOUBLE column skips REPLACE (the reported bug)', () => {
    const sql = castToNumber(COL, 'duckdb', 'decimal', 'double');
    expect(sql).not.toContain('REPLACE');
    expect(sql).toBe(`CAST(${COL} AS NUMERIC)`);
  });

  test('decimal on native bigint / numeric / real skips REPLACE', () => {
    for (const nt of ['bigint', 'numeric', 'real', 'double precision']) {
      expect(castToNumber(COL, 'duckdb', 'decimal', nt)).not.toContain('REPLACE');
    }
  });

  test('parametrized native types (decimal(18,2), numeric(10)) skip REPLACE', () => {
    for (const nt of ['DECIMAL(18,2)', 'numeric(10)', 'DOUBLE', 'number']) {
      expect(castToNumber(COL, 'duckdb', 'decimal', nt)).not.toContain('REPLACE');
    }
  });

  test('integer override never REPLACEs (pre-existing behaviour)', () => {
    expect(castToNumber(COL, 'duckdb', 'integer', 'varchar')).not.toContain('REPLACE');
  });

  test('unknown native type keeps REPLACE (safe default for text)', () => {
    expect(castToNumber(COL, 'duckdb', 'decimal', undefined)).toContain('REPLACE');
  });

  test('mysql still uses DECIMAL(38,10), skips on numeric, casts to CHAR on text', () => {
    expect(castToNumber(COL, 'mysql', 'decimal', 'double')).toBe(`CAST(${COL} AS DECIMAL(38,10))`);
    expect(castToNumber(COL, 'mysql', 'decimal', 'text')).toBe(`CAST(REPLACE(CAST(${COL} AS CHAR), ',', '.') AS DECIMAL(38,10))`);
  });
});
