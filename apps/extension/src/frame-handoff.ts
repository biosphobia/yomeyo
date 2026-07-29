/**
 * Handing saved words to the app without waiting for the app to be opened.
 *
 * An extension cannot write into a website's storage. What it can do is load
 * a page of that site in a frame and let the page do the writing — and the
 * app ships a tiny one, `sync.html`, for exactly this. A frame of one origin
 * inside another is normally given its own partitioned storage, which would
 * make this useless; an extension holding host permissions for the origin is
 * exempt, so the frame really does write into the deck the app reads.
 *
 * The frame needs a document, which a Chromium service worker does not have —
 * there this runs in an offscreen document, and on Firefox in the event page
 * itself. Both use the code below.
 */

const FROM_EXTENSION = "yomeyo-extension";
const FROM_FRAME = "yomeyo-sync-frame";

/** How long to wait for the app's page to load and answer. */
const TIMEOUT_MS = 20000;

/**
 * Load `frameUrl` hidden, hand `cards` over, and resolve with the ids the
 * page accepted. Rejects if the page cannot be reached or does not answer.
 */
export function handOverViaFrame(frameUrl: string, cards: unknown[]): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;border:0";

    let settled = false;
    const finish = (err: Error | null, ids: string[] = []): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      if (err) reject(err);
      else resolve(ids);
    };

    const onMessage = (ev: MessageEvent): void => {
      const data = ev.data as { source?: string; type?: string; ids?: unknown; error?: string } | null;
      if (data?.source !== FROM_FRAME) return;
      if (data.type === "ready") {
        frame.contentWindow?.postMessage({ source: FROM_EXTENSION, type: "cards", cards }, "*");
      } else if (data.type === "stored") {
        finish(null, Array.isArray(data.ids) ? (data.ids as string[]) : []);
      } else if (data.type === "failed") {
        finish(new Error(data.error ?? "the app could not store the words"));
      }
    };

    const timer = setTimeout(() => finish(new Error("the app's page did not answer")), TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    frame.src = frameUrl;
    document.body.appendChild(frame);
  });
}

/** Where the drop-box page lives, given the configured app URL. */
export function syncFrameUrl(appUrl: string): string {
  const base = appUrl.endsWith("/") ? appUrl : appUrl + "/";
  return new URL("sync.html", base).href;
}
