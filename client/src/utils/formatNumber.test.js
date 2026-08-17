import { describe, test, expect } from 'vitest';
import formatNumber, { abbreviateNumber } from './formatNumber';

describe('formatNumber', () => {
  test('the decimal separator follows the format, not a hardcoded point', () => {
    // The bug this guards: the thousands separator was configurable and the
    // decimal one was always '.', so a report on the French convention read
    // "1 234.56" — two number conventions in one widget.
    expect(formatNumber(1234.56, { decimals: 2, thousandSep: ' ', decimalSep: ',' })).toBe('1 234,56');
    expect(formatNumber(1234.56, { decimals: 2, thousandSep: '.', decimalSep: ',' })).toBe('1.234,56');
    expect(formatNumber(1234.56, { decimals: 2, thousandSep: ',', decimalSep: '.' })).toBe('1,234.56');
  });

  test('the default stays the point, so reports already written do not move', () => {
    expect(formatNumber(1234.56, { decimals: 2 })).toBe('1 234.56');
  });

  test('prefix and suffix wrap the formatted number', () => {
    expect(formatNumber(1234.5, { decimals: 1, prefix: '€', suffix: ' HT' })).toBe('€1 234.5 HT');
  });

  test('no decimals means no separator at all', () => {
    expect(formatNumber(1234, { decimals: 0, decimalSep: ',' })).toBe('1 234');
  });

  test('null and NaN do not render as numbers', () => {
    expect(formatNumber(null, { decimals: 2 })).toBe('');
    expect(formatNumber(NaN, { decimals: 2 })).toBe('NaN');
  });
});

describe('abbreviateNumber', () => {
  test('auto picks the unit from the magnitude', () => {
    expect(abbreviateNumber(1500, 'auto')).toBe('1.5K');
    expect(abbreviateNumber(2_500_000, 'auto')).toBe('2.5M');
    expect(abbreviateNumber(3_200_000_000, 'auto')).toBe('3.2B');
  });

  test('a forced unit is used whatever the magnitude', () => {
    expect(abbreviateNumber(1_500_000, 'K')).toBe('1500.0K');
  });
});
