import { describe, test, expect } from 'vitest';
import { mergeSpan, groupBorderCss } from './mergeFrames';

// Three 100x60 cards in a row, then one stacked below the first.
const A = { i: 'a', x: 100, y: 50, w: 100, h: 60 };
const B = { i: 'b', x: 200, y: 50, w: 100, h: 60 };
const C = { i: 'c', x: 300, y: 50, w: 100, h: 60 };
const BELOW = { i: 'd', x: 100, y: 110, w: 100, h: 60 };

describe('mergeSpan', () => {
  test('a row spans the three cards, each offset by its own position', () => {
    const members = [A, B, C];
    expect(mergeSpan(A, members)).toEqual({ w: 300, h: 60, dx: 0, dy: 0 });
    expect(mergeSpan(B, members)).toEqual({ w: 300, h: 60, dx: 100, dy: 0 });
    expect(mergeSpan(C, members)).toEqual({ w: 300, h: 60, dx: 200, dy: 0 });
  });

  test('a stacked pair spans vertically', () => {
    const members = [A, BELOW];
    expect(mergeSpan(A, members)).toEqual({ w: 100, h: 120, dx: 0, dy: 0 });
    expect(mergeSpan(BELOW, members)).toEqual({ w: 100, h: 120, dx: 0, dy: 60 });
  });

  test('an L-shaped group takes the whole bounding box', () => {
    const members = [A, B, BELOW];
    expect(mergeSpan(B, members)).toEqual({ w: 200, h: 120, dx: 100, dy: 0 });
  });

  // A lone widget has nothing to span, and painting a slice of a bigger image
  // would crop its gradient for no reason.
  test('fewer than two members is null', () => {
    expect(mergeSpan(A, [A])).toBeNull();
    expect(mergeSpan(A, [])).toBeNull();
    expect(mergeSpan(A, null)).toBeNull();
    expect(mergeSpan(null, [A, B])).toBeNull();
  });

  test('member order does not matter', () => {
    expect(mergeSpan(B, [C, A, B])).toEqual(mergeSpan(B, [A, B, C]));
  });

  test('the offsets tile the group exactly — no gap, no overlap', () => {
    const members = [A, B, C];
    const spans = members.map((m) => mergeSpan(m, members));
    // Each slice starts where the previous one ended.
    expect(spans.map((s) => s.dx)).toEqual([0, 100, 200]);
    expect(spans[2].dx + C.w).toBe(spans[0].w);
  });
});

describe('groupBorderCss', () => {
  // What the seam cover caps the masked junction with. Getting it wrong is
  // visible as a gap in the frame, or as a short tick continuing nothing.
  test('follows the block own border colour', () => {
    expect(groupBorderCss({ type: 'bar', config: { borderColor: '#dc2626' } }))
      .toBe('1px solid #dc2626');
  });

  test('falls back to the theme border', () => {
    expect(groupBorderCss({ type: 'bar', config: {} })).toBe('1px solid var(--border-default)');
  });

  test('a block with no border caps nothing', () => {
    expect(groupBorderCss({ type: 'bar', config: { borderEnabled: false } })).toBeNull();
    // An image is shown bare by default, like its own frame.
    expect(groupBorderCss({ type: 'image', config: {} })).toBeNull();
    expect(groupBorderCss({ type: 'image', config: { borderEnabled: true } }))
      .toBe('1px solid var(--border-default)');
  });

  test('no widget, no cap', () => {
    expect(groupBorderCss(undefined)).toBeNull();
  });
});
