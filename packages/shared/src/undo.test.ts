import { beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.fn();
vi.mock('./toast', () => ({ toast: () => ({ show }) }));
const { undoable } = await import('./undo');

const steps = () => ({ run: vi.fn().mockResolvedValue(undefined), undo: vi.fn().mockResolvedValue(undefined) });
const lastAction = () => show.mock.calls.at(-1)?.[1] as { run: () => void } | undefined;

beforeEach(() => show.mockClear());

describe('undoable', () => {
  it('runs at once and offers Annulla for 5 s', async () => {
    const action = steps();
    await undoable('Eliminato', action);
    expect(action.run).toHaveBeenCalledTimes(1);
    expect(lastAction()).toBeDefined();
    expect(show.mock.calls.at(-1)?.[2]).toBe(5000);
    expect(action.undo).not.toHaveBeenCalled();
  });

  it('undoes on Annulla', async () => {
    const action = steps();
    await undoable('Eliminato', action);
    lastAction()?.run();
    await vi.waitFor(() => expect(action.undo).toHaveBeenCalledTimes(1));
  });

  it('offers no Annulla when the action fails', async () => {
    const action = { ...steps(), run: vi.fn().mockRejectedValue(new Error('offline')) };
    await undoable('Eliminato', action);
    expect(show).toHaveBeenCalledTimes(1);
    expect(lastAction()).toBeUndefined();
  });

  it('says so when Annulla fails', async () => {
    const action = { ...steps(), undo: vi.fn().mockRejectedValue(new Error('offline')) };
    await undoable('Eliminato', action);
    lastAction()?.run();
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
    expect(lastAction()).toBeUndefined();
  });
});
