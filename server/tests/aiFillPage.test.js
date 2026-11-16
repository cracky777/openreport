// No empty band under the visuals of a page (Jonathan: « ça ne fait pas propre
// d'avoir du vide »): the page height is the report's, shared by all its pages,
// so a page the assistant composes fills it — charts and tables grow, the gaps
// between rows and the figures' heights stay — and the band left on a page is a
// measured flaw the designer is told to fix.
const { fillPage, layoutNew } = require('../utils/ai/arrangeLayout');
const { layoutIssues } = require('../utils/ai/layoutIssues');
const { validateReportChanges } = require('../utils/ai/reportChanges');

const W = (id, type, x, y, w, h) => ({ id, type, layout: { x, y, w, h } });
const bottomOf = (ws) => Math.max(...ws.map((w) => w.layout.y + w.layout.h));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// The checks every filled page must pass, whatever it holds.
function expectSound(before, after, height) {
  const byId = new Map(before.map((w) => [w.id, w.layout]));
  for (const w of after) {
    const was = byId.get(w.id);
    expect(w.layout.x).toBe(was.x);
    expect(w.layout.w).toBe(was.w);
    expect(w.layout.h).toBeGreaterThanOrEqual(was.h); // nothing shrinks
    expect(w.layout.y).toBeGreaterThanOrEqual(was.y);
    // A box that moved or grew lands on the 20 px grid; one left alone keeps its own.
    if (w.layout.y !== was.y) expect(w.layout.y % 20).toBe(0);
    if (w.layout.h !== was.h) expect((w.layout.y + w.layout.h) % 20).toBe(0);
    expect(w.layout.y + w.layout.h).toBeLessThanOrEqual(height - 20); // inside the page
    if (['scorecard', 'filter', 'gauge', 'text', 'image'].includes(w.type)) expect(w.layout.h).toBe(was.h);
  }
  const data = after.filter((w) => w.type !== 'shape');
  for (let i = 0; i < data.length; i += 1) {
    for (let j = i + 1; j < data.length; j += 1) expect(overlap(data[i].layout, data[j].layout)).toBe(false);
  }
}

describe('fillPage', () => {
  const page = [
    W('f1', 'filter', 20, 20, 240, 60),
    W('s1', 'scorecard', 20, 100, 260, 140), W('s2', 'scorecard', 300, 100, 260, 140),
    W('c1', 'bar', 20, 260, 540, 300), W('c2', 'line', 580, 260, 540, 300),
    W('t1', 'table', 20, 580, 1100, 300),
  ];

  test('a short page reaches the bottom: charts and tables grow, figures and gaps stay', () => {
    const out = fillPage(page, 1200);
    expectSound(page, out, 1200);
    expect(bottomOf(out)).toBe(1180);
    const at = (id) => out.find((w) => w.id === id).layout;
    // The 20 px gaps between rows are unchanged.
    expect(at('s1').y).toBe(100);
    expect(at('c1').y - (at('s1').y + at('s1').h)).toBe(20);
    expect(at('t1').y - (at('c1').y + at('c1').h)).toBe(20);
    // Side by side, they still line up.
    expect(at('c1')).toMatchObject({ y: at('c2').y, h: at('c2').h });
  });

  test('a full page, a page of figures only and an empty page are left as they are', () => {
    expect(fillPage(page, 900)).toBe(page);
    const figures = [W('s1', 'scorecard', 20, 20, 260, 140), W('f1', 'filter', 300, 20, 240, 60)];
    expect(fillPage(figures, 1200)).toBe(figures);
    expect(fillPage([], 1200)).toEqual([]);
  });

  test('a band behind a title keeps its height; a shape under a chart grows with it', () => {
    const dressed = [
      W('band', 'shape', 20, 20, 1100, 80), W('title', 'text', 40, 30, 700, 60),
      W('card', 'shape', 20, 120, 1100, 340), W('c1', 'bar', 40, 140, 1060, 300),
    ];
    const out = fillPage(dressed, 1000);
    const at = (id) => out.find((w) => w.id === id).layout;
    expect(at('band')).toEqual({ x: 20, y: 20, w: 1100, h: 80 });
    expect(at('title').h).toBe(60);
    expect(at('c1').h).toBeGreaterThan(300);
    // The card still wraps its chart.
    expect(at('card').y).toBeLessThanOrEqual(at('c1').y);
    expect(at('card').y + at('card').h).toBeGreaterThanOrEqual(at('c1').y + at('c1').h);
  });

  test('a chart grows at most twice its height: a lone chart is not stretched over a tall page', () => {
    const lone = [W('s1', 'scorecard', 20, 20, 260, 140), W('c1', 'bar', 20, 180, 1100, 300)];
    const out = fillPage(lone, 2000);
    expectSound(lone, out, 2000);
    expect(out[1].layout.h).toBe(600);
  });

  test('a chart alone on its row spans the page; a chart beside another, figures and slicers keep their width', () => {
    const lone = [W('f1', 'filter', 20, 20, 240, 60), W('c1', 'line', 20, 100, 560, 360), W('c2', 'bar', 20, 480, 540, 300), W('c3', 'pie', 580, 480, 540, 300)];
    const out = fillPage(lone, 1000, 1140);
    const at = (id) => out.find((w) => w.id === id).layout;
    expect(at('c1')).toMatchObject({ x: 20, w: 1100 });
    expect(at('c2')).toMatchObject({ x: 20, w: 540 });
    expect(at('c3')).toMatchObject({ x: 580, w: 540 });
    expect(at('f1')).toMatchObject({ x: 20, w: 240 });
  });

  test('widgets without a box are passed through', () => {
    const out = fillPage([...page, { id: 'x', type: 'bar' }], 1200);
    expect(out.find((w) => w.id === 'x')).toEqual({ id: 'x', type: 'bar' });
  });

  test('every composition of a new page, filled to a taller page, stays sound', () => {
    const effective = { dimensions: [{ name: 'o.day', type: 'date' }, { name: 'o.country', type: 'string' }], measures: [{ name: 'o.amount', aggregation: 'sum' }] };
    const visual = (type, i) => ({ type, config: { title: `${type} ${i}` }, dataBinding: { selectedDimensions: [type === 'line' ? 'o.day' : 'o.country'], selectedMeasures: ['o.amount'] } });
    const set = [visual('filter', 1), visual('scorecard', 2), visual('scorecard', 3), visual('bar', 4), visual('line', 5), visual('pie', 6), visual('table', 7)];
    for (const composition of ['standard', 'hero', 'sidebar', 'grid', 'focus']) {
      const laid = layoutNew(set, { width: 1140, height: 800 }, effective, composition).map((w, i) => ({ ...w, id: `w${i}` }));
      for (const height of [Math.max(800, bottomOf(laid) + 20), bottomOf(laid) + 320, 1600]) {
        const out = fillPage(laid, height);
        expectSound(laid, out, height);
      }
    }
  });
});

