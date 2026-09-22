const { arrange, pageLoad, floorOf, withFloors } = require('../utils/ai/arrangeLayout');
const { validateDesignProposal } = require('../utils/ai/validateProposal');

// The model says what shares a row and what matters; every pixel is ours. So
// the properties a person would check by eye are asserted here, on any input:
// on the grid, inside the page, no overlap, nothing under its readable size.
const PAGE = { width: 1140, height: 800 };
const widgets = [
  { id: 'k1', type: 'scorecard', title: 'Revenue' },
  { id: 'k2', type: 'scorecard', title: 'Orders' },
  { id: 'k3', type: 'scorecard', title: 'Margin' },
  { id: 'trend', type: 'line', title: 'Trend' },
  { id: 'mix', type: 'pie', title: 'Mix' },
  { id: 'detail', type: 'table', title: 'Detail' },
  { id: 'glued', type: 'bar', title: 'Glued', merged: true },
];
const byId = new Map(widgets.map((w) => [w.id, w]));
const row = (height, ...cells) => ({ height, widgets: cells.map((c) => (typeof c === 'string' ? { widgetId: c } : c)) });

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectSound(moves) {
  for (const m of moves) {
    for (const v of [m.x, m.y, m.w, m.h]) expect(v % 20).toBe(0);
    expect(m.x).toBeGreaterThanOrEqual(20);
    expect(m.y).toBeGreaterThanOrEqual(20);
    expect(m.x + m.w).toBeLessThanOrEqual(PAGE.width - 20);
    expect(m.y + m.h).toBeLessThanOrEqual(PAGE.height - 20);
  }
  moves.forEach((a, i) => moves.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
}

test('a dashboard: scorecards on top, the trend wide, the detail below', () => {
  const { moves, errors } = arrange({ rows: [
    row(1, 'k1', 'k2', 'k3'),
    row(3, { widgetId: 'trend', width: 2 }, 'mix'),
    row(2, 'detail'),
  ] }, byId, PAGE);
  expect(errors).toEqual([]);
  expect(moves).toHaveLength(6);
  expectSound(moves);

  const at = Object.fromEntries(moves.map((m) => [m.widgetId, m]));
  // A row shares its top and height, ends flush right, and rows stack in order.
  expect(new Set([at.k1.y, at.k2.y, at.k3.y]).size).toBe(1);
  expect(at.k3.x + at.k3.w).toBe(PAGE.width - 20);
  expect(at.mix.x + at.mix.w).toBe(PAGE.width - 20);
  expect(at.trend.w).toBeGreaterThan(at.mix.w * 1.5);
  expect(at.trend.y).toBe(at.k1.y + at.k1.h + 20);
  expect(at.detail.w).toBe(PAGE.width - 40);
  // Scorecards are capped: emphasis, not a 400 px tall number.
  expect(at.k1.h).toBeLessThanOrEqual(160);
});

test('weights never push a widget under its readable floor', () => {
  const { moves, errors } = arrange({ rows: [row(1, { widgetId: 'trend', width: 10 }, { widgetId: 'mix', width: 0.25 }, 'detail')] }, byId, PAGE);
  expect(errors).toEqual([]);
  expectSound(moves);
  const at = Object.fromEntries(moves.map((m) => [m.widgetId, m]));
  expect(at.mix.w).toBeGreaterThanOrEqual(220);
  expect(at.detail.w).toBeGreaterThanOrEqual(280);
  expect(at.mix.h).toBeGreaterThanOrEqual(200);
});

test('a row that cannot fit is refused with what to do, the other rows still laid out', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, type: 'bar', title: `C${i}` }));
  const all = new Map([...byId, ...many.map((w) => [w.id, w])]);
  const { moves, errors } = arrange({ rows: [row(1, 'k1', 'k2'), row(2, ...many.map((w) => w.id))] }, all, PAGE);
  expect(errors).toEqual([expect.stringMatching(/row 2: 5 widgets do not fit side by side.*split this row/)]);
  expect(moves.map((m) => m.widgetId)).toEqual(['k1', 'k2']);
});

