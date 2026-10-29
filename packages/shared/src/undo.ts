import { toast } from './toast';

const UNDO_MS = 5000;

const waiting = new Set<() => Promise<void>>();

// Hides something at once and makes it final after undoMs, unless Annulla in the toast restores it.
// A commit that fails restores it as well.
export function undoable(message: string, steps: { hide(): void; restore(): void; commit(): Promise<void> }, undoMs = UNDO_MS) {
  let settled = false;

  const finish = async () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    waiting.delete(finish);
    try {
      await steps.commit();
    } catch {
      steps.restore();
      toast().show('Non salvato, riprova');
    }
  };

  steps.hide();
  const timer = setTimeout(() => void finish(), undoMs);
  waiting.add(finish);
  toast().show(
    message,
    {
      label: 'Annulla',
      run: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiting.delete(finish);
        steps.restore();
      },
    },
    undoMs,
  );
}

// Leaving the app ends the undo window: the page may never come back to run the timers.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') [...waiting].forEach((finish) => void finish());
  });
}
