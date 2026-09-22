import { describe, it, expect } from 'vitest';
import {
  applyWidgetsProposal, applyDesignProposal, applyVisualProposal, samplePreviewData, buildPageContext, unknownFields, describeProposal, describeShaping,
} from './aiProposal';

const widgetTypes = {
  bar: { defaultSize: { w: 24, h: 16 } },
  scorecard: { defaultSize: { w: 12, h: 8 } },
  shape: { defaultSize: { w: 200, h: 200 } },
};
const effectiveModel = {
  dimensions: [{ name: 'items.label' }, { name: 'items.date' }],
  measures: [{ name: 'items.amt_sum' }, { name: 'items.qty_sum' }],
};
const base = { layout: [], widgets: {}, pageWidth: 1140, pageHeight: 800, effectiveModel, widgetTypes };
const bar = (extra = {}) => ({
  type: 'bar',
  config: { title: 'Sales', showLegend: true },
  dataBinding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] },
  layout: null,
  ...extra,
});
const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

describe('applyWidgetsProposal', () => {
  it('adds every widget in one result, bound and ready to fetch', () => {
    const out = applyWidgetsProposal({ widgets: [bar(), bar({ type: 'scorecard' })] }, base, ids());
    expect(out.newIds).toEqual(['id1', 'id2']);
    expect(out.layout.map((it) => it.i)).toEqual(['id1', 'id2']);
    expect(out.widgets.id1).toEqual({
      type: 'bar',
      data: {},
      dataBinding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] },
      config: { title: 'Sales', showLegend: true },
    });
  });

  it('centres a widget that came without a layout, at its registry size', () => {
    const { layout } = applyWidgetsProposal({ widgets: [bar()] }, base, ids());
    expect(layout[0]).toMatchObject({ x: 330, y: 240, w: 480, h: 320 });
  });

  it('keeps the proposed layout and steps aside when the slot is taken', () => {
    const taken = [{ i: 'old', x: 20, y: 40, w: 300, h: 200, z: 3 }];
    const { layout } = applyWidgetsProposal(
      { widgets: [bar({ layout: { x: 20, y: 40, w: 400, h: 300 } })] },
      { ...base, layout: taken, widgets: { old: { type: 'bar' } } },
      ids(),
    );
    expect(layout[1]).toMatchObject({ x: 44, y: 64, w: 400, h: 300, z: 4 });
  });

  it('never pushes a widget off the page', () => {
    const { layout } = applyWidgetsProposal({ widgets: [bar({ layout: { x: 1100, y: 780, w: 400, h: 300 } })] }, base, ids());
    expect(layout[0]).toMatchObject({ x: 740, y: 500, w: 400, h: 300 });
  });

  it('an unknown field applies nothing at all', () => {
    const ghost = bar({ dataBinding: { selectedDimensions: ['items.ghost'], selectedMeasures: ['items.amt_sum'] } });
    const out = applyWidgetsProposal({ widgets: [bar(), ghost] }, base, ids());
    expect(out).toEqual({ error: "Not in this report's model: items.ghost" });
  });

  it('an unknown widget type applies nothing at all', () => {
    expect(applyWidgetsProposal({ widgets: [bar({ type: 'hologram' })] }, base, ids()).error).toMatch(/hologram/);
  });

  it('does not mutate the state it was given', () => {
    const layout = [];
    const widgets = {};
    applyWidgetsProposal({ widgets: [bar()] }, { ...base, layout, widgets }, ids());
    expect(layout).toEqual([]);
    expect(widgets).toEqual({});
  });
});

