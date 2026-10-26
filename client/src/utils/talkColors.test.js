import { describe, it, expect } from 'vitest';
import { talkColorsFor, sameColors, answerWidgets, withConfigs, OPEN_REPORT_BASE } from './talkColors';

describe('talkColors', () => {
  it("Open Report's colors unless the user chose theirs, for the app's theme", () => {
    expect(talkColorsFor(null, 'dark')).toEqual({ base: OPEN_REPORT_BASE, harmony: 'categorical', theme: 'dark' });
    expect(talkColorsFor({ base: '#16a34a', harmony: 'analogous' }, 'light')).toEqual({ base: '#16a34a', harmony: 'analogous', theme: 'light' });
  });

  it('an answer is redrawn when its colors are not the ones wanted', () => {
    const now = talkColorsFor(null, 'light');
    expect(sameColors({ ...now }, now)).toBe(true);
    expect(sameColors({ ...now, theme: 'dark' }, now)).toBe(false);
    expect(sameColors(undefined, now)).toBe(false);
  });

  it('the configs go back to the widgets they came from, page by page', () => {
    const report = { kind: 'report', pages: [{ widgets: [{ type: 'bar', config: { a: 1 } }] }, { widgets: [{ type: 'pie', config: { a: 2 } }] }] };
    expect(answerWidgets(report)).toHaveLength(2);
    const next = withConfigs(report, [{ a: 3 }, { a: 4 }], { base: '#000000' });
    expect(next.pages.map((p) => p.widgets[0].config.a)).toEqual([3, 4]);
    expect(next.colors).toEqual({ base: '#000000' });
    expect(answerWidgets({ kind: 'customVisual' })).toEqual([]);
  });
});
