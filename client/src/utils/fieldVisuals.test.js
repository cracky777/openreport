import { describe, test, expect } from 'vitest';
import { visualForField, showAsChoices } from './fieldVisuals';

const MODEL = {
  dimensions: [
    { name: 'Country', table: 'd', column: 'country', type: 'string' },
    { name: 'Date', table: 'd', column: 'dt', type: 'date' },
  ],
  measures: [{ name: 'Sales', aggregation: 'sum' }],
};
const types = (dataBinding) => showAsChoices({ widget: { dataBinding }, model: MODEL }).map((c) => c.type);

describe('a field dropped on an empty spot of the page', () => {
  test('a measure is a figure, a dimension the list of its values', () => {
    expect(visualForField({ fieldName: 'Sales', fieldType: 'measure' })).toEqual({ type: 'scorecard', binding: { selectedMeasures: ['Sales'] } });
    expect(visualForField({ fieldName: 'Country', fieldType: 'dimension' })).toEqual({ type: 'table', binding: { selectedDimensions: ['Country'], columnOrder: ['Country'] } });
    expect(visualForField({ fieldName: '', fieldType: 'measure' })).toBeNull();
  });
});

describe('what a visual could be shown as', () => {
  test('the likeliest first, for its fields', () => {
    expect(types({ selectedMeasures: ['Sales'] })).toEqual(['scorecard', 'gauge', 'table']);
    expect(types({ selectedDimensions: ['Country'] })).toEqual(['table', 'filter']);
    expect(types({ selectedDimensions: ['Date'], selectedMeasures: ['Sales'] })[0]).toBe('line');
    expect(types({ selectedDimensions: ['Country'], selectedMeasures: ['Sales'] })[0]).toBe('bar');
    expect(types({})).toEqual([]);
  });
});
