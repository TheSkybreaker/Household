import type { RecordSubscription } from 'pocketbase';
import { pb, type Item, type List, type User } from './pb';
import { items, lists, session, type RecordStore } from './stores';

const HOME_DEBOUNCE_MS = 300;

// API reads and realtime events only write to the stores; the pages read from there.

export async function loadUsers() {
  const users = await pb.collection('users').getFullList<User>();
  session().users = Object.fromEntries(users.map((user) => [user.id, user]));
}

export async function loadHome() {
  const [allLists, allItems] = await Promise.all([
    pb.collection('lists').getFullList<List>(),
    pb.collection('items').getFullList<Item>(),
  ]);
  lists().replaceAll(allLists);
  items().replaceAll(allItems);
}

// Resolves to false when the list does not exist (anymore).
export async function loadList(listId: string): Promise<boolean> {
  try {
    const [list, listItems] = await Promise.all([
      pb.collection('lists').getOne<List>(listId),
      pb.collection('items').getFullList<Item>({ filter: pb.filter('list = {:listId}', { listId }) }),
    ]);
    lists().replaceAll([list]);
    items().replaceAll(listItems);
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return false;
    throw error;
  }
}

const reconnectListeners: Array<() => void> = [];

// Events sent while the connection was down are lost, so a view reloads after a reconnect.
export function onReconnect(listener: () => void) {
  reconnectListeners.push(listener);
}

export function trackConnection() {
  let connectedBefore = false;
  void pb.realtime.subscribe('PB_CONNECT', () => {
    if (connectedBefore) reconnectListeners.forEach((listener) => listener());
    connectedBefore = true;
  });
}

// Upsert by id, so the echo of the user's own change never creates a duplicate.
function apply<T extends { id: string }>(store: RecordStore<T>, event: RecordSubscription<T>) {
  if (event.action === 'delete') store.remove(event.record.id);
  else store.upsert(event.record);
}

// Items the other person adds, or puts back from the cart in their name, flash yellow.
function applyItem(event: RecordSubscription<Item>, highlight: boolean) {
  const before = items().byId[event.record.id];
  apply(items(), event);

  const added =
    event.action === 'create' || (event.action === 'update' && before !== undefined && before.added_by !== event.record.added_by);
  if (highlight && added && event.record.added_by !== session().me?.id) items().markFresh(event.record.id);
}

export function subscribeHome() {
  let queue: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (change: () => void) => {
    queue.push(change);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changes = queue;
      queue = [];
      changes.forEach((run) => run());
    }, HOME_DEBOUNCE_MS);
  };

  void pb.collection('lists').subscribe<List>('*', (event) => later(() => apply(lists(), event)));
  void pb.collection('items').subscribe<Item>('*', (event) => later(() => applyItem(event, false)));
}

export function subscribeList(listId: string, onListDeleted: () => void) {
  void pb.collection('items').subscribe<Item>('*', (event) => applyItem(event, true), {
    filter: pb.filter('list = {:listId}', { listId }),
  });
  void pb.collection('lists').subscribe<List>(listId, (event) => {
    if (event.action === 'delete') onListDeleted();
    else lists().upsert(event.record);
  });
}
