import type { User } from '@household/shared/pb';
import type { MonthData } from './types';

// The months Conti showed, so it opens without network in read only mode.
const PREFIX = 'cash:';
const LAST_MONTH_KEY = `${PREFIX}last-month`;
const monthKey = (month: string) => `${PREFIX}month:${month}`;
const USERS_KEY = `${PREFIX}users`;

export function saveMonthCache(data: MonthData) {
  try {
    localStorage.setItem(monthKey(data.summary.month), JSON.stringify(data));
    localStorage.setItem(LAST_MONTH_KEY, data.summary.month);
  } catch {
    // Without storage the app still works online.
  }
}

// The data of month, or of the last month shown when month is absent.
export function restoreMonthCache(month?: string): MonthData | null {
  try {
    const wanted = month ?? localStorage.getItem(LAST_MONTH_KEY);
    return wanted ? JSON.parse(localStorage.getItem(monthKey(wanted)) ?? 'null') : null;
  } catch {
    return null;
  }
}

// Names and colours of the two people, for the panel and the movements offline.
export function saveUsers(users: User[]) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch {
    // Without storage the app still works online.
  }
}

export function restoreUsers(): User[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

// After a sign-out, here or in the Spesa, nothing of the account stays on the phone.
export function clearMonthCache() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '');
    keys.filter((key) => key.startsWith(PREFIX)).forEach((key) => localStorage.removeItem(key));
  } catch {
    // Nothing stored.
  }
}
