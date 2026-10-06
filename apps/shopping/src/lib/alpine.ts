import collapse from '@alpinejs/collapse';
import focus from '@alpinejs/focus';
import type { Alpine } from 'alpinejs';
import { guardPage, isRedirecting, loginPage, refreshSession, type PageName } from './auth';
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

  const page = document.body.dataset.page as PageName;
  guardPage(page);
  if (page !== 'login' && !isRedirecting()) {
    trackConnection();
    void refreshSession();
    void syncPush();
  }
};