// Seen on the first run against a real model: a row for the title, one for
// the filters, one per idea — six rows on a page that holds four. Refused
// twice, it left the author with no layout at all.
test('rows written like a document are merged to fit, order kept, like with like', () => {
  const doc = [
    { id: 'h', type: 'text' },
    { id: 'f', type: 'filter', minSize: { w: 260, h: 60 } },
    ...['k1', 'k2', 'k3', 'k4'].map((id) => ({ id, type: 'scorecard' })),
    { id: 'trend', type: 'line', title: 'Trend' },
    { id: 'status', type: 'pie', title: 'Status' },
    { id: 'cat', type: 'bar', title: 'Category' },
    { id: 'brands', type: 'treemap', title: 'Brands' },
    { id: 'countries', type: 'table', title: 'Countries' },
  ];
  const all = new Map(doc.map((w) => [w.id, w]));
  const { moves, errors } = arrange({ rows: [
    row(0.5, 'h'), row(0.5, 'f'), row(1, 'k1', 'k2', 'k3', 'k4'), row(3, 'trend', 'status'), row(2, 'cat', 'brands'), row(2, 'countries'),
  ] }, all, PAGE);
  expect(errors).toEqual([]);
  expect(moves).toHaveLength(11);
  expectSound(moves);
  const at = Object.fromEntries(moves.map((m) => [m.widgetId, m]));
  // The title and the filters now share the first row, the table joined the breakdowns…
  expect(at.h.y).toBe(at.f.y);
  expect(at.countries.y).toBe(at.cat.y);
  // …the scorecards were NOT stretched beside a chart, and the reading order held.
  expect(new Set(['k1', 'k2', 'k3', 'k4'].map((id) => at[id].y)).size).toBe(1);
  expect(at.k1.h).toBeLessThanOrEqual(160);
  expect(at.h.y).toBeLessThan(at.k1.y);
  expect(at.k1.y).toBeLessThan(at.trend.y);
  expect(at.trend.y).toBeLessThan(at.cat.y);
  expect(at.cat.x).toBeLessThan(at.brands.x);
  expect(at.brands.x).toBeLessThan(at.countries.x);
});

test('when even merged rows cannot fit, it is refused, not squeezed', () => {
  const tall = Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, type: 'bar', title: `R${i}` }));
  const all = new Map(tall.map((w) => [w.id, w]));
  const { moves, errors } = arrange({ rows: tall.slice(0, 12).map((w) => row(1, w.id)) }, all, PAGE);
  expect(moves).toEqual([]);
  expect(errors[0]).toMatch(/rows do not fit at a readable height/);
});

test('unknown, duplicated and merged widgets are left out and said so', () => {
  const { moves, errors } = arrange({ rows: [row(1, 'k1', 'ghost', 'k1', 'glued')] }, byId, PAGE);
  expect(moves.map((m) => m.widgetId)).toEqual(['k1']);
  expect(errors).toHaveLength(3);
  expect(errors.join(' ')).toMatch(/unknown widget.*appears twice.*merged block/);
});

// Verbatim from a real model: a stray quote in the key of an otherwise good layout.
test('a mangled `rows` key does not throw the whole layout away', () => {
  const { moves, errors } = arrange({ 'rows":': [row(1, 'k1', 'k2')] }, byId, PAGE);
  expect(errors).toEqual([]);
  expect(moves.map((m) => m.widgetId)).toEqual(['k1', 'k2']);
});

test('the compact form: a row is a list of ids, ":2" for twice as wide', () => {
  const { moves, errors } = arrange({ rows: [{ height: 3, widgets: ['trend:2', ' mix '] }] }, byId, PAGE);
  expect(errors).toEqual([]);
  const at = Object.fromEntries(moves.map((m) => [m.widgetId, m]));
  expect(at.trend.w).toBeGreaterThan(at.mix.w * 1.5);
});

test('garbage in is an error, never a throw', () => {
  for (const raw of [null, {}, { rows: 'x' }, { rows: [null, { widgets: 'x' }, { widgets: [null, 3] }] }]) {
    expect(() => arrange(raw, byId, PAGE)).not.toThrow();
    expect(arrange(raw, byId, PAGE).moves).toEqual([]);
  }
});

describe('through the design proposal', () => {
  // Everything piled in the top-left corner, as after a careless build —
  // except the table, which sits alone lower down.
  const before = (w) => (w.id === 'detail' ? { x: 400, y: 300, w: 300, h: 200 } : { x: 0, y: 0, w: 300, h: 200 });
  const ctx = { page: PAGE, pageContext: { themes: [], pageWidth: 1140, pageHeight: 800, widgets: widgets.map((w) => ({ ...w, layout: before(w) })) } };

  test('an arrangement becomes plain moves, wins over a hand-made move, and carries advice', () => {
    const { ops, errors, warnings, advice } = validateDesignProposal({
      summary: 's',
      arrangement: { rows: [row(1, 'k1', 'k2', 'k3'), row(3, 'trend', 'mix')] },
      advice: ['Remove "Detail": it repeats the trend.', '', 42, 'x'.repeat(500)],
      ops: [{ op: 'move', widgetId: 'trend', x: 0, y: 0, w: 300, h: 200 }, { op: 'update_config', widgetId: 'trend', set: { color: '#2563eb' } }],
    }, ctx);
    expect(errors).toEqual([]);
    expect(ops.filter((o) => o.op === 'move')).toHaveLength(5);
    expect(ops.filter((o) => o.widgetId === 'trend' && o.op === 'move')).toHaveLength(1);
    expect(ops.at(-1)).toEqual({ op: 'update_config', widgetId: 'trend', set: { color: '#2563eb' } });
    expect(advice).toEqual(['Remove "Detail": it repeats the trend.', 'x'.repeat(240)]);
    // The table was left out of the rows and the trend now lands on it: flagged.
    expect(warnings).toContain('"Trend" and "Detail" would overlap');
  });

  test('an arrangement alone is a proposal: `ops` is optional', () => {
    const { ops, errors } = validateDesignProposal({ summary: 's', arrangement: { rows: [row(1, 'trend')] } }, ctx);
    expect(errors).toEqual([]);
    expect(ops).toHaveLength(1);
  });
});

