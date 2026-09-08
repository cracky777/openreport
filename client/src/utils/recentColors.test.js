import { describe, test, expect, beforeEach, vi } from 'vitest';

// The module caches in memory, so each case needs a fresh import as well as a
// fresh store — hence the dynamic import after resetModules.
function freshStore(initial) {
  const store = new Map(initial ? [['openreport.recentColors', initial]] : []);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  return store;
}

async function load() {
  vi.resetModules();
  return import('./recentColors');
}

beforeEach(() => { freshStore(); });

describe('reading', () => {
  test('an empty or missing store yields no recents', async () => {
    const m = await load();
    expect(m.getRecentColors()).toEqual([]);
  });

  test('unreadable storage is treated as empty, not as a crash', async () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked in a private window'); },
      setItem: () => {},
    };
    const m = await load();
    expect(m.getRecentColors()).toEqual([]);
  });

  test('junk in the store is filtered out', async () => {
    freshStore(JSON.stringify(['#7c3aed', 'red', 42, null, '#GGGGGG', '#abc']));
    const m = await load();
    expect(m.getRecentColors()).toEqual(['#7c3aed']);
  });
});

describe('pushing', () => {
  test('the newest colour comes first', async () => {
    const m = await load();
    m.pushRecentColor('#111111');
    m.pushRecentColor('#222222');
    expect(m.getRecentColors()).toEqual(['#222222', '#111111']);
  });

  test('re-picking a colour moves it to the front instead of duplicating it', async () => {
    const m = await load();
    m.pushRecentColor('#111111');
    m.pushRecentColor('#222222');
    m.pushRecentColor('#111111');
    expect(m.getRecentColors()).toEqual(['#111111', '#222222']);
  });

  test('case does not create a second entry', async () => {
    const m = await load();
    m.pushRecentColor('#AABBCC');
    m.pushRecentColor('#aabbcc');
    expect(m.getRecentColors()).toEqual(['#aabbcc']);
  });

  test('the list is capped at 8, dropping the oldest', async () => {
    const m = await load();
    for (let i = 0; i < 12; i++) m.pushRecentColor('#0000' + String(i).padStart(2, '0'));
    const list = m.getRecentColors();
    expect(list).toHaveLength(8);
    expect(list[0]).toBe('#000011');
    expect(list).not.toContain('#000000');
  });

  test('anything that is not a plain #rrggbb is ignored', async () => {
    const m = await load();
    for (const bad of ['transparent', '', null, undefined, '#abc', 'rgb(1,2,3)', 'var(--x)']) {
      m.pushRecentColor(bad);
    }
    expect(m.getRecentColors()).toEqual([]);
  });

  test('a write that throws still updates the list for this session', async () => {
    const m = await load();
    globalThis.localStorage.setItem = () => { throw new Error('quota exceeded'); };
    m.pushRecentColor('#123456');
    expect(m.getRecentColors()).toEqual(['#123456']);
  });
});

describe('subscribers', () => {
  test('every open picker is told, and unsubscribing stops that', async () => {
    const m = await load();
    const seen = [];
    const off = m.subscribeRecentColors((list) => seen.push(list));
    m.pushRecentColor('#111111');
    off();
    m.pushRecentColor('#222222');
    expect(seen).toEqual([['#111111']]);
  });

  test('an ignored colour notifies nobody', async () => {
    const m = await load();
    let calls = 0;
    m.subscribeRecentColors(() => { calls++; });
    m.pushRecentColor('not a color');
    expect(calls).toBe(0);
  });
});
