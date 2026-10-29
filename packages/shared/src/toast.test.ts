import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToastStore } from './toast-store';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('toast store', () => {
  it('hides after its duration', () => {
    const toast = createToastStore();
    toast.show('Fatto', undefined, 1000);
    expect(toast.visible).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(toast.visible).toBe(false);
  });

  it('runs its action once and hides', () => {
    const toast = createToastStore();
    const run = vi.fn();
    toast.show('Eliminato', { label: 'Annulla', run }, null);
    toast.act();
    toast.act();
    expect(run).toHaveBeenCalledTimes(1);
    expect(toast.visible).toBe(false);
  });
});
