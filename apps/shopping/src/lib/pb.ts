export { newRecordId, pb, type User } from '@household/shared/pb';

export interface List {
  id: string;
  date: string;
  title: string;
  created_by: string;
  created: string;
  updated: string;
}

export interface Item {
  id: string;
  list: string;
  name: string;
  qty: string;
  checked: boolean;
  checked_at: string;
  added_by: string;
  checked_by: string;
  // When the item was added, or put back from the cart; orders the items to buy.
  added_at: string;
  created: string;
  updated: string;
}
