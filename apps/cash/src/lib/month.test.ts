import { describe, expect, it } from 'vitest';
import { dayKind, monthNav, movementRows, paidOnFor, panelState } from './month';
import type { CashSummary, EnvelopeSummary, Movement, QuotaSummary } from './types';

const me = 'usera';
const partner = 'userb';
const envelope = (id: string, name: string, slot: number, kind: 'spend' | 'save' = 'spend') =>
  ({ id, name, slot, kind }) as EnvelopeSummary;
const envelopes = [envelope('casa', 'Casa', 1), envelope('spesa', 'Spesa', 2), envelope('fondo', 'Fondo emergenza', 3, 'save')];
const quota = (user: string, paidOn = ''): QuotaSummary => ({ id: `q-${user}`, user, amount: user === me ? 100000 : 90000, paidOn });

function summary(overrides: Partial<CashSummary>): CashSummary {
  return {
    month: '2026-10', current: '2026-10', first: '2026-09', closed: false, sweepTo: 'fondo', sweep: 0,
    quotas: [quota(partner), quota(me, '2026-10-01')], expected: 190000, entered: 150000, extras: 50000, spent: 154000,
    left: -4000, incoming: 90000, cash: 337710, envelopes, pie: { month: [], all: [] }, savings: { months: [], series: [] },
    ...overrides,
  };
}

const movement = (id: string, overrides: Partial<Movement>): Movement =>
  ({ id, kind: 'spend', amount: 1000, date: '2026-10-06', month: '2026-10', envelope: 'spesa', from_envelope: '', to_envelope: '',
    reason: '', description: '', user: me, shopping_list: '', created_by: me, created: '2026-10-06 10:00:00.000Z', updated: '', ...overrides }) as Movement;

describe('monthNav', () => {
  it('moves between the first month and the current one', () => {
    expect(monthNav(summary({}))).toMatchObject({ current: true, canPrev: true, canNext: false, prev: '2026-09', next: '2026-11' });
    expect(monthNav(summary({ month: '2026-09', closed: true }))).toMatchObject({ current: false, canPrev: false, canNext: true });
    expect(monthNav(summary({ month: '2027-01', current: '2027-01', first: '2026-12' })).prev).toBe('2026-12');
  });
});

describe('panelState', () => {
  it('waits for the partner quota in the current month', () => {
    const state = panelState(summary({}), me);
    expect(state).toMatchObject({ past: false, left: -4000, entered: 150000, spent: 154000, meterPercent: 100, spentPercent: 103 });
    expect(state.note).toEqual({ kind: 'incoming', amount: 90000, whose: 'other', userId: partner });
  });

  it('tells whose quotas are missing', () => {
    const both = panelState(summary({ quotas: [quota(me), quota(partner)], incoming: 190000 }), me).note;
    expect(both).toMatchObject({ kind: 'incoming', whose: 'both' });
    const mine = panelState(summary({ quotas: [quota(me), quota(partner, '2026-10-02')], incoming: 100000 }), me).note;
    expect(mine).toMatchObject({ kind: 'incoming', whose: 'mine' });
    expect(panelState(summary({ incoming: 0 }), me).note).toEqual({ kind: 'allPaid' });
  });

  it('closes a past month on what was left or overspent', () => {
    expect(panelState(summary({ month: '2026-09', incoming: 0, left: 71710 }), me).note).toEqual({ kind: 'leftAtEnd' });
    expect(panelState(summary({ month: '2026-09', incoming: 0, left: -10 }), me).note).toEqual({ kind: 'overspent' });
    expect(panelState(summary({ month: '2026-09' }), me).past).toBe(true);
  });

  it('has no percentage while nothing has entered', () => {
    const state = panelState(summary({ entered: 0, spent: 0, extras: 0 }), me);
    expect(state.spentPercent).toBeNull();
    expect(state.meterPercent).toBe(0);
  });

  it('lists me first, and only the own quota can be paid or unpaid', () => {
    const unpaid = panelState(summary({ quotas: [quota(partner), quota(me)] }), me).people;
    expect(unpaid.map((person) => [person.userId, person.status, person.canUnpay])).toEqual([[me, 'payable', false], [partner, 'waiting', false]]);
    const paid = panelState(summary({ quotas: [quota(partner, '2026-10-02'), quota(me, '2026-10-01')] }), me).people;
    expect(paid.map((person) => [person.userId, person.status, person.canUnpay])).toEqual([[me, 'paid', true], [partner, 'paid', false]]);
  });
});

describe('movementRows', () => {
  it('groups the month by day, newest first, with quotas after the movements of their day', () => {
    const days = movementRows(summary({}), [
      movement('rent', { date: '2026-10-01', envelope: 'casa', amount: 85000, created: '2026-10-01 08:00:00.000Z' }),
      movement('lidl', { date: '2026-10-06', amount: 5000, user: partner }),
      movement('bonus', { kind: 'extra', date: '2026-10-01', envelope: 'fondo', amount: 50000, created: '2026-10-01 09:00:00.000Z' }),
    ]);
    expect(days.map((day) => day.day)).toEqual(['2026-10-06', '2026-10-01']);
    expect(days[1].rows.map((row) => [row.kind, row.id, row.amount])).toEqual([
      ['extra', 'bonus', 50000],
      ['spend', 'rent', -85000],
      ['quota', 'quota-q-usera', 100000],
    ]);
    expect(days[0].rows[0]).toMatchObject({ kind: 'spend', userId: partner, envelope: { id: 'spesa', slot: 2 } });
  });

  it('shows a closed month avanzo as one row on its last day, instead of its transfers', () => {
    const september = summary({ month: '2026-09', closed: true, sweep: 9710, quotas: [] });
    const sweep = (id: string, from: string, to: string, amount: number) =>
      movement(id, { kind: 'transfer', reason: 'sweep', date: '2026-09-30', month: '2026-09', envelope: '', from_envelope: from, to_envelope: to, amount });
    const days = movementRows(september, [sweep('s1', 'casa', 'fondo', 6210), sweep('s2', 'fondo', 'spesa', 2500), movement('fun', { date: '2026-09-30', month: '2026-09' })]);
    expect(days[0].day).toBe('2026-09-30');
    expect(days[0].rows.map((row) => [row.kind, row.amount])).toEqual([['sweep', 9710], ['spend', -1000]]);
  });

  it('keeps a movement of an envelope the month no longer lists', () => {
    const [day] = movementRows(summary({ envelopes: [] }), [movement('old', {})]);
    expect(day.rows[0].envelope).toBeNull();
  });
});

describe('dates', () => {
  it('pays a quota today in the current month and on the first day of a past one', () => {
    expect(paidOnFor('2026-10', '2026-10-29')).toBe('2026-10-29');
    expect(paidOnFor('2026-09', '2026-10-29')).toBe('2026-09-01');
  });

  it('tells today and yesterday from other days', () => {
    expect(dayKind('2026-10-29', '2026-10-29')).toBe('today');
    expect(dayKind('2026-10-28', '2026-10-29')).toBe('yesterday');
    expect(dayKind('2026-09-30', '2026-10-01')).toBe('yesterday');
    expect(dayKind('2026-10-20', '2026-10-29')).toBe('other');
  });
});
