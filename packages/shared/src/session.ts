import { ClientResponseError } from 'pocketbase';
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

export function cachedUser(): User | null {
  try {
    return JSON.parse(readStorage(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function rememberUser(user: User | null) {
  writeStorage(USER_KEY, user && JSON.stringify({ id: user.id, name: user.name, username: user.username, color: user.color }));
}

function legacyToken(): string {
  try {
    return JSON.parse(readStorage(LEGACY_AUTH_KEY) ?? '{}').token ?? '';
  } catch {
    return '';
  }
}

const isRejected = (error: unknown) => error instanceof ClientResponseError && [401, 403, 404].includes(error.status);

// Renews the cookie and reads the signed-in user, from the cookie or, once, from the token the
// Spesa used to keep in localStorage. A network error keeps the cached user.
export async function refreshSession(): Promise<SessionState> {
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
      return refreshSession();
    }
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
  pb.authStore.clear();
  return true;
}
