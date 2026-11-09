import { describe, expect, it } from 'vitest';
import { clampDate, editForm, newForm, preview, refusal, shoppingShortcut, toAmountInput, toRecord, validate, withKind } from './movement-form';
import type { CashSummary, EnvelopeSummary, Movement } from './types';

const envelopes = [
  { id: 'casa', name: 'Casa', kind: 'spend', slot: 1, left: 20000 },
  { id: 'spesa', name: 'Spesa', kind: 'spend', slot: 2, left: 35000 },
  { id: 'fondo', name: 'Fondo emergenza', kind: 'save', slot: 3, balance: 339710, goal: 600000 },
] as EnvelopeSummary[];
const summary = { month: '2026-10', envelopes } as CashSummary;

describe('newForm', () => {
  it('starts today in the current month, on the first day of a past one', () => {
    expect(newForm('n1', 'spend', null, '2026-10', '2026-10-29', 'usera', envelopes)).toMatchObject({ id: 'n1', kind: 'spend', envelope: null, date: '2026-10-29', user: 'usera', amount: '' });
    expect(newForm('n1', 'spend', 'casa', '2026-09', '2026-10-29', 'usera', envelopes).date).toBe('2026-09-01');
  });

  it('puts an extra in the first savings envelope', () => {
    expect(newForm('n1', 'extra', null, '2026-10', '2026-10-29', 'usera', envelopes).envelope).toBe('fondo');
  });
});

describe('validate', () => {
  const form = (amount: string, envelope: string | null = 'casa') => ({ ...newForm('n1', 'spend', envelope, '2026-10', '2026-10-29', 'usera', envelopes), amount });

  it('refuses empty, zero and huge amounts', () => {
    for (const amount of ['', '0', '0,00', 'abc', '100.000,01']) expect(validate(form(amount), envelopes)).toBe('amount');
    for (const amount of ['12,50', '12.5', '1.234,50', '100.000']) expect(validate(form(amount), envelopes)).toBeNull();
  });

  it('an envelope is required', () => {
    expect(validate(form('12', null), envelopes)).toBe('envelope');
    expect(validate(form('12', 'casa'), [])).toBe('envelope');
  });
});

describe('withKind', () => {
  it('puts an extra in a savings envelope', () => {
    const extra = withKind(newForm('n1', 'spend', 'casa', '2026-10', '2026-10-29', 'usera', envelopes), 'extra', envelopes, 'usera');
    expect(extra).toMatchObject({ kind: 'extra', envelope: 'fondo' });
    expect(withKind({ ...extra, envelope: 'fondo' }, 'spend', envelopes, 'usera').envelope).toBe('fondo');
  });

  it("gives a new spend back to me after choosing the partner's extra", () => {
    const partners = { ...withKind(newForm('n1', 'spend', null, '2026-10', '2026-10-29', 'usera', envelopes), 'extra', envelopes, 'usera'), user: 'userb' };
    expect(withKind(partners, 'spend', envelopes, 'usera').user).toBe('usera');
  });
});

describe('clampDate', () => {
  it('keeps a day between the first month and today', () => {
    expect(clampDate('2026-10-12', '2026-10-29', '2026-09')).toBe('2026-10-12');
  });

  it('brings an empty or wrong day to today, a future one back to today, an old one to the first month', () => {
    expect(clampDate('', '2026-10-29', '2026-09')).toBe('2026-10-29');
    expect(clampDate('2026-1-5', '2026-10-29', '2026-09')).toBe('2026-10-29');
    expect(clampDate('2026-10-30', '2026-10-29', '2026-09')).toBe('2026-10-29');
    expect(clampDate('2026-08-31', '2026-10-29', '2026-09')).toBe('2026-09-01');
  });
});

describe('refusal', () => {
  it('points at the field the server refused', () => {
    expect(refusal({ amount: { code: 'validation_max_number_constraint' } })).toBe('amount');
    expect(refusal({ envelope: { code: 'validation_envelope_archived' } })).toBe('envelope');
    expect(refusal({})).toBeNull();
    expect(refusal(undefined)).toBeNull();
  });

  it('takes an id already used as a save that had gone through', () => {
    expect(refusal({ id: { code: 'validation_not_unique' } })).toBe('saved');
  });
});

