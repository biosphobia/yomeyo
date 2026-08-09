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

/* ---------------- reading a book while nobody is watching ----------------
 *
 * "OCR all pages" is a job the app writes down rather than a loop inside
 * an open tab, so closing the tab must not end it. The batch reader is
 * built to its own file and pulled in here; the app tells this worker
 * which account is signed in and asks it to carry on.
 *
 * Two ways in. A `sync` registration is the proper one — the browser wakes
 * this worker when it feels able to, including well after the tab is gone.
 * A direct message covers the browsers with no Background Sync at all, and
 * gets a first slice done while the tab is still closing.
 *
 * How long a worker may run is not ours to decide, so each wake-up takes a
 * budget and stops cleanly inside it. Progress is written down after every
 * page, so the next wake-up (or the next time the app is opened) carries
 * straight on. Nothing is ever read twice.
 */
let ocrAccount = null;

/*
 * Loaded here at the top, because a service worker may only pull in extra
 * scripts while it is first being evaluated — not later, from inside an
 * event. The build id rides along so a new deploy never gets an old copy
 * out of the HTTP cache. A miss (an older deploy, or no network on first
 * run) is not fatal: the app goes on doing the work itself.
 */
try {
  importScripts(new URL(`./ocr-bg.js?v=${BUILD_ID}`, self.location.href).href);
} catch (err) {
  /* no background reader on this deploy */
}

function ocrReader() {
  return self.yomeyoOcrBg ?? null;
}

async function runOcrBatch(budgetMs) {
  const reader = ocrReader();
  if (!reader) return 0;
  try {
    const { left } = await reader.run(ocrAccount, budgetMs);
    // Still work to do: ask to be woken again rather than running on and
    // being killed mid-page.
    if (left > 0 && self.registration.sync) {
      await self.registration.sync.register("yomeyo-ocr").catch(() => {});
    }
    return left;
  } catch (err) {
    return 0;
  }
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "yomeyo-ocr") {
    ocrAccount = data.uid ?? null;
    event.waitUntil(runOcrBatch(data.budgetMs ?? 120000));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "yomeyo-ocr") event.waitUntil(runOcrBatch(240000));
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "yomeyo-ocr") event.waitUntil(runOcrBatch(240000));
});
