import { isNavigating } from './nav';
import { newRecordId, pb, type Item, type List } from './pb';
import { addPendingDeletion, pendingDeletions, removePendingDeletion, type PendingDeletion } from './pending';
import { items, lists, toast } from './stores';

const UNDO_MS = 5000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

// Hides the records now and deletes them when the undo toast expires.
export function scheduleDeletion(collection: PendingDeletion['collection'], records: { lists?: List[]; items?: Item[] }, message: string) {
  const restore = { lists: records.lists ?? [], items: records.items ?? [] };
  const entry: PendingDeletion = {
    key: newRecordId(),
    collection,
    ids: (collection === 'lists' ? restore.lists : restore.items).map((record) => record.id),
    message,
    expiresAt: Date.now() + UNDO_MS,
    restore,
  };

  addPendingDeletion(entry);
  hide(entry);
  arm(entry);
}

// Picks up the deletions started on the previous page.
export function resumeDeletions() {
  for (const entry of pendingDeletions()) {
    hide(entry);
    if (entry.expiresAt <= Date.now()) void commit(entry);
    else arm(entry);
  }
}

function hide(entry: PendingDeletion) {
  entry.restore.lists.forEach((list) => lists().remove(list.id));
  entry.restore.items.forEach((item) => items().remove(item.id));
}

function arm(entry: PendingDeletion) {
  const remaining = entry.expiresAt - Date.now();
  timers.set(entry.key, setTimeout(() => void commit(entry), remaining));
  toast().show(entry.message, { label: 'Annulla', run: () => undo(entry) }, remaining);
}

function undo(entry: PendingDeletion) {
  clearTimeout(timers.get(entry.key));
  removePendingDeletion(entry.key);
  entry.restore.lists.forEach((list) => lists().upsert(list));
  entry.restore.items.forEach((item) => items().upsert(item));
}

async function commit(entry: PendingDeletion, keepalive = false) {
  clearTimeout(timers.get(entry.key));
  removePendingDeletion(entry.key);

  const results = await Promise.allSettled(
    entry.ids.map((id) => pb.collection(entry.collection).delete(id, { keepalive })),
  );
  // 404 means the record is already gone, for example deleted from the other phone.
  const failedIds = new Set(
    entry.ids.filter((_, index) => {
      const result = results[index];
      return result.status === 'rejected' && result.reason?.status !== 404;
    }),
  );
  if (!failedIds.size) return;

  entry.restore.lists.filter((list) => failedIds.has(list.id)).forEach((list) => lists().upsert(list));
  entry.restore.items
    .filter((item) => failedIds.has(entry.collection === 'lists' ? item.list : item.id))
    .forEach((item) => items().upsert(item));
  toast().show('Non salvato, riprova');
}

// Leaving the app ends the undo window: the page may never come back to run the timers.
// keepalive lets the requests outlive the page.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || isNavigating()) return;
  const entries = pendingDeletions();
  if (!entries.length) return;
  toast().hide();
  entries.forEach((entry) => void commit(entry, true));
});
