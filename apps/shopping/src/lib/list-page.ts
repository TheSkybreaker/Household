import { clearCart, deleteItem, deleteList, editItem, toggleItem } from './actions';
import { isRedirecting } from './auth';
import { restoreList, saveList } from './cache';
import { fromIsoDate, fullDateLabel, monthLabel, relativeDay, weekdayLong } from './dates';
import { resumeDeletions } from './deletions';
import { listProgress, progressLabel, splitItems } from './groups';
import { goHome, goTo, setFlash } from './nav';
import type { Item } from './pb';
import { quantityLabel } from './parse';
import { loadList, loadUsers, onReconnect, subscribeList } from './realtime';
import { items, lists, session } from './stores';

const CHECK_ANIMATION_MS = 260;
const LONG_PRESS_MS = 500;
// A finger that moves further than this is scrolling, not pressing.
const LONG_PRESS_SLOP_PX = 10;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function listPage() {
  const params = new URLSearchParams(location.search);
  let pressTimer = 0;
  let pressOrigin: { x: number; y: number } | null = null;
  // The click that ends a long press must not check the item.
  let longPressed = false;

  return {
    listId: params.get('id') ?? '',
    focusComposer: params.has('nuova'),
    loaded: false,
    sheet: null as 'menu' | 'edit' | null,
    confirmDelete: false,
    editingId: '',
    editName: '',
    editQty: '',
    // The row under a finger that may become a long press.
    pressingId: '',
    // Items in the middle of the check animation, before they change section.
    checking: {} as Record<string, 'on' | 'off'>,

    async init() {
      if (isRedirecting()) return;
      if (!this.listId) return goTo('/');

      this.loaded = restoreList(this.listId);
      resumeDeletions();
      subscribeList(this.listId, () => {
        setFlash(`Lista eliminata da ${session().partner?.name ?? ''}`.trim());
        goTo('/');
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.reload();
        else saveList(this.listId);
      });
      onReconnect(() => void this.reload());
      await this.reload();
    },

    async reload() {
      try {
        const [, found] = await Promise.all([loadUsers(), loadList(this.listId)]);
        if (found) saveList(this.listId);
        else goTo('/');
      } catch {
        // Offline or a server error: the page keeps what it already shows.
      } finally {
        this.loaded = true;
      }
    },

    get list() {
      return lists().byId[this.listId];
    },

    get groups() {
      return splitItems(items().forList(this.listId));
    },

    get progress() {
      return listProgress(items().forList(this.listId));
    },

    get progressText() {
      return progressLabel(this.progress);
    },

    get day() {
      return this.list ? fromIsoDate(this.list.date).getDate() : '';
    },

    get relative() {
      return this.list ? relativeDay(this.list.date) : null;
    },

    get weekday() {
      return this.list ? weekdayLong(this.list.date) : '';
    },

    get month() {
      return this.list ? monthLabel(this.list.date) : '';
    },

    get dateLine() {
      return this.list ? fullDateLabel(this.list.date) : '';
    },

    quantity: quantityLabel,

    meta(item: Item) {
      const userId = item.checked ? item.checked_by || item.added_by : item.added_by;
      return {
        userId,
        text: `${item.checked ? 'preso da' : 'aggiunto da'} ${session().who(userId)}`,
      };
    },

    itemClass(item: Item) {
      return {
        'is-done': item.checked,
        'is-checking': this.checking[item.id] === 'on',
        'is-unchecking': this.checking[item.id] === 'off',
        'is-fresh': items().fresh[item.id] === true,
        'is-pressing': this.pressingId === item.id,
      };
    },

    toggle(item: Item) {
      if (this.checking[item.id]) return;
      if (reducedMotion()) return toggleItem(item.id);

      this.checking[item.id] = item.checked ? 'off' : 'on';
      setTimeout(() => {
        delete this.checking[item.id];
        toggleItem(item.id);
      }, CHECK_ANIMATION_MS);
    },

    tap(item: Item) {
      if (longPressed) {
        longPressed = false;
        return;
      }
      this.toggle(item);
    },

    pressStart(item: Item, event: PointerEvent) {
      longPressed = false;
      if (event.button !== 0 || !session().online) return;
      pressOrigin = { x: event.clientX, y: event.clientY };
      this.pressingId = item.id;
      pressTimer = window.setTimeout(() => {
        longPressed = true;
        pressOrigin = null;
        this.pressingId = '';
        // Shorter pulses are too weak to feel on many phones.
        navigator.vibrate?.(30);
        this.openEdit(item);
      }, LONG_PRESS_MS);
    },

    pressMove(event: PointerEvent) {
      if (pressOrigin && Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > LONG_PRESS_SLOP_PX) {
        this.pressEnd();
      }
    },

    pressEnd() {
      clearTimeout(pressTimer);
      pressOrigin = null;
      this.pressingId = '';
    },

    remove(item: Item) {
      deleteItem(item);
    },

    openEdit(item: Item) {
      this.editingId = item.id;
      this.editName = item.name;
      this.editQty = item.qty;
      this.sheet = 'edit';
    },

    saveEdit() {
      if (editItem(this.editingId, this.editName, this.editQty)) this.sheet = null;
    },

    openMenu() {
      this.confirmDelete = false;
      this.sheet = 'menu';
    },

    clearCart() {
      this.sheet = null;
      clearCart(this.listId);
    },

    deleteList() {
      if (!this.confirmDelete) {
        this.confirmDelete = true;
        return;
      }
      if (this.list) deleteList(this.list);
      goHome();
    },

    back: goHome,
  };
}
