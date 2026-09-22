const { validateDesignProposal, pickDesignConfig } = require('../utils/ai/validateProposal');

// A design proposal may restyle and rearrange. It must never be a way to
// change what a widget shows, where a visual's code comes from, or to smuggle
// a CSS string into a style attribute.
const ctx = {
  page: { width: 1140, height: 800 },
  pageContext: {
    themes: ['light', 'dark'],
    widgets: [{ id: 'w1', merged: false }, { id: 'w2', merged: true }],
  },
};
const check = (ops, summary = 's') => validateDesignProposal({ summary, ops }, ctx);

test('whitelisted keys pass, typed and clamped', () => {
  const { ops, errors } = check([{
    op: 'update_config',
    widgetId: 'w1',
    set: { title: 'Revenue', color: '#1D4ED8', showLegend: false, legendPosition: 'bottom', borderRadius: 999, legendColors: { North: '#ff0000' } },
  }]);
  expect(errors).toEqual([]);
  expect(ops).toEqual([{
    op: 'update_config',
    widgetId: 'w1',
    set: { title: 'Revenue', color: '#1D4ED8', showLegend: false, legendPosition: 'bottom', borderRadius: 40, legendColors: { North: '#ff0000' } },
  }]);
});

test.each([
  ['the data binding', { dataBinding: { selectedMeasures: ['x'] } }],
  ['the visual identity', { bundleUrl: 'http://evil/x.js', visualId: 'x', manifest: {} }],
  ['the merge group', { mergeGroup: 'g1' }],
  ['a CSS string as a color', { backgroundColor: 'url(http://evil/p.png)' }],
  ['a CSS variable as a color', { color: 'var(--x);background:url(x)' }],
  ['a wrongly typed flag', { showLegend: 'yes' }],
  ['an unknown enum value', { legendPosition: 'center' }],
  ['a bad color inside legendColors', { legendColors: { a: 'red' } }],
])('%s is refused', (_what, set) => {
  const { ops, errors } = check([{ op: 'update_config', widgetId: 'w1', set }]);
  expect(ops).toEqual([]);
  expect(errors[0]).toMatch(/ignored/);
});

test('an opacity written 0–1 is read as the percentage it meant', () => {
  const set = (v) => check([{ op: 'update_config', widgetId: 'w1', set: { dataLabelBgOpacity: v } }]).ops[0].set.dataLabelBgOpacity;
  expect(set(0.7)).toBeCloseTo(70);
  expect(set(70)).toBe(70);
  expect(set(250)).toBe(100);
});

test('a refused key does not take the valid ones down with it', () => {
  const { ops } = check([{ op: 'update_config', widgetId: 'w1', set: { title: 'ok', bundleUrl: 'x' } }]);
  expect(ops[0].set).toEqual({ title: 'ok' });
});

test('an unknown widget is refused', () => {
  const { ops, errors } = check([{ op: 'update_config', widgetId: 'ghost', set: { title: 'x' } }]);
  expect(ops).toEqual([]);
  expect(errors[0]).toMatch(/unknown widget/);
});

test('a move is snapped to the grid and kept inside the page', () => {
  const { ops } = check([{ op: 'move', widgetId: 'w1', x: 1111, y: -33, w: 407, h: 12 }]);
  expect(ops).toEqual([{ op: 'move', widgetId: 'w1', x: 740, y: 0, w: 400, h: 60 }]);
});

test('a move needs four numbers', () => {
  expect(check([{ op: 'move', widgetId: 'w1', x: '10px', y: 0, w: 100, h: 100 }]).ops).toEqual([]);
});

test('a member of a merged block cannot be moved alone', () => {
  const { ops, errors } = check([{ op: 'move', widgetId: 'w2', x: 0, y: 0, w: 200, h: 200 }]);
  expect(ops).toEqual([]);
  expect(errors[0]).toMatch(/merged block/);
});

test('z_order only knows front and back', () => {
  expect(check([{ op: 'z_order', widgetId: 'w1', to: 'front' }]).ops).toHaveLength(1);
  expect(check([{ op: 'z_order', widgetId: 'w1', to: 9999 }]).ops).toEqual([]);
});

test('report settings: a known theme and a hex background only', () => {
  expect(check([{ op: 'report_settings', set: { theme: 'dark', pageBackground: '#0f172a' } }]).ops)
    .toEqual([{ op: 'report_settings', set: { theme: 'dark', pageBackground: '#0f172a' } }]);
  expect(check([{ op: 'report_settings', set: { theme: 'hacker' } }]).ops).toEqual([]);
  expect(check([{ op: 'report_settings', set: { pageBackground: 'url(x)' } }]).ops).toEqual([]);
  expect(check([{ op: 'report_settings', set: { backgroundImage: 'data:…', pageWidth: 9 } }]).ops).toEqual([]);
});

