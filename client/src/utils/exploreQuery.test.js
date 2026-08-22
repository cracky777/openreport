import { describe, it, expect } from 'vitest';
import { buildExploreBody, exploreColumns, sortRows, rowsToCsv } from './exploreQuery';

const MODEL = {
  dimensions: [{ name: 'd.Country', label: 'Country' }],
  measures: [{ name: 'd.Sales_sum', label: 'Sales sum' }],
};

describe('buildExploreBody', () => {
  it('shapes the /query body and drops half-built filters', () => {
    const body = buildExploreBody({
      modelId: 'm1',
      dims: ['d.Country'],
      measures: ['d.Sales_sum'],
      filters: [{ field: 'd.Country', op: 'in', values: ['FR'] }, { field: '', op: 'in' }, null],
      limit: '250',
    });
    expect(body.dimensionNames).toEqual(['d.Country']);
    expect(body.measureNames).toEqual(['d.Sales_sum']);
    expect(body.limit).toBe(250);
    expect(body.widgetFilters).toHaveLength(1);
  });

  it('clamps the limit into [1, 10000]', () => {
    expect(buildExploreBody({ limit: 0 }).limit).toBe(1000); // empty/0 falls back to the default
    expect(buildExploreBody({ limit: 99999 }).limit).toBe(10000);
    expect(buildExploreBody({ limit: 'abc' }).limit).toBe(1000);
  });
});

describe('exploreColumns / sortRows', () => {
  it('labels columns from the model, dims before measures', () => {
    const cols = exploreColumns({ dims: ['d.Country'], measures: ['d.Sales_sum'], model: MODEL });
    expect(cols.map((c) => c.key)).toEqual(['Country', 'Sales sum']);
    expect(cols.map((c) => c.kind)).toEqual(['dim', 'measure']);
  });

  it('sorts numerically when both sides are numbers, nulls last', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 10 }, { v: 1 }];
    expect(sortRows(rows, 'v', 'asc').map((r) => r.v)).toEqual([1, 2, 10, null]);
    expect(sortRows(rows, 'v', 'desc').map((r) => r.v)).toEqual([10, 2, 1, null]);
    expect(sortRows(rows, null, null)).toBe(rows); // untouched when unsorted
  });
});

describe('rowsToCsv', () => {
  it('quotes and escapes per RFC 4180', () => {
    const cols = [{ key: 'a' }, { key: 'b' }];
    const csv = rowsToCsv([{ a: 'x,y', b: 'He said "hi"' }, { a: null, b: 3 }], cols);
    expect(csv.split('\r\n')).toEqual(['a,b', '"x,y","He said ""hi"""', ',3']);
  });
});
