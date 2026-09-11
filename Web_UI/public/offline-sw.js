/* Maintenix offline app-shell service worker. */
const CACHE_NAME = "maintenix-offline-shell-20260910-v120";
const SCOPE_URL = new URL(self.registration.scope);
const BASE_PATH = SCOPE_URL.pathname.endsWith("/") ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;

function scoped(relativePath = "") {
  return new URL(String(relativePath || "").replace(/^\/+/, ""), self.registration.scope).pathname;
}

const CORE_ASSETS = [
  scoped(""),
  scoped("index.html"),
  scoped("site.webmanifest"),
  scoped("favicon.ico"),
  scoped("android-chrome-192x192.png"),
  scoped("android-chrome-512x512.png"),
  scoped("apple-touch-icon.png"),
  scoped("favicon-16x16.png"),
  scoped("favicon-32x32.png")
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(CORE_ASSETS);

  try {
    const manifestRes = await fetch(scoped("asset-manifest.json"), { cache: "no-store" });
    if (!manifestRes.ok) return;

    const manifest = await manifestRes.json();
    const staticPrefix = scoped("static/");
    const files = Object.values(manifest.files || {}).filter((value) => {
      try {
        const pathname = new URL(String(value || ""), self.location.origin).pathname;
        return pathname.startsWith(staticPrefix) || pathname === scoped("index.html");
      } catch {
        return false;
      }
    });

    await cache.addAll(files);
  } catch {
    // Core assets are enough to open the shell; hashed bundles are best-effort.
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(cacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE_PATH)) return;
  if (url.pathname.startsWith(scoped("api/"))) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(scoped("index.html"), copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(scoped("index.html")))
    );
    return;
  }

  const staticPrefix = scoped("static/");
  if (url.pathname.startsWith(staticPrefix) || CORE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        });
      })
    );
  }
});
