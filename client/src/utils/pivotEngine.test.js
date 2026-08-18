import { describe, test, expect } from 'vitest';
import { resolveCell, pivotData } from './pivotEngine';

// The accumulator shape pivotData builds internally.
const acc = ({ sum = 0, count = 0, min = Infinity, max = -Infinity } = {}) => ({ sum, count, min, max });

describe('resolveCell', () => {
  test('a group where every value was NULL is empty, not zero', () => {
    // The bug this guards: `sum` returned its 0 seed and `avg` its 0 fallback,
    // so a cell that measured nothing claimed to have measured zero — visually
    // indistinguishable from a real zero.
    const nothing = acc();
    expect(resolveCell(nothing, 'sum')).toBeNull();
    expect(resolveCell(nothing, 'avg')).toBeNull();
    expect(resolveCell(nothing, 'count')).toBeNull();
    expect(resolveCell(nothing, 'min')).toBeNull();
    expect(resolveCell(nothing, 'max')).toBeNull();
  });

  test('a real zero stays a zero', () => {
    // The other half: sums that genuinely add up to 0 must not be blanked.
    expect(resolveCell(acc({ sum: 0, count: 3, min: -5, max: 5 }), 'sum')).toBe(0);
    expect(resolveCell(acc({ sum: 0, count: 3 }), 'avg')).toBe(0);
  });

  test('an absent accumulator is empty', () => {
    expect(resolveCell(null, 'sum')).toBeNull();
    expect(resolveCell(undefined, 'avg')).toBeNull();
  });

  test('the aggregations return what they claim', () => {
    const a = acc({ sum: 10, count: 4, min: 1, max: 6 });
    expect(resolveCell(a, 'sum')).toBe(10);
    expect(resolveCell(a, 'avg')).toBe(2.5);
    expect(resolveCell(a, 'count')).toBe(4);
    expect(resolveCell(a, 'min')).toBe(1);
    expect(resolveCell(a, 'max')).toBe(6);
  });
});

describe('total components', () => {
  // Two countries, deliberately lopsided: FR averages 100 over 1 sale, DE
  // averages 10 over 99. The true overall mean is 10.909…, nowhere near the
  // 55 an average-of-averages gives — that is the whole point of the atoms.
  const ROWS = [
    { Country: 'FR', Avg: 100, _avg_h_sum: 100, _avg_h_count: 1 },
    { Country: 'DE', Avg: 10, _avg_h_sum: 990, _avg_h_count: 99 },
  ];
  const pivot = () => pivotData({
    rawRows: ROWS,
    rowDims: ['Country'],
    colDims: [],
    measures: ['Avg'],
    extraCols: ['_avg_h_sum', '_avg_h_count'],
  });

  test('the atoms reach every bucket, not just the grand total', () => {
    const p = pivot();
    for (const bucket of [p.grandTotal, p.rowTotals.FR, p.colTotals.__all__]) {
      expect(bucket._avg_h_sum).toBeDefined();
      expect(bucket._avg_h_count).toBeDefined();
    }
  });

  test('the rebuilt grand total is the weighted mean, not the mean of means', () => {
    const p = pivot();
    const s = resolveCell(p.grandTotal._avg_h_sum, 'sum');
    const n = resolveCell(p.grandTotal._avg_h_count, 'sum');
    expect(s / n).toBeCloseTo(1090 / 100, 10);
    // What the pivot used to show, and what makes the two irreconcilable.
    expect(resolveCell(p.grandTotal.Avg, 'avg')).toBe(55);
  });

  test('a row total over a single group equals that group', () => {
    const p = pivot();
    const s = resolveCell(p.rowTotals.FR._avg_h_sum, 'sum');
    const n = resolveCell(p.rowTotals.FR._avg_h_count, 'sum');
    expect(s / n).toBe(100);
  });

  test('the atoms stay out of the rendered measure list', () => {
    expect(pivot().measures).toEqual(['Avg']);
  });

  test('no atoms requested, nothing accumulated', () => {
    const p = pivotData({
      rawRows: ROWS, rowDims: ['Country'], colDims: [], measures: ['Avg'],
    });
    expect(p.grandTotal._avg_h_sum).toBeUndefined();
  });
});
