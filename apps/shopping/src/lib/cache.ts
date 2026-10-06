import type { Item, List, User } from './pb';
import { items, lists, session } from './stores';

// The last state read for each view, so the app opens offline in read only mode.

const HOME_KEY = 'spesa:cache:home';
const LISTS_KEY = 'spesa:cache:lists';
const MAX_CACHED_LISTS = 10;

interface Snapshot {
  savedAt: number;
  users: User[];
  lists: List[];
  items: Item[];
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked storage only costs the offline copy.
  }
}

function snapshot(listIds: Set<string> | null): Snapshot {
  return {
    savedAt: Date.now(),
    users: Object.values(session().users),
    lists: lists().all.filter((list) => !listIds || listIds.has(list.id)),
    items: items().all.filter((item) => !listIds || listIds.has(item.list)),
  };
}

function restore(cached: Snapshot | null | undefined): boolean {
  if (!cached) return false;
  session().users = Object.fromEntries(cached.users.map((user) => [user.id, user]));
  lists().replaceAll(cached.lists);
  items().replaceAll(cached.items);
  return true;
}

export function saveHome() {
  write(HOME_KEY, snapshot(null));
}

export function restoreHome(): boolean {
  return restore(read<Snapshot>(HOME_KEY));
}

// Keeps the most recently saved lists only.
export function saveList(listId: string) {
  const cached = read<Record<string, Snapshot>>(LISTS_KEY) ?? {};
  cached[listId] = snapshot(new Set([listId]));
  const recent = Object.entries(cached)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_CACHED_LISTS);
  write(LISTS_KEY, Object.fromEntries(recent));
}

export function restoreList(listId: string): boolean {
  return restore(read<Record<string, Snapshot>>(LISTS_KEY)?.[listId]);
}

export function clearCache() {
  try {
    localStorage.removeItem(HOME_KEY);
    localStorage.removeItem(LISTS_KEY);
  } catch {
    // Nothing to clear without storage.
  }
}
