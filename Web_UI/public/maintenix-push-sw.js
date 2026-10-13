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
  const options = {
    body: String(payload?.body || ""),
    icon: payload?.icon || "./android-chrome-192x192.png",
    badge: payload?.badge || "./android-chrome-192x192.png",
    tag: payload?.tag || undefined,
    renotify: false,
    data: payload?.data && typeof payload.data === "object" ? payload.data : {}
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

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
