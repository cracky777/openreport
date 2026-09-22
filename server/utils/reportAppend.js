// Adding widgets to a saved report without the editor. The only other way in
// is PUT /reports/:id, which takes the whole document: a caller that does not
// hold every page and every setting would wipe what it left out. This touches
// one page and passes the rest through untouched.
//
// Pure: the route reads the row, calls this, writes the result.

const GAP = 20;
const DEFAULT_PAGE = { width: 1140, height: 800 };
const FALLBACK_SIZE = { w: 400, h: 300 };

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

// Proposals that came laid out together (a dashboard) keep their places; the
// others are stacked top to bottom from `fromY`, at their own size.
function place(widgets, fromY, page, asSet) {
  if (asSet) return widgets.map((w) => ({ x: num(w.layout.x, GAP), y: num(w.layout.y, GAP), w: num(w.layout.w, FALLBACK_SIZE.w), h: num(w.layout.h, FALLBACK_SIZE.h) }));
  let y = fromY;
  return widgets.map((w) => {
    const size = { w: Math.min(num(w.layout && w.layout.w, FALLBACK_SIZE.w), page.width - 2 * GAP), h: num(w.layout && w.layout.h, FALLBACK_SIZE.h) };
    const box = { x: GAP, y, ...size };
    y += size.h + GAP;
    return box;
  });
}

/**
 * @param {object} report    { settings, layout, widgets }: the row, parsed
 * @param {object[]} widgets validated proposals: { type, config, dataBinding, layout? }
 * @param {object} target    { pageId? } — the page to add to; the first one when absent
 * @param {function} makeId  () => string
 * @returns {{ settings, layout, widgets, pageId, newIds, newPage: boolean }} the three columns to write back
 */
function appendWidgets(report, widgets, { pageId } = {}, makeId) {
  const settings = report.settings && typeof report.settings === 'object' ? report.settings : {};
  const page = pageSizeOf(settings);
  // A report saved before pages existed keeps its content at the root: it
  // becomes the first page, the way the editor itself opens it.
  const pages = Array.isArray(settings.pages) && settings.pages.length
    ? settings.pages.map((p) => ({ ...p }))
    : [{ id: 'page-1', name: 'Page 1', layout: Array.isArray(report.layout) ? report.layout : [], widgets: report.widgets && typeof report.widgets === 'object' ? report.widgets : {} }];

  let index = pageId ? pages.findIndex((p) => p.id === pageId) : 0;
  if (index === -1) index = 0;
  const current = pages[index];
  const currentLayout = Array.isArray(current.layout) ? current.layout : [];

  // A set that comes laid out fills a page: it gets its own, unless the target
  // is empty. Anything else goes under what is there — or on a new page when
  // the page, which has a fixed height, has no room left under it.
  const asSet = widgets.length > 1 && widgets.every((w) => w.layout);
  const fromY = currentLayout.length ? bottomOf(currentLayout) + GAP : GAP;
  let boxes = place(widgets, fromY, page, asSet);
  const fits = boxes.every((b) => b.y + b.h <= page.height);
  let newPage = false;
  if (currentLayout.length && (asSet || !fits)) {
    newPage = true;
    index = pages.length;
    pages.push({ id: `page-${makeId()}`, name: newPageName(pages), layout: [], widgets: {} });
    boxes = place(widgets, GAP, page, asSet);
  }

  const target = pages[index];
  const layout = [...(Array.isArray(target.layout) ? target.layout : [])];
  const byId = { ...(target.widgets || {}) };
  let z = topZ(layout);
  const newIds = widgets.map((w, i) => {
    const id = makeId();
    z += 1;
    layout.push({ i: id, ...boxes[i], z });
    byId[id] = { type: w.type, data: {}, dataBinding: { ...w.dataBinding }, config: { ...w.config } };
    return id;
  });
  pages[index] = { ...target, layout, widgets: byId };

  // The root columns mirror the first page (older readers); they only move
  // when that page did.
  const first = pages[0];
  return {
    settings: { ...settings, pages },
    layout: index === 0 ? first.layout : report.layout,
    widgets: index === 0 ? first.widgets : report.widgets,
    pageId: pages[index].id,
    newIds,
    newPage,
  };
}

module.exports = { appendWidgets };
