import PocketBase, { BaseAuthStore, ClientResponseError } from 'pocketbase';
import { pb, type User } from './pb';

export type SessionState = 'signed-in' | 'signed-out' | 'offline';

// The signed-in user, so the app opens offline. Only public fields: the token is in the cookie.
const USER_KEY = 'household:user';
// Before the cookie, the Spesa kept the token under the default key of the SDK.
const LEGACY_AUTH_KEY = 'pocketbase_auth';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Without storage the app still works online.
  }
}

function parseStorage<T>(key: string): T | null {
  try {
    return JSON.parse(readStorage(key) ?? 'null');
  } catch {
    return null;
  }
}

const publicFields = (user: User): User => ({ id: user.id, name: user.name, username: user.username, color: user.color });

// A Spesa updated while offline has not exchanged its old session yet, and still opens with it.
export function cachedUser(): User | null {
  const user = parseStorage<User>(USER_KEY) ?? parseStorage<{ record?: User }>(LEGACY_AUTH_KEY)?.record;
  return user ? publicFields(user) : null;
}

function rememberUser(user: User | null) {
  writeStorage(USER_KEY, user && JSON.stringify(publicFields(user)));
}

function legacyToken(): string {
  return parseStorage<{ token?: string }>(LEGACY_AUTH_KEY)?.token ?? '';
}

const isRejected = (error: unknown) => error instanceof ClientResponseError && [401, 403, 404].includes(error.status);

// Until 2026-10-29 the API was under /api/ and so was the cookie. A refresh there sends the old
// cookie, and the server answers with the new one and deletes the old.
const oldPathApi = new PocketBase('/', new BaseAuthStore());

async function moveOldPathCookie(): Promise<boolean> {
  try {
    await oldPathApi.collection('users').authRefresh();
    return true;
  } catch {
    return false;
  }
}

// Renews the cookie and reads the signed-in user, from the cookie or, once, from the token the
// Spesa used to keep in localStorage or the cookie on the old path. A network error keeps the
// cached user.
export function refreshSession(): Promise<SessionState> {
  return refresh(true);
}

async function refresh(canMoveOldCookie: boolean): Promise<SessionState> {
  const legacy = legacyToken();
  try {
    const { record } = await pb.collection('users').authRefresh<User>(legacy ? { headers: { Authorization: legacy } } : {});
    writeStorage(LEGACY_AUTH_KEY, null);
    rememberUser(record);
    return 'signed-in';
  } catch (error) {
    if (!isRejected(error)) return 'offline';
    if (legacy) {
      // An expired old token: the cookie may still hold a session.
      writeStorage(LEGACY_AUTH_KEY, null);
      return refresh(canMoveOldCookie);
    }
    if (canMoveOldCookie && (await moveOldPathCookie())) return refresh(false);
    rememberUser(null);
    return 'signed-out';
  }
}

export async function signIn(username: string, password: string): Promise<void> {
  // Usernames are lowercase, while phone keyboards may capitalize the first letter.
  const { record } = await pb.collection('users').authWithPassword<User>(username.trim().toLowerCase(), password);
  rememberUser(record);
}

// False when the server cannot be reached: the cookie stays, and so does the session.
export async function signOut(): Promise<boolean> {
  try {
    await pb.send('/api/auth/logout', { method: 'POST' });
  } catch {
    return false;
  }
  rememberUser(null);
  writeStorage(LEGACY_AUTH_KEY, null);
  pb.authStore.clear();
  return true;
}
