import { describe, it, expect } from 'vitest';
import { chartN1Applies, mergeN1Rows, comparedSeries, comboN1 } from './chartN1';

const month = { label: 'Mois', def: { name: 'cal.mois', type: 'string' } };
const ym = { label: 'Month', def: { name: 'cal.ym', type: 'string', datePart: 'year_month' } };
const year = { label: 'Year', def: { name: 'cal.y', type: 'integer', datePart: 'num_year' } };
const region = { label: 'Region', def: { name: 'r', type: 'string' } };

describe('chartN1Applies', () => {
  it('a line or a bar with a comparison date, without a legend', () => {
    expect(chartN1Applies({ type: 'line', dataBinding: { compareDateDim: 'cal.date' } })).toBe(true);
    expect(chartN1Applies({ type: 'bar', dataBinding: { compareDateDim: 'cal.date' } })).toBe(true);
    expect(chartN1Applies({ type: 'line', dataBinding: { compareDateDim: 'cal.date', groupBy: ['r'] } })).toBe(false);
    expect(chartN1Applies({ type: 'line', dataBinding: {} })).toBe(false);
    expect(chartN1Applies({ type: 'combo', dataBinding: { compareDateDim: 'cal.date' } })).toBe(true);
    expect(chartN1Applies({ type: 'scorecard', dataBinding: { compareDateDim: 'cal.date' } })).toBe(false);
  });
});

describe('mergeN1Rows', () => {
  it('lands each month of the year before beside the same month, on a "YYYY-MM" text axis', () => {
    const rows = [{ Mois: '2025-01', Sales: 10 }, { Mois: '2025-02', Sales: 12 }];
    const n1 = [{ Mois: '2024-01', Sales: 7 }, { Mois: '2024-02', Sales: 9 }];
    expect(mergeN1Rows(rows, n1, [month], ['Sales'])).toEqual([
      { Mois: '2025-01', Sales: 10, 'Sales N-1': 7 },
      { Mois: '2025-02', Sales: 12, 'Sales N-1': 9 },
    ]);
  });

  it('on a year_month part, a year, a full date', () => {
    expect(mergeN1Rows([{ Month: '2025-03', S: 1 }], [{ Month: '2024-03', S: 2 }], [ym], ['S'])[0]['S N-1']).toBe(2);
    expect(mergeN1Rows([{ Year: 2025, S: 1 }], [{ Year: 2024, S: 2 }], [year], ['S'])[0]['S N-1']).toBe(2);
    const day = { label: 'Day', def: { name: 'd', type: 'date' } };
    expect(mergeN1Rows([{ Day: '2025-02-28', S: 1 }], [{ Day: '2024-02-28', S: 2 }], [day], ['S'])[0]['S N-1']).toBe(2);
  });

  it('a category axis is joined as it is: the regions of this year beside last year\'s', () => {
    const out = mergeN1Rows([{ Region: 'Nord', S: 5 }, { Region: 'Sud', S: 3 }], [{ Region: 'Nord', S: 4 }], [region], ['S']);
    expect(out.map((r) => r['S N-1'])).toEqual([4, null]);
  });

  it('a month the year before did not have is empty, never another month\'s value', () => {
    const out = mergeN1Rows([{ Mois: '2025-01', S: 1 }, { Mois: '2025-02', S: 1 }], [{ Mois: '2024-02', S: 9 }], [month], ['S']);
    expect(out.map((r) => r['S N-1'])).toEqual([null, 9]);
  });
});

describe('comparedSeries', () => {
  const merged = [{ Mois: '2025-01', Sales: 120, 'Sales N-1': 100 }, { Mois: '2025-02', Sales: 90, 'Sales N-1': null }];
  const sales = [{ name: 's', label: 'Sales', format: { decimals: 0 } }];

  it('series: the measure and its year before, drawn side by side', () => {
    const { rows, series } = comparedSeries(merged, sales);
    expect(rows).toBe(merged);
    expect(series.map((s) => s.label)).toEqual(['Sales', 'Sales N-1']);
    expect(series[1]._n1Of).toBe('Sales');
  });

  it('difference and change: one column per measure, empty where the year before has nothing', () => {
    const diff = comparedSeries(merged, sales, 'difference');
    expect(diff.rows).toEqual([{ Mois: '2025-01', 'Sales vs N-1': 20 }, { Mois: '2025-02', 'Sales vs N-1': null }]);
    const change = comparedSeries(merged, sales, 'change');
    expect(change.rows[0]['Sales % vs N-1']).toBe(20);
    expect(change.series[0].format.suffix).toBe(' %');
  });
});

describe('comboN1', () => {
  const merged = [{ Mois: '2025-01', Sales: 120, 'Sales N-1': 100 }, { Mois: '2025-02', Sales: 90, 'Sales N-1': null }];
  const sales = [{ name: 's', label: 'Sales' }];

  it('the lines keep the year and its N-1, the bars become the change; nothing removed', () => {
    const { rows, bars, lines } = comboN1(merged, sales, sales, 'change');
    expect(lines.map((m) => m.label)).toEqual(['Sales', 'Sales N-1']);
    expect(lines[1]._n1Of).toBe('Sales');
    expect(bars.map((m) => m.label)).toEqual(['Sales % vs N-1']);
    expect(rows[0]).toMatchObject({ Sales: 120, 'Sales N-1': 100, 'Sales % vs N-1': 20 });
    expect(rows[1]['Sales % vs N-1']).toBeNull();
  });

  it('series: both sides get their year before', () => {
    const { bars, lines } = comboN1(merged, sales, [], 'series');
    expect(bars.map((m) => m.label)).toEqual(['Sales', 'Sales N-1']);
    expect(lines).toEqual([]);
  });
});

describe('a rate against the year before', () => {
  it('moves by points in difference mode', () => {
    const rate = [{ name: 'r', label: 'Rate', format: { decimals: 1, suffix: ' %' } }];
    const { series } = comparedSeries([{ Mois: '2025-01', Rate: 80, 'Rate N-1': 90 }], rate, 'difference');
    expect(series[0].format.suffix).toBe(' pts');
  });
});