test('page load: a number the model can quote instead of guessing', () => {
  const few = pageLoad({ pageWidth: 1140, pageHeight: 800, widgets: widgets.slice(0, 4) });
  expect(few.visuals).toBe(4);
  expect(few.ratio).toBeLessThan(0.7);
  const crowd = pageLoad({ pageWidth: 1140, pageHeight: 800, widgets: Array.from({ length: 16 }, () => ({ type: 'bar' })) });
  expect(crowd.ratio).toBeGreaterThan(1);
  expect(pageLoad({ pageWidth: 1140, pageHeight: 800, widgets: [{ type: 'shape' }, { type: 'text' }] }).visuals).toBe(0);
});

// A floor by type let a filter be squashed: a calendar and a dropdown are the
// same type. The floor is per widget, from what it actually has to draw.
describe('readable floor of one widget', () => {
  const dates = new Set(['t.day']);
  const filter = (shape, dim = 't.country') => ({ type: 'filter', shape, dataBinding: { selectedDimensions: [dim] } });

  test('a filter is sized by its style, not by its type', () => {
    expect(floorOf(filter({ slicerStyle: 'dropdown' }))).toEqual({ w: 160, h: 60 });
    expect(floorOf(filter({}))).toEqual({ w: 160, h: 200 });
    expect(floorOf(filter({ slicerStyle: 'dateCalendar' }))).toEqual({ w: 260, h: 300 });
    expect(floorOf(filter({ slicerStyle: 'buttons', orientation: 'horizontal' }))).toEqual({ w: 260, h: 60 });
    // No style set on a date dimension: the widget opens as a date range, so does the floor.
    expect(floorOf(filter({}, 't.day'), dates)).toEqual({ w: 180, h: 160 });
    expect(floorOf(filter({ dateLayout: 'horizontal' }, 't.day'), dates)).toEqual({ w: 320, h: 80 });
  });

  test('a title, a legend and columns take room the plot must get back', () => {
    const bar = { type: 'bar', config: {} };
    expect(floorOf(bar)).toEqual({ w: 280, h: 200 });
    expect(floorOf({ ...bar, title: 'Sales' }).h).toBe(240);
    expect(floorOf({ ...bar, config: { showLegend: true, legendPosition: 'right' } }).w).toBe(400);
    expect(floorOf({ ...bar, config: { showLegend: true } }).h).toBe(240);
    const wide = { type: 'table', dataBinding: { selectedDimensions: ['a', 'b', 'c'], selectedMeasures: ['m1', 'm2', 'm3', 'm4', 'm5'] } };
    expect(floorOf(wide).w).toBe(720);
    expect(floorOf(wide, dates, 500).w).toBe(500);
  });

  test('the page is stamped with floors, squashed widgets flagged, and the layout honours them', () => {
    const page = withFloors({
      pageWidth: 1140,
      pageHeight: 800,
      widgets: [
        { id: 'cal', type: 'filter', title: 'Period', shape: { slicerStyle: 'dateCalendar' }, layout: { x: 0, y: 0, w: 200, h: 60 } },
        { id: 'drop', type: 'filter', shape: { slicerStyle: 'dropdown' }, layout: { x: 220, y: 0, w: 200, h: 60 } },
        { id: 'bar', type: 'bar', layout: { x: 0, y: 80, w: 600, h: 400 } },
      ],
    }, { dimensions: [] });
    const [cal, drop, bar] = page.widgets;
    expect(cal).toMatchObject({ minSize: { w: 260, h: 340 }, tooSmallNow: true });
    expect(drop.tooSmallNow).toBeUndefined();
    expect(bar.tooSmallNow).toBeUndefined();

    // The model asks for a thin strip of filters: the calendar still gets its height.
    const byId = new Map(page.widgets.map((w) => [w.id, w]));
    const { moves, errors } = arrange({ rows: [{ height: 0.5, widgets: [{ widgetId: 'cal' }, { widgetId: 'drop' }] }, { height: 5, widgets: [{ widgetId: 'bar' }] }] }, byId, { width: 1140, height: 800 });
    expect(errors).toEqual([]);
    const at = Object.fromEntries(moves.map((m) => [m.widgetId, m]));
    expect(at.cal.h).toBeGreaterThanOrEqual(340);
    expect(at.cal.w).toBeGreaterThanOrEqual(260);
    expect(at.bar.h).toBeGreaterThanOrEqual(200);
    expect(at.bar.y + at.bar.h).toBeLessThanOrEqual(780);
  });
});