import { describe, test, expect } from 'vitest';
import { clampPos, clampDelta, clampRect, dragBounds } from './pageBounds';

const PW = 1000;
const PH = 600;
const it = (x, y, w, h, i = 'a') => ({ i, x, y, w, h });

describe('clampPos', () => {
  test('leaves a widget that fits alone', () => {
    expect(clampPos(100, 100, 200, 100, PW, PH)).toEqual({ x: 100, y: 100 });
  });

  test('stops the widget at the right and bottom edges, not at the page corner', () => {
    expect(clampPos(9000, 9000, 200, 100, PW, PH)).toEqual({ x: 800, y: 500 });
  });

  test('stops at the top-left', () => {
    expect(clampPos(-50, -50, 200, 100, PW, PH)).toEqual({ x: 0, y: 0 });
  });

  test('a widget larger than the page is pinned at the origin, not shrunk', () => {
    expect(clampPos(300, 300, 1400, 900, PW, PH)).toEqual({ x: 0, y: 0 });
  });
});

describe('clampDelta', () => {
  const block = [it(700, 400, 200, 100, 'a'), it(900, 400, 100, 100, 'b')];

  test('lets the block through while it fits', () => {
    expect(clampDelta(block, -100, -100, PW, PH)).toEqual({ dx: -100, dy: -100 });
  });

  test('the member nearest the edge caps the whole block', () => {
    // 'b' ends at x=1000, so the block cannot move right at all.
    expect(clampDelta(block, 200, 200, PW, PH)).toEqual({ dx: 0, dy: 100 });
  });

  test('the trailing member caps the move towards the origin', () => {
    expect(clampDelta(block, -900, 0, PW, PH)).toEqual({ dx: -700, dy: 0 });
  });
});

describe('dragBounds', () => {
  test('a lone widget may travel the whole page', () => {
    expect(dragBounds(it(100, 100, 200, 100), [], PW, PH))
      .toEqual({ left: 0, top: 0, right: 800, bottom: 500 });
  });

  test('a member is limited by its siblings so the block stays whole', () => {
    const block = [it(700, 400, 200, 100, 'a'), it(900, 400, 100, 100, 'b')];
    // 'a' can go back to x=700-700=0 and no further right: 'b' is already at the edge.
    expect(dragBounds(block[0], block, PW, PH))
      .toEqual({ left: 0, top: 0, right: 700, bottom: 500 });
  });

  test('a block already off the page may come back but not go further out', () => {
    const block = [it(950, 0, 200, 100, 'a')];
    const b = dragBounds(block[0], block, PW, PH);
    expect(b.right).toBe(950);
    expect(b.left).toBe(0);
  });
});

describe('clampRect', () => {
  test('leaves a rect that fits', () => {
    expect(clampRect({ x: 10, y: 10, w: 200, h: 100 }, PW, PH))
      .toEqual({ x: 10, y: 10, w: 200, h: 100 });
  });

  test('an east overshoot trims the width, the left edge stays put', () => {
    expect(clampRect({ x: 900, y: 0, w: 400, h: 100 }, PW, PH))
      .toEqual({ x: 900, y: 0, w: 100, h: 100 });
  });

  test('a west overshoot stops the left edge and keeps the right one', () => {
    // Dragged 60px past the left edge: x goes to 0 and the width loses those 60.
    expect(clampRect({ x: -60, y: 10, w: 260, h: 100 }, PW, PH))
      .toEqual({ x: 0, y: 10, w: 200, h: 100 });
  });

  test('a north overshoot stops the top edge and keeps the bottom one', () => {
    expect(clampRect({ x: 10, y: -40, w: 200, h: 240 }, PW, PH))
      .toEqual({ x: 10, y: 0, w: 200, h: 200 });
  });

  test('the minimum size wins over the page edge, so the widget stays grabbable', () => {
    expect(clampRect({ x: 980, y: 580, w: 200, h: 100 }, PW, PH))
      .toEqual({ x: 980, y: 580, w: 80, h: 40 });
  });
});
