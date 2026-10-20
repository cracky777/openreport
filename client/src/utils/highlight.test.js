import { describe, test, expect } from 'vitest';
import { highlightedIndices, barHighlight } from './highlight';

// The June spike of Mutuelle Horizon's claims, by month.
const values = [255, 245, 280, 255, 280, 640, 270, 275, 255];
const labels = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09'];

describe('bars that stand out', () => {
  test('by a rule on the bars shown: the largest, the smallest, well over the average', () => {
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'top' })]).toEqual([5]);
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'bottom', n: 2 })].sort()).toEqual([0, 1]);
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'above', above: 50 })]).toEqual([5]);
  });
  test('or by naming categories; off, none', () => {
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'values', values: ['2025-06'] })]).toEqual([5]);
    expect(highlightedIndices(values, labels, { mode: 'top' }).size).toBe(0);
  });
  test('the marked bars take the color and may print their value alone', () => {
    const h = barHighlight({ highlight: { enabled: true, color: '#c2410c', label: true } }, values, labels);
    expect(h.colorAt(5)).toBe('#c2410c');
    expect(h.colorAt(0)).toBeNull();
    expect(h.labelAt(5)).toBe(true);
  });
});
