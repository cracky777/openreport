/* eslint-env jest */
const { aggregate, canServe } = require('./inMemoryAgg');

// Sample pre-aggregated dataset — sales grouped by (year, country, channel)
// with two measures: sum of revenue, count of orders.
function fixture() {
  return {
    dims: ['year', 'country', 'channel'],
    measures: {
      revenue: { type: 'sum' },
      order_count: { type: 'count' },
      min_order: { type: 'min' },
      max_order: { type: 'max' },
    },
    rows: [
      { year: 2024, country: 'FR', channel: 'web', revenue: 100, order_count: 4, min_order: 25, max_order: 50 },
      { year: 2024, country: 'FR', channel: 'shop', revenue: 200, order_count: 6, min_order: 10, max_order: 80 },
      { year: 2024, country: 'DE', channel: 'web', revenue: 50, order_count: 2, min_order: 15, max_order: 40 },
      { year: 2025, country: 'FR', channel: 'web', revenue: 300, order_count: 10, min_order: 5, max_order: 120 },
      { year: 2025, country: 'DE', channel: 'web', revenue: 150, order_count: 3, min_order: 30, max_order: 90 },
      { year: 2025, country: 'DE', channel: 'shop', revenue: 80, order_count: 2, min_order: 20, max_order: 60 },
    ],
  };
}

describe('inMemoryAgg.aggregate', () => {
  test('regroups SUM by a subset of dims', () => {
    const dataset = fixture();
    const out = aggregate({
      dataset,
      request: { dims: ['year'], measures: ['revenue'] },
    });
    // 2024: 100+200+50 = 350; 2025: 300+150+80 = 530
    const byYear = Object.fromEntries(out.map((r) => [r.year, r.revenue]));
    expect(byYear).toEqual({ 2024: 350, 2025: 530 });
  });

  test('regroups COUNT additively', () => {
    const dataset = fixture();
    const out = aggregate({
      dataset,
      request: { dims: ['country'], measures: ['order_count'] },
    });
    const byCountry = Object.fromEntries(out.map((r) => [r.country, r.order_count]));
    // FR: 4+6+10 = 20 ; DE: 2+3+2 = 7
    expect(byCountry).toEqual({ FR: 20, DE: 7 });
  });

  test('MIN takes the smallest across grouped rows', () => {
    const dataset = fixture();
    const out = aggregate({
      dataset,
      request: { dims: ['country'], measures: ['min_order'] },
    });
    const byCountry = Object.fromEntries(out.map((r) => [r.country, r.min_order]));
    expect(byCountry).toEqual({ FR: 5, DE: 15 });
  });

  test('MAX takes the largest across grouped rows', () => {
    const dataset = fixture();
    const out = aggregate({
      dataset,
      request: { dims: ['country'], measures: ['max_order'] },
    });
    const byCountry = Object.fromEntries(out.map((r) => [r.country, r.max_order]));
    expect(byCountry).toEqual({ FR: 120, DE: 90 });
  });

  test('filters rows BEFORE grouping', () => {
    const dataset = fixture();
    const out = aggregate({
      dataset,
      request: {
        dims: ['year'],
        measures: ['revenue'],
        filters: { country: ['FR'] },
      },
    });
    // FR only: 2024 = 100+200 = 300 ; 2025 = 300
    const byYear = Object.fromEntries(out.map((r) => [r.year, r.revenue]));
    expect(byYear).toEqual({ 2024: 300, 2025: 300 });
  });

  test('multi-value filter (IN) works', () => {
    const dataset = fixture();
    const out = aggregate({
      dataset,
      request: {
        dims: ['country'],
        measures: ['revenue'],
        filters: { year: [2025] },
      },
    });
    // Only 2025 rows: FR=300, DE=150+80=230
    const byCountry = Object.fromEntries(out.map((r) => [r.country, r.revenue]));
    expect(byCountry).toEqual({ FR: 300, DE: 230 });
  });

  test('string-coerces filter values (UI sends strings, SQL sometimes returns numbers)', () => {
    const dataset = fixture();
    const out = aggregate({
      dataset,
      request: {
        dims: ['country'],
        measures: ['revenue'],
        filters: { year: ['2025'] }, // user picked "2025" in the slicer
      },
    });
    expect(out.find((r) => r.country === 'FR').revenue).toBe(300);
  });

  test('zero dims = single grand total bucket', () => {
    const dataset = fixture();
    const out = aggregate({
      dataset,
      request: { dims: [], measures: ['revenue'] },
    });
    expect(out).toHaveLength(1);
    expect(out[0].revenue).toBe(880);
  });

  test('throws when a requested dim is missing from the dataset', () => {
    const dataset = fixture();
    expect(() => aggregate({
      dataset,
      request: { dims: ['region'], measures: ['revenue'] },
    })).toThrow(/region/);
  });

  test('does not mutate the input dataset', () => {
    const dataset = fixture();
    const before = JSON.stringify(dataset);
    aggregate({
      dataset,
      request: { dims: ['year'], measures: ['revenue'], filters: { country: ['FR'] } },
    });
    expect(JSON.stringify(dataset)).toBe(before);
  });

  test('null and non-finite measure values are skipped, not summed as 0', () => {
    const dataset = {
      dims: ['k'],
      measures: { x: { type: 'sum' } },
      rows: [
        { k: 'a', x: 10 },
        { k: 'a', x: null },      // null skipped
        { k: 'a', x: NaN },       // non-finite skipped
        { k: 'a', x: 'not-a-num' }, // can't coerce, skipped
        { k: 'a', x: 5 },
      ],
    };
    const out = aggregate({ dataset, request: { dims: ['k'], measures: ['x'] } });
    expect(out[0].x).toBe(15);
  });

  test('throws on unsupported measure type', () => {
    const dataset = {
      dims: ['k'],
      measures: { x: { type: 'count_distinct' } },
      rows: [{ k: 'a', x: 1 }],
    };
    expect(() => aggregate({
      dataset,
      request: { dims: ['k'], measures: ['x'] },
    })).toThrow(/count_distinct/);
  });
});

