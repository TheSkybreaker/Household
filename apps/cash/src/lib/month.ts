import { addDays, fromIsoDate, toIsoDate } from '@household/shared/dates';
import type { CashSummary, Movement } from './types';

// "2026-10" moved by a number of months.
export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + by, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function lastDayOf(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return toIsoDate(new Date(year, monthNumber, 0));
}

// From the first month with a snapshot to the current one.
export function monthNav(summary: CashSummary) {
  return {
    month: summary.month,
    current: summary.month === summary.current,
    canPrev: summary.month > summary.first,
    canNext: summary.month < summary.current,
    prev: shiftMonth(summary.month, -1),
    next: shiftMonth(summary.month, 1),
  };
}

export type PanelNote =
  | { kind: 'incoming'; amount: number; whose: 'both' | 'mine' | 'other'; userId: string }
  | { kind: 'allPaid' }
  | { kind: 'leftAtEnd' }
  | { kind: 'overspent' };

export interface PanelPerson {
  userId: string;
  quotaId: string;
  amount: number;
  paidOn: string;
  // The server lets each person mark only their own quota, as paid or not.
  status: 'paid' | 'payable' | 'waiting';
  canUnpay: boolean;
}

// What the mint panel of the Mese tab shows, me first among the people.
export function panelState(summary: CashSummary, meId: string) {
  const past = summary.month !== summary.current;
  const unpaid = summary.quotas.filter((quota) => !quota.paidOn);
  let note: PanelNote;
  if (summary.incoming > 0) {
    const whose = unpaid.length > 1 ? 'both' : unpaid[0]?.user === meId ? 'mine' : 'other';
    note = { kind: 'incoming', amount: summary.incoming, whose, userId: unpaid[0]?.user ?? '' };
  } else if (!past) {
    note = { kind: 'allPaid' };
  } else {
    note = summary.left >= 0 ? { kind: 'leftAtEnd' } : { kind: 'overspent' };
  }

  const people: PanelPerson[] = [...summary.quotas]
    .sort((a, b) => Number(b.user === meId) - Number(a.user === meId))
    .map((quota) => ({
      userId: quota.user,
      quotaId: quota.id,
      amount: quota.amount,
      paidOn: quota.paidOn,
      status: quota.paidOn ? 'paid' : quota.user === meId ? 'payable' : 'waiting',
      canUnpay: Boolean(quota.paidOn) && quota.user === meId,
    }));

  const { entered, spent } = summary;
  return {
    past,
    left: summary.left,
    entered,
    extras: summary.extras,
    expected: summary.expected,
    spent,
    meterPercent: entered ? Math.min(100, (spent / entered) * 100) : spent ? 100 : 0,
    spentPercent: entered ? Math.round((spent / entered) * 100) : null,
    note,
    people,
  };
}

export interface EnvelopeRef {
  id: string;
  name: string;
  slot: number;
}

export interface MovementRow {
  id: string;
  kind: 'quota' | 'spend' | 'extra' | 'transfer' | 'sweep';
  // Signed as shown: spending negative, money in positive, transfers as they are.
  amount: number;
  date: string;
  userId: string;
  envelope: EnvelopeRef | null;
  from: EnvelopeRef | null;
  to: EnvelopeRef | null;
  // Empty means the page shows the envelope name, or "Versamento extra".
  description: string;
  movement: Movement | null;
  quotaId: string;
}

function envelopeOf(summary: CashSummary, id: string): EnvelopeRef | null {
  const envelope = summary.envelopes.find((candidate) => candidate.id === id);
  return envelope ? { id: envelope.id, name: envelope.name, slot: envelope.slot } : null;
}

// The movements of the month by day, newest first. Within a day the avanzo of a closed month comes
// first, then the movements newest first, then the quotas, as in the demo. The avanzo is one row:
// its transfers per envelope are in the Avanzo sheet.
export function movementRows(summary: CashSummary, movements: Movement[]): { day: string; rows: MovementRow[] }[] {
  const base = { userId: '', envelope: null, from: null, to: null, description: '', movement: null, quotaId: '' };
  const ranked: { row: MovementRow; rank: number; created: string }[] = [];

  if (summary.closed && summary.sweep !== 0) {
    ranked.push({ row: { ...base, id: `sweep-${summary.month}`, kind: 'sweep', amount: summary.sweep, date: lastDayOf(summary.month) }, rank: 0, created: '' });
  }
  for (const movement of movements) {
    if (movement.reason === 'sweep') continue;
    const row: MovementRow = {
      ...base,
      id: movement.id,
      kind: movement.kind,
      amount: movement.kind === 'spend' ? -movement.amount : movement.amount,
      date: movement.date,
      userId: movement.user,
      envelope: envelopeOf(summary, movement.envelope),
      from: envelopeOf(summary, movement.from_envelope),
      to: envelopeOf(summary, movement.to_envelope),
      description: movement.description,
      movement,
    };
    ranked.push({ row, rank: 1, created: movement.created });
  }
  for (const quota of summary.quotas) {
    if (!quota.paidOn) continue;
    ranked.push({ row: { ...base, id: `quota-${quota.id}`, kind: 'quota', amount: quota.amount, date: quota.paidOn, userId: quota.user, quotaId: quota.id }, rank: 2, created: '' });
  }

  ranked.sort((a, b) => b.row.date.localeCompare(a.row.date) || a.rank - b.rank || b.created.localeCompare(a.created));
  const days: { day: string; rows: MovementRow[] }[] = [];
  for (const { row } of ranked) {
    const last = days[days.length - 1];
    if (last?.day === row.date) last.rows.push(row);
    else days.push({ day: row.date, rows: [row] });
  }
  return days;
}

// The day a quota is marked as paid: today in the current month, the first day of a past one.
export function paidOnFor(month: string, today: string): string {
  return today.startsWith(month) ? today : `${month}-01`;
}

export function dayKind(date: string, today: string): 'today' | 'yesterday' | 'other' {
  if (date === today) return 'today';
  return date === toIsoDate(addDays(fromIsoDate(today), -1)) ? 'yesterday' : 'other';
}
