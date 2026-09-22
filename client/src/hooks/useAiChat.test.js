import { describe, it, expect } from 'vitest';
import { toWire } from './useAiChat';

describe('what a turn sends back of the conversation', () => {
  const read = { dimensions: ['c.client'], measures: ['calls'], rows: [{ Client: 'Acme', Calls: 12 }, { Client: 'Beta', Calls: 9 }], truncated: false };

  it('replays what the assistant read, after its words', () => {
    const { role, text } = toWire({ role: 'assistant', text: 'Acme leads.', proposals: [], reads: [read] });
    expect(role).toBe('assistant');
    expect(text).toBe('Acme leads.\n[Read from the cache: dimensions c.client · measures calls → 2 rows: [{"Client":"Acme","Calls":12},{"Client":"Beta","Calls":9}]]');
  });

  it('says when more rows existed, and gives way at the tail when too long', () => {
    const long = { ...read, rows: Array.from({ length: 400 }, (_, i) => ({ Client: `client-${i}`, Calls: i })), truncated: true };
    const { text } = toWire({ role: 'assistant', text: 'Words stay.', reads: [long] });
    expect(text.startsWith('Words stay.\n[Read from the cache:')).toBe(true);
    expect(text).toContain('more rows exist');
    expect(text.length).toBe(8000);
  });

  it('a user turn is its text', () => {
    expect(toWire({ role: 'user', text: 'top 5 clients' })).toEqual({ role: 'user', text: 'top 5 clients' });
  });
});
