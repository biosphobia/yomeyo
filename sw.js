/* Yomeyo service worker.
 *
 * Cache-first for the app shell and the dictionary so reviews and lookups
 * work offline (and so the multi-megabyte dictionary is downloaded once).
 *
 * BUILD_ID is stamped by the deploy workflow; every deploy therefore gets a
 * fresh cache and clients pick up the new dictionary instead of serving a
 * stale one forever.
 */
const BUILD_ID = "eb6642d0ad02";
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
  "./assets/accounts-WZN5CFdX.js",
  "./assets/admin-panel-4hEmrzRG.js",
  "./assets/anki-import-DHqW337N.js",
  "./assets/auto-sync-D8onJym1.js",
  "./assets/book-view-_fUkAqtY.js",
  "./assets/card-DsqtbGFJ.js",
  "./assets/casino-BHVgw8Xk.js",
  "./assets/casino-gate-C_UM-IgY.js",
  "./assets/cloud-BuPD2oGo.js",
  "./assets/deck-build-DR4C8OKE.js",
  "./assets/deck-edit-Bd3eoiID.js",
  "./assets/deck-refresh-CINVqqwU.js",
  "./assets/deck-sync-DUhjoI9B.js",
  "./assets/door-keys-D0_KGJ7H.js",
  "./assets/feedback-B51RI4L2.js",
  "./assets/gacha-DRowGKdC.js",
  "./assets/gacha-audio-fG1ZURVx.js",
  "./assets/gacha-collection-7pa3EGv8.js",
  "./assets/gacha-data-B74dNing.js",
  "./assets/gacha-roll-DKLw5n5G.js",
  "./assets/gacha-scene-DFBz1RYy.js",
  "./assets/index-BU38kawt.css",
  "./assets/index-C0q5K_Wr.js",
  "./assets/index-Dx2Zjubn.js",
  "./assets/kana-duel-sXAVfPBf.js",
  "./assets/kana-exam-Br0LCn2H.js",
  "./assets/library-W5jfw358.js",
  "./assets/media-DYzEgu4n.js",
  "./assets/modulepreload-polyfill-B5Qt9EMX.js",
  "./assets/ocr-jobs-BUVKTBr5.js",
  "./assets/ocr-resume-DQb7bAyc.js",
  "./assets/pdf-ksa_hnld.js",
  "./assets/pdf.worker.min-yatZIOMy.mjs",
  "./assets/profile-Y4JJx_-_.js",
  "./assets/progress-sync-gP5dNRmw.js",
  "./assets/review-stats-C-nIqcXo.js",
  "./assets/skins-D-9h-pRe.js",
  "./assets/store-N04W-om1.js",
  "./assets/sync-BXi5DMiG.js",
  "./assets/unlock-B9fOAItM.js",
  "./assets/zip-BeuNSCwz.js",
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
  "./ocr-bg.js",
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
