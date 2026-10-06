// List dates are local calendar days stored as "YYYY-MM-DD" text, never Date objects in UTC.

const longFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const weekdayShortFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
const weekdayLongFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'long' });
const monthFormat = new Intl.DateTimeFormat('it-IT', { month: 'long' });

const pad = (value: number) => String(value).padStart(2, '0');

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function relativeDay(isoDate: string, now = new Date()): 'Oggi' | 'Domani' | 'Ieri' | null {
  if (isoDate === toIsoDate(now)) return 'Oggi';
  if (isoDate === toIsoDate(addDays(now, 1))) return 'Domani';
  if (isoDate === toIsoDate(addDays(now, -1))) return 'Ieri';
  return null;
}

// "Sabato 3 ottobre"
export function longDate(isoDate: string): string {
  return capitalize(longFormat.format(fromIsoDate(isoDate)));
}

// "Oggi", or "Sabato 3 ottobre" further away.
export function shortDateLabel(isoDate: string, now = new Date()): string {
  return relativeDay(isoDate, now) ?? longDate(isoDate);
}

// "Oggi, sabato 3 ottobre"
export function fullDateLabel(isoDate: string, now = new Date()): string {
  const relative = relativeDay(isoDate, now);
  const long = longFormat.format(fromIsoDate(isoDate));
  return relative ? `${relative}, ${long}` : capitalize(long);
}

// "sab"
export function weekdayShort(isoDate: string): string {
  return weekdayShortFormat.format(fromIsoDate(isoDate)).replace('.', '');
}

export function weekdayLong(isoDate: string): string {
  return weekdayLongFormat.format(fromIsoDate(isoDate));
}

// "ottobre", with the year only when it is not the current one.
export function monthLabel(isoDate: string, now = new Date()): string {
  const date = fromIsoDate(isoDate);
  const month = monthFormat.format(date);
  return date.getFullYear() === now.getFullYear() ? month : `${month} ${date.getFullYear()}`;
}

// The next Saturday after today, a week away when today is Saturday.
export function nextSaturday(now = new Date()): Date {
  return addDays(now, (6 - now.getDay() + 7) % 7 || 7);
}

export interface QuickDay {
  label: string;
  date: string;
}

// The day chips of the new list sheet: Oggi, Domani and Sabato, without duplicate days.
export function quickDays(now = new Date()): QuickDay[] {
  const days: QuickDay[] = [
    { label: 'Oggi', date: toIsoDate(now) },
    { label: 'Domani', date: toIsoDate(addDays(now, 1)) },
  ];
  const saturday = toIsoDate(nextSaturday(now));
  if (!days.some((day) => day.date === saturday)) days.push({ label: 'Sabato', date: saturday });
  return days;
}

// PocketBase returns "2026-10-03 10:00:00.000Z", which not every engine parses with a space.
export function timestamp(dateTime: string): number {
  return dateTime ? Date.parse(dateTime.replace(' ', 'T')) : 0;
}
