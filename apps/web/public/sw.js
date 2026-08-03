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

/**
 * App-shell files to cache at install time, injected by scripts/stamp-sw.mjs
 * from the real build output (the JS/CSS filenames are content-hashed).
 *
 * This must not rely on the runtime handler below to fill the cache: the
 * worker only starts controlling the page *after* the first load, so the
 * scripts and styles fetched during that first load never pass through it.
 * Without precaching, the very first offline launch renders a blank page.
 *
 * The dictionary is deliberately excluded — it is megabytes, and the app
 * caches it itself on first use (or via "Download for offline use" in
 * Settings), in a cache this worker neither fills nor clears.
 */
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Cache entries individually so one bad URL cannot void the whole set.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => {
            /* keep installing; the runtime handler can still fill this in */
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // yomeyo-dict is the app's own: a redeploy must not throw away a
      // dictionary the user downloaded over mobile data. It revalidates
      // itself instead.
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE && k !== "yomeyo-dict").map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Same-origin GETs only: never intercept sync traffic to the server.
  if (event.request.method !== "GET" || url.origin !== location.origin) return;

  // The dictionary is handled by the app itself, and must not come through
  // here. Serving it from this worker means streaming ~19MB back through
  // JavaScript, which measured about 2.5 seconds on a phone-class CPU —
  // against ~100ms for the app reading the same bytes out of Cache Storage
  // directly. See apps/web/src/dict-bytes.ts.
  if (url.pathname.includes("/dict/")) return;

  // The audio endpoint is live server code: its availability probe must see
  // the server's answer of the moment (the key can be deployed between app
  // updates), and the app caches the clips itself in IndexedDB. A cached
  // copy here would freeze both.
  if (url.pathname.endsWith("/audio.php")) return;

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