describe('applyVisualProposal', () => {
  const types = { ...widgetTypes, customVisual: { defaultSize: { w: 24, h: 16 } } };
  const proposal = { dataBinding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] }, layout: null };
  const stored = { id: 'ai-radial', name: 'Radial', manifest: { id: 'ai-radial', name: 'Radial' } };

  it('points the widget at the STORED visual, in the workspace library', () => {
    const out = applyVisualProposal(proposal, stored, 'ws1', { ...base, widgetTypes: types }, ids());
    expect(out.widgets.id1).toEqual({
      type: 'customVisual',
      data: {},
      dataBinding: proposal.dataBinding,
      config: {
        title: 'Radial', visualId: 'ai-radial', visualName: 'Radial',
        bundleUrl: '/api/workspaces/ws1/visuals/ai-radial/bundle.js', manifest: stored.manifest,
      },
    });
  });

  it('a field the editor no longer knows applies nothing', () => {
    const ghost = { ...proposal, dataBinding: { selectedMeasures: ['items.ghost'] } };
    expect(applyVisualProposal(ghost, stored, 'ws1', { ...base, widgetTypes: types }, ids()).error).toMatch(/items.ghost/);
  });
});

describe('samplePreviewData', () => {
  it('is shaped like what a visual receives, keyed by label, and invented', () => {
    const model = {
      dimensions: [{ name: 'items.label', label: 'Label' }],
      measures: [{ name: 'items.amt_sum', label: 'Amount', format: { decimals: 0 } }],
    };
    const data = samplePreviewData({ selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] }, model);
    expect(data.fields).toEqual({
      dimensions: [{ name: 'Label', role: 'category', sourceName: 'items.label' }],
      measures: [{ name: 'Amount', role: 'value', sourceName: 'items.amt_sum', format: { decimals: 0 } }],
    });
    expect(data.rows).toHaveLength(6);
    expect(data.rows[0]).toEqual({ Label: 'Label A', Amount: expect.any(Number) });
  });

  it('a measure-only binding previews as a single row', () => {
    expect(samplePreviewData({ selectedMeasures: ['m'] }, {}).rows).toHaveLength(1);
  });
});

describe('unknownFields', () => {
  it('looks into every binding slot', () => {
    const w = {
      dataBinding: {
        selectedDimensions: ['items.label'], groupBy: ['g.x'], columnDimensions: ['c.x'], compareDateDim: 'd.x',
        selectedMeasures: ['items.amt_sum'], comboBarMeasures: ['b.x'], comboLineMeasures: ['l.x'],
        scatterMeasures: { x: 'sx', y: 'items.qty_sum', size: 'ss' }, gaugeMaxMeasure: 'gm', gaugeThresholdMeasure: 'gt',
      },
    };
    expect(unknownFields(w, effectiveModel)).toEqual(['g.x', 'c.x', 'd.x', 'b.x', 'l.x', 'sx', 'ss', 'gm', 'gt']);
  });
});

describe('buildPageContext', () => {
  it('sends bindings, geometry and the look — never fetched rows or image data', () => {
    const ctx = buildPageContext({
      layout: [{ i: 'a', x: 0, y: 0, w: 100, h: 80, z: 1 }, { i: 'orphan', x: 0, y: 0, w: 1, h: 1 }],
      widgets: {
        a: {
          type: 'bar',
          config: { title: 'T', color: '#ffffff', mergeGroup: 'g', legendImages: { x: 'data:image/png;base64,AAAA' }, bundleUrl: '/b.js' },
          dataBinding: { selectedMeasures: ['m'] },
          data: { rows: [{ secret: 1 }] },
        },
      },
      pageWidth: 1140,
      pageHeight: 800,
      settings: { theme: { key: 'dark', vars: {} }, backgroundColor: '#000000' },
      themes: { light: {}, dark: {} },
      palette: ['#5470c6'],
    });
    expect(ctx).toEqual({
      pageWidth: 1140,
      pageHeight: 800,
      themes: ['light', 'dark'],
      theme: 'dark',
      pageBackground: '#000000',
      palette: ['#5470c6'],
      widgets: [{
        id: 'a', type: 'bar', title: 'T', dataBinding: { selectedMeasures: ['m'] },
        layout: { x: 0, y: 0, w: 100, h: 80 }, config: { title: 'T', color: '#ffffff' },
        // What sizes the widget (a filter's style): sent to be read, never settable.
        shape: { slicerStyle: undefined, orientation: undefined, dateLayout: undefined, subType: undefined },
        merged: true,
      }],
    });
  });
});

