import { describe, test, expect } from 'vitest';
import { computeTotal, getConditionalStyle } from './tableConfigHelpers';

// Rows are arrays, one entry per column — the shape TableWidget renders.
const rows = (...values) => values.map((v) => ['France', v]);

describe('computeTotal', () => {
  test('totals a numeric column', () => {
    expect(computeTotal(rows(10, 20, 5), 1, 'sum')).toBe(35);
    expect(computeTotal(rows(10, 20, 5), 1, 'avg')).toBe(35 / 3);
    expect(computeTotal(rows(10, 20, 5), 1, 'min')).toBe(5);
  });

  test('a column of formatted durations has no total', () => {
    // parseFloat totalled the digits each value starts with: 164 + 12 = 176,
    // printed under a column whose values are not numbers.
    expect(computeTotal(rows('164j 08:02:17', '12j 01:00:00'), 1, 'sum')).toBe('');
  });

  test('the numeric rows of a mixed column still count', () => {
    expect(computeTotal(rows(10, 'N/A', 5), 1, 'sum')).toBe(15);
  });
});

describe('getConditionalStyle', () => {
  const scale = [{ type: 'colorScale', minColor: '#000000', maxColor: '#ffffff' }];

  test('colours a numeric cell', () => {
    const { style } = getConditionalStyle(scale, 5, [0, 10]);
    expect(style.backgroundColor).toBeTruthy();
  });

  test('leaves a text cell alone', () => {
    // parseFloat read 164 and the cell was tinted on a number nobody computed.
    const { style } = getConditionalStyle(scale, '164j 08:02:17', ['164j 08:02:17', '12j 01:00:00']);
    expect(style).toEqual({});
  });
});