describe('the empty band, measured for the designer', () => {
  test('named with its size and where the visuals should end', () => {
    const issues = layoutIssues({ pageWidth: 1140, pageHeight: 1200, widgets: [
      { id: 'w1', type: 'bar', title: 'A', layout: { x: 20, y: 20, w: 1100, h: 400 } },
    ] });
    expect(issues.join(' ')).toMatch(/visuals end at 420 px: an empty band of 760 px.*grow down to 1180 px/);
  });

  test('a page that ends at its bottom margin, an unknown height or a page of dressing say nothing', () => {
    const chart = { id: 'w1', type: 'bar', title: 'A', layout: { x: 20, y: 20, w: 1100, h: 740 } };
    expect(layoutIssues({ pageWidth: 1140, pageHeight: 800, widgets: [chart] })).toEqual([]);
    expect(layoutIssues({ pageWidth: 1140, pageHeight: 820, widgets: [chart] })).toEqual([]);
    expect(layoutIssues({ pageWidth: 1140, widgets: [{ ...chart, layout: { ...chart.layout, h: 200 } }] })).toEqual([]);
    expect(layoutIssues({ pageWidth: 1140, pageHeight: 1200, widgets: [{ id: 't', type: 'text', layout: { x: 20, y: 20, w: 400, h: 60 } }] })).toEqual([]);
  });
});

describe('a page the studio adds to a report', () => {
  const effective = {
    dimensions: [{ name: 'orders.country', label: 'Country', type: 'string' }, { name: 'orders.day', label: 'Day', type: 'date' }],
    measures: [{ name: 'orders.amount_sum', label: 'Amount', table: 'orders', column: 'amount', aggregation: 'sum' }],
  };
  const pageContext = {
    pageWidth: 1140, pageHeight: 1400, themes: ['light'], theme: 'light', pageBackground: null, palette: [], pageId: 'page-a', pageName: 'Overview',
    widgets: [{ id: 'w1', type: 'table', title: 'Rows', dataBinding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] }, layout: { x: 20, y: 20, w: 1100, h: 1360 }, config: {}, shape: {} }],
    otherPages: [],
  };
  const ctx = { effective, page: { width: 1140, height: 1400 }, pageContext, mode: 'visuals', allowReport: true, library: [], cardinality: {}, canWriteVisuals: false };
  const line = { type: 'line', answers: 'trend', title: 'Amount over time', rationale: 'r', binding: { selectedDimensions: ['orders.day'], selectedMeasures: ['orders.amount_sum'] } };
  const bar = { type: 'bar', answers: 'comparison', title: 'Amount by country', rationale: 'r', binding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };

  test('a new page fills the report\'s page height', () => {
    const taller = { ...ctx, page: { width: 1140, height: 1000 }, pageContext: { ...pageContext, pageHeight: 1000, widgets: [{ ...pageContext.widgets[0], layout: { x: 20, y: 20, w: 1100, h: 960 } }] } };
    const r = validateReportChanges({ summary: 's', pages: [{ page: 'new', name: 'Trends', add: [line, bar, { ...bar, title: 'Again by country' }] }] }, taller);
    expect(r.errors).toEqual([]);
    expect(r.payload.pageHeight).toBe(1000);
    expect(bottomOf(r.payload.pages[0].add)).toBe(980);
  });

  test('on a much taller report a new page grows its charts twice at most; the band left is named to the designer', () => {
    const r = validateReportChanges({ summary: 's', pages: [{ page: 'new', name: 'Trends', add: [line, bar] }] }, ctx);
    const added = r.payload.pages[0].add;
    expect(bottomOf(added)).toBeLessThan(1380);
    expect(layoutIssues({ pageWidth: 1140, pageHeight: 1400, widgets: added.map((w, i) => ({ id: `w${i}`, type: w.type, layout: w.layout })) }).join(' ')).toMatch(/empty band/);
  });

  test('a visual added into an existing page stretches nothing there', () => {
    const r = validateReportChanges({ summary: 's', pages: [{ page: 'p1', add: [bar] }] }, ctx);
    expect(r.errors).toEqual([]);
    const [shown] = r.payload.pages;
    expect(shown.add[0].layout.h).toBeLessThanOrEqual(400);
    expect(shown.moves.every((m) => m.h <= 1360)).toBe(true);
  });
});
