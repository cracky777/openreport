import { describe, it, expect } from 'vitest';
import { routeJoin, bezierAt, curveCrosses } from './joinRouting';

const W = 220;
const H = 200;
const rect = (x, y, height = H) => ({ x, y, width: W, height });
// Port factory mirroring SchemaCanvas.getColumnPos: left port on the left
// edge, right port on the right edge, at the given row Y.
const port = (r, y) => (side) => ({ x: side === 'right' ? r.x + r.width : r.x, y });

// Sample the routed curve and assert it never enters any of the rects.
const expectClearOf = (route, rects) => {
  expect(curveCrosses(route.from, route.to, route.c1x, route.c1y, route.c2x, route.c2y, rects)).toBe(false);
};

describe('routeJoin — facing cards (horizontal gap)', () => {
  it('routes left-to-right out of the right edge into the left edge', () => {
    const a = rect(0, 0);
    const b = rect(600, 50);
    const route = routeJoin({
      fromRect: a, toRect: b,
      getFromPort: port(a, 100), getToPort: port(b, 150),
      obstacles: [],
    });
    expect(route.from.x).toBe(a.x + W); // right edge of A
    expect(route.to.x).toBe(b.x); // left edge of B
    expect(route.c1x).toBeGreaterThan(route.from.x); // exits rightward
    expect(route.c2x).toBeLessThan(route.to.x); // enters leftward
  });

  it('keeps a minimum stiffness so narrow gaps still produce a visible S-curve', () => {
    const a = rect(0, 0);
    const b = rect(a.x + W + 30, 400); // 30px corridor, big vertical offset
    const route = routeJoin({
      fromRect: a, toRect: b,
      getFromPort: port(a, 100), getToPort: port(b, 450),
      obstacles: [],
    });
    expect(route.c1x - route.from.x).toBeGreaterThanOrEqual(40);
    expect(route.to.x - route.c2x).toBeGreaterThanOrEqual(40);
  });

  it('detours around a card sitting between the two endpoints', () => {
    const a = rect(0, 0);
    const b = rect(700, 0);
    const obstacle = rect(340, 60, 120); // straight line at y=100 would hit it
    const route = routeJoin({
      fromRect: a, toRect: b,
      getFromPort: port(a, 100), getToPort: port(b, 100),
      obstacles: [obstacle],
    });
    expectClearOf(route, [obstacle]);
  });
});

describe('routeJoin — stacked/overlapping cards (same-side loop)', () => {
  it('loops out of the same side when one card is right above the other', () => {
    const a = rect(100, 0);
    const b = rect(100, 300); // identical X — the old center rule crossed behind the cards
    const route = routeJoin({
      fromRect: a, toRect: b,
      getFromPort: port(a, 100), getToPort: port(b, 350),
      obstacles: [],
    });
    // Both ends anchor on the right edge and the curve bulges outward,
    // never entering either card's X span.
    expect(route.from.x).toBe(a.x + W);
    expect(route.to.x).toBe(b.x + W);
    expect(route.c1x).toBeGreaterThan(a.x + W);
    expect(route.c2x).toBeGreaterThan(b.x + W);
    expectClearOf(route, [a, b]);
  });

  it('loops when the cards partially overlap in X', () => {
    const a = rect(0, 0);
    const b = rect(120, 300); // X spans overlap — no corridor for facing sides
    const route = routeJoin({
      fromRect: a, toRect: b,
      getFromPort: port(a, 100), getToPort: port(b, 350),
      obstacles: [],
    });
    expect(route.from.x).toBe(route.c1x < route.from.x ? a.x : a.x + W);
    expect(route.to.x).toBe(route.c2x < route.to.x ? b.x : b.x + W);
    // Same side for both ends: control offsets point the same way.
    expect(Math.sign(route.c1x - route.from.x)).toBe(Math.sign(route.c2x - route.to.x));
  });

  it('widens or switches side when a card blocks the right loop', () => {
    const a = rect(0, 0);
    const b = rect(0, 400);
    const blocker = rect(240, 100, 200); // sits exactly where the right loop bulges
    const route = routeJoin({
      fromRect: a, toRect: b,
      getFromPort: port(a, 100), getToPort: port(b, 450),
      obstacles: [blocker],
    });
    expectClearOf(route, [blocker]);
  });

  it('handles a self-join without degenerating', () => {
    const a = rect(50, 50);
    const route = routeJoin({
      fromRect: a, toRect: a,
      getFromPort: port(a, 80), getToPort: port(a, 130),
      obstacles: [],
    });
    // Loop on one side of the card, visibly bulging away from the edge.
    expect(Math.abs(route.c1x - route.from.x)).toBeGreaterThanOrEqual(60);
    expectClearOf(route, [a]);
  });
});

describe('bezierAt', () => {
  it('hits the endpoints at t=0 and t=1', () => {
    expect(bezierAt(10, 50, 90, 130, 0)).toBe(10);
    expect(bezierAt(10, 50, 90, 130, 1)).toBe(130);
  });
});
