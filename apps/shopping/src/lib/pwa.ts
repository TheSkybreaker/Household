import { registerSW } from 'virtual:pwa-register';
import { session } from './stores';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let installPrompt: InstallPromptEvent | null = null;

// A new version takes over by itself (registerType autoUpdate). onNeedReload replaces the reload
// the plugin would do then, so the page in use stays as it is: the new version arrives with the
// next page load, such as reopening the app or opening a list.
export function registerServiceWorker() {
  registerSW({ onNeedReload() {} });
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
