/**
 * Dynamic imports that survive a deploy.
 *
 * The app's chunks are content-hashed, and a deploy replaces them. A page
 * that was already open still asks for the OLD hashes when a lazy screen
 * is first visited — the server no longer has them, and the browser says
 * "Importing a module script failed". The page itself is the stale thing,
 * so the fix is one reload: the fresh page loads fresh hashes.
 *
 * The timestamp guard keeps a genuinely broken build from reloading in a
 * loop: one reload per half-minute, then the error is allowed through.
 */

const RELOAD_KEY = "chunkReloadAt";

export async function lazyImport<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    } catch {
      // Storage denied: reload once per page lifetime is still safe-ish,
      // but without the guard, don't risk the loop.
      throw error;
    }
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      location.reload();
      // The page is going away; never resolve into the torn-down world.
      await new Promise<never>(() => undefined);
    }
    throw error;
  }
}
