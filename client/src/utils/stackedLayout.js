// Small-screen ("stacked") reading of an absolute-pixel report layout.
//
// The editor positions widgets in pixels on a fixed-width page; below a
// width threshold the Viewer stops scaling that page down (unreadable on a
// phone) and stacks the widgets in ONE column instead. This module decides
// the order and the per-widget height — pure functions, no DOM.

// Below this container width the Viewer stacks instead of scaling.
export const STACK_BREAKPOINT = 640;
// Vertical gap between stacked widgets.
export const STACK_GAP = 10;

// Purely decorative types that only make sense at their absolute position
// (a background rectangle behind a group of widgets has no meaning in a
// single column).
const DECORATIVE_TYPES = new Set(['shape']);

// Group items into visual rows: an item joins the current row when its top
// edge sits within the upper half of the row's first item — side-by-side
// widgets that are a few pixels off still read as one row. Rows run top to
// bottom, items within a row left to right.
function readingOrder(items) {
  const sorted = [...items].sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && (it.y || 0) < row.y + Math.min(row.h, it.h || 300) / 2) row.items.push(it);
    else rows.push({ y: it.y || 0, h: it.h || 300, items: [it] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => (a.x || 0) - (b.x || 0)));
}

/**
 * Layout items in stacked order: slicers first (they drive everything
 * below and must not be buried under the charts they filter), then the rest
 * in reading order. Decorative shapes and widgets without a definition are
 * dropped.
 */
export function stackedOrder(layout, widgets) {
  const visible = (layout || []).filter((it) => {
    const w = widgets?.[it.i];
    return w && !DECORATIVE_TYPES.has(w.type);
  });
  const slicers = visible.filter((it) => widgets[it.i].type === 'filter');
  const rest = visible.filter((it) => widgets[it.i].type !== 'filter');
  return [...readingOrder(slicers), ...readingOrder(rest)];
}

/**
 * Height of a widget once it spans the full column. The authored height is
 * preserved (a 200px scorecard stays 200px) — only clamped so a sliver or a
 * giant table doesn't break the page. Tables in auto-height keep 'auto'.
 */
export function stackedHeight(item, widget, viewportHeight) {
  if (widget?.type === 'table' && widget.config?.autoHeight) return item.h || 300;
  const max = Math.max(240, Math.round((viewportHeight || 800) * 0.8));
  return Math.min(max, Math.max(60, item.h || 300));
}
