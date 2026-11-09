import { toast } from './toast';

const UNDO_MS = 5000;
const FAILED = 'Non salvato, riprova';

// Does something at once, so everything that depends on it changes with it, then offers Annulla in
// the toast for undoMs. A failure, of the action or of Annulla, says so in the toast instead.
export async function undoable(message: string, steps: { run(): Promise<void>; undo(): Promise<void> }, undoMs = UNDO_MS) {
  try {
    await steps.run();
  } catch {
    toast().show(FAILED);
    return;
  }
  toast().show(
    message,
    {
      label: 'Annulla',
      run: () => void steps.undo().catch(() => toast().show(FAILED)),
    },
    undoMs,
  );
}
