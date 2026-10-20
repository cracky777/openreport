import { describe, expect, test } from 'vitest';
import { restorable } from './pageState';

const card = (data, extra = {}) => ({ type: 'scorecard', dataBinding: { selectedMeasures: ['m'] }, data, ...extra });

describe('restorable', () => {
  test('a page whose visuals hold their rows is shown again as it was', () => {
    expect(restorable({ a: card({ value: 12, _rowCount: 1 }), t: { type: 'text', dataBinding: {}, data: { text: 'Title' } } })).toBe(true);
  });
  test('a visual without rows — none yet, a card\'s empty data, still loading — makes the page fetch again', () => {
    expect(restorable({ a: card(undefined) })).toBe(false);
    expect(restorable({ a: card({}) })).toBe(false);
    expect(restorable({ a: card({ value: 1 }, { _loading: true }) })).toBe(false);
  });
  test('the dressing reads no rows: a logo or a title never holds a page back', () => {
    expect(restorable({ i: { type: 'image', dataBinding: {}, data: {} }, s: { type: 'shape', dataBinding: {} } })).toBe(true);
  });
});
