const { firstAggregate, looksTextual, sortValueAlias } = require('../utils/sqlBuilder/measureSortValue');

describe('firstAggregate', () => {
  test('finds the aggregate a formatted duration is built on', () => {
    const expr = `CASE WHEN FLOOR(COALESCE(SUM("t"."d"), 0) / 86400) < 10 THEN '0' ELSE '' END`
      + ` || CAST(CAST(FLOOR(COALESCE(SUM("t"."d"), 0) / 86400) AS BIGINT) AS VARCHAR)`;
    expect(firstAggregate(expr)).toBe('SUM("t"."d")');
  });

  test('takes the first one and is paren-aware', () => {
    expect(firstAggregate('SUM(a) / NULLIF(SUM(b), 0)')).toBe('SUM(a)');
    // The IN (...) inside the aggregate must not close the match early.
    expect(firstAggregate("SUM(CASE WHEN x IN ('a', 'b') THEN y END) || 'j'"))
      .toBe("SUM(CASE WHEN x IN ('a', 'b') THEN y END)");
  });

  test('a windowed aggregate keeps its OVER — alone, SUM(COUNT(…)) nests', () => {
    const expr = "SUM(COUNT(CASE WHEN s = 'Perdu' THEN id END)) OVER (PARTITION BY TO_CHAR(d, 'Month')) || ' calls'";
    expect(firstAggregate(expr))
      .toBe("SUM(COUNT(CASE WHEN s = 'Perdu' THEN id END)) OVER (PARTITION BY TO_CHAR(d, 'Month'))");
  });

  test('an expression with no aggregate has no companion', () => {
    expect(firstAggregate("'constant'")).toBeNull();
    expect(firstAggregate('')).toBeNull();
    expect(firstAggregate(undefined)).toBeNull();
  });
});

describe('looksTextual', () => {
  test('the constructs that turn a number into text', () => {
    expect(looksTextual("SUM(a) || 'j'")).toBe(true);
    expect(looksTextual('LPAD(CAST(SUM(a) AS VARCHAR), 2, ' + "'0')")).toBe(true);
    expect(looksTextual('TO_CHAR(SUM(a), ' + "'999')")).toBe(true);
    expect(looksTextual('CONCAT(SUM(a), SUM(b))')).toBe(true);
  });

  test('a numeric expression stays numeric — its SQL must not change', () => {
    expect(looksTextual('SUM(a) / NULLIF(COUNT(b), 0)')).toBe(false);
    expect(looksTextual('ROUND(AVG(x), 2)')).toBe(false);
    expect(looksTextual('CAST(SUM(a) AS NUMERIC)')).toBe(false);
  });

  test('a month NAME in a window partition does not make a ratio textual', () => {
    const ratio = "(SUM(COUNT(CASE WHEN s = 'Perdu' THEN id END)) OVER (PARTITION BY TO_CHAR(d, 'Month')))"
      + " / NULLIF(SUM(COUNT(id)) OVER (PARTITION BY TO_CHAR(d, 'Month')), 0) * 100";
    expect(looksTextual(ratio)).toBe(false);
    expect(looksTextual("SUM(a) OVER (PARTITION BY TO_CHAR(d, 'Month')) || ' j'")).toBe(true);
  });
});

describe('sortValueAlias', () => {
  test('is prefixed so the client can strip it from a table\'s columns', () => {
    expect(sortValueAlias('Duree')).toBe('__orsort__Duree');
  });
});
