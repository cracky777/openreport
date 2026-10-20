import { describe, test, expect } from 'vitest';
import { resolveCell, pivotData, rebuildTotal } from './pivotEngine';

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

describe('rebuildTotal', () => {
  // The accumulators of a bucket, keyed by the atoms' aliases.
  const bucket = (sales, target) => ({ tc_sales: acc({ sum: sales, count: 2 }), tc_target: acc({ sum: target, count: 2 }) });
  test('a difference, a ratio and a percentage are the operation on the two totals, never a sum of per-row results', () => {
    expect(rebuildTotal({ op: 'subtract', left: 'tc_sales', right: 'tc_target' }, bucket(1200, 1000))).toBe(200);
    expect(rebuildTotal({ op: 'add', left: 'tc_sales', right: 'tc_target' }, bucket(1200, 1000))).toBe(2200);
    expect(rebuildTotal({ op: 'divide', left: 'tc_sales', right: 'tc_target' }, bucket(1200, 1000))).toBe(1.2);
    expect(rebuildTotal({ op: 'percent', left: 'tc_sales', right: 'tc_target' }, bucket(1200, 1000))).toBe(120);
  });
  test('a side with no row counts for 0; a zero divisor or an empty bucket shows nothing', () => {
    expect(rebuildTotal({ op: 'subtract', left: 'tc_sales', right: 'tc_target' }, { tc_sales: acc({ sum: 50, count: 1 }) })).toBe(50);
    expect(rebuildTotal({ op: 'percent', left: 'tc_sales', right: 'tc_target' }, { tc_target: acc({ sum: 400, count: 1 }) })).toBe(0);
    expect(rebuildTotal({ op: 'percent', left: 'tc_sales', right: 'tc_target' }, bucket(10, 0))).toBeNull();
    expect(rebuildTotal({ op: 'subtract', left: 'tc_sales', right: 'tc_target' }, {})).toBeNull();
  });
  test('an average is Σsum / Σcount, empty when nothing was measured', () => {
    expect(rebuildTotal({ sum: 's', count: 'n' }, { s: acc({ sum: 300, count: 3 }), n: acc({ sum: 3, count: 3 }) })).toBe(100);
    expect(rebuildTotal({ sum: 's', count: 'n' }, { s: acc(), n: acc() })).toBeNull();
  });
});

describe('pivotData — column order', () => {
  // The first rows need not hold every column: a line booked only in
  // September comes first, the months still read in order.
  test('columns read in ascending order, whatever order the rows arrive in', () => {
    const p = pivotData({
      rawRows: [
        { Line: 'A', Period: '2017-09', Amount: 1 },
        { Line: 'B', Period: '2017-03', Amount: 2 },
        { Line: 'B', Period: '2017-10', Amount: 3 },
      ],
      rowDims: ['Line'], colDims: ['Period'], measures: ['Amount'],
    });
    expect(p.colKeys.map(([, v]) => v[0])).toEqual(['2017-03', '2017-09', '2017-10']);
  });

  test('a month name sorts by the calendar, a number as a number', () => {
    const months = pivotData({
      rawRows: ['March', 'January', 'February'].map((m) => ({ M: m, v: 1 })),
      rowDims: [], colDims: ['M'], measures: ['v'], colDimDefs: [{ datePart: 'name_month' }],
    });
    expect(months.colKeys.map(([, v]) => v[0])).toEqual(['January', 'February', 'March']);
    const years = pivotData({
      rawRows: [10, 9, 100].map((y) => ({ Y: y, v: 1 })),
      rowDims: [], colDims: ['Y'], measures: ['v'], colDimDefs: [{ type: 'integer' }],
    });
    expect(years.colKeys.map(([, v]) => v[0])).toEqual([9, 10, 100]);
  });
});
