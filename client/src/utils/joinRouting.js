// Geometry for the model-canvas join curves. Pure functions so the routing
// rules can be unit-tested without an SVG. Three rules drive the shape:
//   1. Curves leave a card perpendicular to its edge with a minimum
//      horizontal stiffness, so near-vertical links bow out instead of
//      hugging the card borders.
//   2. When the two cards' X spans (nearly) overlap — stacked or
//      overlapping cards — facing sides would send the curve behind the
//      cards, so both ends anchor on the SAME side and the curve loops
//      around the outside of the stack, where it stays visible.
//   3. Collision checks sample the actual Bézier against card rects (no
//      Y-band heuristics): facing curves detour above/below obstacles,
//      loops widen (then switch side) until the sampled curve is clear.

const SAMPLES = 20;
const PADDING = 18;
// Below this horizontal gap between the two cards, facing sides have no
// corridor to route through — switch to a same-side loop.
const MIN_GAP = 24;
const MIN_STIFFNESS = 40;
const LOOP_MIN_STIFFNESS = 60;
const LOOP_MAX_BASE_STIFFNESS = 140;

// Cubic Bézier sampler, one axis at a time.
export function bezierAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function curveCrosses(from, to, c1x, c1y, c2x, c2y, rects) {
  for (let s = 1; s < SAMPLES; s++) {
    const t = s / SAMPLES;
    const x = bezierAt(from.x, c1x, c2x, to.x, t);
    const y = bezierAt(from.y, c1y, c2y, to.y, t);
    for (const r of rects) {
      if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) return true;
    }
  }
  return false;
}

// Route one join between two cards.
//   fromRect / toRect : card rects { x, y, width, height }
//   getFromPort / getToPort : (side: 'left'|'right') => { x, y } port position
//   obstacles : rects of every OTHER card on the canvas
// Returns { from, to, c1x, c1y, c2x, c2y } for a cubic Bézier path.
export function routeJoin({ fromRect, toRect, getFromPort, getToPort, obstacles }) {
  const gapLR = toRect.x - (fromRect.x + fromRect.width);
  const gapRL = fromRect.x - (toRect.x + toRect.width);
  if (gapLR >= MIN_GAP || gapRL >= MIN_GAP) {
    return routeFacing(gapLR >= MIN_GAP, getFromPort, getToPort, obstacles);
  }
  return routeLoop(getFromPort, getToPort, obstacles);
}

function routeFacing(leftToRight, getFromPort, getToPort, obstacles) {
  const from = getFromPort(leftToRight ? 'right' : 'left');
  const to = getToPort(leftToRight ? 'left' : 'right');
  const s = Math.max(MIN_STIFFNESS, Math.abs(to.x - from.x) / 2);
  const c1x = from.x + (leftToRight ? s : -s);
  const c2x = to.x + (leftToRight ? -s : s);
  let c1y = from.y;
  let c2y = to.y;

  // Only cards overlapping the curve's X span can possibly be hit.
  const xMin = Math.min(from.x, to.x);
  const xMax = Math.max(from.x, to.x);
  const xObstacles = obstacles.filter((r) => r.x + r.width >= xMin && r.x <= xMax);

  if (xObstacles.length && curveCrosses(from, to, c1x, c1y, c2x, c2y, xObstacles)) {
    // Detour above or below ALL X-overlapping cards (not just the ones the
    // straight curve hits — a tighter apex risks crashing into a card we
    // hadn't flagged). Prefer the side closer to the direct midline.
    const topApex = Math.min(...xObstacles.map((r) => r.y)) - PADDING;
    const botApex = Math.max(...xObstacles.map((r) => r.y + r.height)) + PADDING;
    // With both control Ys at cy, the curve peaks at (from.y + to.y)/8
    // + 0.75*cy. Invert so the actual peak lands on the apex.
    const ctrlForApex = (apex) => (apex - (from.y + to.y) / 8) / 0.75;
    const tryApex = (apex) => {
      const cy = ctrlForApex(apex);
      return curveCrosses(from, to, c1x, cy, c2x, cy, xObstacles) ? null : cy;
    };
    const preferTop = Math.abs((from.y + to.y) / 2 - topApex) <= Math.abs((from.y + to.y) / 2 - botApex);
    const first = preferTop ? topApex : botApex;
    const second = preferTop ? botApex : topApex;
    // Both sides blocked (dense canvas): fall back to the preferred apex
    // anyway — better a routed line that grazes than one through the middle.
    const cy = tryApex(first) ?? tryApex(second) ?? ctrlForApex(first);
    c1y = cy;
    c2y = cy;
  }
  return { from, to, c1x, c1y, c2x, c2y };
}

function routeLoop(getFromPort, getToPort, obstacles) {
  const build = (side) => {
    const from = getFromPort(side);
    const to = getToPort(side);
    const dir = side === 'right' ? 1 : -1;
    let s = Math.max(LOOP_MIN_STIFFNESS, Math.min(LOOP_MAX_BASE_STIFFNESS, Math.abs(to.y - from.y) / 2));
    // Only cards in the Y band between the two ports can sit in the loop's
    // path — everything outside is cleared by construction.
    const yMin = Math.min(from.y, to.y) - PADDING;
    const yMax = Math.max(from.y, to.y) + PADDING;
    const near = obstacles.filter((r) => r.y + r.height >= yMin && r.y <= yMax);
    for (let attempt = 0; attempt < 5; attempt++) {
      const c1x = from.x + dir * s;
      const c2x = to.x + dir * s;
      if (!near.length || !curveCrosses(from, to, c1x, from.y, c2x, to.y, near)) {
        return { from, to, c1x, c1y: from.y, c2x, c2y: to.y, clear: true };
      }
      s *= 1.5;
    }
    return { from, to, c1x: from.x + dir * s, c1y: from.y, c2x: to.x + dir * s, c2y: to.y, clear: false };
  };
  const right = build('right');
  if (right.clear) return right;
  const left = build('left');
  return left.clear ? left : right;
}
