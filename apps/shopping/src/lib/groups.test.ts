import { describe, expect, it } from 'vitest';
import { contributors, homeSummary, listProgress, progressLabel, rowStatus, splitItems, splitLists, suggestions } from './groups';
import type { Item, List } from './pb';

const now = new Date(2026, 9, 1, 12);

const list = (id: string, date: string, created = '2026-09-30 10:00:00.000Z'): List => ({
  id, date, title: 'Spesa', created_by: 'me', created, updated: created,
});

const item = (id: string, overrides: Partial<Item> = {}): Item => ({
  id, list: 'l1', name: id, qty: '', checked: false, checked_at: '', added_by: 'me', checked_by: '', added_at: '',
  created: '2026-10-01 10:00:00.000Z', updated: '2026-10-01 10:00:00.000Z', ...overrides,
});

describe('splitLists', () => {
  it('puts today and later in upcoming, nearest first, and earlier days in past, latest first', () => {
    const { upcoming, past } = splitLists(
      [list('a', '2026-10-05'), list('b', '2026-10-01'), list('c', '2026-09-20'), list('d', '2026-09-30')],
      now,
    );
    expect(upcoming.map((l) => l.id)).toEqual(['b', 'a']);
    expect(past.map((l) => l.id)).toEqual(['d', 'c']);
  });
});

describe('splitItems', () => {
  it('orders items to buy by creation and items in the cart by last checked', () => {
    const { toBuy, inCart } = splitItems([
      item('later', { created: '2026-10-01 11:00:00.000Z' }),
      item('earlier', { created: '2026-10-01 09:00:00.000Z' }),
      item('checkedFirst', { checked: true, checked_at: '2026-10-01 09:30:00.000Z' }),
      item('checkedLast', { checked: true, checked_at: '2026-10-01T10:30:00.000Z' }),
    ]);
    expect(toBuy.map((i) => i.id)).toEqual(['earlier', 'later']);
    expect(inCart.map((i) => i.id)).toEqual(['checkedLast', 'checkedFirst']);
  });

  it('puts an item back from the cart after the others, by its added_at', () => {
    const { toBuy } = splitItems([
      item('putBack', { created: '2026-10-01 08:00:00.000Z', added_at: '2026-10-01 12:00:00.000Z' }),
      item('other', { created: '2026-10-01 09:00:00.000Z' }),
    ]);
    expect(toBuy.map((i) => i.id)).toEqual(['other', 'putBack']);
  });
});

describe('progress texts', () => {
  it('describes empty, partial and complete lists', () => {
    const empty = listProgress([]);
    const partial = listProgress([item('a'), item('b'), item('c', { checked: true })]);
    const done = listProgress([item('a', { checked: true })]);

    expect([rowStatus(empty), rowStatus(partial), rowStatus(done)]).toEqual(['Vuota', '2 da prendere', 'Fatto']);
    expect([progressLabel(empty), progressLabel(partial), progressLabel(done)]).toEqual([
      'Ancora vuota', '2 da prendere, 1 nel carrello', 'Tutto nel carrello',
    ]);
    expect(partial.percent).toBe(33);
  });
});

describe('homeSummary', () => {
  it('counts items to buy in upcoming lists, with singular forms', () => {
    const upcoming = [list('l1', '2026-10-01')];
    expect(homeSummary([], [])).toBe('Nessuna spesa in programma.');
    expect(homeSummary(upcoming, [item('a', { checked: true })])).toBe('Avete preso tutto, per ora.');
    expect(homeSummary(upcoming, [item('a')])).toBe('1 cosa da prendere in 1 lista');
    expect(homeSummary([...upcoming, list('l2', '2026-10-02')], [item('a'), item('b', { list: 'l2' })])).toBe(
      '2 cose da prendere in 2 liste',
    );
  });
});

describe('contributors', () => {
  it('lists each adder once, the current user first', () => {
    expect(contributors([item('a', { added_by: 'other' }), item('b'), item('c', { added_by: 'other' })], 'me')).toEqual([
      'me', 'other',
    ]);
  });
});

describe('suggestions', () => {
  it('skips items already to buy, ignoring case, and keeps at most 7', () => {
    expect(suggestions([item('latte'), item('Pane')])).toEqual(['Uova', 'Acqua', 'Frutta', 'Caffè', 'Pasta', 'Insalata', 'Burro']);
  });
});
