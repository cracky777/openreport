import { describe, it, expect } from 'vitest';
import {
  TIME_PRESETS, presetRange, comparableRange, timePeriodOf, timePeriodFilter,
} from './timeIntelligence';

// Fixed clock: Wednesday 2026-08-19 (Q3, mid-month) — every expectation
// below is hand-computed against this date.
const NOW = new Date(2026, 7, 19, 15, 30);

describe('presetRange', () => {
  it('covers calendar-to-date presets', () => {
    expect(presetRange('ytd', NOW)).toEqual(['2026-01-01', '2026-08-19']);
    expect(presetRange('qtd', NOW)).toEqual(['2026-07-01', '2026-08-19']);
    expect(presetRange('mtd', NOW)).toEqual(['2026-08-01', '2026-08-19']);
  });

  it('covers rolling day windows (inclusive of today)', () => {
    expect(presetRange('last_7_days', NOW)).toEqual(['2026-08-13', '2026-08-19']);
    expect(presetRange('last_30_days', NOW)).toEqual(['2026-07-21', '2026-08-19']);
    expect(presetRange('last_90_days', NOW)).toEqual(['2026-05-22', '2026-08-19']);
  });

  it('covers last 12 months and previous calendar periods', () => {
    expect(presetRange('last_12_months', NOW)).toEqual(['2025-08-20', '2026-08-19']);
    expect(presetRange('prev_month', NOW)).toEqual(['2026-07-01', '2026-07-31']);
    expect(presetRange('prev_quarter', NOW)).toEqual(['2026-04-01', '2026-06-30']);
    expect(presetRange('prev_year', NOW)).toEqual(['2025-01-01', '2025-12-31']);
  });

  it('handles year boundaries (prev_month/prev_quarter in January)', () => {
    const jan = new Date(2026, 0, 10);
    expect(presetRange('prev_month', jan)).toEqual(['2025-12-01', '2025-12-31']);
    expect(presetRange('prev_quarter', jan)).toEqual(['2025-10-01', '2025-12-31']);
  });

  it('returns null for unknown presets', () => {
    expect(presetRange('nope', NOW)).toBeNull();
  });

  it('every declared preset resolves to an ordered pair', () => {
    for (const { key } of TIME_PRESETS) {
      const r = presetRange(key, NOW);
      expect(r, key).toHaveLength(2);
      expect(r[0] <= r[1], key).toBe(true);
    }
  });
});

describe('comparableRange', () => {
  it('year-shifts calendar presets (YoY)', () => {
    expect(comparableRange('ytd', NOW)).toEqual(['2025-01-01', '2025-08-19']);
    expect(comparableRange('qtd', NOW)).toEqual(['2025-07-01', '2025-08-19']);
    expect(comparableRange('prev_year', NOW)).toEqual(['2024-01-01', '2024-12-31']);
  });

  it('uses the immediately preceding window for rolling day presets', () => {
    expect(comparableRange('last_7_days', NOW)).toEqual(['2026-08-06', '2026-08-12']);
    expect(comparableRange('last_30_days', NOW)).toEqual(['2026-06-21', '2026-07-20']);
  });

  it('last_12_months compares to the 12 months before the window', () => {
    // Window is 2025-08-20 → 2026-08-19; comparable ends the day before it starts.
    expect(comparableRange('last_12_months', NOW)).toEqual(['2024-08-20', '2025-08-19']);
  });

  it('clamps Feb 29 when year-shifting from a leap year', () => {
    const leap = new Date(2028, 1, 29); // 2028-02-29, YTD to-date
    expect(comparableRange('ytd', leap)).toEqual(['2027-01-01', '2027-02-28']);
  });
});

describe('timePeriodOf / timePeriodFilter', () => {
  it('validates the binding shape', () => {
    expect(timePeriodOf(null)).toBeNull();
    expect(timePeriodOf({})).toBeNull();
    expect(timePeriodOf({ timePeriod: { dim: 'd.Date' } })).toBeNull(); // preset pending
    expect(timePeriodOf({ timePeriod: { dim: null, preset: 'ytd' } })).toBeNull();
    expect(timePeriodOf({ timePeriod: { dim: 'd.Date', preset: 'bogus' } })).toBeNull();
    expect(timePeriodOf({ timePeriod: { dim: 'd.Date', preset: 'ytd' } }))
      .toEqual({ dim: 'd.Date', preset: 'ytd' });
  });

  it('emits a between rule carrying the pair under value AND values', () => {
    const f = timePeriodFilter({ timePeriod: { dim: 'd.Date', preset: 'mtd' } }, NOW);
    expect(f.field).toBe('d.Date');
    expect(f.op).toBe('between');
    expect(f.value).toEqual(['2026-08-01', '2026-08-19']);
    expect(f.values).toEqual(f.value);
    expect(f._timePeriod).toBe(true);
  });
});

describe('time-variant helpers', () => {
  const MODEL = {
    dateColumn: 'd.Date',
    dimensions: [
      { name: 'd.Date', table: 'd', column: 'Date', type: 'date' },
      { name: 'd.Other', table: 'd', column: 'Other', type: 'date' },
      { name: 'd.Country', table: 'd', column: 'Country', type: 'string' },
    ],
    measures: [{ name: 'd.Sales_sum', label: 'Sales sum' }],
  };

  it('parses and builds variant names round-trip', async () => {
    const { parseTimeVariant, makeTimeVariant } = await import('./timeIntelligence');
    expect(parseTimeVariant(makeTimeVariant('d.Sales_sum', 'ytd')))
      .toEqual({ base: 'd.Sales_sum', preset: 'ytd' });
    expect(parseTimeVariant('d.Sales_sum')).toBeNull();
    expect(parseTimeVariant('d.Sales_sum@@tp:bogus')).toBeNull();
  });

  it('variantDateDim prefers the model date column, falls back to a sole date dim', async () => {
    const { variantDateDim } = await import('./timeIntelligence');
    expect(variantDateDim(MODEL)).toBe('d.Date');
    const noCol = { ...MODEL, dateColumn: null };
    expect(variantDateDim(noCol)).toBeNull(); // two date dims, ambiguous
    const sole = { ...noCol, dimensions: MODEL.dimensions.filter((d) => d.name !== 'd.Other') };
    expect(variantDateDim(sole)).toBe('d.Date');
  });

  it('buildTimeVariants resolves windows and drops unservable variants', async () => {
    const { buildTimeVariants, presetRange } = await import('./timeIntelligence');
    const v = 'd.Sales_sum@@tp:mtd';
    const ok = buildTimeVariants(['d.Sales_sum', v], MODEL, NOW);
    expect(ok.names).toEqual(['d.Sales_sum', v]);
    expect(ok.timeVariants[v]).toEqual({
      dim: 'd.Date', range: presetRange('mtd', NOW), label: 'Sales sum (MTD)',
    });
    // No usable date dim -> the variant is dropped, the base survives.
    const dropped = buildTimeVariants(['d.Sales_sum', v], { ...MODEL, dateColumn: null }, NOW);
    expect(dropped.names).toEqual(['d.Sales_sum']);
    expect(dropped.timeVariants).toBeNull();
  });

  it('variantDefsFor synthesizes labelled defs for chips and data building', async () => {
    const { variantDefsFor } = await import('./timeIntelligence');
    const defs = variantDefsFor(['d.Sales_sum@@tp:last_30_days', 'd.Sales_sum'], MODEL.measures);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('d.Sales_sum@@tp:last_30_days');
    expect(defs[0].label).toBe('Sales sum (30d)');
    expect(defs[0]._timeVariant).toBe(true);
  });
});