describe('inMemoryAgg.aggregate (rowKeys alias map)', () => {
  // The cacheWarmer stores rows AS THE SQL EMITS THEM — keyed by the
  // measure / dim *label* (column alias). The aggregator translates
  // request name → row alias via `dataset.rowKeys` so the cache schema
  // stays uniform on names while the rows preserve the SQL output.
  const aliasFixture = () => ({
    dims: ['_date.month_name', 'lib_client'],
    measures: { '_calc.nbr_appel_fin': { type: 'count' } },
    rowKeys: {
      '_date.month_name': 'Month Name',
      '_calc.nbr_appel_fin': 'nbr_appel_fin',
    },
    rows: [
      { 'Month Name': 'January', lib_client: 'A', nbr_appel_fin: 10 },
      { 'Month Name': 'January', lib_client: 'B', nbr_appel_fin: 5 },
      { 'Month Name': 'February', lib_client: 'A', nbr_appel_fin: 7 },
      { 'Month Name': 'February', lib_client: 'B', nbr_appel_fin: 3 },
    ],
  });

  test('reads dim values via rowKeys alias', () => {
    const out = aggregate({
      dataset: aliasFixture(),
      request: {
        dims: ['_date.month_name'],
        measures: ['_calc.nbr_appel_fin'],
      },
    });
    // Output rows are keyed BY ALIAS (so the visual sees the same shape
    // a fresh SQL call would produce).
    const byMonth = Object.fromEntries(out.map((r) => [r['Month Name'], r.nbr_appel_fin]));
    expect(byMonth).toEqual({ January: 15, February: 10 });
  });

  test('filter on a dim resolves through rowKeys', () => {
    const out = aggregate({
      dataset: aliasFixture(),
      request: {
        dims: ['_date.month_name'],
        measures: ['_calc.nbr_appel_fin'],
        filters: { lib_client: ['A'] },
      },
    });
    const byMonth = Object.fromEntries(out.map((r) => [r['Month Name'], r.nbr_appel_fin]));
    expect(byMonth).toEqual({ January: 10, February: 7 });
  });

  test('grand total over an aliased dataset', () => {
    const out = aggregate({
      dataset: aliasFixture(),
      request: { dims: [], measures: ['_calc.nbr_appel_fin'] },
    });
    expect(out).toHaveLength(1);
    expect(out[0].nbr_appel_fin).toBe(25);
  });
});

describe('inMemoryAgg.canServe', () => {
  test('accepts subset of dims with additive measures', () => {
    expect(canServe({
      dataset: fixture(),
      request: { dims: ['year'], measures: ['revenue'], filters: { country: ['FR'] } },
    })).toBe(true);
  });

  test('rejects when requested dim is missing', () => {
    expect(canServe({
      dataset: fixture(),
      request: { dims: ['region'], measures: ['revenue'] },
    })).toBe(false);
  });

  test('rejects when filter dim is missing', () => {
    expect(canServe({
      dataset: fixture(),
      request: { dims: ['year'], measures: ['revenue'], filters: { region: ['EU'] } },
    })).toBe(false);
  });

  test('rejects measures whose type is not additive', () => {
    const dataset = {
      ...fixture(),
      measures: { ...fixture().measures, distinct_users: { type: 'count_distinct' } },
    };
    expect(canServe({
      dataset,
      request: { dims: ['year'], measures: ['distinct_users'] },
    })).toBe(false);
  });

  test('rejects when the measure isn\'t in the dataset at all', () => {
    expect(canServe({
      dataset: fixture(),
      request: { dims: ['year'], measures: ['ghost_measure'] },
    })).toBe(false);
  });
});
