import { beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.fn();
const me = { id: 'u1', name: 'Vittorio', username: 'vittorio', color: 'sky' };
vi.mock('@household/shared/session', () => ({ signOut: vi.fn(), saveMyName: vi.fn() }));
vi.mock('@household/shared/auth', () => ({ redirect: vi.fn() }));
vi.mock('@household/shared/toast', () => ({ toast: () => ({ show }) }));
vi.mock('./cache', () => ({ clearMonthCache: vi.fn() }));
vi.mock('./stores', () => ({ session: () => ({ me }) }));

const { signOut, saveMyName } = await import('@household/shared/session');
const { redirect } = await import('@household/shared/auth');
const { clearMonthCache } = await import('./cache');
const { homePage } = await import('./home-page');

beforeEach(() => vi.clearAllMocks());

describe('logout', () => {
  it('opens the login once signed out', async () => {
    vi.mocked(signOut).mockResolvedValueOnce(true);
    const page = homePage();
    await page.logout();
    expect(redirect).toHaveBeenCalledWith('/login/');
    expect(clearMonthCache).toHaveBeenCalled();
    expect(page.logoutFailed).toBe(false);
  });

  it('says so when the sign-out fails', async () => {
    vi.mocked(signOut).mockResolvedValueOnce(false);
    const page = homePage();
    await page.logout();
    expect(redirect).not.toHaveBeenCalled();
    expect(clearMonthCache).not.toHaveBeenCalled();
    expect(page.logoutFailed).toBe(true);
  });
});

describe('name', () => {
  it('opens the profile with my name and saves the new one', async () => {
    const page = homePage();
    page.openProfile();
    expect(page.nameDraft).toBe('Vittorio');
    page.nameDraft = 'Vitto';
    await page.saveName();
    expect(saveMyName).toHaveBeenCalledWith(me, 'Vitto');
    expect(show).not.toHaveBeenCalled();
  });

  it('says so when the name is not saved', async () => {
    vi.mocked(saveMyName).mockRejectedValueOnce(new Error('offline'));
    const page = homePage();
    page.nameDraft = 'Vitto';
    await page.saveName();
    expect(show).toHaveBeenCalledTimes(1);
  });
});
