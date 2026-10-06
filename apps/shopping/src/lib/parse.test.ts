import { describe, expect, it } from 'vitest';
import { editChanges, parseEntry, quantityLabel } from './parse';

describe('parseEntry', () => {
  it.each([
    ['latte', 'Latte', ''],
    ['2 latte', 'Latte', '2'],
    ['2x latte', 'Latte', '2'],
    ['latte x2', 'Latte', '2'],
    ['500 g farina', 'Farina', '500 g'],
    ['1,5 kg patate', 'Patate', '1,5 kg'],
  ])('reads "%s" as %s with quantity "%s"', (raw, name, qty) => {
    expect(parseEntry(raw)).toEqual({ name, qty });
  });

  it('compresses spaces and capitalizes only the first letter', () => {
    expect(parseEntry('  carta    igienica  ')).toEqual({ name: 'Carta igienica', qty: '' });
  });

  it('normalizes a unit written without space or in capitals', () => {
    expect(parseEntry('500G farina')).toEqual({ name: 'Farina', qty: '500 g' });
  });

  it('accepts every recognized unit', () => {
    expect(['g', 'kg', 'ml', 'l', 'pz'].map((unit) => parseEntry(`3 ${unit} roba`)?.qty)).toEqual([
      '3 g', '3 kg', '3 ml', '3 l', '3 pz',
    ]);
  });

  it('does not read the start of a word as a unit', () => {
    expect(parseEntry('2 gelati')).toEqual({ name: 'Gelati', qty: '2' });
    expect(parseEntry('2 limoni')).toEqual({ name: 'Limoni', qty: '2' });
  });

  it('keeps a number that is part of the name', () => {
    expect(parseEntry('7up')).toEqual({ name: '7up', qty: '' });
  });

  it('returns null for blank input', () => {
    expect(parseEntry('   ')).toBeNull();
  });
});

describe('quantityLabel', () => {
  it('shows a bare count as ×n and a measure as written', () => {
    expect(quantityLabel('2')).toBe('×2');
    expect(quantityLabel('500 g')).toBe('500 g');
  });
});

describe('editChanges', () => {
  const item = { name: 'Farina', qty: '500 g' };

  it('cleans the name like an added one and compresses the quantity', () => {
    expect(editChanges(item, '  farina   integrale ', ' 1   kg ')).toEqual({ name: 'Farina integrale', qty: '1 kg' });
  });

  it('removes the quantity when it is emptied', () => {
    expect(editChanges(item, 'Farina', '  ')).toEqual({ qty: '' });
  });

  it('is empty when nothing changes', () => {
    expect(editChanges(item, ' farina', '500 g ')).toEqual({});
  });

  it('returns null without a name', () => {
    expect(editChanges(item, '   ', '2')).toBeNull();
  });
});
