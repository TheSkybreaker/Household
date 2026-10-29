import PocketBase, { BaseAuthStore } from 'pocketbase';

export interface User {
  id: string;
  name: string;
  username: string;
  color: 'sky' | 'sun' | '';
}

// The auth token lives in an HttpOnly cookie that only the server reads, so the client keeps no
// token: the SDK sends no Authorization header and its store holds just the user, in memory.
// The API is under /household/api/, which Caddy hands to PocketBase as /api/: the cookie is kept
// to that path, which the other sites on the domain do not have.
export const pb = new PocketBase('/household', new BaseAuthStore());

// Auto cancellation drops a request when another one with the same path starts, which would
// silently skip a reload or a quick second update of the same record.
pb.autoCancellation(false);

// PocketBase accepts client ids of 15 lowercase alphanumeric characters, so optimistic records
// keep the same id when the realtime echo of the create arrives.
export function newRecordId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(15)), (byte) => alphabet[byte % alphabet.length]).join('');
}
