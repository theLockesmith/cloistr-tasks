// frontend/public/sw.js
//
// Minimal service worker for browser push notifications on board activity.
// Registered from src/lib/push.js. Deliberately does not do anything with
// fetch/caching — this is push-only, not an offline-first app shell.

self.addEventListener('install', () => {
  // Activate immediately instead of waiting for old clients to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  // Payload is always the small {title, body, url} JSON object sent by
  // backend/lib/notify.js. Guard against a missing/unparseable payload
  // (push delivery does not guarantee data survives every push service).
  let data = { title: 'Cloistr Tasks', body: 'Something happened on one of your boards.' };
  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch (err) {
    // Not JSON — fall back to the default body above.
  }

  const options = {
    body: data.body,
    icon: '/logo192.png',
    badge: '/favicon-32.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab if one is already open, navigating it to the
      // notification's target instead of always opening a new tab.
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) {
            client.navigate(targetUrl).catch(() => {});
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
