/*
 * Service worker — makes the app fully offline-capable and installable.
 *
 * Strategy: **network-first** for same-origin requests. When online you always
 * get the freshly deployed files (so a new release shows up on the next load,
 * with no cache-busting dance); the cache is only the offline fallback. Bump
 * CACHE when the precached ASSET list itself changes.
 *
 * (The previous version was cache-first, which meant a returning visitor kept
 * seeing the first files their browser ever cached — updates never showed.)
 */
const CACHE = "mushroom-v11";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "crochet-core.js",
  "crochet-viz.js",
  "registry.js",
  "color-names.js",
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
  // Only manage our own origin; let anything cross-origin go straight to network.
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // `cache: "no-cache"` forces the SW to revalidate with the server (a
    // conditional request) instead of trusting the browser's HTTP cache — so a
    // freshly deployed script can never be masked by a still-valid cached copy.
    fetch(req, { cache: "no-cache" })
      .then((resp) => {
        // Freshest copy wins — refresh the cache for offline use next time.
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      })
      .catch(() =>
        // Offline (or the network failed): serve the cached copy, falling back
        // to the app shell for navigations so the SPA still boots.
        caches.match(req).then((hit) => hit || caches.match("index.html"))
      )
  );
});
