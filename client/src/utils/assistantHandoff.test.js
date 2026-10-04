import { beforeEach, describe, expect, test } from 'vitest';
import { handOver, takeHandOver, peekHandOver, DESCRIBE_MAX_AGE_MS } from './assistantHandoff';

// The tests run in Node: a Map stands in for the browser's storage.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

describe('handing a request over to another assistant', () => {
  beforeEach(() => localStorage.clear());

  test('read once, by the model it was meant for', () => {
    handOver('model', 'm1', 'Join orders to customers');
    expect(takeHandOver('model', 'm2')).toBe('');
    handOver('model', 'm1', 'Join orders to customers');
    expect(takeHandOver('model', 'm1')).toBe('Join orders to customers');
    expect(takeHandOver('model', 'm1')).toBe('');
  });

  test('a report never picks up a request meant for a model with the same id', () => {
    handOver('model', '7', 'Join orders to customers');
    expect(takeHandOver('report', '7')).toBe('');
  });

  test('the report request waits beside the model one, for as long as the model takes', () => {
    handOver('model', 'm1', 'Sales by country');
    handOver('describe', 'm1', 'Sales by country', DESCRIBE_MAX_AGE_MS);
    expect(takeHandOver('model', 'm1')).toBe('Sales by country');
    const later = Date.now() + 20 * 60_000;
    expect(peekHandOver('describe', 'm1', later)).toBe('Sales by country');
    expect(takeHandOver('describe', 'm1', later)).toBe('Sales by country');
    expect(peekHandOver('describe', 'm1', later)).toBe('');
  });

  test('a stale request is dropped', () => {
    handOver('report', 'r1', 'old');
    expect(takeHandOver('report', 'r1', Date.now() + 120_000)).toBe('');
  });
});
