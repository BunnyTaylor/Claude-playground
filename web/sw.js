/*
 * Service worker — makes the app fully offline-capable and installable.
 *
 * The whole app is static, so we cache the app shell on install and serve it
 * cache-first. Bump CACHE when any shell file changes to roll the update out.
 */
const CACHE = "mushroom-v2";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "crochet-core.js",
  "crochet-viz.js",
  "registry.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req)
        .then((resp) => {
          // cache same-origin successful responses for next time
          if (resp.ok && new URL(req.url).origin === self.location.origin) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match("index.html"))
    )
  );
});
