import Alpine from 'alpinejs';
import { pb, type Item, type List, type User } from './pb';
import { isPendingDeletion } from './pending';
import { initialNotificationState, type NotificationState } from './push';

const FRESH_MS = 1500;
const TOAST_MS = 2800;

export interface SessionStore {
  me: User | null;
  users: Record<string, User>;
  online: boolean;
  installable: boolean;
  notifications: NotificationState;
  readonly partner: User | null;
  name(userId: string): string;
  initial(userId: string): string;
  avatarClass(userId: string): string;
  who(userId: string): string;
}

export interface RecordStore<T extends { id: string }> {
  byId: Record<string, T>;
  readonly all: T[];
  replaceAll(records: T[]): void;
  upsert(record: T): void;
  remove(id: string): void;
}

export interface ItemsStore extends RecordStore<Item> {
  fresh: Record<string, boolean>;
  forList(listId: string): Item[];
  markFresh(id: string): void;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastStore {
  message: string;
  actionLabel: string;
  visible: boolean;
  // durationMs null keeps the toast until it is tapped or replaced.
  show(message: string, action?: ToastAction, durationMs?: number | null): void;
  act(): void;
  hide(): void;
}

export const session = () => Alpine.store('session') as SessionStore;
export const lists = () => Alpine.store('lists') as RecordStore<List>;
export const items = () => Alpine.store('items') as ItemsStore;
export const toast = () => Alpine.store('toast') as ToastStore;

// Records hidden by a deletion that is still waiting for its undo window are never re-added,
// whether by a reload or by a realtime event.
function recordStore<T extends { id: string }>(): RecordStore<T> {
  return {
    byId: {},
    get all() {
      return Object.values(this.byId);
    },
    replaceAll(records) {
      this.byId = Object.fromEntries(records.filter((record) => !isPendingDeletion(record.id)).map((record) => [record.id, record]));
    },
    upsert(record) {
      if (!isPendingDeletion(record.id)) this.byId[record.id] = record;
    },
    remove(id) {
      delete this.byId[id];
    },
  };
}

function sessionStore(): SessionStore {
  return {
    me: pb.authStore.record as User | null,
    users: {},
    online: navigator.onLine,
    installable: false,
    notifications: initialNotificationState(),
    get partner() {
      return Object.values(this.users).find((user) => user.id !== this.me?.id) ?? null;
    },
    name(userId) {
      const user = this.users[userId] ?? (this.me && userId === this.me.id ? this.me : null);
      return user?.name ?? '';
    },
    initial(userId) {
      return (this.name(userId).trim().charAt(0) || '?').toUpperCase();
    },
    avatarClass(userId) {
      return this.users[userId]?.color === 'sun' ? 'av-sun' : 'av-sky';
    },
    who(userId) {
      return userId === this.me?.id ? 'te' : this.name(userId);
    },
  };
}

// Extends the record store in place: a spread would copy its `all` getter as a fixed array.
function itemsStore(): ItemsStore {
  const store = recordStore<Item>() as ItemsStore;
  store.fresh = {};
  store.forList = function (listId) {
    return this.all.filter((item) => item.list === listId);
  };
  store.markFresh = function (id) {
    this.fresh[id] = true;
    setTimeout(() => delete this.fresh[id], FRESH_MS);
  };
  return store;
}

function toastStore(): ToastStore {
  let action: ToastAction | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    message: '',
    actionLabel: '',
    visible: false,
    show(message, nextAction, durationMs = TOAST_MS) {
      action = nextAction;
      this.message = message;
      this.actionLabel = nextAction?.label ?? '';
      this.visible = true;
      clearTimeout(timer);
      if (durationMs !== null) timer = setTimeout(() => this.hide(), durationMs);
    },
    act() {
      const run = action?.run;
      this.hide();
      run?.();
    },
    hide() {
      action = undefined;
      this.visible = false;
    },
  };
}

export function registerStores() {
  Alpine.store('session', sessionStore());
  Alpine.store('lists', recordStore<List>());
  Alpine.store('items', itemsStore());
  Alpine.store('toast', toastStore());

  pb.authStore.onChange(() => {
    session().me = pb.authStore.record as User | null;
  });
  addEventListener('online', () => (session().online = true));
  addEventListener('offline', () => (session().online = false));
}
