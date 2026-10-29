import collapse from '@alpinejs/collapse';
import focus from '@alpinejs/focus';
import type { Alpine } from 'alpinejs';
import { appLinks } from '@household/shared/apps';
import { checkSession, guardPage, isRedirecting, loginPage, type PageName } from './auth';
import { clearCache } from './cache';
import { composer } from './composer';
import { homePage } from './home-page';
import { listPage } from './list-page';
import { syncPush } from './push';
import { registerServiceWorker, trackInstall } from './pwa';
import { trackConnection } from './realtime';
import { registerStores } from './stores';

// Entrypoint of @astrojs/alpinejs: runs on every page before Alpine starts.
export default (Alpine: Alpine) => {
  Alpine.plugin(focus);
  Alpine.plugin(collapse);
  registerStores();
  registerServiceWorker();
  trackInstall();

  Alpine.data('loginPage', loginPage);
  Alpine.data('homePage', homePage);
  Alpine.data('listPage', listPage);
  Alpine.data('composer', composer);
  Alpine.data('appLinks', appLinks);

  const page = document.body.dataset.page as PageName;
  guardPage(page === 'login');
  if (page !== 'login' && !isRedirecting()) {
    trackConnection();
    void checkSession(clearCache);
    void syncPush();
    // The other app may have signed out meanwhile.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkSession(clearCache);
    });
  }
};
