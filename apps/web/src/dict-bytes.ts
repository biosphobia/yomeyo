/**
 * Getting the dictionary's bytes onto the page as fast as the device allows.
 *
 * The obvious `fetch()` is the slow way here. Once a service worker is
 * installed it intercepts the request and streams the response back through
 * JavaScript, and for a dictionary this size that indirection alone measured
 * about 2.5 seconds on a phone-class CPU — against roughly 100ms for reading
 * the very same bytes straight out of the cache it was serving them from.
 * So the dictionary is read from Cache Storage directly, and the service
 * worker deliberately leaves `dict/` requests alone.
 *
 * The cache is also what makes the app work offline, so it is owned here
 * rather than by the worker's per-deploy cache: a redeploy should not throw
 * away a dictionary the user may have downloaded over mobile data. Freshness
 * is handled instead by revalidating in the background, after the bytes the
 * user is waiting for have already been handed over.
 */

const DICT_CACHE = "yomeyo-dict";

function cacheStorage(): CacheStorage | null {
  try {
    return typeof caches !== "undefined" ? caches : null;
  } catch {
    return null; // some browsers throw on insecure origins
  }
}

/**
 * Ask the server whether the dictionary has changed, and quietly replace the
 * cached copy if it has. Never blocks a lookup: the new bytes are picked up
 * on the next load.
 */
async function revalidate(cache: Cache, url: string, cached: Response): Promise<void> {
  const etag = cached.headers.get("etag");
  const modified = cached.headers.get("last-modified");
  if (!etag && !modified) return; // nothing to compare against

  const headers: Record<string, string> = {};
  if (etag) headers["if-none-match"] = etag;
  else if (modified) headers["if-modified-since"] = modified;

  try {
    // no-store so this really reaches the server rather than the HTTP cache.
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.status === 200) await cache.put(url, res);
  } catch {
    /* offline, or the server does not do conditional requests */
  }
}

/** The dictionary's bytes, from the cache when possible. */
export async function loadDictBytes(url: string): Promise<ArrayBuffer> {
  const store = cacheStorage();
  let cache: Cache | null = null;
  if (store) {
    try {
      cache = await store.open(DICT_CACHE);
    } catch {
      cache = null; // private mode, or storage denied
    }
  }

  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      // Check for a new dictionary, but do not wait for the answer.
      void revalidate(cache, url, hit.clone());
      return hit.arrayBuffer();
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the dictionary (${res.status})`);
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch {
      /* out of quota: the dictionary still works, just not offline */
    }
  }
  return res.arrayBuffer();
}

/** True once the dictionary is stored for offline use. */
export async function isDictCached(url: string): Promise<boolean> {
  const store = cacheStorage();
  if (!store) return false;
  try {
    return !!(await (await store.open(DICT_CACHE)).match(url));
  } catch {
    return false;
  }
}
