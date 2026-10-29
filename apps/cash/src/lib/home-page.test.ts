import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@household/shared/session', () => ({ signOut: vi.fn() }));
vi.mock('@household/shared/auth', () => ({ redirect: vi.fn() }));

const { signOut } = await import('@household/shared/session');
const { redirect } = await import('@household/shared/auth');
const { homePage } = await import('./home-page');

beforeEach(() => vi.clearAllMocks());

describe('logout', () => {
  it('opens the login once signed out', async () => {
    vi.mocked(signOut).mockResolvedValueOnce(true);
    const page = homePage();
    await page.logout();
    expect(redirect).toHaveBeenCalledWith('/login/');
    expect(page.logoutFailed).toBe(false);
  });

  it('says so when the sign-out fails', async () => {
    vi.mocked(signOut).mockResolvedValueOnce(false);
    const page = homePage();
    await page.logout();
    expect(redirect).not.toHaveBeenCalled();
    expect(page.logoutFailed).toBe(true);
  });
});
