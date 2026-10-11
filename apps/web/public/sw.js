/* Minimal app-shell service worker: cache static assets, never cache API or WebSocket traffic. */
const VERSION = "nimbus-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(event.request, copy)).catch(() => {});
      return res;
    })));
    return;
  }

  // Navigation and other shell requests: network first, cached shell as fallback.
  event.respondWith(fetch(event.request).then((res) => {
    if (event.request.mode === "navigate") {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put("/", copy)).catch(() => {});
    }
    return res;
  }).catch(() => caches.match(event.request.mode === "navigate" ? "/" : event.request)));
});
