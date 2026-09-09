import { describe, test, expect } from 'vitest';
import { parseAggVariant, makeAggVariant, baseMeasureName, nextAggVariant } from './aggVariant';

describe('parseAggVariant', () => {
  test('reads the aggregation out of the name', () => {
    expect(parseAggVariant('sales.amt_sum@@agg:avg')).toEqual({ base: 'sales.amt_sum', agg: 'avg' });
  });

  test('a plain measure is not a variant', () => {
    expect(parseAggVariant('sales.amt_sum')).toBeNull();
    expect(parseAggVariant(undefined)).toBeNull();
  });

  test('an aggregation nobody supports is not a variant', () => {
    // Otherwise the name would reach the SQL as a function nobody validated.
    expect(parseAggVariant('sales.amt_sum@@agg:median')).toBeNull();
    expect(parseAggVariant('sales.amt_sum@@agg:1) UNION SELECT')).toBeNull();
  });

  test('round trip', () => {
    expect(parseAggVariant(makeAggVariant('m', 'min'))).toEqual({ base: 'm', agg: 'min' });
    expect(baseMeasureName(makeAggVariant('m', 'min'))).toBe('m');
    expect(baseMeasureName('m')).toBe('m');
  });
});

describe('nextAggVariant', () => {
  test('the second drop of a measure picks an aggregation not already there', () => {
    // The base sits in the zone as a sum, so the copy must not be one too.
    expect(nextAggVariant('m', ['m'], 'sum')).toBe('m@@agg:avg');
  });

  test('it keeps walking down the list', () => {
    expect(nextAggVariant('m', ['m', 'm@@agg:avg'], 'sum')).toBe('m@@agg:count');
  });

  test('other measures in the zone are none of its business', () => {
    expect(nextAggVariant('m', ['other', 'other@@agg:avg'], 'sum')).toBe('m@@agg:sum');
  });

  test('every aggregation taken: repeat rather than refuse the drop', () => {
    const all = ['m', 'm@@agg:avg', 'm@@agg:count', 'm@@agg:min', 'm@@agg:max'];
    expect(nextAggVariant('m', all, 'sum')).toBe('m@@agg:max');
  });
});
