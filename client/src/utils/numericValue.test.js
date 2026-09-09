import { describe, test, expect } from 'vitest';
import { toNumber } from './numericValue';

describe('toNumber', () => {
  test('a number passes through, including zero and negatives', () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-3.5)).toBe(-3.5);
  });

  test('the plain forms a driver hands back', () => {
    expect(toNumber('1234.56')).toBe(1234.56);
    expect(toNumber('-42')).toBe(-42);
    expect(toNumber('.5')).toBe(0.5);
    expect(toNumber('1e3')).toBe(1000);
  });

  test('thousands spaces and a decimal comma are still a number', () => {
    expect(toNumber('1 234,56')).toBe(1234.56);
    expect(toNumber('1 234')).toBe(1234);
  });

  test('both conventions for writing the same number', () => {
    // A dot alongside the comma means the comma separates thousands.
    expect(toNumber('1,234.56')).toBe(1234.56);
    // Alone, it is the decimal point.
    expect(toNumber('1234,56')).toBe(1234.56);
  });

  test('a formatted duration is text, not the digits inside it', () => {
    // Two ways this went wrong: extracting every digit made it 80217 on the
    // scorecard, and parseFloat took the leading ones for the whole value,
    // so the table showed 164 — right-aligned, as a number.
    expect(toNumber('164j 08:02:17')).toBeNaN();
    expect(toNumber('00j 00:00:00')).toBeNaN();
  });

  test('a value that merely starts with digits is text', () => {
    expect(toNumber('12h30')).toBeNaN();
    expect(toNumber('2026-01-05')).toBeNaN();
  });

  test('anything else is text', () => {
    expect(toNumber('N/A')).toBeNaN();
    expect(toNumber('A12')).toBeNaN();
    expect(toNumber('12 %')).toBeNaN();
    expect(toNumber('')).toBeNaN();
    expect(toNumber(null)).toBeNaN();
    expect(toNumber(undefined)).toBeNaN();
  });
});
