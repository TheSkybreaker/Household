import { fromIsoDate, relativeDay } from './dates';

// What the backend pushes when an item is added (see backend/push.go).
export interface PushPayload {
  type: 'item_added' | 'test';
  listId: string;
  listTitle: string;
  listDate: string;
  item: string;
  qty: string;
  by: string;
}

const longFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

// "oggi", "domani" or "sabato 3 ottobre", from the phone's own date.
export function notificationDay(isoDate: string, now = new Date()): string {
  const relative = relativeDay(isoDate, now);
  return relative === 'Oggi' || relative === 'Domani' ? relative.toLowerCase() : longFormat.format(fromIsoDate(isoDate));
}

// items: every item of the notification for this list, the new one last.
export function notificationText(payload: PushPayload, items: string[], now = new Date()): { title: string; body: string } {
  if (items.length === 1) {
    return { title: `${payload.by} ha aggiunto ${payload.item}`, body: `${payload.listTitle}, ${notificationDay(payload.listDate, now)}` };
  }
  return { title: `${payload.by} ha aggiunto ${items.length} cose`, body: `${items.join(', ')}. Lista: ${payload.listTitle}` };
}
