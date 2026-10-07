import { redirect } from '@household/shared/auth';
import { signOut } from '@household/shared/session';

export function homePage() {
  return {
    sheet: null as 'profile' | null,

    async logout() {
      if (await signOut()) redirect('/login/');
    },
  };
}
