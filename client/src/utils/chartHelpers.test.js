import { describe, test, expect } from 'vitest';
import { alignDualAxes, calcBottomMargin } from './chartHelpers';

describe('alignDualAxes', () => {
  test('both axes get the same number of round steps', () => {
    const { left, right } = alignDualAxes({ leftMax: 1320, rightMax: 87 });
    expect(left).toEqual({ max: 1500, interval: 300 });
    expect(right).toEqual({ max: 100, interval: 20 });
    expect(left.max / left.interval).toBe(right.max / right.interval);
  });

  test('a pinned left interval sets the step count for the right axis', () => {
    const { left, right } = alignDualAxes({ leftMax: 1320, rightMax: 87, leftInterval: 200 });
    expect(left).toEqual({ max: 1400, interval: 200 });
    expect(right.max / right.interval).toBe(7);
  });

  test('two pinned intervals keep both and stretch the shorter side', () => {
    const { left, right } = alignDualAxes({ leftMax: 1320, rightMax: 87, leftInterval: 200, rightInterval: 25 });
    expect(left).toEqual({ max: 1400, interval: 200 });
    expect(right).toEqual({ max: 175, interval: 25 });
  });

  test('a side without data leaves both on the chart defaults', () => {
    const { left, right } = alignDualAxes({ leftMax: 1320, rightMax: undefined });
    expect(left).toEqual({ max: undefined, interval: undefined });
    expect(right).toEqual({ max: undefined, interval: undefined });
  });
});

describe('calcBottomMargin', () => {
  test('a negative tilt takes the same room as a positive one', () => {
    const labels = ['January 2026', 'February 2026'];
    expect(calcBottomMargin(-45, labels)).toBe(calcBottomMargin(45, labels));
  });
});

describe('calcBottomMargin follows the tilt', () => {
  const labels = ['January 2026', 'February 2026'];
  test('a flat axis keeps the default margin', () => {
    expect(calcBottomMargin(0, labels)).toBe(35);
  });
  test('the steeper the tilt and the bigger the font, the more room below', () => {
    expect(calcBottomMargin(45, labels)).toBeGreaterThan(calcBottomMargin(30, labels));
    expect(calcBottomMargin(90, labels)).toBeGreaterThan(calcBottomMargin(45, labels));
    expect(calcBottomMargin(90, labels, 35, 16)).toBeGreaterThan(calcBottomMargin(90, labels, 35, 11));
  });
  test('a very long label at 90 degrees cannot swallow the plot', () => {
    expect(calcBottomMargin(90, ['x'.repeat(200)], 35, 14)).toBe(180);
  });
});
