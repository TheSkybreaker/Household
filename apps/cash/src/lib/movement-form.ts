import { addDays, fromIsoDate, toIsoDate } from '@household/shared/dates';
import { parseAmount } from '@household/shared/money';
import type { CashSummary, EnvelopeSummary, Movement, MovementInput } from './types';

// 100.000 €: more is a typing slip, not a household movement.
const MAX_AMOUNT = 10_000_000;

export interface MovementForm {
  // The edited movement's, or the one a new movement gets, made when the form opens: a save retried
  // after a lost answer finds it taken instead of writing the movement twice.
  id: string;
  kind: 'spend' | 'extra';
  amount: string;
  description: string;
  envelope: string | null;
  // spend: who wrote it down; extra: whose money it is.
  user: string;
  date: string;
  shoppingList: string;
}

export function newForm(id: string, kind: MovementForm['kind'], envelopeId: string | null, month: string, today: string, meId: string, envelopes: EnvelopeSummary[]): MovementForm {
  const firstSavings = envelopes.find((envelope) => envelope.kind === 'save')?.id ?? null;
  return {
    id,
    kind,
    amount: '',
    description: '',
    envelope: envelopeId ?? (kind === 'extra' ? firstSavings : null),
    user: meId,
    date: today.startsWith(month) ? today : `${month}-01`,
    shoppingList: '',
  };
}

// "12,50", or "850" when round: what parseAmount reads back.
export function toAmountInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ',');
}

export function editForm(movement: Movement): MovementForm {
  return {
    id: movement.id,
    kind: movement.kind === 'extra' ? 'extra' : 'spend',
    amount: toAmountInput(movement.amount),
    description: movement.description,
    envelope: movement.envelope,
    user: movement.user,
    date: movement.date,
    shoppingList: movement.shopping_list,
  };
}

// The form switched to kind: an extra goes to a savings envelope, and a spend is mine, as in the demo.
export function withKind(form: MovementForm, kind: MovementForm['kind'], envelopes: EnvelopeSummary[], meId: string): MovementForm {
  const chosen = envelopes.find((envelope) => envelope.id === form.envelope);
  if (kind === 'spend') return { ...form, kind, user: meId };
  return { ...form, kind, envelope: chosen?.kind === 'save' ? form.envelope : (envelopes.find((envelope) => envelope.kind === 'save')?.id ?? form.envelope) };
}

// The day the server takes, as the demo does: an empty or wrong one becomes today, a future one
// today, one before the first month that month's first day.
export function clampDate(date: string, today: string, firstMonth: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return today;
  return date.slice(0, 7) < firstMonth ? `${firstMonth}-01` : date;
}

// What a refused save means for the form: the field to fix, or, when the id is already taken, an
// earlier attempt of the same form that had gone through.
export function refusal(data: Record<string, { code?: string }> | undefined): 'amount' | 'envelope' | 'saved' | null {
  if (data?.id?.code === 'validation_not_unique') return 'saved';
  if (data?.amount) return 'amount';
  return data?.envelope ? 'envelope' : null;
}

export function validate(form: MovementForm, envelopes: EnvelopeSummary[]): 'amount' | 'envelope' | null {
  const cents = parseAmount(form.amount);
  if (cents === null || cents <= 0 || cents > MAX_AMOUNT) return 'amount';
  return envelopes.some((envelope) => envelope.id === form.envelope) ? null : 'envelope';
}

export type Preview =
  | { kind: 'needEnvelope' }
  | { kind: 'needAmount' }
  | { kind: 'left'; amount: number }
  | { kind: 'over'; amount: number }
  | { kind: 'balance'; amount: number; goal: number };

// How the chosen envelope changes, from the summary of the form's month. An edited movement is
// already in the summary: its old effect is taken out first.
export function preview(form: MovementForm, summary: CashSummary | null, original?: Movement): Preview {
  const envelope = summary?.envelopes.find((candidate) => candidate.id === form.envelope);
  if (!envelope) return { kind: 'needEnvelope' };
  const cents = parseAmount(form.amount);
  if (cents === null || cents <= 0) return { kind: 'needAmount' };

  const effect = (kind: string, amount: number) => (kind === 'extra' ? amount : -amount);
  const before = original && original.envelope === envelope.id && original.month === summary?.month ? -effect(original.kind, original.amount) : 0;
  if (envelope.kind === 'save') return { kind: 'balance', amount: (envelope.balance ?? 0) + before + effect(form.kind, cents), goal: envelope.goal };
  const left = (envelope.left ?? 0) + before + effect(form.kind, cents);
  return left >= 0 ? { kind: 'left', amount: left } : { kind: 'over', amount: -left };
}

export function toRecord(form: MovementForm): MovementInput {
  return {
    kind: form.kind,
    amount: parseAmount(form.amount) ?? 0,
    date: form.date,
    envelope: form.envelope ?? '',
    description: form.description.trim(),
    user: form.user,
    shopping_list: form.shoppingList,
  };
}

// A Spesa list of today or yesterday with everything taken and no movement yet: the Aggiungi panel
// offers to write its spend.
export function shoppingShortcut(
  lists: { id: string; date: string; title: string; created: string }[],
  items: { list: string; checked: boolean }[],
  movements: { shopping_list: string }[],
  today: string,
): { listId: string; title: string; date: string } | null {
  const yesterday = toIsoDate(addDays(fromIsoDate(today), -1));
  const linked = new Set(movements.map((movement) => movement.shopping_list));
  const done = lists
    .filter((list) => list.date >= yesterday && list.date <= today && !linked.has(list.id))
    .filter((list) => {
      const own = items.filter((item) => item.list === list.id);
      return own.length > 0 && own.every((item) => item.checked);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
  return done[0] ? { listId: done[0].id, title: done[0].title, date: done[0].date } : null;
}
