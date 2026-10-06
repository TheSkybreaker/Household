import { describe, expect, it } from 'vitest';
import { formatEuro, formatEuroRound, parseAmount } from './money';

describe('formatEuro', () => {
  it.each([
    [123450, '1.234,50 €'],
    [5, '0,05 €'],
    [0, '0,00 €'],
    [-1200, '−12,00 €'],
    [123456789, '1.234.567,89 €'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatEuro(cents)).toBe(text);
  });

  it('adds a plus sign only when asked, and only to positive amounts', () => {
    expect(formatEuro(500, { sign: true })).toBe('+5,00 €');
    expect(formatEuro(-500, { sign: true })).toBe('−5,00 €');
    expect(formatEuro(0, { sign: true })).toBe('0,00 €');
  });
});

describe('formatEuroRound', () => {
  it('drops the cents of round amounts only', () => {
    expect(formatEuroRound(105000)).toBe('1.050 €');
    expect(formatEuroRound(-30000)).toBe('−300 €');
    expect(formatEuroRound(1250)).toBe('12,50 €');
  });
});

describe('parseAmount', () => {
  it.each([
    ['12,50', 1250],
    ['12.50', 1250],
    ['1.234,50', 123450],
    ['1234', 123400],
    ['12,5', 1250],
    ['12.5', 1250],
    ['1.234', 123400],
    ['1.234.567,89', 123456789],
    [' 12,50 € ', 1250],
    ['0,05', 5],
  ])('reads "%s" as %i cents', (raw, cents) => {
    expect(parseAmount(raw)).toBe(cents);
  });

  it.each(['', 'abc', '12,345', '1,2,3', '-5', '12.3.4', '1.23,45', ',50', '12,', '1e3'])('refuses "%s"', (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});
