import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./session', () => ({ cachedUser: vi.fn(), refreshSession: vi.fn(), signIn: vi.fn() }));

const { refreshSession } = await import('./session');
const { checkSession } = await import('./auth');

let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replace = vi.fn();
  vi.stubGlobal('location', { replace });
});

afterEach(() => vi.unstubAllGlobals());

describe('checkSession', () => {
  it('drops what the app keeps of a session closed in the other app, then opens the login', async () => {
    vi.mocked(refreshSession).mockResolvedValueOnce('signed-out');
    const forget = vi.fn();
    await checkSession(forget);
    expect(forget).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/login/');
  });

  it('keeps everything while the session holds or the network is down', async () => {
    const forget = vi.fn();
    vi.mocked(refreshSession).mockResolvedValueOnce('signed-in').mockResolvedValueOnce('offline');
    await checkSession(forget);
    await checkSession(forget);
    expect(forget).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
