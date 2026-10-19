const APP_SHELL_CACHE = "maintenix-app-shell-v1";
const APP_SHELL_PREFIX = "maintenix-app-shell-";

function scopedUrl(relative) {
  return new URL(relative, self.registration.scope).href;
}

async function cacheResponse(cache, url) {
  try {
    const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
    if (response && response.ok) await cache.put(url, response.clone());
  } catch {}
}

async function cacheApplicationShell() {
  const cache = await caches.open(APP_SHELL_CACHE);
  const manifestUrl = scopedUrl("asset-manifest.json");
  const urls = new Set([
    self.registration.scope,
    scopedUrl("index.html"),
    manifestUrl,
    scopedUrl("site.webmanifest"),
    scopedUrl("favicon.ico"),
    scopedUrl("android-chrome-192x192.png"),
    scopedUrl("android-chrome-512x512.png"),
    scopedUrl("api-bootstrap.js")
  ]);

  try {
    const response = await fetch(manifestUrl, { cache: "no-store", credentials: "same-origin" });
    if (response.ok) {
      const manifest = await response.clone().json();
      await cache.put(manifestUrl, response);
      Object.values(manifest?.files || {}).forEach((value) => {
        try {
          const url = new URL(String(value || ""), self.registration.scope);
          if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) {
            urls.add(url.href);
          }
        } catch {}
      });
    }
  } catch {}

  for (const url of urls) {
    if (url === manifestUrl) continue;
    await cacheResponse(cache, url);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheApplicationShell().then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(APP_SHELL_PREFIX) && key !== APP_SHELL_CACHE)
          .map((key) => caches.delete(key))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(self.registration.scope)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response?.ok) {
            const cache = await caches.open(APP_SHELL_CACHE);
            await cache.put(scopedUrl("index.html"), response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(APP_SHELL_CACHE);
          return (
            await cache.match(scopedUrl("index.html")) ||
            await cache.match(self.registration.scope)
          );
        })
    );
    return;
  }

  const isStaticAsset =
    url.pathname.includes("/static/") ||
    /\.(?:js|css|svg|png|jpg|jpeg|webp|ico|woff2?|json|webmanifest)$/i.test(url.pathname);

  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then(async (response) => {
        if (response?.ok) {
          const cache = await caches.open(APP_SHELL_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      });
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "Maintenix",
      body: event.data ? event.data.text() : ""
    };
  }

  const title = String(payload?.title || "Maintenix");
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const notificationId = String(data?.notificationId || "").trim();
  const requiresAck = data?.requiresAck === true;

  const options = {
    body: String(payload?.body || ""),
    icon: payload?.icon || "./android-chrome-192x192.png",
    badge: payload?.badge || "./android-chrome-192x192.png",
    tag: payload?.tag || undefined,
    renotify: false,
    data
  };

  // Notification action buttons are advisory: platforms that support Web
  // Notification actions show them; platforms that do not simply ignore them.
  // Browser/OS-owned controls such as "Unsubscribe" cannot be removed here.
  if (notificationId && data?.test !== true) {
    options.actions = [
      {
        action: requiresAck ? "acknowledge" : "mark-read",
        title: requiresAck ? "Acknowledge" : "Mark as read"
      },
      {
        action: "open",
        title: "Open"
      }
    ];
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

async function focusOrOpenNotificationAction(action, notificationId) {
  const message = {
    type: "maintenix-notification-action",
    action,
    notificationId
  };

  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (!client.url.startsWith(self.registration.scope)) continue;
    try { client.postMessage(message); } catch {}
    try { return await client.focus(); } catch { return client; }
  }

  const launchUrl = new URL("./", self.registration.scope);
  launchUrl.searchParams.set("mtxNotificationAction", action);
  launchUrl.searchParams.set("mtxNotificationId", notificationId);
  return self.clients.openWindow(launchUrl.href);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const action = String(event.action || "");
  const notificationId = String(event.notification?.data?.notificationId || "").trim();

  if ((action === "mark-read" || action === "acknowledge") && notificationId) {
    event.waitUntil(focusOrOpenNotificationAction(action, notificationId));
    return;
  }

  const rawUrl = String(event.notification?.data?.url || "./");
  const targetUrl = new URL(rawUrl, self.registration.scope).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        for (const client of windows) {
          if (client.url.startsWith(self.registration.scope)) {
            try {
              await client.navigate(targetUrl);
            } catch {}
            return client.focus();
          }
        }

        return self.clients.openWindow(targetUrl);
      })
  );
});
