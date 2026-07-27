/* Yomeyo service worker.
 *
 * Cache-first for the app shell and the dictionary so reviews and lookups
 * work offline (and so the multi-megabyte dictionary is downloaded once).
 *
 * BUILD_ID is stamped by the deploy workflow; every deploy therefore gets a
 * fresh cache and clients pick up the new dictionary instead of serving a
 * stale one forever.
 */
const BUILD_ID = "__BUILD_ID__";
const CACHE = `yomeyo-${BUILD_ID}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["./", "./manifest.webmanifest"]))
      .catch(() => {
        /* a failed precache must not block activation */
      }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Same-origin GETs only: never intercept sync traffic to the server.
  if (event.request.method !== "GET" || url.origin !== location.origin) return;

  // Navigations: network-first so a new deploy is picked up promptly, with
  // the cached shell as the offline fallback.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match("./"))),
    );
    return;
  }

  // Everything else (assets, dictionary): cache-first.
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
