/**
 * Frame-merge helpers (shared by ReportCanvas — Editor + Viewer — and the
 * Editor's merge controls).
 *
 * Two visuals can be "merged": they then render inside ONE shared frame
 * (single bg/border/radius/shadow, no double border between them), with an
 * optional thin separator on the shared edge. Membership is persisted on
 * each member's `config.mergeGroup` (a group id string); the separator
 * flag on `config.mergeSeparator` (kept in sync across the group). Pairs
 * are merged one at a time but a group can grow by chaining, and a merged
 * group moves as a solid block (handled in ReportCanvas.handleDragStop).
 *
 * The canvas is absolutely positioned in px, so "touching" = the layout
 * rectangles share an edge (within a small tolerance) AND overlap on the
 * perpendicular axis.
 */

export function rectOf(item) {
  return {
    x: item.x || 0,
    y: item.y || 0,
    w: item.w || 400,
    h: (typeof item.h === 'number' ? item.h : 300),
  };
}

// Map of groupId -> array of layout items, only for groups that still have
// at least 2 present members (a lone leftover member renders normally).
export function getMergeGroups(layout, widgets) {
  const byId = {};
  for (const item of layout || []) {
    const w = widgets?.[item.i];
    const gid = w?.config?.mergeGroup;
    if (!gid || !w) continue;
    (byId[gid] = byId[gid] || []).push(item);
  }
  const out = {};
  for (const [gid, items] of Object.entries(byId)) {
    if (items.length >= 2) out[gid] = items;
  }
  return out;
}

// Seam segments between every adjacent pair of group members, in canvas
// px. Each member keeps its FULL own frame (border + radius everywhere);
// only the exact touching segment is "fused" by an overlay placed here.
// So a tall visual merged against a short one keeps its border + rounded
// corners on the parts that don't touch.
//   vertical seam (side by side): { vertical:true,  x, y, length, capStart, capEnd }
//   horizontal seam (stacked):    { vertical:false, x, y, length, capStart, capEnd }
// (x,y) is the segment's start point on the shared boundary. capStart /
// capEnd say whether the seam's two ends are TRUE outer corners (both
// widgets aligned there) — the cover then continues the perpendicular
// outer border across itself so the frame line stays unbroken; where
// they don't align (mismatched sizes) no cap is drawn and each widget's
// own border simply continues past the seam.
export function groupSeams(items, tol = 10) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = rectOf(items[i]);
      const b = rectOf(items[j]);
      const vOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const hOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (vOverlap > 0 &&
          (Math.abs((a.x + a.w) - b.x) <= tol || Math.abs((b.x + b.w) - a.x) <= tol)) {
        const x = Math.abs((a.x + a.w) - b.x) <= tol
          ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2;
        out.push({
          vertical: true, x, y: Math.max(a.y, b.y), length: vOverlap,
          capStart: Math.abs(a.y - b.y) <= tol,                       // tops aligned
          capEnd: Math.abs((a.y + a.h) - (b.y + b.h)) <= tol,         // bottoms aligned
        });
      }
      if (hOverlap > 0 &&
          (Math.abs((a.y + a.h) - b.y) <= tol || Math.abs((b.y + b.h) - a.y) <= tol)) {
        const y = Math.abs((a.y + a.h) - b.y) <= tol
          ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2;
        out.push({
          vertical: false, x: Math.max(a.x, b.x), y, length: hOverlap,
          capStart: Math.abs(a.x - b.x) <= tol,                       // left edges aligned
          capEnd: Math.abs((a.x + a.w) - (b.x + b.w)) <= tol,         // right edges aligned
        });
      }
    }
  }
  return out;
}

// Which of `item`'s 4 corners sit exactly at a junction with a sibling
// (the sibling's edge reaches that corner) → those corners are squared
// so the two visuals read as ONE continuous frame at the seam, while
// every corner that is NOT touched keeps its rounding. Returns
// { tl, tr, br, bl } booleans.
export function mergeCorners(item, members, tol = 10) {
  const r = rectOf(item);
  const c = { tl: false, tr: false, br: false, bl: false };
  for (const m of members) {
    if (!m || m.i === item.i) continue;
    const o = rectOf(m);
    const vOverlap = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
    const hOverlap = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
    const reachTop = o.y <= r.y + tol;
    const reachBottom = o.y + o.h >= r.y + r.h - tol;
    const reachLeft = o.x <= r.x + tol;
    const reachRight = o.x + o.w >= r.x + r.w - tol;
    if (vOverlap > 0 && Math.abs((r.x + r.w) - o.x) <= tol) { // item is the left one
      if (reachTop) c.tr = true;
      if (reachBottom) c.br = true;
    }
    if (vOverlap > 0 && Math.abs(r.x - (o.x + o.w)) <= tol) { // item is the right one
      if (reachTop) c.tl = true;
      if (reachBottom) c.bl = true;
    }
    if (hOverlap > 0 && Math.abs((r.y + r.h) - o.y) <= tol) { // item is the top one
      if (reachLeft) c.bl = true;
      if (reachRight) c.br = true;
    }
    if (hOverlap > 0 && Math.abs(r.y - (o.y + o.h)) <= tol) { // item is the bottom one
      if (reachLeft) c.tl = true;
      if (reachRight) c.tr = true;
    }
  }
  return c;
}

// Midpoint of the shared edge between two adjacent items, in canvas px.
// Returns { x, y } at the junction, or null if they don't touch. Used to
// place the on-canvas "magnet" merge affordance.
export function edgeMidpoint(a, b, tol = 10) {
  const ra = rectOf(a);
  const rb = rectOf(b);
  const vOverlap = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  const hOverlap = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  if (vOverlap > 0 &&
      (Math.abs((ra.x + ra.w) - rb.x) <= tol || Math.abs((rb.x + rb.w) - ra.x) <= tol)) {
    const edgeX = Math.abs((ra.x + ra.w) - rb.x) <= tol ? (ra.x + ra.w) : (rb.x + rb.w);
    return { x: edgeX, y: Math.max(ra.y, rb.y) + vOverlap / 2 };
  }
  if (hOverlap > 0 &&
      (Math.abs((ra.y + ra.h) - rb.y) <= tol || Math.abs((rb.y + rb.h) - ra.y) <= tol)) {
    const edgeY = Math.abs((ra.y + ra.h) - rb.y) <= tol ? (ra.y + ra.h) : (rb.y + rb.h);
    return { x: Math.max(ra.x, rb.x) + hOverlap / 2, y: edgeY };
  }
  return null;
}

export function newMergeGroupId() {
  return 'mg_' + Math.random().toString(36).slice(2, 9);
}
