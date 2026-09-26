import { describe, it, expect } from 'vitest';
import {
  shiftIsoDate, shiftDimValue, splitPeriodMeasures, shiftFilterContext, mergePeriodRows,
} from './periodShift';
import { buildWidgetQueryPayload } from './widgetQueryPayload';

const MODEL = {
  dimensions: [
    { name: 'd.date', table: 'd', column: 'date', type: 'date', label: 'Date' },
    { name: 'd.year', table: 'd', column: 'date', type: 'integer', datePart: 'num_year', label: 'Year' },
    { name: 'd.month', table: 'd', column: 'date', type: 'integer', datePart: 'num_month', label: 'Month' },
    { name: 'f.status', table: 'f', column: 'status', type: 'string', label: 'Status' },
    { name: 'f.year', table: 'f', column: 'year', type: 'integer', label: 'Fact year' },
  ],
  measures: [
    { name: 'f.amt', label: 'Amount' },
    { name: 'f.amt_ly', label: 'Amount LY', periodShift: { dim: 'd.date', unit: 'year', n: -1 } },
    { name: 'f.amt_lm', label: 'Amount LM', periodShift: { dim: 'd.date', unit: 'month', n: -1 } },
  ],
};

describe('periodShift values', () => {
  it('moves ISO dates and year numbers, clamping the day', () => {
    expect(shiftIsoDate('2024-02-29', 'year', -1)).toBe('2023-02-28');
    expect(shiftIsoDate('2025-03-31T00:00:00.000Z', 'month', -1)).toBe('2025-02-28T00:00:00.000Z');
    expect(shiftDimValue(2025, MODEL.dimensions[1], 'year', -1)).toBe(2024);
    expect(shiftDimValue('2025', MODEL.dimensions[1], 'month', -1)).toBeNull();
    expect(shiftDimValue(5, MODEL.dimensions[2], 'year', -1)).toBeNull();
  });
});

describe('splitPeriodMeasures', () => {
  it('keeps everything in the main query when no displayed dim tells the periods apart', () => {
    expect(splitPeriodMeasures(['f.amt', 'f.amt_ly'], ['f.status', 'd.month'], MODEL))
      .toEqual({ main: ['f.amt', 'f.amt_ly'], groups: [] });
    // A year column on the fact is not the shift's date table.
    expect(splitPeriodMeasures(['f.amt_ly'], ['f.year'], MODEL).groups).toEqual([]);
  });
  it('moves shifted measures out when the date or its year is on the axis, one group per shift', () => {
    const r = splitPeriodMeasures(['f.amt', 'f.amt_ly', 'f.amt_lm'], ['d.year', 'f.status'], MODEL);
    expect(r.main).toEqual(['f.amt']);
    expect(r.groups.map((g) => [g.unit, g.measures])).toEqual([['year', ['f.amt_ly']], ['month', ['f.amt_lm']]]);
  });
});

describe('shiftFilterContext', () => {
  it('moves value lists, between ranges and widget rules on the shift table only', () => {
    const shift = { dim: 'd.date', unit: 'year', n: -1 };
    const r = shiftFilterContext(
      { 'd.year': [2025], 'f.status': ['open'], 'd.date': { op: 'between', value: ['2025-01-01', '2025-06-30'] }, 'f.year': [2025] },
      [{ field: 'd.date', op: 'gte', value: '2025-01-01' }, { field: 'f.amt', op: 'gt', value: 3, isMeasure: true }],
      MODEL.dimensions, shift,
    );
    expect(r.filters).toEqual({ 'd.year': [2024], 'f.status': ['open'], 'd.date': { op: 'between', value: ['2024-01-01', '2024-06-30'] }, 'f.year': [2025] });
    expect(r.widgetFilters).toEqual([{ field: 'd.date', op: 'gte', value: '2024-01-01' }, { field: 'f.amt', op: 'gt', value: 3, isMeasure: true }]);
  });
});

describe('mergePeriodRows', () => {
  it('realigns the moved rows on the axis and fills the shifted measure', () => {
    const meta = { allDims: ['d.year', 'f.status'], periodGroups: [{ dim: 'd.date', unit: 'year', n: -1, measures: ['f.amt_ly'] }] };
    const rows = [{ Year: 2025, Status: 'open', Amount: 10 }, { Year: 2025, Status: 'lost', Amount: 4 }];
    const periodRes = [{ data: { rows: [{ Year: 2024, Status: 'open', 'Amount LY': 8 }] } }];
    expect(mergePeriodRows(rows, periodRes, meta, MODEL)).toEqual([
      { Year: 2025, Status: 'open', Amount: 10, 'Amount LY': 8 },
      { Year: 2025, Status: 'lost', Amount: 4, 'Amount LY': null },
    ]);
  });
  it('a failed moved query leaves the column empty rather than absent', () => {
    const meta = { allDims: ['d.date'], periodGroups: [{ dim: 'd.date', unit: 'year', n: -1, measures: ['f.amt_ly'] }] };
    expect(mergePeriodRows([{ Date: '2025-01-01', Amount: 1 }], [null], meta, MODEL)).toEqual([{ Date: '2025-01-01', Amount: 1, 'Amount LY': null }]);
  });
});

describe('widgetQueryPayload × periodShift', () => {
  const ctx = {
    effectiveModel: MODEL, reportFilters: { 'd.year': [2025] }, currentWidgets: {}, crossHighlight: null,
    reportId: 'r1', reportLevelFilters: [], reportExtras: {}, bypassCache: false,
  };
  it('fires one moved query per shift when the year is on the axis', () => {
    const widget = { type: 'bar', dataBinding: { selectedDimensions: ['d.year'], selectedMeasures: ['f.amt', 'f.amt_ly'] }, config: {} };
    const { bodies, meta } = buildWidgetQueryPayload(widget, 'w1', ctx);
    expect(bodies.main.measureNames).toEqual(['f.amt']);
    expect(bodies.period).toHaveLength(1);
    expect(bodies.period[0]).toMatchObject({ dimensionNames: ['d.year'], measureNames: ['f.amt_ly'], filters: { 'd.year': [2024] }, ignorePeriodShift: true });
    expect(meta.periodGroups[0].measures).toEqual(['f.amt_ly']);
  });
  it('leaves the server to it when the axis does not tell the periods apart', () => {
    const widget = { type: 'pie', dataBinding: { selectedDimensions: ['f.status'], selectedMeasures: ['f.amt_ly'] }, config: {} };
    const { bodies } = buildWidgetQueryPayload(widget, 'w1', ctx);
    expect(bodies.main.measureNames).toEqual(['f.amt_ly']);
    expect(bodies.period).toBeNull();
  });
});
