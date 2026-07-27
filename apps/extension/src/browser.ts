/**
 * Cross-browser WebExtension API shim.
 *
 * Chromium exposes `chrome` with callback-style APIs; Firefox (including
 * Firefox for Android) exposes `browser` with promise-style APIs and also
 * provides `chrome` for compatibility. Normalising here keeps the rest of the
 * extension free of per-engine branching.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const chrome: any;
declare const browser: any;

const globalAny = globalThis as any;

/** The extension API namespace, whichever the engine provides. */
export const ext: any =
  typeof globalAny.browser !== "undefined" && globalAny.browser?.runtime
    ? globalAny.browser
    : globalAny.chrome;

/** True when the engine's APIs already return promises (Firefox). */
const promiseStyle =
  typeof globalAny.browser !== "undefined" && globalAny.browser?.runtime !== undefined;

/** Send a message to the background script, promise-style on both engines. */
export function sendMessage<T = any>(message: unknown): Promise<T> {
  if (promiseStyle) return ext.runtime.sendMessage(message);
  return new Promise<T>((resolve) => {
    ext.runtime.sendMessage(message, (response: T) => {
      // Reading lastError suppresses "Unchecked runtime.lastError" noise when
      // the background worker is still spinning up.
      void ext.runtime.lastError;
      resolve(response);
    });
  });
}

/** Read keys from local storage, promise-style on both engines. */
export function storageGet<T = any>(keys: string | string[]): Promise<T> {
  if (promiseStyle) return ext.storage.local.get(keys);
  return new Promise<T>((resolve) => ext.storage.local.get(keys, resolve));
}

/** Write to local storage, promise-style on both engines. */
export function storageSet(items: Record<string, unknown>): Promise<void> {
  if (promiseStyle) return ext.storage.local.set(items);
  return new Promise<void>((resolve) => ext.storage.local.set(items, () => resolve()));
}

/** Resolve a packaged file to a URL usable from the extension context. */
export function resourceUrl(path: string): string {
  return ext.runtime.getURL(path);
}

/** Every open tab whose URL matches the pattern. */
export async function tabsMatching(urlPattern: string): Promise<Array<{ id?: number }>> {
  const query = { url: urlPattern };
  try {
    const tabs: any[] = promiseStyle
      ? await ext.tabs.query(query)
      : await new Promise((resolve) => ext.tabs.query(query, resolve));
    return tabs ?? [];
  } catch {
    return []; // an unusable pattern must not break saving a word
  }
}

/** The tab the user is currently looking at, or null. */
export async function activeTab(): Promise<{ id?: number } | null> {
  const query = { active: true, currentWindow: true };
  const tabs: any[] = promiseStyle
    ? await ext.tabs.query(query)
    : await new Promise((resolve) => ext.tabs.query(query, resolve));
  return tabs?.[0] ?? null;
}

/**
 * Message a tab's content script. Resolves to null when no content script is
 * listening there (extension pages, the new-tab page, PDF viewers, …) rather
 * than rejecting, so callers can fall back.
 */
export async function sendToTab<T = any>(tabId: number, message: unknown): Promise<T | null> {
  try {
    if (promiseStyle) return await ext.tabs.sendMessage(tabId, message);
    return await new Promise<T | null>((resolve) => {
      ext.tabs.sendMessage(tabId, message, (response: T) => {
        void ext.runtime.lastError;
        resolve(response ?? null);
      });
    });
  } catch {
    return null;
  }
}
