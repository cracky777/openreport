import { describe, test, expect } from 'vitest';
import { highlightedIndices, barHighlight, highlightLegendItem, legendWithHighlight } from './highlight';

// The June spike of Mutuelle Horizon's claims, by month.
const values = [255, 245, 280, 255, 280, 640, 270, 275, 255];
const labels = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09'];

describe('bars that stand out', () => {
  test('by a rule on the bars shown: the largest, the smallest, well over the average', () => {
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'top' })]).toEqual([5]);
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'bottom', n: 2 })].sort()).toEqual([0, 1]);
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'above', above: 50 })]).toEqual([5]);
  });
  test('or over / under a value the reader sets ("the bars over 2 million")', () => {
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'over', threshold: 275 })]).toEqual([2, 4, 5]);
    expect([...highlightedIndices(values, labels, { enabled: true, mode: 'under', threshold: 250 })]).toEqual([1]);
    expect(highlightedIndices(values, labels, { enabled: true, mode: 'over' }).size).toBe(0);
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

// A color with a meaning the chart cannot say alone: the legend says it (Jonathan).
describe('the highlight in the legend', () => {
  const write = (v) => String(v);
  test('over / under a value and well above the average get an entry; the largest or named bars do not need one', () => {
    expect(highlightLegendItem({ highlight: { enabled: true, mode: 'over', threshold: 1000000, color: '#16a34a' } }, write)).toEqual({ name: '> 1000000', color: '#16a34a', fixed: true });
    expect(highlightLegendItem({ highlight: { enabled: true, mode: 'above', above: 50 } }, write).name).toBe('+50 % vs average');
    expect(highlightLegendItem({ highlight: { enabled: true, mode: 'top', n: 1 } }, write)).toBeNull();
    expect(highlightLegendItem({ highlight: { enabled: false, mode: 'over', threshold: 3 } }, write)).toBeNull();
  });
  test('shown even when the chart has no legend of its own', () => {
    const config = { highlight: { enabled: true, mode: 'under', threshold: 0, color: '#dc2626' } };
    expect(legendWithHighlight([{ name: 'Sales', color: '#000' }], false, config, write)).toEqual([{ name: '< 0', color: '#dc2626', fixed: true }]);
    expect(legendWithHighlight([{ name: 'Sales', color: '#000' }], true, config, write)).toHaveLength(2);
    expect(legendWithHighlight([{ name: 'Sales', color: '#000' }], false, {}, write)).toEqual([]);
  });
});
