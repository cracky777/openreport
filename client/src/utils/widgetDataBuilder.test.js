import { describe, test, expect } from 'vitest';
import { buildWidgetData } from './widgetDataBuilder';
import { buildWidgetQueryPayload } from './widgetQueryPayload';

// A minimal model: one dimension, two measures, labels distinct from names so
// the tests also catch a builder that keys on the wrong one.
const model = {
  dimensions: [{ name: 'sales.country', label: 'Country', type: 'string' }],
  measures: [
    { name: 'sales.amt_sum', label: 'Sales', aggregation: 'sum' },
    { name: 'sales.margin_sum', label: 'Margin', aggregation: 'sum' },
    { name: 'sales.amt_avg', label: 'Avg basket', aggregation: 'avg' },
  ],
};

const barWidget = (measures) => ({
  type: 'bar',
  dataBinding: { selectedDimensions: ['sales.country'], selectedMeasures: measures },
});

// `meta` is produced by the query-payload builder, not by the data builder.
// Going through the real function keeps these tests tied to the actual contract
// instead of a hand-rolled fixture that could drift from it.
function build(widget, rows, extra = {}) {
  const { meta } = buildWidgetQueryPayload(widget, 'w1', {
    effectiveModel: model,
    reportFilters: {},
    currentWidgets: { w1: widget },
    crossHighlight: null,
    reportId: 'r1',
    reportLevelFilters: [],
    reportExtras: {},
    bypassCache: false,
    generateQueryId: () => 'q1',
  });
  return buildWidgetData({ widget, rows, meta, effectiveModel: model, ...extra });
}

describe('bar without a groupBy', () => {
  test('two measures produce two series, not one', () => {
    // The bug this guards: `values` took the LAST column, so the second measure
    // silently replaced the first and the axis carried the wrong name.
    const data = build(barWidget(['sales.amt_sum', 'sales.margin_sum']),
      [{ Country: 'FR', Sales: 10, Margin: 3 }, { Country: 'DE', Sales: 20, Margin: 7 }]);
    expect(data.series).toHaveLength(2);
    expect(data.series.map((s) => s.name)).toEqual(['Sales', 'Margin']);
    expect(data.series[0].values).toEqual([10, 20]);
    expect(data.series[1].values).toEqual([3, 7]);
    expect(data.labels).toEqual(['FR', 'DE']);
  });

  test('a single measure keeps the flat shape', () => {
    const data = build(barWidget(['sales.amt_sum']),
      [{ Country: 'FR', Sales: 10 }, { Country: 'DE', Sales: 20 }]);
    expect(data.values).toEqual([10, 20]);
    expect(data.series).toBeUndefined();
  });

  test('a missing category is blank, never the word "null"', () => {
    const data = build(barWidget(['sales.amt_sum']),
      [{ Country: 'FR', Sales: 10 }, { Country: null, Sales: 4 }]);
    expect(data.labels).toEqual(['FR', '']);
    expect(data.labels).not.toContain('null');
  });
});

describe('pie', () => {
  test('a missing slice name is blank, never the word "null"', () => {
    const data = build({ type: 'pie', dataBinding: { selectedDimensions: ['sales.country'], selectedMeasures: ['sales.amt_sum'] } },
      [{ Country: 'FR', Sales: 10 }, { Country: null, Sales: 4 }]);
    expect(data.items.map((i) => i.name)).toEqual(['FR', '']);
  });
});

describe('non-additive measures', () => {
  test('an average is flagged so the pivot does not re-aggregate it', () => {
    // Totals of these cannot be rebuilt from rows the server already grouped —
    // averaging per-group averages weighs a group of one like a group of a
    // thousand. The flag is what lets PivotTableWidget blank the total.
    const data = build(barWidget(['sales.amt_avg']), [{ Country: 'FR', 'Avg basket': 100 }]);
    expect(data._nonAdditiveMeasures).toEqual(['Avg basket']);
  });

  test('sums are not flagged — summing sums is sound', () => {
    const data = build(barWidget(['sales.amt_sum', 'sales.margin_sum']), [{ Country: 'FR', Sales: 10, Margin: 3 }]);
    expect(data._nonAdditiveMeasures).toBeUndefined();
  });

  test('an average the server decomposed is no longer flagged', () => {
    // Atoms present → the total is rebuildable exactly, so blanking it would
    // now be hiding a number we have.
    const comps = { 'Avg basket': { sum: '_avg_h_sum', count: '_avg_h_count' } };
    const data = build(
      barWidget(['sales.amt_avg']),
      [{ Country: 'FR', 'Avg basket': 100, _avg_h_sum: 100, _avg_h_count: 1 }],
      { totalComponents: comps },
    );
    expect(data._nonAdditiveMeasures).toBeUndefined();
    expect(data._totalComponents).toEqual(comps);
  });

  test('an average left undecomposed stays flagged', () => {
    // e.g. a filtered average, or a rollup-served response: the atoms are
    // absent, so the total must go back to saying nothing.
    const data = build(
      barWidget(['sales.amt_avg']),
      [{ Country: 'FR', 'Avg basket': 100 }],
      { totalComponents: { 'Some other measure': { sum: 's', count: 'c' } } },
    );
    expect(data._nonAdditiveMeasures).toEqual(['Avg basket']);
  });
});
