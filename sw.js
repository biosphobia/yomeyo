/* Yomeyo service worker.
 *
 * Cache-first for the app shell and the dictionary so reviews and lookups
 * work offline (and so the multi-megabyte dictionary is downloaded once).
 *
 * BUILD_ID is stamped by the deploy workflow; every deploy therefore gets a
 * fresh cache and clients pick up the new dictionary instead of serving a
 * stale one forever.
 */
const BUILD_ID = "0429e0f08296";
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
const PRECACHE = [
  "./",
  "./assets/SkeletonUtils-PH-FjEqV.js",
  "./assets/accounts-WTK4qg94.js",
  "./assets/anki-import-BcqP_Wq9.js",
  "./assets/card-DloYQ9Ck.js",
  "./assets/casino-CK1qjOx2.js",
  "./assets/casino-gate-DtpzB93p.js",
  "./assets/cloud-BrAf8IS0.js",
  "./assets/deck-edit-C5287PMD.js",
  "./assets/deck-sync-AHrIQBeC.js",
  "./assets/gacha-BcoIoU6P.js",
  "./assets/gacha-collection-CB8hFBPg.js",
  "./assets/gacha-data-CaT_Zqip.js",
  "./assets/gacha-roll-PtFkHMTq.js",
  "./assets/gacha-scene-DtWv1Tj3.js",
  "./assets/index-B6BmWXm8.css",
  "./assets/index-CGRRECQs.js",
  "./assets/kana-duel-CMjbBTMx.js",
  "./assets/library-BxlHCIkX.js",
  "./assets/modulepreload-polyfill-B5Qt9EMX.js",
  "./assets/profile-VM8BKhqX.js",
  "./assets/skins-D9f5ijRb.js",
  "./assets/store-Dxti2Gd4.js",
  "./assets/sync-Ci_V7IYI.js",
  "./assets/unlock-CrtL2933.js",
  "./feedback/feedback.json",
  "./gacha/prizes.json",
  "./icons/icon-128.png",
  "./icons/icon-192.png",
  "./icons/icon-48.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./kanji/index.json",
  "./kanji/strokes/200.json",
  "./kanji/strokes/20b.json",
  "./kanji/strokes/34.json",
  "./kanji/strokes/4e.json",
  "./kanji/strokes/4f.json",
  "./kanji/strokes/50.json",
  "./kanji/strokes/51.json",
  "./kanji/strokes/52.json",
  "./kanji/strokes/53.json",
  "./kanji/strokes/54.json",
  "./kanji/strokes/55.json",
  "./kanji/strokes/56.json",
  "./kanji/strokes/57.json",
  "./kanji/strokes/58.json",
  "./kanji/strokes/59.json",
  "./kanji/strokes/5a.json",
  "./kanji/strokes/5b.json",
  "./kanji/strokes/5c.json",
  "./kanji/strokes/5d.json",
  "./kanji/strokes/5e.json",
  "./kanji/strokes/5f.json",
  "./kanji/strokes/60.json",
  "./kanji/strokes/61.json",
  "./kanji/strokes/62.json",
  "./kanji/strokes/63.json",
  "./kanji/strokes/64.json",
  "./kanji/strokes/65.json",
  "./kanji/strokes/66.json",
  "./kanji/strokes/67.json",
  "./kanji/strokes/68.json",
  "./kanji/strokes/69.json",
  "./kanji/strokes/6a.json",
  "./kanji/strokes/6b.json",
  "./kanji/strokes/6c.json",
  "./kanji/strokes/6d.json",
  "./kanji/strokes/6e.json",
  "./kanji/strokes/6f.json",
  "./kanji/strokes/70.json",
  "./kanji/strokes/71.json",
  "./kanji/strokes/72.json",
  "./kanji/strokes/73.json",
  "./kanji/strokes/74.json",
  "./kanji/strokes/75.json",
  "./kanji/strokes/76.json",
  "./kanji/strokes/77.json",
  "./kanji/strokes/78.json",
  "./kanji/strokes/79.json",
  "./kanji/strokes/7a.json",
  "./kanji/strokes/7b.json",
  "./kanji/strokes/7c.json",
  "./kanji/strokes/7d.json",
  "./kanji/strokes/7e.json",
  "./kanji/strokes/7f.json",
  "./kanji/strokes/80.json",
  "./kanji/strokes/81.json",
  "./kanji/strokes/82.json",
  "./kanji/strokes/83.json",
  "./kanji/strokes/84.json",
  "./kanji/strokes/85.json",
  "./kanji/strokes/86.json",
  "./kanji/strokes/87.json",
  "./kanji/strokes/88.json",
  "./kanji/strokes/89.json",
  "./kanji/strokes/8a.json",
  "./kanji/strokes/8b.json",
  "./kanji/strokes/8c.json",
  "./kanji/strokes/8d.json",
  "./kanji/strokes/8e.json",
  "./kanji/strokes/8f.json",
  "./kanji/strokes/90.json",
  "./kanji/strokes/91.json",
  "./kanji/strokes/92.json",
  "./kanji/strokes/93.json",
  "./kanji/strokes/94.json",
  "./kanji/strokes/95.json",
  "./kanji/strokes/96.json",
  "./kanji/strokes/97.json",
  "./kanji/strokes/98.json",
  "./kanji/strokes/99.json",
  "./kanji/strokes/9a.json",
  "./kanji/strokes/9b.json",
  "./kanji/strokes/9c.json",
  "./kanji/strokes/9d.json",
  "./kanji/strokes/9e.json",
  "./kanji/strokes/9f.json",
  "./manifest.webmanifest",
  "./prizes-admin.php",
  "./sync.html"
];

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
  if (url.pathname.endsWith("/grammar.php")) return;

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
