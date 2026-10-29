import { redirect } from '@household/shared/auth';
import { signOut } from '@household/shared/session';
import { clearCache } from './cache';
import { forgetDevice, syncPush } from './push';
import { toast } from './stores';

export { checkSession, guardPage, isRedirecting, loginPage } from '@household/shared/auth';

export type PageName = 'login' | 'home' | 'list';

export async function logout() {
  await forgetDevice();
  if (!(await signOut())) {
    // Still signed in: the server takes this phone's subscription back, so its notifications go on.
    await syncPush();
    toast().show('Non salvato, riprova');
    return;
  }
  clearCache();
  redirect('/login/');
}
