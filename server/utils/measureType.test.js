const {
  additiveTypeForMeasure,
  inferAdditiveTypeFromExpression,
} = require('./measureType');

describe('additiveTypeForMeasure (standard aggregations)', () => {
  test('sum / count / min / max pass through', () => {
    expect(additiveTypeForMeasure({ aggregation: 'sum' })).toBe('sum');
    expect(additiveTypeForMeasure({ aggregation: 'count' })).toBe('count');
    expect(additiveTypeForMeasure({ aggregation: 'min' })).toBe('min');
    expect(additiveTypeForMeasure({ aggregation: 'max' })).toBe('max');
  });

  test('avg / count_distinct / unknown reject', () => {
    expect(additiveTypeForMeasure({ aggregation: 'avg' })).toBeNull();
    expect(additiveTypeForMeasure({ aggregation: 'count_distinct' })).toBeNull();
    expect(additiveTypeForMeasure({ aggregation: 'median' })).toBeNull();
    expect(additiveTypeForMeasure({ aggregation: 'whatever' })).toBeNull();
  });

  test('null / undefined return null', () => {
    expect(additiveTypeForMeasure(null)).toBeNull();
    expect(additiveTypeForMeasure(undefined)).toBeNull();
    expect(additiveTypeForMeasure({})).toBeNull();
  });
});

describe('inferAdditiveTypeFromExpression (custom trivial wrappers)', () => {
  test('COUNT(*)', () => {
    expect(inferAdditiveTypeFromExpression('COUNT(*)')).toBe('count');
    expect(inferAdditiveTypeFromExpression('count(*)')).toBe('count');
    expect(inferAdditiveTypeFromExpression('  Count ( *  )  ')).toBe('count');
  });

  test('COUNT(col) variants', () => {
    expect(inferAdditiveTypeFromExpression('COUNT(id)')).toBe('count');
    expect(inferAdditiveTypeFromExpression('COUNT("orders"."id")')).toBe('count');
    expect(inferAdditiveTypeFromExpression('COUNT(orders.id)')).toBe('count');
    // The cacheWarmer payload showed parens around the whole expression;
    // the regex trims and matches the inside on its own.
    expect(inferAdditiveTypeFromExpression('COUNT("nyukom_appel_entrant"."f_appel_entrant_fin"."id_appel")')).toBe('count');
  });

  test('SUM / MIN / MAX trivial', () => {
    expect(inferAdditiveTypeFromExpression('SUM(amount)')).toBe('sum');
    expect(inferAdditiveTypeFromExpression('MIN("orders"."amount")')).toBe('min');
    expect(inferAdditiveTypeFromExpression('MAX(amount)')).toBe('max');
  });

  test('DISTINCT anywhere disqualifies', () => {
    expect(inferAdditiveTypeFromExpression('COUNT(DISTINCT user_id)')).toBeNull();
    expect(inferAdditiveTypeFromExpression('SUM(DISTINCT amount)')).toBeNull();
  });

  test('AVG / MEDIAN / arithmetic / CASE reject', () => {
    expect(inferAdditiveTypeFromExpression('AVG(amount)')).toBeNull();
    expect(inferAdditiveTypeFromExpression('MEDIAN(amount)')).toBeNull();
    expect(inferAdditiveTypeFromExpression('SUM(amount) / COUNT(*)')).toBeNull();
    expect(inferAdditiveTypeFromExpression('CASE WHEN x > 0 THEN SUM(amount) ELSE 0 END')).toBeNull();
    expect(inferAdditiveTypeFromExpression('SUM(amount) + SUM(tax)')).toBeNull();
  });

  test('empty / non-string returns null', () => {
    expect(inferAdditiveTypeFromExpression('')).toBeNull();
    expect(inferAdditiveTypeFromExpression(null)).toBeNull();
    expect(inferAdditiveTypeFromExpression(undefined)).toBeNull();
    expect(inferAdditiveTypeFromExpression(42)).toBeNull();
  });
});

describe('additiveTypeForMeasure (aggregation: custom)', () => {
  test('promotes a trivial COUNT(col) to count', () => {
    const m = { aggregation: 'custom', expression: 'COUNT(orders.id)' };
    expect(additiveTypeForMeasure(m)).toBe('count');
  });

  test('promotes a trivial SUM(col) to sum', () => {
    const m = { aggregation: 'custom', expression: 'SUM("orders"."amount")' };
    expect(additiveTypeForMeasure(m)).toBe('sum');
  });

  test('rejects a non-trivial custom expression', () => {
    const m = { aggregation: 'custom', expression: 'SUM(amount) - SUM(refund)' };
    expect(additiveTypeForMeasure(m)).toBeNull();
  });

  test('rejects COUNT(DISTINCT) custom', () => {
    const m = { aggregation: 'custom', expression: 'COUNT(DISTINCT user_id)' };
    expect(additiveTypeForMeasure(m)).toBeNull();
  });

  test('custom with no expression returns null', () => {
    const m = { aggregation: 'custom' };
    expect(additiveTypeForMeasure(m)).toBeNull();
  });
});
