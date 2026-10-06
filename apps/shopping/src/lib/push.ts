import { pb } from './pb';
import { session, toast } from './stores';

export type NotificationState = 'unsupported' | 'denied' | 'off' | 'on';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// A first guess from the permission alone, refined by syncPush, so the home card does not flash.
export function initialNotificationState(): NotificationState {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'on' : 'off';
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function saveSubscription(subscription: PushSubscription) {
  return pb.send('/api/push/subscribe', { method: 'POST', body: subscription.toJSON() });
}

// The VAPID public key comes as base64url text; the Push API wants its bytes.
function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

// At every start with the permission granted, the subscription goes to the server again: it covers
// endpoint changes.
export async function syncPush() {
  session().notifications = initialNotificationState();
  if (session().notifications !== 'on') return;

  const subscription = await currentSubscription();
  session().notifications = subscription ? 'on' : 'off';
  if (subscription) await saveSubscription(subscription).catch(() => undefined);
}

// Asks for the permission, so it must run from a tap.
export async function enableNotifications() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    session().notifications = permission === 'denied' ? 'denied' : 'off';
    return;
  }

  try {
    const { publicKey } = await pb.send<{ publicKey: string }>('/api/push/key', {});
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await saveSubscription(subscription);
    session().notifications = 'on';
    toast().show('Notifiche attivate');
  } catch {
    toast().show('Non salvato, riprova');
  }
}

export async function disableNotifications() {
  try {
    const subscription = await currentSubscription();
    if (subscription) {
      await pb.send('/api/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
      await subscription.unsubscribe();
    }
    session().notifications = 'off';
    toast().show('Notifiche disattivate');
  } catch {
    toast().show('Non salvato, riprova');
  }
}

// Before signing out, so this phone stops receiving the pushes of the account leaving it.
export async function forgetDevice() {
  if (!supported()) return;
  try {
    const subscription = await currentSubscription();
    if (subscription) await pb.send('/api/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
  } catch {
    // Offline: the server keeps the subscription until the push service drops it.
  }
}

export async function sendTestPush() {
  try {
    await pb.send('/api/push/test', { method: 'POST' });
  } catch {
    toast().show('Non salvato, riprova');
  }
}
