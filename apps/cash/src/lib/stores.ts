import Alpine from 'alpinejs';
import { pb, type User } from '@household/shared/pb';
import { cachedUser } from '@household/shared/session';

export interface SessionStore {
  me: User | null;
  online: boolean;
  initial(userId: string): string;
  avatarClass(userId: string): string;
}

export const session = () => Alpine.store('session') as SessionStore;

function sessionStore(): SessionStore {
  return {
    me: cachedUser(),
    online: navigator.onLine,
    initial(userId) {
      const name = userId === this.me?.id ? this.me.name : '';
      return (name.trim().charAt(0) || '?').toUpperCase();
    },
    avatarClass(userId) {
      return userId === this.me?.id && this.me.color === 'sun' ? 'av-sun' : 'av-sky';
    },
  };
}

export function registerStores() {
  Alpine.store('session', sessionStore());

  pb.authStore.onChange(() => {
    session().me = (pb.authStore.record as User | null) ?? cachedUser();
  });
  addEventListener('online', () => (session().online = true));
  addEventListener('offline', () => (session().online = false));
}
