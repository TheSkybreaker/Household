import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { notificationText, type PushPayload } from './lib/notification';

declare let self: ServiceWorkerGlobalScope;

// Chrome supports these options; the TypeScript library does not list them yet.
interface ShowNotificationOptions extends NotificationOptions {
  actions?: { action: string; title: string }[];
  renotify?: boolean;
  vibrate?: number[];
}

// Only the app shell is precached. /api requests are never in the manifest, so they always reach
// the network. Query parameters such as ?id= are ignored: every list shares the same page.
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/.*/] });
cleanupOutdatedCaches();

// "Aggiorna" in the new version toast activates the waiting service worker.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('push', (event) => {
  const payload = event.data?.json() as PushPayload | undefined;
  if (payload) event.waitUntil(showItemAdded(payload));
});

async function showItemAdded(payload: PushPayload) {
  // With the app on screen the realtime connection already shows the item. Chrome accepts a push
  // without a notification only in that case.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (payload.type !== 'test' && windows.some((client) => client.visibilityState === 'visible')) return;

  // Items added in a row to the same list share one notification.
  const [previous] = await self.registration.getNotifications({ tag: payload.listId });
  const items: string[] = [...(previous?.data?.items ?? []), payload.item];
  const { title, body } = notificationText(payload, items);

  const options: ShowNotificationOptions = {
    body,
    tag: payload.listId,
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    vibrate: [80, 40, 80],
    actions: [{ action: 'open', title: 'Apri lista' }],
    data: { listId: payload.listId, items },
  };
  await self.registration.showNotification(title, options);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openList(`/lista/?id=${encodeURIComponent(event.notification.data?.listId ?? '')}`));
});

// Brings an open window to the list, or opens a new one.
async function openList(url: string) {
  const [window] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (window) {
    await window.focus();
    try {
      // navigate() works only on windows this worker controls.
      await window.navigate(url);
      return;
    } catch {
      // Fall through to a new window.
    }
  }
  await self.clients.openWindow(url);
}
