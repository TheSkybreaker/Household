const TOAST_MS = 2800;

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastStore {
  message: string;
  actionLabel: string;
  visible: boolean;
  // durationMs null keeps the toast until it is tapped or replaced.
  show(message: string, action?: ToastAction, durationMs?: number | null): void;
  act(): void;
  hide(): void;
}

export function createToastStore(): ToastStore {
  let action: ToastAction | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    message: '',
    actionLabel: '',
    visible: false,
    show(message, nextAction, durationMs = TOAST_MS) {
      action = nextAction;
      this.message = message;
      this.actionLabel = nextAction?.label ?? '';
      this.visible = true;
      clearTimeout(timer);
      if (durationMs !== null) timer = setTimeout(() => this.hide(), durationMs);
    },
    act() {
      const run = action?.run;
      this.hide();
      run?.();
    },
    hide() {
      action = undefined;
      this.visible = false;
    },
  };
}
