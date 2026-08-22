import { describe, it, expect } from 'vitest';
import { buildWidgetQueryPayload } from './widgetQueryPayload';
import { presetRange, comparableRange } from './timeIntelligence';

// The payload builder resolves presets against the real clock (a widget's
// window must slide with time, so no clock injection there) — expectations
// derive from the same pure helpers it calls.

const MODEL = {
  dimensions: [
    { name: 'data.Country', table: 'data', column: 'Country', type: 'string' },
    { name: 'data.Date', table: 'data', column: 'Date', type: 'date' },
  ],
  measures: [{ name: 'data.Sales_sum', label: 'Sales sum' }],
};

const CTX = {
  effectiveModel: MODEL,
  reportFilters: {},
  currentWidgets: {},
  crossHighlight: null,
  reportId: 'r1',
  reportLevelFilters: [],
  reportExtras: {},
  bypassCache: false,
};

const timeRule = (body) => (body.widgetFilters || []).find((f) => f._timePeriod);

describe('widgetQueryPayload × timePeriod', () => {
  it('appends the preset window as a between widget filter on every body', () => {
    const widget = {
      type: 'bar',
      dataBinding: {
        selectedDimensions: ['data.Country'],
        selectedMeasures: ['data.Sales_sum'],
        timePeriod: { dim: 'data.Date', preset: 'ytd' },
      },
      config: { topNEnabled: true, topN: 5 },
    };
    const { bodies } = buildWidgetQueryPayload(widget, 'w1', CTX);
    const expected = presetRange('ytd');
    for (const key of ['main', 'total']) {
      const rule = timeRule(bodies[key]);
      expect(rule, key).toBeTruthy();
      expect(rule.op).toBe('between');
      expect(rule.values).toEqual(expected);
    }
    // The synthetic top_n stays out of the grand-total body but the window stays in.
    expect((bodies.total.widgetFilters || []).some((f) => f.op === 'top_n')).toBe(false);
  });

  it('does nothing for incomplete or absent presets', () => {
    const widget = {
      type: 'bar',
      dataBinding: {
        selectedDimensions: ['data.Country'],
        selectedMeasures: ['data.Sales_sum'],
        timePeriod: { dim: 'data.Date', preset: null },
      },
    };
    const { bodies } = buildWidgetQueryPayload(widget, 'w1', CTX);
    expect(timeRule(bodies.main)).toBeUndefined();
  });

  it('scorecard + compare dim: N-1 fires with the comparable window', () => {
    const widget = {
      type: 'scorecard',
      dataBinding: {
        selectedMeasures: ['data.Sales_sum'],
        compareDateDim: 'data.Date',
        timePeriod: { dim: 'data.Date', preset: 'last_30_days' },
      },
    };
    const { meta, bodies } = buildWidgetQueryPayload(widget, 'w1', CTX);
    expect(meta.n1.shouldFetch).toBe(true);
    const mainRule = timeRule(bodies.main);
    const n1Rule = timeRule(bodies.n1);
    expect(mainRule.values).toEqual(presetRange('last_30_days'));
    // Rolling preset → the window immediately before, NOT a year shift.
    expect(n1Rule.values).toEqual(comparableRange('last_30_days'));
    expect(n1Rule.value).toEqual(n1Rule.values);
  });

  it('scorecard without compare dim: no N-1 fetch from the preset alone', () => {
    const widget = {
      type: 'scorecard',
      dataBinding: {
        selectedMeasures: ['data.Sales_sum'],
        timePeriod: { dim: 'data.Date', preset: 'ytd' },
      },
    };
    const { meta, bodies } = buildWidgetQueryPayload(widget, 'w1', CTX);
    expect(meta.n1.shouldFetch).toBe(false);
    expect(bodies.n1).toBeNull();
  });
});

describe('widgetQueryPayload × time-variant measures', () => {
  const MODEL_TV = {
    ...MODEL,
    dateColumn: 'data.Date',
  };

  it('keeps variants in measureNames and ships the timeVariants map', () => {
    const v = 'data.Sales_sum@@tp:ytd';
    const widget = {
      type: 'table',
      dataBinding: { selectedMeasures: ['data.Sales_sum', v] },
    };
    const { bodies } = buildWidgetQueryPayload(widget, 'w1', { ...CTX, effectiveModel: MODEL_TV });
    expect(bodies.main.measureNames).toEqual(['data.Sales_sum', v]);
    expect(bodies.main.timeVariants[v].dim).toBe('data.Date');
    expect(bodies.main.timeVariants[v].range).toEqual(presetRange('ytd'));
    expect(bodies.main.timeVariants[v].label).toBe('Sales sum (YTD)');
  });

  it('drops variants when the model has no usable date dim', () => {
    const noDate = {
      ...MODEL,
      dateColumn: null,
      dimensions: MODEL.dimensions.map((d) => (d.type === 'date' ? { ...d, type: 'string' } : d)),
    };
    const widget = {
      type: 'table',
      dataBinding: { selectedMeasures: ['data.Sales_sum', 'data.Sales_sum@@tp:ytd'] },
    };
    const { bodies } = buildWidgetQueryPayload(widget, 'w1', { ...CTX, effectiveModel: noDate });
    expect(bodies.main.measureNames).toEqual(['data.Sales_sum']);
    expect(bodies.main.timeVariants).toBeUndefined();
  });
});
