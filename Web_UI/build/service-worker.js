// Maintenix legacy service-worker recovery.
// The active offline worker is /offline-sw.js. This file remains only so
// older bundles that still register /service-worker.js clear stale Workbox
// caches and get out of the way.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.indexOf("maintenix-offline-shell-") !== 0).map((key) => caches.delete(key)));
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
  })());
});
