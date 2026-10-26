// Adding widgets to a saved report without the editor. The only other way in
// is PUT /reports/:id, which takes the whole document: a caller that does not
// hold every page and every setting would wipe what it left out. This touches
// one page and passes the rest through untouched.
//
// Where a visual goes (Jonathan): on the page asked for. In the room the page
// has; with none, the page is laid out again to take it — every visual a
// little smaller, the reading order kept (utils/ai/arrangeLayout.arrange, its
// readable floors). When even that leaves visuals under a readable size, the
// page is crowded: nothing is written and the caller asks the user — a new
// page reads better (`mode: 'newPage'`), or this one anyway, its visuals
// pressed below their usual floors (`mode: 'compress'`).
//
// Pure: the route reads the row, calls this, writes the result.

const { arrange } = require('./ai/arrangeLayout');

const GAP = 20;
const DEFAULT_PAGE = { width: 1140, height: 800 };
const FALLBACK_SIZE = { w: 400, h: 300 };
// Pressed anyway, asked for: the least a visual keeps.
const PRESSED_MIN = { w: 100, h: 60 };

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function pageSizeOf(settings) {
  return { width: num(settings.pageWidth, DEFAULT_PAGE.width), height: num(settings.pageHeight, DEFAULT_PAGE.height) };
}

function newPageName(pages) {
  let n = pages.length + 1;
  const taken = new Set(pages.map((p) => String(p.name || '').toLowerCase()));
  while (taken.has(`page ${n}`)) n += 1;
  return `Page ${n}`;
}

const bottomOf = (layout) => layout.reduce((max, it) => Math.max(max, num(it.y, 0) + num(it.h, 0)), 0);
const topZ = (layout) => layout.reduce((max, it) => Math.max(max, num(it.z, 0)), 0);
const boxOf = (it) => ({ x: num(it.x, 0), y: num(it.y, 0), w: num(it.w, 0), h: num(it.h, 0) });
// Apart by a gap at least: two boxes closer than that touch.
const touches = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;
const sizeOf = (w, page) => ({ w: Math.min(num(w.layout && w.layout.w, FALLBACK_SIZE.w), page.width - 2 * GAP), h: num(w.layout && w.layout.h, FALLBACK_SIZE.h) });

// The first place of the page, reading top to bottom and left to right, where
// a box of this size sits clear of everything, inside the page as it is.
function freeSpot(taken, size, page) {
  for (let y = GAP; y + size.h <= page.height - GAP; y += GAP) {
    for (let x = GAP; x + size.w <= page.width - GAP; x += GAP) {
      const box = { x, y, ...size };
      if (!taken.some((t) => touches(box, t))) return box;
    }
  }
  return null;
}

// The page as rows, in reading order: a widget starts a new row when it
// begins below the bottom of the row so far.
function rowsOf(items) {
  const sorted = [...items].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && it.box.y < row.bottom - GAP) {
      row.items.push(it);
      row.bottom = Math.max(row.bottom, it.box.y + it.box.h);
      row.height = Math.max(row.height, it.box.h);
    } else rows.push({ items: [it], bottom: it.box.y + it.box.h, height: it.box.h });
  }
  for (const row of rows) row.items.sort((a, b) => a.box.x - b.box.x);
  return rows;
}

/**
 * The page laid out again with the new widgets as a last row: each keeps its
 * share of its row (width) and each row its share of the page (height).
 * @returns {Map|null} id → box, or null when the visuals no longer fit at the floors given
 */
function reflow(kept, added, page, pressed) {
  const rows = rowsOf(kept);
  rows.push({ items: added, height: Math.max(...added.map((a) => a.box.h)) });
  const avgH = rows.reduce((s, r) => s + r.height, 0) / rows.length || 1;
  const raw = {
    rows: rows.map((r) => {
      const avgW = r.items.reduce((s, it) => s + it.box.w, 0) / r.items.length || 1;
      return { height: r.height / avgH, widgets: r.items.map((it) => `${it.id}:${it.box.w / avgW}`) };
    }),
  };
  const items = [...kept, ...added];
  const byId = new Map(items.map((it) => [it.id, { id: it.id, type: it.type, ...(pressed ? { minSize: PRESSED_MIN } : {}) }]));
  const { moves, errors } = arrange(raw, byId, page);
  if (errors.length || moves.length !== items.length) return null;
  return new Map(moves.map((m) => [m.widgetId, { x: m.x, y: m.y, w: m.w, h: m.h }]));
}

