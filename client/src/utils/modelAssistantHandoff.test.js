import { beforeEach, describe, expect, test } from 'vitest';
import { handOver, takeHandOver } from './modelAssistantHandoff';

// The tests run in Node: a Map stands in for the browser's storage.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

describe('handing a request over to the model assistant', () => {
  beforeEach(() => localStorage.clear());

  test('read once, by the model it was meant for', () => {
    handOver('m1', 'Join orders to customers');
    expect(takeHandOver('m2')).toBe('');
    handOver('m1', 'Join orders to customers');
    expect(takeHandOver('m1')).toBe('Join orders to customers');
    expect(takeHandOver('m1')).toBe('');
  });

  test('a stale request is dropped', () => {
    handOver('m1', 'old');
    expect(takeHandOver('m1', Date.now() + 120_000)).toBe('');
  });
});
