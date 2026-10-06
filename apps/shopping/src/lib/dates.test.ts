import { describe, expect, it } from 'vitest';
import { fullDateLabel, monthLabel, nextSaturday, quickDays, relativeDay, shortDateLabel, toIsoDate, weekdayShort } from './dates';

// Thursday 1 October 2026, late in the evening so a UTC conversion would land on the next day.
const thursday = new Date(2026, 9, 1, 23, 30);

describe('dates', () => {
  it('formats the local day, not the UTC one', () => {
    expect(toIsoDate(thursday)).toBe('2026-10-01');
  });

  it('labels today, tomorrow and yesterday', () => {
    expect(relativeDay('2026-10-01', thursday)).toBe('Oggi');
    expect(relativeDay('2026-10-02', thursday)).toBe('Domani');
    expect(relativeDay('2026-09-30', thursday)).toBe('Ieri');
    expect(relativeDay('2026-10-03', thursday)).toBeNull();
  });

  it('writes the other days in full', () => {
    expect(shortDateLabel('2026-10-03', thursday)).toBe('Sabato 3 ottobre');
    expect(fullDateLabel('2026-10-01', thursday)).toBe('Oggi, giovedì 1 ottobre');
    expect(weekdayShort('2026-10-03')).toBe('sab');
  });

  it('adds the year to the month only outside the current year', () => {
    expect(monthLabel('2026-10-03', thursday)).toBe('ottobre');
    expect(monthLabel('2027-01-02', thursday)).toBe('gennaio 2027');
  });

  it('finds next Saturday, a week away on a Saturday', () => {
    expect(toIsoDate(nextSaturday(thursday))).toBe('2026-10-03');
    expect(toIsoDate(nextSaturday(new Date(2026, 9, 3)))).toBe('2026-10-10');
  });

  it('offers Oggi, Domani and Sabato without duplicate days', () => {
    expect(quickDays(thursday).map((day) => day.label)).toEqual(['Oggi', 'Domani', 'Sabato']);
    // On Friday, tomorrow is Saturday.
    expect(quickDays(new Date(2026, 9, 2))).toEqual([
      { label: 'Oggi', date: '2026-10-02' },
      { label: 'Domani', date: '2026-10-03' },
    ]);
  });
});
