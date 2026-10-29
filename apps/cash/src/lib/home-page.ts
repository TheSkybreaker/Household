import { redirect } from '@household/shared/auth';
import { signOut } from '@household/shared/session';

export function homePage() {
  return {
    sheet: null as 'profile' | null,
    logoutFailed: false,

    async logout() {
      this.logoutFailed = !(await signOut());
      if (!this.logoutFailed) redirect('/login/');
    },
  };
}
