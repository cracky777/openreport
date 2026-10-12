import { describe, it, expect } from 'vitest';
import { buildWidgetQueryPayload } from './widgetQueryPayload';

// A search slicer holds typed text, not values: what it filters by reaches
// the server as a contains / starts-with rule, never as a list of values.

const MODEL = {
  dimensions: [
    { name: 'data.Account', table: 'data', column: 'Account', type: 'string' },
    { name: 'data.Number', table: 'data', column: 'Number', type: 'string' },
  ],
  measures: [{ name: 'data.Amount_sum', label: 'Amount' }],
};
const search = (dim, searchMatch) => ({ type: 'filter', dataBinding: { selectedDimensions: [dim] }, config: { slicerStyle: 'search', searchMatch } });
const TABLE = { type: 'table', dataBinding: { selectedDimensions: ['data.Account'], selectedMeasures: ['data.Amount_sum'] } };

const payloadFor = (widget, reportFilters, filterWidgetMode) => buildWidgetQueryPayload(widget, 'w', {
  effectiveModel: MODEL,
  reportFilters,
  currentWidgets: { s1: search('data.Account'), s2: search('data.Number', 'starts_with'), w: widget },
  crossHighlight: null,
  reportId: 'r1',
  reportLevelFilters: [],
  reportExtras: {},
  bypassCache: false,
  filterWidgetMode,
}).bodies.main;

describe('widgetQueryPayload × search slicers', () => {
  it('turns the typed text into rules, by the slicer\'s match', () => {
    const body = payloadFor(TABLE, { 'data.Account': ['salar'], 'data.Number': ['41'] });
    expect(body.filters).toEqual({});
    expect(body.widgetFilters).toEqual([
      { field: 'data.Account', isMeasure: false, op: 'contains', value: 'salar', values: [] },
      { field: 'data.Number', isMeasure: false, op: 'starts_with', value: '41', values: [] },
    ]);
  });

  it('an empty box filters nothing', () => {
    const body = payloadFor(TABLE, { 'data.Account': [] });
    expect(body.widgetFilters || []).toEqual([]);
  });
});
