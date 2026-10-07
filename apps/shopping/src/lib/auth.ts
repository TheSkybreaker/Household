import { redirect } from '@household/shared/auth';
import { signOut } from '@household/shared/session';
import { clearCache } from './cache';
import { forgetDevice } from './push';
import { toast } from './stores';

export { checkSession, guardPage, isRedirecting, loginPage } from '@household/shared/auth';

export type PageName = 'login' | 'home' | 'list';

export async function logout() {
  await forgetDevice();
  if (!(await signOut())) {
    toast().show('Non salvato, riprova');
    return;
  }
  clearCache();
  redirect('/login/');
}
