import { redirect } from '@household/shared/auth';
import { saveMyName, signOut } from '@household/shared/session';
import { toast } from '@household/shared/toast';
import { clearMonthCache } from './cache';
import { session } from './stores';

export function homePage() {
  return {
    sheet: null as 'profile' | null,
    logoutFailed: false,
    nameDraft: '',

    openProfile() {
      this.nameDraft = session().me?.name ?? '';
      this.sheet = 'profile';
    },

    async saveName() {
      try {
        await saveMyName(session().me, this.nameDraft);
      } catch {
        toast().show('Non salvato, riprova');
      }
    },

    async logout() {
      this.logoutFailed = !(await signOut());
      if (this.logoutFailed) return;
      clearMonthCache();
      redirect('/login/');
    },
  };
}
