import { describe, test, expect } from 'vitest';
import { CONTAINER_KEYS, pickContainer, containerSource, applyContainerToGroup } from './mergeContainer';

const w = (config) => ({ type: 'bar', config });

describe('pickContainer', () => {
  test('keeps the container keys and nothing else', () => {
    const picked = pickContainer({
      backgroundColor: '#fff', borderEnabled: true, borderColor: '#000',
      // Not container: data binding, title, and the rotation that shares the panel section.
      title: 'Sales', rotation: 45, dataLabelColor: '#123456', mergeGroup: 'g1',
    });
    expect(picked).toEqual({ backgroundColor: '#fff', borderEnabled: true, borderColor: '#000' });
  });

  test('an absent key stays absent rather than becoming undefined', () => {
    expect(Object.keys(pickContainer({ backgroundColor: '#fff' }))).toEqual(['backgroundColor']);
    expect(pickContainer({})).toEqual({});
    expect(pickContainer(undefined)).toEqual({});
  });

  test('a falsy value is a value, not an absence', () => {
    const picked = pickContainer({ borderEnabled: false, transparentBg: false, borderRadius: 0 });
    expect(picked).toEqual({ borderEnabled: false, transparentBg: false, borderRadius: 0 });
  });
});

describe('containerSource', () => {
  // The rule that matters: dropping a lone visual onto a merged pair must not
  // repaint the pair in the newcomer's colours.
  test('an existing group beats a lone widget, whichever side it is on', () => {
    const widgets = {
      a: w({}), b: w({ mergeGroup: 'g1' }), c: w({ mergeGroup: 'g1' }),
    };
    expect(containerSource(widgets, 'a', 'b', 'a')).toBe('b');
    expect(containerSource(widgets, 'b', 'a', 'b')).toBe('b');
  });

  test('between two groups the larger one wins — fewer widgets change look', () => {
    const widgets = {
      a: w({ mergeGroup: 'g1' }),
      b: w({ mergeGroup: 'g2' }), c: w({ mergeGroup: 'g2' }), d: w({ mergeGroup: 'g2' }),
    };
    expect(containerSource(widgets, 'a', 'b', 'a')).toBe('b');
    expect(containerSource(widgets, 'b', 'a', 'b')).toBe('b');
  });

  test('equal groups fall back to the anchor, the widget that does not move', () => {
    const widgets = {
      a: w({ mergeGroup: 'g1' }), b: w({ mergeGroup: 'g1' }),
      c: w({ mergeGroup: 'g2' }), d: w({ mergeGroup: 'g2' }),
    };
    expect(containerSource(widgets, 'a', 'c', 'a')).toBe('a');
    expect(containerSource(widgets, 'c', 'a', 'c')).toBe('c');
  });

  test('two lone widgets fall back to the anchor as well', () => {
    const widgets = { a: w({}), b: w({}) };
    expect(containerSource(widgets, 'a', 'b', 'a')).toBe('a');
    expect(containerSource(widgets, 'a', 'b', 'b')).toBe('b');
  });

  test('a widget with no config at all is treated as lone', () => {
    const widgets = { a: {}, b: w({ mergeGroup: 'g1' }) };
    expect(containerSource(widgets, 'a', 'b', 'a')).toBe('b');
  });
});

describe('applyContainerToGroup', () => {
  const base = {
    a: w({ mergeGroup: 'g1', mergeSeparator: true, backgroundColor: '#aaa', borderEnabled: true, title: 'A' }),
    b: w({ mergeGroup: 'g1', mergeSeparator: true, backgroundColor: '#bbb', title: 'B' }),
    outsider: w({ backgroundColor: '#ccc' }),
  };

  test('every member takes the same container', () => {
    const next = applyContainerToGroup(base, 'g1', { backgroundColor: '#123456' });
    expect(next.a.config.backgroundColor).toBe('#123456');
    expect(next.b.config.backgroundColor).toBe('#123456');
  });

  test('a widget outside the group is untouched', () => {
    const next = applyContainerToGroup(base, 'g1', { backgroundColor: '#123456' });
    expect(next.outsider.config.backgroundColor).toBe('#ccc');
    expect(next.outsider).toBe(base.outsider);
  });

  test('keys the source does not define are cleared, not inherited', () => {
    // 'a' had a border; the group's look has none, so 'a' must lose it rather
    // than keep a frame the block no longer draws.
    const next = applyContainerToGroup(base, 'g1', { backgroundColor: '#123456' });
    expect(next.a.config.borderEnabled).toBeUndefined();
  });

  test('everything that is not container survives', () => {
    const next = applyContainerToGroup(base, 'g1', { backgroundColor: '#123456' });
    expect(next.a.config.title).toBe('A');
    expect(next.b.config.title).toBe('B');
    expect(next.a.config.mergeGroup).toBe('g1');
  });

  test('no group id is a no-op', () => {
    expect(applyContainerToGroup(base, null, { backgroundColor: '#000' })).toBe(base);
  });

  test('CONTAINER_KEYS excludes rotation — it would tear a block apart', () => {
    expect(CONTAINER_KEYS).not.toContain('rotation');
    expect(CONTAINER_KEYS).toContain('shadow');
    expect(CONTAINER_KEYS).toContain('gradientBg');
  });

  test('the seam colour reaches the whole block, its on/off flag is left alone', () => {
    // Painted on one member from the panel: the seam is one line across the
    // block, so both sides have to agree on its colour. The flag is toggled
    // group-wide from the canvas and must not be touched here.
    const next = applyContainerToGroup(base, 'g1', { mergeSeparatorColor: '#dc2626' });
    expect(next.a.config.mergeSeparatorColor).toBe('#dc2626');
    expect(next.b.config.mergeSeparatorColor).toBe('#dc2626');
    expect(next.a.config.mergeSeparator).toBe(true);
  });
});
