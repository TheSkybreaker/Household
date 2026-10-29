import { addDays, fromIsoDate, relativeDay, timestamp, toIsoDate, weekdayLong } from './dates';
import type { Item, List } from './pb';

export const SUGGESTIONS = [
  'Latte', 'Pane', 'Uova', 'Acqua', 'Frutta', 'Caffè', 'Pasta', 'Insalata', 'Burro', 'Carta igienica', 'Pomodori', 'Yogurt',
];
const MAX_SUGGESTIONS = 7;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Older lists leave the home page; they stay in the database.
const VISIBLE_DAYS = 30;
const oldestVisible = (now: Date) => toIsoDate(addDays(now, -VISIBLE_DAYS));

// In programma: from today on, nearest first. Passate: the last 30 days, most recent first.
export function splitLists(lists: List[], now = new Date()): { upcoming: List[]; past: List[] } {
  const today = toIsoDate(now);
  const oldest = oldestVisible(now);
  const upcoming = lists
    .filter((list) => list.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || timestamp(a.created) - timestamp(b.created));
  const past = lists.filter((list) => list.date < today && list.date >= oldest).sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, past };
}

// What a new list can take over: the items still to buy on the latest list up to today, in their
// order. Only that list counts, so leftovers of an older one are not offered.
export function carryOver(lists: List[], items: Item[], now = new Date()): { list: List; items: Item[] } | null {
  const today = toIsoDate(now);
  const oldest = oldestVisible(now);
  const [latest] = lists
    .filter((list) => list.date <= today && list.date >= oldest)
    .sort((a, b) => b.date.localeCompare(a.date) || timestamp(b.created) - timestamp(a.created));
  if (!latest) return null;
  const { toBuy } = splitItems(items.filter((item) => item.list === latest.id));
  return toBuy.length ? { list: latest, items: toBuy } : null;
}

// "Porta le 3 cose non prese di sabato 24", with "di oggi" and "di ieri" for the nearest days.
export function carryOverLabel(count: number, isoDate: string, now = new Date()): string {
  const relative = relativeDay(isoDate, now);
  const day = relative ? relative.toLowerCase() : `${weekdayLong(isoDate)} ${fromIsoDate(isoDate).getDate()}`;
  return count === 1 ? `Porta la cosa non presa di ${day}` : `Porta le ${count} cose non prese di ${day}`;
}

// Da prendere in the order they were added, an item put back from the cart last; Nel carrello by
// last checked first.
export function splitItems(items: Item[]): { toBuy: Item[]; inCart: Item[] } {
  const addedAt = (item: Item) => timestamp(item.added_at || item.created);
  const toBuy = items.filter((item) => !item.checked).sort((a, b) => addedAt(a) - addedAt(b));
  const inCart = items.filter((item) => item.checked).sort((a, b) => timestamp(b.checked_at) - timestamp(a.checked_at));
  return { toBuy, inCart };
}

export interface ListProgress {
  total: number;
  toBuy: number;
  inCart: number;
  percent: number;
}

export function listProgress(items: Item[]): ListProgress {
  const inCart = items.filter((item) => item.checked).length;
  return {
    total: items.length,
    toBuy: items.length - inCart,
    inCart,
    percent: items.length ? Math.round((inCart / items.length) * 100) : 0,
  };
}

// Status on a home row: "3 da prendere", "Fatto" or "Vuota".
export function rowStatus(progress: ListProgress): string {
  if (!progress.total) return 'Vuota';
  return progress.toBuy ? `${progress.toBuy} da prendere` : 'Fatto';
}

// Progress line on the list panel.
export function progressLabel(progress: ListProgress): string {
  if (!progress.total) return 'Ancora vuota';
  return progress.toBuy ? `${progress.toBuy} da prendere, ${progress.inCart} nel carrello` : 'Tutto nel carrello';
}

// The line under the greeting on the home page.
export function homeSummary(upcoming: List[], items: Item[]): string {
  if (!upcoming.length) return 'Nessuna spesa in programma.';
  const upcomingIds = new Set(upcoming.map((list) => list.id));
  const toBuy = items.filter((item) => upcomingIds.has(item.list) && !item.checked).length;
  if (!toBuy) return 'Avete preso tutto, per ora.';
  return `${plural(toBuy, 'cosa', 'cose')} da prendere in ${plural(upcoming.length, 'lista', 'liste')}`;
}

// Who added items to a list, the current user first.
export function contributors(items: Item[], meId: string): string[] {
  return [...new Set(items.map((item) => item.added_by))].sort((a, b) => Number(b === meId) - Number(a === meId));
}

export function suggestions(toBuy: Item[]): string[] {
  const wanted = new Set(toBuy.map((item) => item.name.toLowerCase()));
  return SUGGESTIONS.filter((name) => !wanted.has(name.toLowerCase())).slice(0, MAX_SUGGESTIONS);
}

export function findByName(items: Item[], name: string): Item | undefined {
  const wanted = name.toLowerCase();
  return items.find((item) => item.name.toLowerCase() === wanted);
}

// "1 cosa tolta", "3 cose tolte"
export function removedLabel(count: number): string {
  return count === 1 ? '1 cosa tolta' : `${count} cose tolte`;
}
