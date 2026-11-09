import { newRecordId, pb, type User } from '@household/shared/pb';
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

export function loadUsers() {
  return pb.collection('users').getFullList<User>({ fields: 'id,name,username,color' });
}

// The Spesa lists since a day, with their items and the movements already linked to one of them:
// what the Aggiungi panel needs for its shortcut.
export async function loadRecentShopping(since: string) {
  const lists = await pb.collection('lists').getFullList<{ id: string; date: string; title: string; created: string }>({
    filter: pb.filter('date >= {:since}', { since }),
    fields: 'id,date,title,created',
  });
  if (!lists.length) return { lists, items: [], movements: [] };
  const params = Object.fromEntries(lists.map((list, index) => [`list${index}`, list.id]));
  const [items, movements] = await Promise.all([
    pb.collection('items').getFullList<{ list: string; checked: boolean }>({
      filter: pb.filter(lists.map((_, index) => `list = {:list${index}}`).join(' || '), params),
      fields: 'list,checked',
    }),
    pb.collection('movements').getFullList<{ shopping_list: string }>({
      filter: pb.filter('shopping_list != "" && date >= {:since}', { since }),
      fields: 'shopping_list',
    }),
  ]);
  return { lists, items, movements };
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
