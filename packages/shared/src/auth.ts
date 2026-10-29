import { cachedUser, refreshSession, signIn } from './session';

let redirecting = false;

// Pages skip their setup while the guard is sending the browser elsewhere.
export function isRedirecting(): boolean {
  return redirecting;
}

export function redirect(url: string) {
  redirecting = true;
  location.replace(url);
}

// App pages open from the cached user, so they work offline. Without it the login page decides,
// because a sign-in in the other app already counts here.
export function guardPage(isLoginPage: boolean) {
  if (!isLoginPage && !cachedUser()) redirect('/login/');
}

// Confirms the session in the background: a rejected cookie, for example after Esci in the other
// app, sends the app to the login page after forgetSession drops what it kept for that session.
export async function checkSession(forgetSession?: () => void) {
  if ((await refreshSession()) !== 'signed-out') return;
  forgetSession?.();
  redirect('/login/');
}

export function loginPage() {
  return {
    username: '',
    password: '',
    error: '',
    busy: false,
    // The form shows once the cookie turned out not to hold a session.
    ready: false,

    async init() {
      if ((await refreshSession()) === 'signed-in') redirect('/');
      else this.ready = true;
    },

    async submit() {
      this.busy = true;
      this.error = '';
      try {
        await signIn(this.username, this.password);
        redirect('/');
      } catch {
        this.error = 'Nome utente o password non corretti.';
        this.busy = false;
      }
    },
  };
}
