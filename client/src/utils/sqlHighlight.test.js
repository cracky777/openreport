import { describe, it, expect } from 'vitest';
import { tokenizeSql } from './sqlHighlight';

const types = (sql) => tokenizeSql(sql).filter((t) => t.type !== 'ws').map((t) => `${t.type}:${t.text}`);

describe('tokenizeSql', () => {
  it('is lossless — concatenated tokens rebuild the input exactly', () => {
    const sql = `SUM(CASE WHEN "orders"."status" = 'paid' THEN amount ELSE 0 END) -- net\n/ NULLIF(\${total_count}, 0) * 1.5`;
    expect(tokenizeSql(sql).map((t) => t.text).join('')).toBe(sql);
  });

  it('classifies keywords, functions and plain words (case-insensitive)', () => {
    expect(types('sum(x) WHEN foo')).toEqual(['function:sum', 'op:(', 'word:x', 'op:)', 'keyword:WHEN', 'word:foo']);
  });

  it('keeps strings and quoted identifiers atomic, including escaped quotes', () => {
    expect(types(`'it''s' "we""ird"`)).toEqual([`string:'it''s'`, `identifier:"we""ird"`]);
  });

  it('flags ${calc} references and numbers', () => {
    expect(types('${net_sales} / 100.5')).toEqual(['calc:${net_sales}', 'op:/', 'number:100.5']);
  });

  it('treats -- comments as a single token up to end of line', () => {
    const t = tokenizeSql('a -- rest of line\nb');
    expect(t.find((x) => x.type === 'comment').text).toBe('-- rest of line');
  });

  it('tolerates an unterminated string without dropping text', () => {
    const sql = `'unfinished AND more`;
    expect(tokenizeSql(sql).map((t) => t.text).join('')).toBe(sql);
  });

  it('returns an empty list for empty input', () => {
    expect(tokenizeSql('')).toEqual([]);
  });
});
