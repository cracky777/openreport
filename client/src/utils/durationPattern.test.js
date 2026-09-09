import { describe, test, expect } from 'vitest';
import { formatDurationPattern, isDurationFormat } from './durationPattern';

const D = 86400;

describe('formatDurationPattern', () => {
  test('the pattern the DAX measure produced', () => {
    expect(formatDurationPattern(164 * D + 8 * 3600 + 2 * 60 + 17, 'DDj HH:MM:SS'))
      .toBe('164j 08:02:17');
    expect(formatDurationPattern(0, 'DDj HH:MM:SS')).toBe('00j 00:00:00');
    expect(formatDurationPattern(D + 3661, 'DDj HH:MM:SS')).toBe('01j 01:01:01');
  });

  test('padding never truncates the largest unit', () => {
    // A naive pad to two digits would have shown 16 for 164 days.
    expect(formatDurationPattern(164 * D, 'DD')).toBe('164');
    expect(formatDurationPattern(5 * D, 'DD')).toBe('05');
    expect(formatDurationPattern(5 * D, 'D')).toBe('5');
  });

  test('each unit shows only what the larger ones left', () => {
    expect(formatDurationPattern(3 * D + 25 * 60, 'D H M S')).toBe('3 0 25 0');
  });

  test('a bracketed unit carries nothing over', () => {
    expect(formatDurationPattern(2 * D + 3600, '[H]:MM:SS')).toBe('49:00:00');
    expect(formatDurationPattern(90, '[M]')).toBe('1');
    expect(formatDurationPattern(90, '[S]')).toBe('90');
  });

  test('quoted text is literal, tokens or not', () => {
    expect(formatDurationPattern(3661, 'H"h"MM')).toBe('1h01');
    // Without quotes the S of "Sec" would have been read as a token.
    expect(formatDurationPattern(45, 'S" Sec"')).toBe('45 Sec');
  });

  test('a negative duration keeps its sign', () => {
    expect(formatDurationPattern(-3661, 'HH:MM:SS')).toBe('-01:01:01');
  });

  test('a missing or unusable value reads as zero', () => {
    expect(formatDurationPattern(null, 'HH:MM:SS')).toBe('00:00:00');
    expect(formatDurationPattern('abc', 'HH:MM:SS')).toBe('00:00:00');
  });
});

describe('isDurationFormat', () => {
  test('a non-empty pattern turns the measure into a duration', () => {
    expect(isDurationFormat({ duration: 'HH:MM' })).toBe(true);
    expect(isDurationFormat({ duration: '   ' })).toBe(false);
    expect(isDurationFormat({ decimals: 2 })).toBe(false);
    expect(isDurationFormat(undefined)).toBe(false);
  });
});
