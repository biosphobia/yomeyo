import { cardKey, mergeCards, type Card } from "@yomeyo/core";
import { getAllCards, putCards, type StoredCard } from "./db.js";

/**
 * A drop box for words saved with the extension, on the app's own origin.
 *
 * The extension keeps its own store, and an extension cannot write into a
 * website's storage — so words used to sit there until a page of the app
 * happened to be open. This page closes that gap: the extension loads it in a
 * hidden frame the moment a word is saved, hands the card over, and it lands
 * in the same IndexedDB the app reads. Nothing to press, and the app does not
 * have to be open at all.
 *
 * A frame of one origin embedded in another normally gets its own partitioned
 * storage, which would make this pointless — an extension holding host
 * permissions for the origin is exempt, which is what makes it work.
 *
 * This page is deliberately tiny: it must not pull in the dictionary or the
 * rest of the app, because it is loaded in the background on every save.
 */

const FROM_EXTENSION = "yomeyo-extension";
const FROM_FRAME = "yomeyo-sync-frame";

/**
 * Only an extension may use this page.
 *
 * Nothing is ever sent back except a list of ids that were just handed in, so
 * a hostile embedder could at worst add words to the deck rather than read
 * it — but there is no reason for anything but an extension to be here.
 */
function embeddedByExtension(): boolean {
  try {
    const ancestors = (location as unknown as { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    if (ancestors && ancestors.length > 0) {
      return /^(chrome-extension|moz-extension|extension|safari-web-extension):\/\//.test(ancestors[0]);
    }
    // Firefox has no ancestorOrigins; fall back to the referrer.
    return /^(moz-extension|chrome-extension):\/\//.test(document.referrer);
  } catch {
    return false;
  }
}

function looksLikeCard(value: unknown): value is Card {
  const card = value as Card | null;
  return (
    !!card &&
    typeof card.id === "string" &&
    typeof card.term === "string" &&
    typeof card.updatedAt === "number" &&
    Array.isArray(card.glosses)
  );
}

/**
 * Merge cards into the deck, last-write-wins, refusing to create a second
 * card for a word already there under a different id — the extension and the
 * app mint their own ids, so id-only merging would double every word.
 */
async function receive(incoming: Card[]): Promise<number> {
  const existing = await getAllCards();
  const byId = new Map<string, Card>(existing.map((c) => [c.id, c]));
  const idByWord = new Map<string, string>();
  for (const card of existing) idByWord.set(cardKey(card.term, card.reading), card.id);

  const usable = incoming.filter((card) => {
    const owner = idByWord.get(cardKey(card.term, card.reading));
    return owner === undefined || owner === card.id;
  });
  if (usable.length === 0) return 0;

  const applied = mergeCards(byId, usable);
  if (applied.length > 0) {
    await putCards(applied.map((card): StoredCard => ({ ...card, dirty: true })));
  }
  return applied.length;
}

function reply(type: string, payload: Record<string, unknown> = {}): void {
  // The embedder is an extension page, whose origin is not known ahead of
  // time; the reply carries no deck contents, only what was handed in.
  parent.postMessage({ source: FROM_FRAME, type, ...payload }, "*");
}

if (embeddedByExtension()) {
  window.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data as { source?: string; type?: string; cards?: unknown } | null;
    if (data?.source !== FROM_EXTENSION || data.type !== "cards" || !Array.isArray(data.cards)) return;

    const cards = data.cards.filter(looksLikeCard);
    if (cards.length === 0) {
      reply("stored", { ids: [], added: 0 });
      return;
    }
    void receive(cards).then(
      (added) => reply("stored", { ids: cards.map((c) => c.id), added }),
      (err) => reply("failed", { error: err instanceof Error ? err.message : String(err) }),
    );
  });
  reply("ready");
} else {
  document.body.textContent =
    "This page is how the Yomeyo browser extension hands saved words to the app. There is nothing to do here.";
}
