import { newRecordId, pb } from '@household/shared/pb';
import type { CashSummary, Movement, MovementInput, MonthData } from './types';

// The summary of month, the current one when absent, and its movements, newest first.
export async function loadMonth(month?: string): Promise<MonthData> {
  const summary = await pb.send<CashSummary>('/api/cash/summary', { query: month ? { month } : {} });
  const movements = await pb.collection('movements').getFullList<Movement>({
    filter: pb.filter('month = {:month}', { month: summary.month }),
    sort: '-date,-created',
  });
  return { summary, movements };
}

export function payQuota(quotaId: string, paidOn: string) {
  return pb.collection('month_quotas').update(quotaId, { paid_on: paidOn });
}

export function unpayQuota(quotaId: string) {
  return pb.collection('month_quotas').update(quotaId, { paid_on: '' });
}

export function createMovement(input: MovementInput, meId: string) {
  return pb.collection('movements').create<Movement>({ id: newRecordId(), ...input, created_by: meId });
}

export function updateMovement(id: string, input: MovementInput) {
  return pb.collection('movements').update<Movement>(id, input);
}

export function deleteMovement(id: string) {
  return pb.collection('movements').delete(id);
}
