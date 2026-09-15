// The live /query path and the rollup cache must hand the client the same
// value types for the same widget: numbers as numbers, dates as ISO dates,
// intervals as seconds — while dimension values keep their text as-is.
const { normalizeRows, tidyNumber } = require('../utils/rowNormalize');

describe('normalizeRows', () => {
  const dims = new Set(['code', 'day']);

  test('numeric strings on measure keys become numbers (pg NUMERIC / BIGINT)', () => {
    const [row] = normalizeRows([{ code: '00123', total: '12345.67', nb: '42', neg: '-3', sci: '1e3' }], { dimensionKeys: dims });
    expect(row).toEqual({ code: '00123', total: 12345.67, nb: 42, neg: -3, sci: 1000 });
  });

  test('a dimension value is never coerced, even when it looks numeric', () => {
    const [row] = normalizeRows([{ code: '42', total: '1' }], { dimensionKeys: dims });
    expect(row.code).toBe('42');
    expect(row.total).toBe(1);
  });

  test('strings that are not canonical numbers stay strings', () => {
    const [row] = normalizeRows([{ a: '007', b: ' 12', c: '1,5', d: '12.', e: '', f: 'abc' }]);
    expect(row).toEqual({ a: '007', b: ' 12', c: '1,5', d: '12.', e: '', f: 'abc' });
  });

  test('Date objects become ISO dates on every key, intervals become seconds', () => {
    const [row] = normalizeRows([{ day: new Date('2024-03-05T10:00:00Z'), dur: { hours: 1, minutes: 30 }, zero: {}, obj: { x: 1 } }], { dimensionKeys: dims });
    expect(row).toEqual({ day: '2024-03-05', dur: 5400, zero: 0, obj: { x: 1 } });
  });

  test('the rollup builder keeps strings untouched', () => {
    const [row] = normalizeRows([{ total: '12.5' }], { coerceNumbers: false });
    expect(row.total).toBe('12.5');
  });

  test('floating-point noise on a measure is dropped, real digits and integers are kept', () => {
    const [row] = normalizeRows([{ code: 30.299999999999997, noisy: 10.1 + 10.1 + 10.1, big: 44956662.650000006, exact: 44956662.65216311, int: 1234567890123, small: 0.000123456789 }], { dimensionKeys: dims });
    expect(row.code).toBe(30.299999999999997); // a dimension is data, not a figure
    expect(row.noisy).toBe(30.3);
    expect(row.big).toBe(44956662.65);
    expect(row.exact).toBe(44956662.6522); // 12 significant digits
    expect(row.int).toBe(1234567890123);
    expect(row.small).toBe(0.000123456789);
  });

  test('tidyNumber is what the rollup planner applies to recomposed measures', () => {
    expect(tidyNumber(0.1 + 0.2)).toBe(0.3);
    expect(tidyNumber(7)).toBe(7);
    expect(tidyNumber('0.30000000000000004')).toBe('0.30000000000000004');
    expect(tidyNumber(null)).toBe(null);
  });
});
