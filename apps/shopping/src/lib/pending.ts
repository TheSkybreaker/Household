import type { Item, List } from './pb';

// Deletions wait for the undo window of their toast before reaching the API. They live in
// sessionStorage so that deleting a list from its page can still be undone on the home page.

export interface PendingDeletion {
  key: string;
  collection: 'items' | 'lists';
  ids: string[];
  message: string;
  expiresAt: number;
  // What undo puts back in the stores, with no API call.
  restore: { lists: List[]; items: Item[] };
}

const STORAGE_KEY = 'spesa:pending-deletions';

function read(): PendingDeletion[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

let pending = read();

function write() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Without storage the deletion still runs on this page; only the hand-over to the next page is lost.
  }
}

export function pendingDeletions(): PendingDeletion[] {
  return [...pending];
}

export function isPendingDeletion(id: string): boolean {
  return pending.some((entry) => entry.ids.includes(id) || entry.restore.items.some((item) => item.id === id));
}

export function addPendingDeletion(entry: PendingDeletion) {
  pending.push(entry);
  write();
}

export function removePendingDeletion(key: string) {
  pending = pending.filter((entry) => entry.key !== key);
  write();
}
