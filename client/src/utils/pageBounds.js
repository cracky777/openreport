/**
 * The report page is the only surface a widget may occupy. Everything around
 * it is backdrop: a widget parked there is missing from a print, a PDF export
 * and a small-screen stack, so the page edge has to stop the gesture rather
 * than let the widget escape. Drag, keyboard nudge and resize all go through
 * these.
 *
 * A widget larger than the page is pinned at the origin, never shrunk — its
 * size is the author's decision, its position is ours to correct.
 */

/** Keep a widget's top-left inside the page, given its size. */
export function clampPos(x, y, w, h, pw, ph) {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, pw - w)),
    y: Math.min(Math.max(0, y), Math.max(0, ph - h)),
  };
}

/** Bounding box of a set of layout items. */
function bbox(items) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.x || 0);
    minY = Math.min(minY, it.y || 0);
    maxX = Math.max(maxX, (it.x || 0) + (it.w || 0));
    maxY = Math.max(maxY, (it.y || 0) + (it.h || 0));
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Clamp a translation applied to a merged block. The block travels as one
 * piece, so the limit is its bounding box: clamping each member on its own
 * would stop the ones that reached the edge and let the others carry on,
 * tearing the block apart.
 */
export function clampDelta(items, dx, dy, pw, ph) {
  if (!items.length) return { dx, dy };
  const { minX, minY, maxX, maxY } = bbox(items);
  const p = clampPos(minX + dx, minY + dy, maxX - minX, maxY - minY, pw, ph);
  return { dx: p.x - minX, dy: p.y - minY };
}

/**
 * Travel limits for one widget, in the coordinates react-draggable moves it
 * in. `group` is the merged block it belongs to (empty when it drags alone):
 * the member's travel is then capped by whichever sibling reaches the page
 * edge first, which is what keeps the block whole during the gesture.
 *
 * Given to react-draggable rather than clamped after the fact: the component
 * tracks the slack between cursor and widget itself, so the widget resumes
 * exactly under the pointer on the way back instead of jumping.
 */
export function dragBounds(item, group, pw, ph) {
  const items = group && group.length ? group : [item];
  const { minX, minY, maxX, maxY } = bbox(items);
  const x = item.x || 0;
  const y = item.y || 0;
  return {
    left: x - minX,
    top: y - minY,
    right: x + Math.max(0, pw - maxX),
    bottom: y + Math.max(0, ph - maxY),
  };
}

/**
 * Pull a resized rect back inside the page. Only the edge that crossed moves:
 * an overshoot to the west stops the left edge and leaves the right one where
 * the author dropped it, and the other way round.
 */
export function clampRect(rect, pw, ph, minW = 80, minH = 40) {
  let { x, y, w, h } = rect;
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  w = Math.max(minW, Math.min(w, pw - x));
  h = Math.max(minH, Math.min(h, ph - y));
  return { x, y, w, h };
}