describe('applyDesignProposal', () => {
  const state = () => ({
    layout: [
      { i: 'a', x: 0, y: 0, w: 200, h: 100, z: 1 },
      { i: 'b', x: 200, y: 0, w: 200, h: 100, z: 2 },
      { i: 'c', x: 400, y: 0, w: 200, h: 100, z: 3 },
    ],
    widgets: {
      a: { type: 'bar', dataBinding: { selectedMeasures: ['m'] }, config: { title: 'A' } },
      b: { type: 'bar', config: { mergeGroup: 'g1', backgroundColor: '#111111' } },
      c: { type: 'pie', config: { mergeGroup: 'g1', backgroundColor: '#111111' } },
    },
    settings: { pageWidth: 1140, backgroundColor: '#ffffff' },
    pageWidth: 1140,
    pageHeight: 800,
    themes: { dark: { label: 'Dark', kind: 'dark', vars: { '--bg-app': '#000' } } },
  });

  it('restyles, moves and restacks in one returned state', () => {
    const out = applyDesignProposal({
      ops: [
        { op: 'update_config', widgetId: 'a', set: { title: 'Revenue', color: '#2563eb' } },
        { op: 'move', widgetId: 'a', x: 20, y: 120, w: 400, h: 300 },
        { op: 'z_order', widgetId: 'a', to: 'front' },
      ],
    }, state());
    expect(out.widgets.a.config).toEqual({ title: 'Revenue', color: '#2563eb' });
    expect(out.widgets.a.dataBinding).toEqual({ selectedMeasures: ['m'] });
    expect(out.layout[0]).toEqual({ i: 'a', x: 20, y: 120, w: 400, h: 300, z: 4 });
    expect(out).toMatchObject({ settings: null, applied: 3, skipped: 0 });
  });

  it('never writes a key outside the look, nor a non-hex color', () => {
    const out = applyDesignProposal({
      ops: [{ op: 'update_config', widgetId: 'a', set: { bundleUrl: 'x', dataBinding: {}, mergeGroup: 'g9', color: 'url(x)', title: 'ok' } }],
    }, state());
    expect(out.widgets.a.config).toEqual({ title: 'ok' });
    expect(out.widgets.a.dataBinding).toEqual({ selectedMeasures: ['m'] });
  });

  it('a container edit on one member repaints the whole merged block', () => {
    const out = applyDesignProposal({ ops: [{ op: 'update_config', widgetId: 'b', set: { backgroundColor: '#222222' } }] }, state());
    expect(out.widgets.b.config.backgroundColor).toBe('#222222');
    expect(out.widgets.c.config.backgroundColor).toBe('#222222');
  });

  it('a member of a merged block is not moved alone', () => {
    const s = state();
    const out = applyDesignProposal({ ops: [{ op: 'move', widgetId: 'b', x: 0, y: 400, w: 200, h: 100 }] }, s);
    expect(out.layout).toBe(s.layout);
    expect(out).toMatchObject({ applied: 0, skipped: 1 });
  });

  it('a move stays inside the page', () => {
    const out = applyDesignProposal({ ops: [{ op: 'move', widgetId: 'a', x: 1100, y: 0, w: 400, h: 300 }] }, state());
    expect(out.layout[0].x + out.layout[0].w).toBeLessThanOrEqual(1140);
  });

  it('settings come back apart, built from the theme registry', () => {
    const out = applyDesignProposal({ ops: [{ op: 'report_settings', set: { theme: 'dark', pageBackground: '#0f172a' } }] }, state());
    expect(out.settings).toEqual({
      pageWidth: 1140,
      backgroundColor: '#0f172a',
      theme: { key: 'dark', label: 'Dark', kind: 'dark', vars: { '--bg-app': '#000' } },
    });
  });

  it('an unknown theme or a widget deleted since is skipped, the rest applies', () => {
    const out = applyDesignProposal({
      ops: [
        { op: 'report_settings', set: { theme: 'nope' } },
        { op: 'update_config', widgetId: 'gone', set: { title: 'x' } },
        { op: 'update_config', widgetId: 'a', set: { title: 'kept' } },
      ],
    }, state());
    expect(out).toMatchObject({ settings: null, applied: 1, skipped: 2 });
    expect(out.widgets.a.config.title).toBe('kept');
  });

  it('does not mutate the state it was given', () => {
    const s = state();
    const snapshot = JSON.stringify(s);
    applyDesignProposal({ ops: [{ op: 'update_config', widgetId: 'b', set: { backgroundColor: '#333333' } }, { op: 'move', widgetId: 'a', x: 0, y: 0, w: 300, h: 300 }] }, s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('describeProposal', () => {
  const bar = { kind: 'widgets', widgets: [{ type: 'bar', config: { title: 'Sales', subType: 'stacked' }, dataBinding: { selectedDimensions: ['t.d'], selectedMeasures: ['t.m'] } }] };

  it('says what was proposed and what became of it, never empty', () => {
    expect(describeProposal(bar)).toBe('[Proposed — not applied yet: bar/stacked "Sales" {"selectedDimensions":["t.d"],"selectedMeasures":["t.m"]}]');
    expect(describeProposal(bar, 'dismissed')).toContain('dismissed by the user');
    expect(describeProposal({ kind: 'design', summary: 'KPI first.', ops: [{}, {}] }, 'applied')).toBe('[Proposed — applied by the user: 2 design change(s): KPI first.]');
  });

  it('never carries the code of a generated visual, and stays short', () => {
    const out = describeProposal({ kind: 'customVisual', manifest: { name: 'Funnel' }, visualJs: 'SECRET'.repeat(1000), dataBinding: {} });
    expect(out).toContain('"Funnel"');
    expect(out).not.toContain('SECRET');
    expect(out.length).toBeLessThanOrEqual(1500);
  });
});
describe('design: colors beyond the series', () => {
  const state = {
    layout: [{ i: 't', x: 0, y: 0, w: 400, h: 300, z: 1 }],
    widgets: { t: { type: 'table', config: { tableConfig: {
      header: { bgColor: '#f8fafc', fontSize: 14 },
      rows: { striped: true },
      columns: { Sales: { width: 120, conditionalFormatting: [{ type: 'dataBar' }] } },
    } } } },
    settings: {}, pageWidth: 1140, pageHeight: 800, themes: {},
  };
  const apply = (set) => applyDesignProposal({ ops: [{ op: 'update_config', widgetId: 't', set }] }, state);

  it('merges table colors into the existing tableConfig instead of replacing it', () => {
    const { widgets, applied } = apply({ tableConfig: { header: { bgColor: '#1e3a8a', fontColor: '#ffffff' }, grid: { horizontalColor: '#e2e8f0' } } });
    expect(applied).toBe(1);
    expect(widgets.t.config.tableConfig).toEqual({
      header: { bgColor: '#1e3a8a', fontSize: 14, fontColor: '#ffffff' },
      rows: { striped: true },
      grid: { horizontalColor: '#e2e8f0' },
      columns: { Sales: { width: 120, conditionalFormatting: [{ type: 'dataBar' }] } },
    });
  });

  it('cannot reach the columns, and drops a color that is not one', () => {
    const { widgets, skipped } = apply({ tableConfig: { columns: { Sales: { width: 1 } }, header: { bgColor: 'url(x)' } } });
    expect(skipped).toBe(1);
    expect(widgets.t.config.tableConfig.columns.Sales.width).toBe(120);
  });

  it('keeps the boolean that is named like a color', () => {
    const { widgets } = apply({ gaugeConditionalColor: true, slicerSelectedBg: '#eff6ff', shapeFill: 'red' });
    expect(widgets.t.config.gaugeConditionalColor).toBe(true);
    expect(widgets.t.config.slicerSelectedBg).toBe('#eff6ff');
    expect(widgets.t.config.shapeFill).toBeUndefined();
  });

  it('the page context carries the table look, not the columns', () => {
    const ctx = buildPageContext({ ...state, palette: [] });
    expect(ctx.widgets[0].config.tableConfig).toEqual({ header: { bgColor: '#f8fafc' }, rows: { striped: true } });
  });
});
describe('design: report settings that change nothing', () => {
  const themes = { light: { label: 'Light' }, dark: { label: 'Dark' } };
  const base = { layout: [], widgets: {}, pageWidth: 1140, pageHeight: 800, themes };
  const run = (settings, set) => applyDesignProposal({ ops: [{ op: 'report_settings', set }] }, { ...base, settings });

  it('the theme already in place is not a change: nothing to revert afterwards', () => {
    expect(run({}, { theme: 'light' })).toMatchObject({ settings: null, applied: 0, skipped: 1 });
    expect(run({ theme: { key: 'dark' } }, { theme: 'dark' }).settings).toBeNull();
    expect(run({ backgroundColor: '#FFFFFF' }, { pageBackground: '#ffffff' }).settings).toBeNull();
  });

  it('a real change still goes through, and only the part that changed', () => {
    const { settings } = run({ theme: { key: 'dark' }, backgroundColor: '#000000' }, { theme: 'dark', pageBackground: '#0f172a' });
    expect(settings.backgroundColor).toBe('#0f172a');
    expect(settings.theme).toEqual({ key: 'dark' });
  });
});
describe('design: a palette per widget', () => {
  const state = {
    layout: [{ i: 'b', x: 0, y: 0, w: 400, h: 300, z: 1 }],
    widgets: { b: { type: 'bar', config: { legendColors: { North: '#ff0000' } } } },
    settings: {}, pageWidth: 1140, pageHeight: 800, themes: {},
  };
  const apply = (set) => applyDesignProposal({ ops: [{ op: 'update_config', widgetId: 'b', set, fromScheme: true }] }, state);

  it('sets the palette and clears the per-series overrides that would hide it', () => {
    const { widgets } = apply({ palette: ['#0072B2', '#E69F00'], legendColors: {}, color: '#0072B2' });
    expect(widgets.b.config).toEqual({ palette: ['#0072B2', '#E69F00'], legendColors: {}, color: '#0072B2' });
  });

  it('refuses a palette that is not all hex, or empty', () => {
    expect(apply({ palette: ['#0072B2', 'red'] }).applied).toBe(0);
    expect(apply({ palette: [] }).applied).toBe(0);
    expect(apply({ palette: 'okabe-ito' }).applied).toBe(0);
  });
});
describe('what a proposal keeps of the data', () => {
  const model = { dimensions: [{ name: 'items.label', label: 'Label' }, { name: 'items.date' }], measures: [{ name: 'items.amt_sum', label: 'Amount' }] };
  const binding = {
    selectedDimensions: ['items.label'],
    selectedMeasures: ['items.amt_sum'],
    widgetFilters: [
      { field: 'items.amt_sum', isMeasure: true, op: 'top_n', value: 5, values: [] },
      { field: 'items.label', isMeasure: false, op: 'contains', value: 'fr', values: [] },
      { field: 'items.date', isMeasure: false, op: 'between', value: '', values: ['2023-01-01', '2023-12-31'] },
    ],
    timePeriod: { dim: 'items.date', preset: 'last_12_months' },
  };

  it('reads as words', () => {
    expect(describeShaping(binding, model)).toBe('Top 5 by Amount · Label contains fr · items.date between 2023-01-01 – 2023-12-31 · Last 12 months');
    expect(describeShaping({ selectedMeasures: ['items.amt_sum'] }, model)).toBe('');
  });

  it('a field used only in a filter is checked against the editor model too', () => {
    const gone = { ...binding, widgetFilters: [{ field: 'items.region', isMeasure: false, op: 'in', value: '', values: ['N'] }] };
    expect(unknownFields({ dataBinding: gone }, effectiveModel)).toEqual(['items.region']);
    expect(unknownFields({ dataBinding: binding }, effectiveModel)).toEqual([]);
  });
});
