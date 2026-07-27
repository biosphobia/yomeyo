import type { Card } from "@yomeyo/core";
import { importCards } from "./store.js";
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
export function listenForExtensionCards(onImported: (count: number) => void): void {
  window.addEventListener("message", (ev) => {
    // Only messages posted into this same window, by the content script
    // sharing it — never from an embedded frame or another window.
    if (ev.source !== window) return;
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
