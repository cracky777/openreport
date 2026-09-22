const { dimensionCardinality } = require('../utils/ai/cardinality');

// Counting values reads the cache, like everything the assistant reads: the
// same fail-closed rule, and what cannot be counted from the cache stays
// unknown rather than being read some other way.
const effective = {
  dimensions: [{ name: 'c.city' }, { name: 'c.region' }, { name: 'c.status' }],
  measures: [{ name: 'c.pop' }],
};
const coverage = [{ dimensions: ['c.city', 'c.region'], builtAt: 't1' }, { dimensions: ['c.region', 'c.gone'], builtAt: 't2' }];
const user = { id: 'u1' };
let seq = 0;
const report = () => ({ id: null, model_id: `m${++seq}`, settings: {} });

test('each dimension the cache can list is counted with a cacheOnly distinct read; the others stay unknown', async () => {
  const fireQuery = jest.fn(async ({ body }) => ({
    rows: Array.from({ length: body.dimensionNames[0] === 'c.city' ? 200 : 13 }, (_, i) => ({ v: i })),
    _cache: { hit: true, fromRollup: 'r1' },
  }));
  const out = await dimensionCardinality({ user, orgId: null, report: report(), effective, coverage }, { fireQuery });
  expect(out).toEqual({ 'c.city': { n: 200, more: true }, 'c.region': { n: 13, more: false } });
  // c.status is not in the cache, c.gone is not in the model: neither is asked.
  expect(fireQuery.mock.calls.map((c) => c[0].body.dimensionNames)).toEqual([['c.city'], ['c.region']]);
  for (const [{ body }] of fireQuery.mock.calls) {
    expect(body).toMatchObject({ cacheOnly: true, distinct: true, measureNames: [] });
    expect(body).not.toHaveProperty('reportId');
  }
});

test('an answer that did not come from the cache counts for nothing', async () => {
  const fireQuery = jest.fn()
    .mockResolvedValueOnce({ rows: [{ v: 1 }], _cache: { hit: false } })
    .mockRejectedValueOnce(new Error('down'));
  const out = await dimensionCardinality({ user, orgId: null, report: report(), effective, coverage }, { fireQuery });
  expect(out).toEqual({});
});

test('counted once per user and cache build, not at every question', async () => {
  const fireQuery = jest.fn(async () => ({ rows: [{ v: 1 }], _cache: { hit: true, fromRollup: 'r1' } }));
  const r = report();
  await dimensionCardinality({ user, orgId: null, report: r, effective, coverage }, { fireQuery });
  await dimensionCardinality({ user, orgId: null, report: r, effective, coverage }, { fireQuery });
  expect(fireQuery).toHaveBeenCalledTimes(2);
  await dimensionCardinality({ user: { id: 'u2' }, orgId: null, report: r, effective, coverage }, { fireQuery });
  expect(fireQuery).toHaveBeenCalledTimes(4);
});
