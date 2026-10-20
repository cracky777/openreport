import { describe, test, expect } from 'vitest';
import { echartsPosition, placementOf, autoPlacements, inkOn, niceMax } from './barLabels';

describe('a bar label placed along its bar', () => {
  test('the end of the bar is a different side of the screen in each direction', () => {
    // 'top' on a horizontal bar was ECharts' top: above the bar, between two bars.
    expect(echartsPosition('top', 'horizontal')).toBe('right');
    expect(echartsPosition('top', 'horizontalInverse')).toBe('left');
    expect(echartsPosition('top', 'verticalInverse')).toBe('bottom');
    expect(echartsPosition('insideTop', 'horizontal')).toBe('insideRight');
    expect(echartsPosition('insideBottom', 'horizontal')).toBe('insideLeft');
    expect(echartsPosition('inside', 'vertical')).toBe('inside');
  });

  test('best fit is the default, and the pie\'s "outside" means it too', () => {
    expect(placementOf({})).toBe('auto');
    expect(placementOf({ dataLabelPosition: 'outside' })).toBe('auto');
    expect(placementOf({ dataLabelPosition: 'insideTop' })).toBe('insideTop');
  });

  test('outside when the text fits after the bar, inside a long bar when it does not', () => {
    const width = (s) => s.length * 7;
    const out = autoPlacements({ values: [300, 1900, 10], texts: ['300 699', '1 922 178', '10'], max: 2000, length: 200, textWidth: width, along: true });
    expect(out).toEqual(['outside', 'inside', 'outside']);
  });

  test('a label inside a bar takes the ink that reads on it', () => {
    expect(inkOn('#0A2344', '#475569')).toBe('#ffffff');
    expect(inkOn('#FFD400', '#475569')).toBe('#1f2937');
    expect(inkOn('var(--x)', '#475569')).toBe('#475569');
    expect(niceMax(1922178)).toBe(2000000);
  });
});
