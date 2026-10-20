import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import formatNumber, { abbreviateNumber, formatPlain, formatShare } from './formatNumber';

// The separators are the reader's: the language of the browser that opens the
// report decides them, whatever the format says.
const as = (language) => vi.stubGlobal('navigator', { language });
afterEach(() => vi.unstubAllGlobals());
const NB = ' ';

describe('formatNumber', () => {
  test('the separators follow the language the report is opened in', () => {
    // "92.48" on a French report: the decimal separator was the format's,
    // and every visual that skipped the format kept the point.
    as('fr-FR');
    expect(formatNumber(1234.56, { decimals: 2, thousandSep: ',', decimalSep: '.' })).toBe(`1${NB}234,56`);
    as('en-US');
    expect(formatNumber(1234.56, { decimals: 2, thousandSep: ' ', decimalSep: ',' })).toBe('1,234.56');
    as('de-DE');
    expect(formatNumber(1234.56, { decimals: 2 })).toBe('1.234,56');
  });

  test('a format without grouping keeps none', () => {
    as('fr-FR');
    expect(formatNumber(2025, { decimals: 0, thousandSep: '' })).toBe('2025');
  });

  test('percentages and abbreviations too', () => {
    as('fr-FR');
    expect(formatPlain(12.345, 1)).toBe('12,3');
    expect(formatShare(12.5)).toBe('12,5');
    expect(formatShare(20)).toBe('20');
    expect(abbreviateNumber(1500, 'auto')).toBe('1,5K');
  });

  test('prefix and suffix wrap the formatted number', () => {
    as('en-US');
    expect(formatNumber(1234.5, { decimals: 1, prefix: '€', suffix: ' HT' })).toBe('€1,234.5 HT');
  });

  test('no decimals means no separator at all', () => {
    as('en-US');
    expect(formatNumber(1234, { decimals: 0 })).toBe('1,234');
  });

  test('null and NaN do not render as numbers', () => {
    expect(formatNumber(null, { decimals: 2 })).toBe('');
    expect(formatNumber(NaN, { decimals: 2 })).toBe('NaN');
  });
});

describe('abbreviateNumber', () => {
  beforeEach(() => as('en-US'));
  test('auto picks the unit from the magnitude', () => {
    expect(abbreviateNumber(1500, 'auto')).toBe('1.5K');
    expect(abbreviateNumber(2_500_000, 'auto')).toBe('2.5M');
    expect(abbreviateNumber(3_200_000_000, 'auto')).toBe('3.2B');
  });

  test('a forced unit is used whatever the magnitude', () => {
    expect(abbreviateNumber(1_500_000, 'K')).toBe('1500.0K');
  });

  test('no abbreviation returns null so the caller can format in full', () => {
    expect(abbreviateNumber(1500, 'none')).toBeNull();
    expect(abbreviateNumber(null, 'auto')).toBeNull();
    expect(abbreviateNumber(NaN, 'auto')).toBeNull();
  });

  // A measure's prefix and suffix are what the number means. Abbreviating used
  // to drop them, so switching a chart to "thousands" unlabelled every figure.
  test('the measure prefix and suffix survive the abbreviation', () => {
    expect(abbreviateNumber(1500, 'auto', { prefix: '€' })).toBe('€1.5K');
    expect(abbreviateNumber(2_500_000, 'auto', { suffix: ' kWh' })).toBe('2.5M kWh');
    expect(abbreviateNumber(1500, 'auto', { prefix: '€', suffix: ' HT' })).toBe('€1.5K HT');
  });

  test('a format without prefix or suffix changes nothing', () => {
    expect(abbreviateNumber(1500, 'auto', { decimals: 2 })).toBe('1.5K');
    expect(abbreviateNumber(1500, 'auto', {})).toBe('1.5K');
  });

  test('a format cannot resurrect a value that should not be abbreviated', () => {
    expect(abbreviateNumber(1500, 'none', { prefix: '€' })).toBeNull();
  });
});

describe('a text value', () => {
  // The pivot table hands whatever a measure returned straight to formatNumber
  // when the measure carries a format. A measure is free to return text — a
  // formatted duration, a label — and it has to come back out untouched rather
  // than be run through the decimal machinery.
  test('comes back as it went in, format or not', () => {
    expect(formatNumber('164j 08:02:17', { decimals: 2, prefix: '€' })).toBe('164j 08:02:17');
    expect(formatNumber('N/A', { decimals: 0 })).toBe('N/A');
  });
});
