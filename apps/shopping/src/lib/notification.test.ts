import { describe, expect, it } from 'vitest';
import { notificationDay, notificationItems, notificationText, type PushPayload } from './notification';

const thursday = new Date(2026, 9, 1, 20);
const payload: PushPayload = {
  type: 'item_added', listId: 'l1', listTitle: 'Spesa settimanale', listDate: '2026-10-02', item: 'Pane', qty: '', by: 'Lei',
};

describe('notificationText', () => {
  it('names the item for a single addition', () => {
    expect(notificationText(payload, ['Pane'], thursday)).toEqual({ title: 'Lei ha aggiunto Pane', body: 'Spesa settimanale, domani' });
  });

  it('counts the items added in a row and lists them', () => {
    expect(notificationText({ ...payload, item: 'Uova' }, ['Pane', 'Latte', 'Uova'], thursday)).toEqual({
      title: 'Lei ha aggiunto 3 cose',
      body: 'Pane, Latte, Uova. Lista: Spesa settimanale',
    });
  });
});

describe('notificationDay', () => {
  it('says oggi, domani or the full day', () => {
    expect(notificationDay('2026-10-01', thursday)).toBe('oggi');
    expect(notificationDay('2026-10-02', thursday)).toBe('domani');
    expect(notificationDay('2026-10-03', thursday)).toBe('sabato 3 ottobre');
    expect(notificationDay('2026-09-30', thursday)).toBe('mercoledì 30 settembre');
  });
});

describe('notificationItems', () => {
  const base = { type: 'item_added', listId: 'l1', listTitle: 'Spesa', listDate: '2026-10-03', qty: '', by: 'Martina' } as const;

  it('adds every item of a grouped push after the ones already shown', () => {
    expect(notificationItems(['Pane'], { ...base, item: 'Uova', items: ['Latte', 'Uova'] })).toEqual(['Pane', 'Latte', 'Uova']);
  });

  it('takes the single item of a push without the list of items', () => {
    expect(notificationItems([], { ...base, item: 'Pane' })).toEqual(['Pane']);
  });
});
