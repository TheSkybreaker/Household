import focus from '@alpinejs/focus';
import type { Alpine } from 'alpinejs';
import { appLinks } from '@household/shared/apps';
import { checkSession, guardPage, isRedirecting, loginPage } from '@household/shared/auth';
import { homePage } from './home-page';
import { registerStores } from './stores';

// Entrypoint of @astrojs/alpinejs: runs on every page before Alpine starts.
export default (Alpine: Alpine) => {
  Alpine.plugin(focus);
  registerStores();

  Alpine.data('loginPage', loginPage);
  Alpine.data('homePage', homePage);
  Alpine.data('appLinks', appLinks);

  const isLoginPage = document.body.dataset.page === 'login';
  guardPage(isLoginPage);
  if (!isLoginPage && !isRedirecting()) {
    void checkSession();
    // The other app may have signed out meanwhile.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkSession();
    });
  }
};
