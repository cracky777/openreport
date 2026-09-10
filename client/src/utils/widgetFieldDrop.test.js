import { describe, test, expect } from 'vitest';
import { planFieldDrop } from './widgetFieldDrop';

const MODEL = {
  dimensions: [
    { name: 'Country', table: 'd', column: 'country', type: 'string' },
    { name: 'Date', table: 'd', column: 'dt', type: 'date' },
  ],
  measures: [{ name: 'Sales', aggregation: 'sum' }],
};

const w = (type, dataBinding = {}, config = {}) => ({ type, dataBinding, config });
const drop = (widget, fieldName, fieldType) => planFieldDrop({ widget, fieldName, fieldType, model: MODEL });

describe('planFieldDrop', () => {
  test('a chart sends a dimension to its axis and a measure to its values', () => {
    expect(drop(w('bar'), 'Country', 'dimension')).toEqual({ zone: 'Axis', binding: { selectedDimensions: ['Country'] } });
    expect(drop(w('line'), 'Sales', 'measure')).toEqual({ zone: 'Values', binding: { selectedMeasures: ['Sales'] } });
  });

  test('each visual names its wells its own way', () => {
    expect(drop(w('pie'), 'Country', 'dimension').zone).toBe('Category');
    expect(drop(w('pivotTable'), 'Country', 'dimension').zone).toBe('Rows');
    expect(drop(w('scatter'), 'Country', 'dimension').zone).toBe('Details');
    expect(drop(w('filter'), 'Country', 'dimension').zone).toBe('Filter field');
    expect(drop(w('table'), 'Country', 'dimension').zone).toBe('Columns');
  });

  test('an existing field is added to, not replaced, where the well takes several', () => {
    const bar = w('bar', { selectedDimensions: ['Country'], selectedMeasures: ['Sales'] });
    expect(drop(bar, 'Date', 'dimension').binding.selectedDimensions).toEqual(['Country', 'Date']);
  });

  test('a well that holds one field swaps its contents', () => {
    const pie = w('pie', { selectedMeasures: ['Sales'] });
    expect(drop(pie, 'Other', 'measure').binding.selectedMeasures).toEqual(['Other']);
    const card = w('scorecard', { selectedMeasures: ['Sales'] });
    expect(drop(card, 'Other', 'measure')).toEqual({ zone: 'Value', binding: { selectedMeasures: ['Other'] } });
  });

  test('the same dimension twice is refused - the two copies would be identical', () => {
    expect(drop(w('bar', { selectedDimensions: ['Country'] }), 'Country', 'dimension')).toBeNull();
    expect(drop(w('table', { selectedDimensions: ['Country'] }), 'Country', 'dimension')).toBeNull();
  });

  test('the same measure twice becomes a second reading of it', () => {
    // Not a duplicate: the second entry carries an aggregation of its own, so
    // one visual can show the sum and the average of one column.
    const got = drop(w('bar', { selectedMeasures: ['Sales'] }), 'Sales', 'measure').binding.selectedMeasures;
    expect(got).toHaveLength(2);
    expect(got[0]).toBe('Sales');
    expect(got[1]).toMatch(/^Sales@@agg:/);
    expect(got[1]).not.toBe('Sales@@agg:sum'); // sum is what the first one already is
  });

  test('a table column lands in the drawing order too', () => {
    const t = w('table', { selectedDimensions: ['Country'], selectedMeasures: [], columnOrder: ['Country'] });
    expect(drop(t, 'Sales', 'measure').binding).toEqual({ selectedMeasures: ['Sales'], columnOrder: ['Country', 'Sales'] });
  });

  test('the single-field wells of a gauge fill in order, then it refuses', () => {
    expect(drop(w('gauge'), 'Sales', 'measure')).toEqual({ zone: 'Value', binding: { selectedMeasures: ['Sales'] } });
    const withValue = w('gauge', { selectedMeasures: ['Sales'] });
    expect(drop(withValue, 'Target', 'measure')).toEqual({ zone: 'Max', binding: { gaugeMaxMeasure: 'Target' } });
    const withMax = w('gauge', { selectedMeasures: ['Sales'], gaugeMaxMeasure: 'Target' });
    expect(drop(withMax, 'Floor', 'measure').zone).toBe('Threshold');
    const full = w('gauge', { selectedMeasures: ['Sales'], gaugeMaxMeasure: 'T', gaugeThresholdMeasure: 'F' });
    // Which of the three was meant is anyone's guess - the panel decides.
    expect(drop(full, 'Other', 'measure')).toBeNull();
  });

  test('a scatter fills X, then Y, then size', () => {
    expect(drop(w('scatter'), 'Sales', 'measure')).toEqual({ zone: 'X Axis', binding: { scatterMeasures: { x: 'Sales' } } });
    const withX = w('scatter', { scatterMeasures: { x: 'Sales' } });
    expect(drop(withX, 'Cost', 'measure').zone).toBe('Y Axis');
    const withXY = w('scatter', { scatterMeasures: { x: 'a', y: 'b' } });
    expect(drop(withXY, 'c', 'measure').zone).toBe('Size');
    expect(drop(w('scatter', { scatterMeasures: { x: 'a', y: 'b', size: 'c' } }), 'd', 'measure')).toBeNull();
  });

  test('a combo starts a measure on the bars', () => {
    expect(drop(w('combo'), 'Sales', 'measure')).toEqual({ zone: 'Bar values', binding: { comboBarMeasures: ['Sales'] } });
  });

  test('a scorecard only reads a dimension to compare periods, so it wants a date', () => {
    expect(drop(w('scorecard'), 'Country', 'dimension')).toBeNull();
    const got = drop(w('scorecard'), 'Date', 'dimension');
    expect(got.binding).toEqual({ compareDateDim: 'Date' });
    // The comparison shows something straight away rather than looking broken.
    expect(got.config.showN1Percent).toBe(true);
  });

  test('changing a slicer field drops the values ticked on the old one', () => {
    const f = w('filter', { selectedDimensions: ['Country'] }, { selectedValues: ['FR'] });
    const got = drop(f, 'Date', 'dimension');
    expect(got.binding).toEqual({ selectedDimensions: ['Date'] });
    expect(got.config).not.toHaveProperty('selectedValues');
    // Re-dropping the field already there leaves the selection alone.
    expect(drop(f, 'Country', 'dimension').config).toBeUndefined();
  });

  test('a visual with no well for that kind of field refuses the drop', () => {
    expect(drop(w('gauge'), 'Country', 'dimension')).toBeNull();
    expect(drop(w('filter'), 'Sales', 'measure')).toBeNull();
    expect(drop(w('text'), 'Sales', 'measure')).toBeNull();
    expect(drop(w('shape'), 'Country', 'dimension')).toBeNull();
    expect(drop(w('image'), 'Sales', 'measure')).toBeNull();
  });

  test('nothing to place, nothing planned', () => {
    expect(planFieldDrop({ widget: null, fieldName: 'Sales', fieldType: 'measure', model: MODEL })).toBeNull();
    expect(drop(w('bar'), '', 'measure')).toBeNull();
    expect(drop(w('bar'), 'Sales', '')).toBeNull();
  });
});
