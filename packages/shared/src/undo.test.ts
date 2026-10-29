import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.fn();
vi.mock('./toast', () => ({ toast: () => ({ show }) }));

const listeners: (() => void)[] = [];
const fakeDocument = { visibilityState: 'visible', addEventListener: (_: string, listener: () => void) => listeners.push(listener) };
vi.stubGlobal('document', fakeDocument);
const { undoable } = await import('./undo');

const steps = () => ({ hide: vi.fn(), restore: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) });
const annulla = () => (show.mock.calls.at(-1)?.[1] as { run: () => void }).run();

beforeEach(() => {
  vi.useFakeTimers();
  show.mockClear();
  fakeDocument.visibilityState = 'visible';
});
afterEach(() => vi.useRealTimers());

describe('undoable', () => {
  it('hides at once and commits after 5 s', async () => {
    const action = steps();
    undoable('Eliminato', action);
    expect(action.hide).toHaveBeenCalled();
    expect(action.commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(action.commit).toHaveBeenCalledTimes(1);
  });

  it('restores on Annulla and never commits', async () => {
    const action = steps();
    undoable('Eliminato', action);
    annulla();
    await vi.advanceTimersByTimeAsync(5000);
    expect(action.restore).toHaveBeenCalledTimes(1);
    expect(action.commit).not.toHaveBeenCalled();
  });

  it('commits when the page is hidden, once', async () => {
    const action = steps();
    undoable('Eliminato', action);
    fakeDocument.visibilityState = 'hidden';
    listeners.forEach((listener) => listener());
    await vi.advanceTimersByTimeAsync(5000);
    expect(action.commit).toHaveBeenCalledTimes(1);
  });

  it('restores and says so when the commit fails', async () => {
    const action = { ...steps(), commit: vi.fn().mockRejectedValue(new Error('offline')) };
    undoable('Eliminato', action);
    await vi.advanceTimersByTimeAsync(5000);
    expect(action.restore).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenLastCalledWith('Non salvato, riprova');
  });
});