describe('preview', () => {
  const form = (kind: 'spend' | 'extra', envelope: string, amount: string) => ({ ...newForm('n1', kind, envelope, '2026-10', '2026-10-29', 'usera', envelopes), amount });

  it('tells what a spend envelope keeps, or how far over it goes', () => {
    expect(preview(form('spend', 'casa', '50'), summary)).toEqual({ kind: 'left', amount: 15000 });
    expect(preview(form('spend', 'casa', '250'), summary)).toEqual({ kind: 'over', amount: 5000 });
    expect(preview(form('extra', 'spesa', '10'), summary)).toEqual({ kind: 'left', amount: 36000 });
  });

  it('tells where a savings envelope gets to', () => {
    expect(preview(form('extra', 'fondo', '100'), summary)).toEqual({ kind: 'balance', amount: 349710, goal: 600000 });
  });

  it('asks for what is missing', () => {
    expect(preview(form('spend', 'nowhere', '10'), summary)).toEqual({ kind: 'needEnvelope' });
    expect(preview(form('spend', 'casa', ''), summary)).toEqual({ kind: 'needAmount' });
    expect(preview(form('spend', 'casa', '10'), null)).toEqual({ kind: 'needEnvelope' });
  });

  it('leaves out the movement being edited', () => {
    const original = { id: 'm1', kind: 'spend', amount: 5000, envelope: 'casa', month: '2026-10' } as Movement;
    expect(preview({ ...editForm(original), amount: '80' }, summary, original)).toEqual({ kind: 'left', amount: 17000 });
  });
});

describe('editForm and toRecord', () => {
  it('round-trips a movement', () => {
    const movement = { id: 'm1', kind: 'extra', amount: 123450, date: '2026-10-12', envelope: 'fondo', description: 'Premio', user: 'userb', shopping_list: '' } as Movement;
    const form = editForm(movement);
    expect(form).toMatchObject({ id: 'm1', amount: '1234,50' });
    expect(toRecord(form)).toEqual({ kind: 'extra', amount: 123450, date: '2026-10-12', envelope: 'fondo', description: 'Premio', user: 'userb', shopping_list: '' });
  });

  it('writes amounts for the input without thousands separators', () => {
    expect(toAmountInput(85000)).toBe('850');
    expect(toAmountInput(123405)).toBe('1234,05');
  });
});

describe('shoppingShortcut', () => {
  const list = (id: string, date: string, title = 'Esselunga') => ({ id, date, title, created: `${date} 10:00:00.000Z` });
  const item = (listId: string, checked: boolean) => ({ list: listId, checked });

  it('offers a list of today or yesterday with everything taken and no movement yet', () => {
    const shortcut = shoppingShortcut([list('l1', '2026-10-28'), list('l2', '2026-10-29', 'Lidl')], [item('l1', true), item('l2', true), item('l2', true)], [], '2026-10-29');
    expect(shortcut).toEqual({ listId: 'l2', title: 'Lidl', date: '2026-10-29' });
    const yesterday = shoppingShortcut([list('l1', '2026-10-28')], [item('l1', true)], [], '2026-10-29');
    expect(yesterday).toEqual({ listId: 'l1', title: 'Esselunga', date: '2026-10-28' });
  });

  it('ignores lists with items to buy, older lists, empty lists and lists already linked', () => {
    expect(shoppingShortcut([list('l1', '2026-10-29')], [item('l1', true), item('l1', false)], [], '2026-10-29')).toBeNull();
    expect(shoppingShortcut([list('l1', '2026-10-27')], [item('l1', true)], [], '2026-10-29')).toBeNull();
    expect(shoppingShortcut([list('l1', '2026-10-29')], [], [], '2026-10-29')).toBeNull();
    expect(shoppingShortcut([list('l1', '2026-10-29')], [item('l1', true)], [{ shopping_list: 'l1' }], '2026-10-29')).toBeNull();
  });
});
