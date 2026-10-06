import { describe, expect, it } from 'vitest';
import { addDays, capitalize, fromIsoDate, toIsoDate } from './dates';

describe('dates', () => {
  it('formats the local day, not the UTC one', () => {
    expect(toIsoDate(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });

  it('reads a day back as local midnight', () => {
    const date = fromIsoDate('2026-10-03');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 3, 0]);
  });

  it('adds days across the end of a month', () => {
    expect(toIsoDate(addDays(new Date(2026, 9, 31), 1))).toBe('2026-11-01');
  });

  it('capitalizes only the first letter', () => {
    expect(capitalize('sabato 3 ottobre')).toBe('Sabato 3 ottobre');
  });
});
