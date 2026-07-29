import type { Card } from "@yomeyo/core";
import { importCards } from "./store.js";
import { getMeta, setMeta } from "./db.js";
import { looksLikeCard } from "./handoff.js";

/**
 * Words saved by the extension arriving on their own.
 *
 * The extension keeps its own store — it has to, since it must work on pages
 * where the app is not open — so something has to carry those words across.
 * Until now the only route was the "Send to app" button in the extension's
 * toolbar popup, which on Chrome for Android is buried behind a menu most
 * people never open, so in practice the words simply never arrived.
 *
 * The extension already injects a content script into every page, including
 * this one, and a content script shares the page's `window`. So when the app
 * is open the two can simply talk: the content script offers whatever it has
 * not handed over yet, the app imports it and says which ids it took, and the
 * extension stops offering those. No button, no server, and no reliance on
 * `externally_connectable`, which Firefox does not support.
 *
 * The extension is the one that checks it is talking to the real app — it
 * compares the page against the app URL configured in its own settings,
 * which a page cannot forge. From this side, anything arriving is treated as
 * untrusted input and validated like any other import.
 */

const FROM_EXTENSION = "yomeyo-extension";
const FROM_APP = "yomeyo-app";

/**
 * What the extension has told us about itself, if anything.
 *
 * An extension that cannot transfer words looks, from the app, exactly like
 * no extension at all: both are silence. Recording the greeting lets the app
 * say which of the two it is, which is the difference between "nothing
 * happens" and knowing to update the extension.
 */
let seen: { version: string | null } | null = null;

/**
 * A secret the extension can show when it hands words over from elsewhere.
 *
 * Words now arrive without the app being open: the extension loads sync.html
 * in a hidden frame from whatever page you are on. That frame cannot tell the
 * extension apart from the page hosting it, so it asks for this instead —
 * minted here and handed over on the app's own page, where no other site can
 * listen for it.
 */
const TOKEN_KEY = "extensionToken";

async function handoverToken(): Promise<string> {
  const existing = await getMeta<string>(TOKEN_KEY);
  if (typeof existing === "string" && existing.length >= 32) return existing;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await setMeta(TOKEN_KEY, token);
  return token;
}

export function extensionStatus(): { connected: boolean; version: string | null } {
  return { connected: seen !== null, version: seen?.version ?? null };
}

/**
 * Fetch a URL the browser will not let this page fetch itself.
 *
 * Audio services built for Yomitan and Anki are used by extensions and
 * desktop programs, which are not bound by CORS — so many of them never send
 * the header a web page needs, and the request fails before it starts. The
 * extension is not bound by it either, so when one is installed it can be
 * asked to do the fetch instead.
 *
 * Resolves to null when there is no extension, when it has not been given
 * permission, or when it could not fetch either — the caller then falls back
 * as it would have anyway.
 */
/**
 * Whether an extension has ever acknowledged a relay request here.
 *
 * Once it is known that nothing is listening, later calls must not wait for
 * it again: audio falls back to the device voice on failure, and a pause
 * before every spoken word is worse than no relay at all.
 */
let relayAnswers: boolean | null = null;

export async function fetchThroughExtension(
  url: string,
  { ackMs = 400, totalMs = 25000 }: { ackMs?: number; totalMs?: number } = {},
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  if (relayAnswers === false) return null;

  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: { body: ArrayBuffer; contentType: string } | null): void => {
      if (done) return;
      done = true;
      clearTimeout(ackTimer);
      clearTimeout(totalTimer);
      window.removeEventListener("message", onMessage);
      resolve(value);
    };

    const onMessage = (ev: MessageEvent): void => {
      if (ev.source !== window) return;
      const data = ev.data as
        | { source?: string; type?: string; id?: string; base64?: string; contentType?: string }
        | null;
      if (data?.source !== FROM_EXTENSION || data.id !== id) return;

      // An acknowledgement means an extension is there and working on it, so
      // stop counting against the short "is anyone listening" deadline.
      if (data.type === "fetching") {
        relayAnswers = true;
        clearTimeout(ackTimer);
        return;
      }
      if (data.type !== "fetched") return;

      if (typeof data.base64 !== "string" || data.base64.length === 0) {
        finish(null);
        return;
      }
      try {
        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        finish({ body: bytes.buffer, contentType: data.contentType ?? "application/octet-stream" });
      } catch {
        finish(null);
      }
    };

    // Two deadlines: a short one for "is an extension even here", and a long
    // one for the download itself. Without the first, every failure on a
    // machine with no extension would stall for the whole download timeout.
    const ackTimer = setTimeout(() => {
      relayAnswers = false; // nothing is listening; do not wait again
      finish(null);
    }, ackMs);
    const totalTimer = setTimeout(() => finish(null), totalMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: FROM_APP, type: "fetch", id, url }, location.origin);
  });
}

interface CardsMessage {
  source: typeof FROM_EXTENSION;
  type: "cards";
  cards: unknown[];
}

function isCardsMessage(data: unknown): data is CardsMessage {
  const message = data as CardsMessage | null;
  return (
    !!message &&
    message.source === FROM_EXTENSION &&
    message.type === "cards" &&
    Array.isArray(message.cards)
  );
}

/**
 * Accept words from the extension for as long as the app is open.
 *
 * `onImported` is called only when something new actually landed, so it can
 * refresh the screen and say so.
 */
export function listenForExtensionCards(
  onImported: (count: number) => void,
  onExtensionSeen: () => void = () => {},
): void {
  window.addEventListener("message", (ev) => {
    // Only messages posted into this same window, by the content script
    // sharing it — never from an embedded frame or another window.
    if (ev.source !== window) return;

    const data = ev.data as { source?: string; type?: string; version?: unknown } | null;
    if (data?.source === FROM_EXTENSION && data.type === "hello") {
      const first = seen === null;
      seen = { version: typeof data.version === "string" ? data.version : null };
      // Give it the secret it needs to deliver words from other pages.
      void handoverToken().then((token) => {
        window.postMessage({ source: FROM_APP, type: "token", token }, location.origin);
      });
      if (first) onExtensionSeen();
      return;
    }

    if (!isCardsMessage(ev.data)) return;

    const cards = ev.data.cards.filter(looksLikeCard) as Card[];
    if (cards.length === 0) return;

    void importCards(cards).then((imported) => {
      // Acknowledge everything offered, including the words already in the
      // deck: they are handled, and the extension should stop re-offering
      // them on every visit.
      window.postMessage(
        { source: FROM_APP, type: "imported", ids: cards.map((c) => c.id) },
        location.origin,
      );
      if (imported > 0) onImported(imported);
    });
  });

  // The content script runs at document_idle, so it may have posted its
  // offer before this listener existed — or it may not have run yet. Saying
  // "ready" covers the first case; the extension also offers unprompted,
  // which covers the second.
  window.postMessage({ source: FROM_APP, type: "ready" }, location.origin);
}
