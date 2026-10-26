const { appendWidgets } = require('../utils/reportAppend');

const ids = () => { let n = 0; return () => `id${++n}`; };
const bar = (layout) => ({ type: 'bar', config: { title: 'Sales' }, dataBinding: { selectedDimensions: ['d'], selectedMeasures: ['m'] }, layout });
const existing = { i: 'old', x: 20, y: 20, w: 400, h: 300, z: 4 };
const oldWidget = { type: 'pie', data: {}, dataBinding: {}, config: {} };

test('every other key of settings, and every other page, comes through untouched', () => {
  const settings = {
    theme: 'dark',
    extraMeasures: [{ name: '_calc.margin' }],
    pages: [
      { id: 'p1', name: 'Overview', layout: [existing], widgets: { old: oldWidget } },
      { id: 'p2', name: 'Detail', layout: [{ i: 'x', x: 0, y: 0, w: 100, h: 100 }], widgets: { x: oldWidget } },
    ],
  };
  const before = JSON.stringify(settings);
  const out = appendWidgets({ settings, layout: [existing], widgets: { old: oldWidget } }, [bar({ w: 560, h: 360 })], { pageId: 'p2' }, ids());

  expect(JSON.stringify(settings)).toBe(before);
  expect(out.settings.theme).toBe('dark');
  expect(out.settings.extraMeasures).toEqual([{ name: '_calc.margin' }]);
  expect(out.settings.pages[0]).toEqual(settings.pages[0]);
  expect(out.pageId).toBe('p2');
  expect(out.settings.pages[1].layout).toHaveLength(2);
  // The root mirrors the FIRST page: adding to the second leaves it alone.
  expect(out.layout).toEqual([existing]);
  expect(out.widgets).toEqual({ old: oldWidget });
});

test('a visual takes the room the page has, beside what is there, above it in z, in the shape the editor saves', () => {
  const settings = { pages: [{ id: 'p1', name: 'Page 1', layout: [existing], widgets: { old: oldWidget } }] };
  const out = appendWidgets({ settings, layout: [existing], widgets: { old: oldWidget } }, [bar({ w: 560, h: 360 })], {}, ids());
  expect(out.newPage).toBe(false);
  expect(out.settings.pages[0].layout[1]).toEqual({ i: 'id1', x: 440, y: 20, w: 560, h: 360, z: 5 });
  expect(out.settings.pageHeight).toBeUndefined();
  expect(out.settings.pages[0].widgets.id1).toEqual({ type: 'bar', data: {}, dataBinding: bar().dataBinding, config: { title: 'Sales' } });
  expect(out.layout).toBe(out.settings.pages[0].layout);
  expect(out.widgets).toBe(out.settings.pages[0].widgets);
});

test('a report from before pages existed gets its root content as the first page', () => {
  const out = appendWidgets({ settings: { theme: 'x' }, layout: [existing], widgets: { old: oldWidget } }, [bar({ w: 400, h: 300 })], {}, ids());
  expect(out.settings.pages).toHaveLength(1);
  expect(out.settings.pages[0]).toMatchObject({ id: 'page-1', name: 'Page 1' });
  expect(Object.keys(out.settings.pages[0].widgets)).toEqual(['old', 'id1']);
});

const inside = (boxes, page = { width: 1140, height: 800 }) => boxes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= page.width && b.y + b.h <= page.height);
const apart = (boxes) => boxes.every((a, i) => boxes.every((b, j) => i === j || a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y));

// It used to open a page of its own, then to grow the page: the page is laid
// out again to take it, in its reading order (Jonathan).
test('no room left on the page: the page is laid out again to take it, on that same page', () => {
  const full = { ...existing, w: 1100, h: 700 };
  const settings = { pages: [{ id: 'p1', name: 'Page 1', layout: [full], widgets: { old: oldWidget } }, { id: 'p2', name: 'Page 3', layout: [], widgets: {} }] };
  const out = appendWidgets({ settings, layout: [full], widgets: { old: oldWidget } }, [bar({ w: 400, h: 300 })], {}, ids());
  expect(out).toMatchObject({ newPage: false, reflowed: true, pageId: 'p1' });
  expect(out.settings.pages).toHaveLength(2);
  const boxes = out.settings.pages[0].layout;
  expect(boxes.map((b) => b.i)).toEqual(['old', 'id1']);
  expect(inside(boxes)).toBe(true);
  expect(apart(boxes)).toBe(true);
  // The old one first, the new one under it: the reading order is kept.
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
  expect(out.settings.pageHeight).toBeUndefined();
});

test('a crowded page: nothing written, the caller asks — a new page, or this one pressed', () => {
  const grid = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) grid.push({ i: `w${r}${c}`, x: 20 + c * 280, y: 20 + r * 190, w: 260, h: 170 });
  const widgets = Object.fromEntries(grid.map((g) => [g.i, { ...oldWidget, type: 'bar' }]));
  const report = { settings: { pages: [{ id: 'p1', name: 'Page 1', layout: grid, widgets }] }, layout: grid, widgets };
  expect(appendWidgets(report, [bar({ w: 560, h: 360 })], {}, ids())).toEqual({ crowded: true, count: 16 });

  const pressed = appendWidgets(report, [bar({ w: 560, h: 360 })], { mode: 'compress' }, ids());
  expect(pressed.settings.pages[0].layout).toHaveLength(17);
  expect(apart(pressed.settings.pages[0].layout)).toBe(true);

  const fresh = appendWidgets(report, [bar({ w: 560, h: 360 })], { mode: 'newPage' }, ids());
  expect(fresh.newPage).toBe(true);
  expect(fresh.settings.pages[1].layout[0]).toMatchObject({ x: 20, y: 20 });
  expect(fresh.settings.pages[0]).toEqual(report.settings.pages[0]);
});

test('a laid-out set keeps its places on an empty page; on a busy one, each takes the room there is', () => {
  const set = [bar({ x: 20, y: 20, w: 540, h: 300 }), bar({ x: 580, y: 20, w: 540, h: 300 })];
  const empty = appendWidgets({ settings: {}, layout: [], widgets: {} }, set, {}, ids());
  expect(empty.newPage).toBe(false);
  expect(empty.layout.map((l) => l.x)).toEqual([20, 580]);

  const settings = { pages: [{ id: 'p1', name: 'Page 1', layout: [existing], widgets: { old: oldWidget } }] };
  const busy = appendWidgets({ settings, layout: [existing], widgets: { old: oldWidget } }, set, {}, ids());
  expect(busy.settings.pages).toHaveLength(1);
  expect(inside(busy.settings.pages[0].layout)).toBe(true);
  expect(apart(busy.settings.pages[0].layout)).toBe(true);
});

test('an unknown page falls back to the first, and a wide visual is held inside the page', () => {
  const out = appendWidgets({ settings: { pageWidth: 600 }, layout: [], widgets: {} }, [bar({ w: 900, h: 300 })], { pageId: 'gone' }, ids());
  expect(out.pageId).toBe('page-1');
  expect(out.layout[0]).toMatchObject({ x: 20, w: 560 });
});
