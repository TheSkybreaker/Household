import { registerSW } from 'virtual:pwa-register';
import { session, toast } from './stores';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let installPrompt: InstallPromptEvent | null = null;

export function registerServiceWorker() {
  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      // Stays until tapped: a new version is worth not missing.
      toast().show('Nuova versione disponibile', { label: 'Aggiorna', run: () => void updateServiceWorker(true) }, null);
    },
  });
}

// Chrome offers the install prompt once per page load; the profile shows "Installa l'app" while it is available.
export function trackInstall() {
  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    session().installable = true;
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    session().installable = false;
  });
}

export async function installApp() {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  session().installable = false;
}
