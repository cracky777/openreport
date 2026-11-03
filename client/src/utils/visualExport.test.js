import { describe, it, expect } from 'vitest';
import { sheetOf, toCsv, fileNameOf } from './visualExport';

describe('visualExport', () => {
  it('exports what a combo draws, bars then lines, as raw numbers', () => {
    const data = { labels: ['Jan', 'Feb'], _dimLabel: 'Month', barSeries: [{ name: 'Sales', values: [1200.5, null] }], lineSeries: [{ name: 'Target', values: [1000, 1100] }] };
    expect(sheetOf(data)).toEqual([['Month', 'Sales', 'Target'], ['Jan', 1200.5, 1000], ['Feb', null, 1100]]);
    expect(sheetOf(data, 'Mois')[0][0]).toBe('Mois');
  });
  it('exports a scorecard with its year before, and nothing for an empty shape', () => {
    expect(sheetOf({ _numValue: 42, _n1Value: 40, _measureLabel: 'Calls' })).toEqual([['Calls', 'Calls N-1'], [42, 40]]);
    expect(sheetOf({})).toBeNull();
  });
  it('drops the pivot atoms behind average totals', () => {
    const data = { rawRows: [{ Region: 'N', Avg: 2, s: 4, c: 2 }], _totalComponents: { Avg: { sum: 's', count: 'c' } } };
    expect(sheetOf(data)).toEqual([['Region', 'Avg'], ['N', 2]]);
  });
  it('quotes CSV cells and names files from titles', () => {
    expect(toCsv([['a,b', 'say "hi"'], [1, null]])).toBe(String.fromCharCode(0xfeff) + '"a,b","say ""hi"""\r\n1,\r\n');
    expect(fileNameOf('Sales / region: 2025')).toBe('Sales region 2025');
    expect(fileNameOf('')).toBe('visual');
  });
});
