import { beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.fn();
vi.mock('@household/shared/session', () => ({ signOut: vi.fn() }));
vi.mock('@household/shared/auth', () => ({ redirect: vi.fn() }));
vi.mock('./push', () => ({ forgetDevice: vi.fn(), syncPush: vi.fn() }));
vi.mock('./cache', () => ({ clearCache: vi.fn() }));
vi.mock('./stores', () => ({ toast: () => ({ show }) }));

const { signOut } = await import('@household/shared/session');
const { redirect } = await import('@household/shared/auth');
const { forgetDevice, syncPush } = await import('./push');
const { clearCache } = await import('./cache');
const { logout } = await import('./auth');

beforeEach(() => vi.clearAllMocks());

describe('logout', () => {
  it('forgets the phone, signs out, clears the cache and opens the login', async () => {
    vi.mocked(signOut).mockResolvedValueOnce(true);
    await logout();
    expect(forgetDevice).toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/login/');
    expect(syncPush).not.toHaveBeenCalled();
  });

  it('subscribes the phone again when the sign-out fails, so its notifications go on', async () => {
    vi.mocked(signOut).mockResolvedValueOnce(false);
    await logout();
    expect(syncPush).toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalled();
  });
});