test('unknown operations and an empty proposal are reported', () => {
  expect(check([{ op: 'delete_widget', widgetId: 'w1' }]).errors[0]).toMatch(/unknown operation/);
  expect(check([]).errors).toEqual(['No change was proposed']);
});

test('the number of operations is capped', () => {
  const many = Array.from({ length: 100 }, () => ({ op: 'z_order', widgetId: 'w1', to: 'front' }));
  expect(check(many).ops).toHaveLength(40);
});

test('pickDesignConfig drops everything that is not a known look key', () => {
  expect(pickDesignConfig({ title: 't', legendImages: { a: 'data:image/png;base64,AAAA' }, bundleUrl: 'x', color: '#fff' }))
    .toEqual({ title: 't' });
});

// The layout the model proposes is held to what a person can read, not only to
// what fits on the page.
describe('readable layout', () => {
  const page = {
    page: { width: 1140, height: 800 },
    pageContext: {
      themes: [],
      widgets: [
        { id: 'bar', type: 'bar', title: 'Sales', layout: { x: 0, y: 0, w: 400, h: 300 } },
        { id: 'kpi', type: 'scorecard', title: 'Total', layout: { x: 420, y: 0, w: 200, h: 100 } },
        { id: 'pie', type: 'pie', title: 'Mix', layout: { x: 400, y: 320, w: 300, h: 300 } },
        { id: 'box', type: 'shape', layout: { x: 0, y: 0, w: 1140, h: 320 } },
      ],
    },
  };
  const run = (ops) => validateDesignProposal({ summary: 's', ops }, page);

  test('a chart shrunk under its readable floor is refused, with the floor in the message', () => {
    const { ops, errors } = run([{ op: 'move', widgetId: 'bar', x: 0, y: 0, w: 200, h: 120 }]);
    expect(ops).toEqual([]);
    expect(errors[0]).toMatch(/not readable under 280 × 200/);
  });

  test('the floor is per type: a scorecard may be that small', () => {
    const { ops, errors } = run([{ op: 'move', widgetId: 'kpi', x: 420, y: 0, w: 200, h: 120 }]);
    expect(errors).toEqual([]);
    expect(ops).toHaveLength(1);
  });

  test('an overlap the proposal creates is a warning, and the move is kept', () => {
    const { ops, warnings } = run([{ op: 'move', widgetId: 'kpi', x: 300, y: 0, w: 200, h: 100 }]);
    expect(ops).toHaveLength(1);
    expect(warnings).toEqual(['"Sales" and "Total" would overlap']);
  });

  test('no warning for a shape under a chart, nor for an overlap that was already there', () => {
    expect(run([{ op: 'move', widgetId: 'bar', x: 20, y: 0, w: 380, h: 300 }]).warnings).toEqual([]);
    page.pageContext.widgets[2].layout = { x: 300, y: 100, w: 300, h: 300 };
    expect(run([{ op: 'move', widgetId: 'pie', x: 300, y: 120, w: 300, h: 300 }]).warnings).toEqual([]);
  });
});
// Table colors live one level down. What is settable there is the look; the
// author's per-column setup must be out of reach, both ways.
describe('tableConfig', () => {
  test('only the appearance groups pass, each key typed', () => {
    const { ops, errors } = check([{
      op: 'update_config',
      widgetId: 'w1',
      set: {
        gaugeColor: '#2563eb',
        gaugeConditionalColor: true,
        slicerSelectedBg: '#eff6ff',
        tableConfig: {
          header: { bgColor: '#1e3a8a', fontColor: '#ffffff', fontSize: 40 },
          rows: { striped: true, stripeColor2: 'url(x)' },
          grid: { horizontalColor: '#e2e8f0', horizontalWidth: 9 },
          columns: { Sales: { conditionalFormatting: [{ type: 'dataBar' }] } },
          freeze: { stickyHeader: false },
        },
      },
    }]);
    expect(errors).toEqual([]);
    expect(ops[0].set).toEqual({
      gaugeColor: '#2563eb',
      gaugeConditionalColor: true,
      slicerSelectedBg: '#eff6ff',
      tableConfig: {
        header: { bgColor: '#1e3a8a', fontColor: '#ffffff' },
        rows: { striped: true },
        grid: { horizontalColor: '#e2e8f0' },
      },
    });
  });

  test('a tableConfig with nothing valid in it is refused, not sent empty', () => {
    const { ops, errors } = check([{ op: 'update_config', widgetId: 'w1', set: { tableConfig: { columns: {}, header: { bgColor: 'red' } } } }]);
    expect(ops).toEqual([]);
    expect(errors[0]).toMatch(/ignored tableConfig/);
  });

  test('what goes to the provider is the look only, never the columns', () => {
    const out = pickDesignConfig({ tableConfig: { header: { bgColor: '#111111' }, columns: { Secret: { displayName: 'KEEP-OUT' } } } });
    expect(out).toEqual({ tableConfig: { header: { bgColor: '#111111' } } });
  });
});