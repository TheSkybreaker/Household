import { capitalize } from './dates';

export interface Entry {
  name: string;
  qty: string;
}

// "2 latte", "2x latte", "500 g farina", "1,5 kg patate". The mandatory space before the
// name keeps "2 latte" from reading as 2 l of "atte".
const LEADING_QUANTITY = /^(\d+(?:[.,]\d+)?)(?:\s?(kg|g|ml|l|pz))?(?:\s*x)?\s+(.+)$/i;
// "latte x2"
const TRAILING_QUANTITY = /^(.+?)\s*[x×]\s*(\d+)$/i;

const compressSpaces = (text: string) => text.trim().replace(/\s+/g, ' ');

export function parseEntry(raw: string): Entry | null {
  let name = compressSpaces(raw);
  let qty = '';

  const leading = name.match(LEADING_QUANTITY);
  const trailing = leading ? null : name.match(TRAILING_QUANTITY);
  if (leading) {
    const [, amount, unit, rest] = leading;
    qty = unit ? `${amount} ${unit.toLowerCase()}` : amount;
    name = rest;
  } else if (trailing) {
    [, name, qty] = trailing;
  }

  name = name.trim();
  return name ? { name: capitalize(name), qty } : null;
}

// What the edit sheet changes on an item: the name cleaned like an added one, the quantity with
// its spaces compressed. Null without a name, empty when nothing changes.
export function editChanges(current: Entry, name: string, qty: string): Partial<Entry> | null {
  const cleanName = compressSpaces(name);
  if (!cleanName) return null;

  const next = { name: capitalize(cleanName), qty: compressSpaces(qty) };
  const changes: Partial<Entry> = {};
  if (next.name !== current.name) changes.name = next.name;
  if (next.qty !== current.qty) changes.qty = next.qty;
  return changes;
}

// A bare count reads as "×2"; a measure ("500 g") stays as written.
export function quantityLabel(qty: string): string {
  return /^\d+$/.test(qty) ? `×${qty}` : qty;
}
