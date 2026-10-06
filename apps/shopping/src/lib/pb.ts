import PocketBase from 'pocketbase';

export interface User {
  id: string;
  name: string;
  username: string;
  color: 'sky' | 'sun' | '';
}

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

export const pb = new PocketBase('/');

// Auto cancellation drops a request when another one with the same path starts, which would
// silently skip a reload or a quick second update of the same item.
pb.autoCancellation(false);

// PocketBase accepts client ids of 15 lowercase alphanumeric characters, so optimistic records
// keep the same id when the realtime echo of the create arrives.
export function newRecordId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(15)), (byte) => alphabet[byte % alphabet.length]).join('');
}
