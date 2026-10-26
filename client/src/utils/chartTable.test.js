import { describe, test, expect } from 'vitest';
import { chartTable } from './chartTable';

// What the chart draws, as a table: added series included (Jonathan: the
// Table view lost what the answer added to the chart).
describe('chartTable', () => {
  test('a line with its year before: both series, in their formats, gaps left empty', () => {
    const t = chartTable({
      labels: ['2025-01', '2025-02'], _dimLabel: 'Month',
      series: [{ name: 'Sales', values: [1200, 900] }, { name: 'Sales N-1', values: [1000, null] }],
      _measureFormats: { Sales: { decimals: 0, thousandSep: '' }, 'Sales N-1': { decimals: 0, thousandSep: '' } },
    });
    expect(t.columns.map((c) => c.label)).toEqual(['Month', 'Sales', 'Sales N-1']);
    expect(t.rows).toEqual([['2025-01', '1200', '1000'], ['2025-02', '900', '']]);
  });

  test('a combo: its bars, then its lines', () => {
    const t = chartTable({ labels: ['A'], _dimLabel: 'Region', barSeries: [{ name: 'Change', values: [5] }], lineSeries: [{ name: 'Sales', values: [10] }] });
    expect(t.columns.map((c) => c.label)).toEqual(['Region', 'Change', 'Sales']);
  });

  test('slices, a heatmap and a scatter read too; an unknown shape does not', () => {
    expect(chartTable({ items: [{ name: 'A', value: 3 }], _dimLabel: 'Cat', _measureLabel: 'N' }).rows).toEqual([['A', '3']]);
    expect(chartTable({ xLabels: ['01', '02'], yLabels: ['FR'], cells: [[0, 0, 4], [1, 0, 6]] }).rows).toEqual([['FR', '4', '6']]);
    expect(chartTable({ points: [{ x: 1, y: 2, label: 'Lyon' }], _dimLabel: 'Hotel', _xLabel: 'ADR', _yLabel: 'Occ' }).columns.map((c) => c.label)).toEqual(['Hotel', 'ADR', 'Occ']);
    expect(chartTable({ value: 3 })).toBeNull();
  });
});

test('the name the answer gave the axis field heads the first column ("Month" in a French answer)', () => {
  expect(chartTable({ labels: ['2025-01'], _dimLabel: 'Month', barSeries: [{ name: 'CA', values: [1] }] }, 'Mois').columns[0].label).toBe('Mois');
});
