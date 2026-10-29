import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedUser, refreshSession, signIn, signOut } from './session';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const record = { id: 'u1', collectionId: '_pb_users_auth_', collectionName: 'users', name: 'Vittorio', username: 'vittorio', color: 'sky', email: '' };
const publicUser = { id: 'u1', name: 'Vittorio', username: 'vittorio', color: 'sky' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const authorization = (call: number) => (fetchMock.mock.calls[call][1] as RequestInit & { headers: Record<string, string> }).headers.Authorization;
const url = (call: number) => String(fetchMock.mock.calls[call][0]);
const rejected = () => json(401, { status: 401, message: 'no', data: {} });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('refreshSession', () => {
  it('signs in from the cookie and caches only the public fields of the user', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { token: '', record }));
    expect(await refreshSession()).toBe('signed-in');
    expect(cachedUser()).toEqual(publicUser);
    expect(authorization(0)).toBeUndefined();
    expect(url(0)).toContain('/household/api/collections/users/auth-refresh');
  });

  it('signs out and forgets the user when the cookie is rejected', async () => {
    localStorage.setItem('household:user', JSON.stringify(publicUser));
    fetchMock.mockResolvedValueOnce(rejected());
    expect(await refreshSession()).toBe('signed-out');
    expect(cachedUser()).toBeNull();
  });

  it('keeps the cached user without network', async () => {
    localStorage.setItem('household:user', JSON.stringify(publicUser));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await refreshSession()).toBe('offline');
    expect(cachedUser()).toEqual(publicUser);
  });

  it('exchanges the token of the old localStorage session once', async () => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: 'old-token', record }));
    fetchMock.mockResolvedValueOnce(json(200, { token: '', record }));
    expect(await refreshSession()).toBe('signed-in');
    expect(authorization(0)).toBe('old-token');
    expect(localStorage.getItem('pocketbase_auth')).toBeNull();
  });

  it('opens offline with the user of the old localStorage session', () => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: 'old-token', record }));
    expect(cachedUser()).toEqual(publicUser);
  });

  it('falls back to the cookie when the old token is expired', async () => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: 'expired-token', record }));
    fetchMock.mockResolvedValueOnce(json(401, { status: 401, message: 'no', data: {} })).mockResolvedValueOnce(json(200, { token: '', record }));
    expect(await refreshSession()).toBe('signed-in');
    expect(authorization(1)).toBeUndefined();
    expect(localStorage.getItem('pocketbase_auth')).toBeNull();
  });
});

describe('signIn and signOut', () => {
  it('signs in with the username in lowercase', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { token: '', record }));
    await signIn('  Vittorio ', 'secret');
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ identity: 'vittorio', password: 'secret' });
    expect(cachedUser()).toEqual(publicUser);
  });

  it('keeps the session when signing out without network', async () => {
    localStorage.setItem('household:user', JSON.stringify(publicUser));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await signOut()).toBe(false);
    expect(cachedUser()).toEqual(publicUser);
  });

  it('forgets the user once the server deleted the cookie', async () => {
    localStorage.setItem('household:user', JSON.stringify(publicUser));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await signOut()).toBe(true);
    expect(cachedUser()).toBeNull();
  });

  it('also forgets the old localStorage session, which would sign the user back in', async () => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: 'old-token', record }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await signOut()).toBe(true);
    expect(cachedUser()).toBeNull();
    expect(localStorage.getItem('pocketbase_auth')).toBeNull();
  });
});
