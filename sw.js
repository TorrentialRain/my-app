// The old Hub's offline helper, retired Nov 26, 2026. A phone that still has it picks up this version,
// which throws away the old saved copies and switches itself off, so nothing old can be shown again.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const tabs = await self.clients.matchAll({ type: 'window' });
    tabs.forEach((t) => t.navigate(t.url).catch(() => {}));
  })());
});