/**
 * @param {object} report    { settings, layout, widgets }: the row, parsed
 * @param {object[]} widgets validated proposals: { type, config, dataBinding, layout? }
 * @param {object} target    { pageId?, mode? } — the page (the first one when absent);
 *                           mode 'auto' | 'newPage' | 'compress', see the top of the file
 * @param {function} makeId  () => string
 * @returns {{ crowded: true, count: number } | { settings, layout, widgets, pageId, newIds, newPage: boolean, reflowed: boolean }}
 *          crowded: nothing to write, the caller asks; else the three columns to write back
 */
function appendWidgets(report, widgets, { pageId, mode = 'auto' } = {}, makeId) {
  const settings = report.settings && typeof report.settings === 'object' ? report.settings : {};
  const page = pageSizeOf(settings);
  // A report saved before pages existed keeps its content at the root: it
  // becomes the first page, the way the editor itself opens it.
  const pages = Array.isArray(settings.pages) && settings.pages.length
    ? settings.pages.map((p) => ({ ...p }))
    : [{ id: 'page-1', name: 'Page 1', layout: Array.isArray(report.layout) ? report.layout : [], widgets: report.widgets && typeof report.widgets === 'object' ? report.widgets : {} }];

  let index = pageId ? pages.findIndex((p) => p.id === pageId) : 0;
  if (index === -1) index = 0;
  let newPage = false;
  if (mode === 'newPage' && (pages[index].layout || []).length) {
    newPage = true;
    index = pages.length;
    pages.push({ id: `page-${makeId()}`, name: newPageName(pages), layout: [], widgets: {} });
  }
  const current = pages[index];
  const currentLayout = Array.isArray(current.layout) ? current.layout : [];
  const newIds = widgets.map(() => makeId());

  let boxes;
  let moved = null;
  // A set laid out together (a dashboard) on an empty page keeps its places.
  const asSet = widgets.length > 1 && widgets.every((w) => w.layout);
  if (!currentLayout.length && asSet) {
    boxes = widgets.map((w) => ({ x: num(w.layout.x, GAP), y: num(w.layout.y, GAP), w: num(w.layout.w, FALLBACK_SIZE.w), h: num(w.layout.h, FALLBACK_SIZE.h) }));
  } else {
    // In the room the page has, each in turn.
    const taken = currentLayout.map(boxOf);
    const free = widgets.map((w) => { const b = freeSpot(taken, sizeOf(w, page), page); if (b) taken.push(b); return b; });
    if (free.every(Boolean)) boxes = free;
    else {
      const kept = currentLayout.map((it) => ({ id: it.i, type: ((current.widgets || {})[it.i] || {}).type, box: boxOf(it) }));
      const added = widgets.map((w, i) => ({ id: newIds[i], type: w.type, box: { x: 0, y: 0, ...sizeOf(w, page) } }));
      const laid = kept.length
        ? reflow(kept, added, page, false) || (mode === 'compress' ? reflow(kept, added, page, true) : null)
        : null;
      if (laid) {
        moved = laid;
        boxes = newIds.map((id) => laid.get(id));
      } else if (kept.length && mode !== 'compress') {
        return { crowded: true, count: currentLayout.length };
      } else {
        // Pressed to the least and still too many, or bigger than an empty
        // page: under the content, and the page grows.
        let y = bottomOf(currentLayout) + GAP;
        boxes = widgets.map((w) => { const b = { x: GAP, y, ...sizeOf(w, page) }; y += b.h + GAP; return b; });
      }
    }
  }

  const layout = currentLayout.map((it) => (moved && moved.has(it.i) ? { ...it, ...moved.get(it.i) } : it));
  const byId = { ...(current.widgets || {}) };
  let z = topZ(layout);
  widgets.forEach((w, i) => {
    z += 1;
    layout.push({ i: newIds[i], ...boxes[i], z });
    byId[newIds[i]] = { type: w.type, data: {}, dataBinding: { ...w.dataBinding }, config: { ...w.config } };
  });
  pages[index] = { ...current, layout, widgets: byId };
  // Placed below the page's edge: it grows to hold it, every page alike (the
  // report has one height).
  const reach = boxes.reduce((max, b) => Math.max(max, b.y + b.h + GAP), 0);
  const pageHeight = reach > page.height ? Math.ceil(reach / GAP) * GAP : null;

  // The root columns mirror the first page (older readers); they only move
  // when that page did.
  const first = pages[0];
  return {
    settings: { ...settings, pages, ...(pageHeight ? { pageHeight } : {}) },
    layout: index === 0 ? first.layout : report.layout,
    widgets: index === 0 ? first.widgets : report.widgets,
    pageId: pages[index].id,
    newIds,
    newPage,
    reflowed: !!moved,
  };
}

module.exports = { appendWidgets };
