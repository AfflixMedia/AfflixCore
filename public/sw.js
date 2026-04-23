// Afflix Core service worker — handles web push (Phase 2).
// Phase 1 (in-app realtime) works without this file's push handler firing.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: event.data ? event.data.text() : 'Notification' }; }
  const title = data.title || 'Afflix Core';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { link: data.link || '/' },
    tag: data.tag || 'afflix-core',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetLink = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.location.origin)) {
        c.focus();
        c.postMessage({ type: 'navigate', link: targetLink });
        return;
      }
    }
    await self.clients.openWindow(targetLink);
  })());
});
