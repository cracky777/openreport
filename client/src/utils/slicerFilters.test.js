import { describe, test, expect } from 'vitest';
import { slicerFilters, sameSelections } from './slicerFilters';

const slicer = (dim, selectedValues) => ({
  type: 'filter',
  dataBinding: { selectedDimensions: [dim] },
  config: selectedValues ? { selectedValues } : {},
});

describe('slicerFilters', () => {
  test('one entry per slicer with a selection, every slicer dim managed', () => {
    const widgets = {
      a: slicer('users.gender', ['Men']),
      b: slicer('products.category'),
      c: { type: 'bar', dataBinding: { selectedDimensions: ['x'] } },
    };
    const { fromWidgets, managedDims } = slicerFilters(widgets);
    expect(fromWidgets).toEqual({ 'users.gender': ['Men'] });
    expect([...managedDims]).toEqual(['users.gender', 'products.category']);
  });

  test('a page without slicers filters nothing', () => {
    expect(slicerFilters({}).fromWidgets).toEqual({});
    expect(slicerFilters(undefined).managedDims.size).toBe(0);
  });
});

describe('sameSelections', () => {
  test('compares value for value', () => {
    expect(sameSelections({ d: ['a', 'b'] }, { d: ['a', 'b'] })).toBe(true);
    expect(sameSelections({ d: ['a', 'b'] }, { d: ['b', 'a'] })).toBe(false);
    expect(sameSelections({ d: ['a'] }, {})).toBe(false);
  });
});
