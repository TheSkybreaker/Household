import Alpine from 'alpinejs';
import { createToastStore, type ToastStore } from './toast-store';

export type { ToastAction, ToastStore } from './toast-store';

export const toast = () => Alpine.store('toast') as ToastStore;

export function registerToast() {
  Alpine.store('toast', createToastStore());
}
