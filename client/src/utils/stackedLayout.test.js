import { describe, it, expect } from 'vitest';
import { stackedOrder, stackedHeight } from './stackedLayout';

const W = {
  title: { type: 'text' },
  kpi1: { type: 'scorecard' },
  kpi2: { type: 'scorecard' },
  chart: { type: 'bar' },
  slicer: { type: 'filter' },
  bg: { type: 'shape' },
  ghost: undefined,
};

describe('stackedOrder', () => {
  it('reads rows top to bottom and left to right, with a tolerance for slightly offset tops', () => {
    const layout = [
      { i: 'chart', x: 0, y: 300, w: 800, h: 300 },
      { i: 'kpi2', x: 420, y: 48, w: 380, h: 120 }, // 8px lower than kpi1 — same row
      { i: 'kpi1', x: 0, y: 40, w: 380, h: 120 },
      { i: 'title', x: 0, y: 0, w: 800, h: 30 },
    ];
    expect(stackedOrder(layout, W).map((l) => l.i)).toEqual(['title', 'kpi1', 'kpi2', 'chart']);
  });

  it('puts slicers first, regardless of where the author placed them', () => {
    const layout = [
      { i: 'chart', x: 0, y: 0, w: 800, h: 300 },
      { i: 'slicer', x: 0, y: 320, w: 200, h: 200 }, // below the chart on the page
      { i: 'kpi1', x: 220, y: 320, w: 200, h: 200 },
    ];
    expect(stackedOrder(layout, W).map((l) => l.i)).toEqual(['slicer', 'chart', 'kpi1']);
  });

  it('drops decorative shapes and items with no widget', () => {
    const layout = [
      { i: 'bg', x: 0, y: 0, w: 800, h: 600 },
      { i: 'ghost', x: 0, y: 0, w: 100, h: 100 },
      { i: 'kpi1', x: 20, y: 20, w: 300, h: 120 },
    ];
    expect(stackedOrder(layout, W).map((l) => l.i)).toEqual(['kpi1']);
  });
});

describe('stackedHeight', () => {
  it('keeps the authored height inside sane bounds', () => {
    expect(stackedHeight({ h: 200 }, W.kpi1, 800)).toBe(200);
    expect(stackedHeight({ h: 20 }, W.kpi1, 800)).toBe(60);
    expect(stackedHeight({ h: 2000 }, W.chart, 800)).toBe(640);
    expect(stackedHeight({}, W.chart, 800)).toBe(300);
  });
});
