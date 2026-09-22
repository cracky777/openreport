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

test('a visual goes under what is on the page, above it in z, in the shape the editor saves', () => {
  const settings = { pages: [{ id: 'p1', name: 'Page 1', layout: [existing], widgets: { old: oldWidget } }] };
  const out = appendWidgets({ settings, layout: [existing], widgets: { old: oldWidget } }, [bar({ w: 560, h: 360 })], {}, ids());
  expect(out.newPage).toBe(false);
  expect(out.settings.pages[0].layout[1]).toEqual({ i: 'id1', x: 20, y: 340, w: 560, h: 360, z: 5 });
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

test('no room left under the content: a new page, named like the editor names them', () => {
  const tall = { ...existing, h: 700 };
  const settings = { pages: [{ id: 'p1', name: 'Page 1', layout: [tall], widgets: { old: oldWidget } }, { id: 'p2', name: 'Page 3', layout: [], widgets: {} }] };
  const out = appendWidgets({ settings, layout: [tall], widgets: { old: oldWidget } }, [bar({ w: 400, h: 300 })], {}, ids());
  expect(out.newPage).toBe(true);
  expect(out.settings.pages).toHaveLength(3);
  expect(out.settings.pages[2]).toMatchObject({ id: 'page-id1', name: 'Page 4' });
  expect(out.settings.pages[2].layout[0]).toMatchObject({ i: 'id2', x: 20, y: 20 });
  expect(out.settings.pages[0]).toEqual(settings.pages[0]);
});

test('a laid-out set keeps its places: on the page if it is empty, else on a page of its own', () => {
  const set = [bar({ x: 20, y: 20, w: 540, h: 300 }), bar({ x: 580, y: 20, w: 540, h: 300 })];
  const empty = appendWidgets({ settings: {}, layout: [], widgets: {} }, set, {}, ids());
  expect(empty.newPage).toBe(false);
  expect(empty.layout.map((l) => l.x)).toEqual([20, 580]);

  const settings = { pages: [{ id: 'p1', name: 'Page 1', layout: [existing], widgets: { old: oldWidget } }] };
  const busy = appendWidgets({ settings, layout: [existing], widgets: { old: oldWidget } }, set, {}, ids());
  expect(busy.newPage).toBe(true);
  expect(busy.settings.pages[1].layout.map((l) => [l.x, l.y])).toEqual([[20, 20], [580, 20]]);
});

test('an unknown page falls back to the first, and a wide visual is held inside the page', () => {
  const out = appendWidgets({ settings: { pageWidth: 600 }, layout: [], widgets: {} }, [bar({ w: 900, h: 300 })], { pageId: 'gone' }, ids());
  expect(out.pageId).toBe('page-1');
  expect(out.layout[0]).toMatchObject({ x: 20, w: 560 });
});
