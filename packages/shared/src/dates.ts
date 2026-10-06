// Days are local calendar days stored as "YYYY-MM-DD" text, never Date objects in UTC.

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
