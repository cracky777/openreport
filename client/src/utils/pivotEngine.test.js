import { describe, test, expect } from 'vitest';
import { resolveCell } from './pivotEngine';

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
