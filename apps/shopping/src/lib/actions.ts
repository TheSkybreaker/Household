import { capitalize } from './dates';
import { scheduleDeletion } from './deletions';
import { findByName, removedLabel, splitItems } from './groups';
import { editChanges, parseEntry } from './parse';
import { newRecordId, pb, type Item, type List, type User } from './pb';
import { items, session, toast } from './stores';

// Writes are optimistic: the stores change first, then the request runs, and a failure puts
// the previous state back.
async function optimistic(apply: () => void, revert: () => void, request: () => Promise<unknown>) {
  apply();
  try {
    await request();
  } catch {
    revert();
    toast().show('Non salvato, riprova');
  }
}

function meId(): string {
  const me = session().me;
  if (!me) throw new Error('No signed-in user');
  return me.id;
}

export type AddOutcome = { kind: 'added' | 'restored' | 'duplicate'; itemId: string };

export function addItem(listId: string, raw: string): AddOutcome | null {
  const entry = parseEntry(raw);
  if (!entry) return null;

  const me = meId();
  const { toBuy, inCart } = splitItems(items().forList(listId));

  const wanted = findByName(toBuy, entry.name);
  if (wanted) {
    toast().show('È già in lista');
    return { kind: 'duplicate', itemId: wanted.id };
  }

  // Already in the cart: it goes back to buy, at the end, in the name of whoever wrote it again.
  const taken = findByName(inCart, entry.name);
  if (taken) {
    const before = { ...taken };
    const changes = {
      checked: false,
      checked_at: '',
      checked_by: '',
      added_by: me,
      added_at: new Date().toISOString(),
      ...(entry.qty ? { qty: entry.qty } : {}),
    };
    void optimistic(
      () => items().upsert({ ...before, ...changes }),
      () => items().upsert(before),
      () => pb.collection('items').update(taken.id, changes),
    );
    toast().show('Rimesso tra le cose da prendere');
    return { kind: 'restored', itemId: taken.id };
  }

  const now = new Date().toISOString();
  const item: Item = {
    id: newRecordId(),
    list: listId,
    name: entry.name,
    qty: entry.qty,
    checked: false,
    checked_at: '',
    added_by: me,
    checked_by: '',
    added_at: now,
    created: now,
    updated: now,
  };
  void optimistic(
    () => items().upsert(item),
    () => items().remove(item.id),
    () =>
      pb.collection('items').create({ id: item.id, list: listId, name: item.name, qty: item.qty, added_by: me, added_at: now }),
  );
  return { kind: 'added', itemId: item.id };
}

export function toggleItem(itemId: string) {
  const current = items().byId[itemId];
  if (!current) return;

  const before = { ...current };
  const checked = !before.checked;
  const changes = {
    checked,
    checked_by: checked ? meId() : '',
    checked_at: checked ? new Date().toISOString() : '',
  };
  void optimistic(
    () => items().upsert({ ...before, ...changes }),
    () => items().upsert(before),
    () => pb.collection('items').update(itemId, changes),
  );
}

// False keeps the edit sheet open: the name is empty or already among the items to buy.
export function editItem(itemId: string, name: string, qty: string): boolean {
  const current = items().byId[itemId];
  if (!current) return true;

  const changes = editChanges(current, name, qty);
  if (!changes) return false;
  if (!Object.keys(changes).length) return true;

  if (changes.name) {
    const others = splitItems(items().forList(current.list)).toBuy.filter((item) => item.id !== itemId);
    if (findByName(others, changes.name)) {
      toast().show('È già in lista');
      return false;
    }
  }

  const before = { ...current };
  void optimistic(
    () => items().upsert({ ...before, ...changes }),
    () => items().upsert(before),
    () => pb.collection('items').update(itemId, changes),
  );
  return true;
}

export function deleteItem(item: Item) {
  scheduleDeletion('items', { items: [{ ...item }] }, `${item.name} eliminato`);
}

export function clearCart(listId: string) {
  const { inCart } = splitItems(items().forList(listId));
  if (!inCart.length) return;
  scheduleDeletion('items', { items: inCart.map((item) => ({ ...item })) }, removedLabel(inCart.length));
}

// The list record only: its items go with it through the cascade delete.
export function deleteList(list: List) {
  const listItems = items().forList(list.id).map((item) => ({ ...item }));
  scheduleDeletion('lists', { lists: [{ ...list }], items: listItems }, 'Lista eliminata');
}

// Not optimistic: the list page loads the record, so it must exist before opening it.
export async function createList(date: string, title: string): Promise<string | null> {
  const id = newRecordId();
  try {
    await pb.collection('lists').create({ id, date, title: capitalize(title.trim()) || 'Spesa', created_by: meId() });
    return id;
  } catch {
    toast().show('Non salvato, riprova');
    return null;
  }
}

export async function renameMe(name: string) {
  const me = session().me;
  const trimmed = name.trim();
  if (!me || !trimmed || trimmed === me.name) return;

  try {
    const updated = await pb.collection('users').update<User>(me.id, { name: trimmed });
    session().users[me.id] = updated;
  } catch {
    toast().show('Non salvato, riprova');
  }
}
