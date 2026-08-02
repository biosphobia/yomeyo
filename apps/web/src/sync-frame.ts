import { cardKey, mergeCards, type Card } from "@yomeyo/core";
import { getAllCards, getMeta, putCards, type StoredCard } from "./db.js";
import { restoreAccount } from "./accounts.js";

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
 * storage, which would make this pointless — frames an extension creates are
 * exempt, which is what makes it work, and no special permission is needed
 * for that.
 *
 * This page is deliberately tiny: it must not pull in the dictionary or the
 * rest of the app, because it is loaded in the background on every save.
 */

const FROM_EXTENSION = "yomeyo-extension";
const FROM_FRAME = "yomeyo-sync-frame";
const TOKEN_KEY = "extensionToken";

// Words have to land in the deck of whoever is signed in — this page shares
// the app's storage but not its startup, so it has to be said here too. The
// handover below waits on it rather than racing it.
const accountReady = restoreAccount();

/**
 * Proving that the extension, and not some website, is handing words over.
 *
 * The frame is created by the extension's content script, which lives inside
 * whatever page the user is on — so from here the embedder looks like that
 * page, and a hostile site making the same frame would look identical. The
 * embedding origin therefore proves nothing.
 *
 * What does prove it is a secret the extension can only have got from the
 * app itself. The app mints one and gives it to the extension over the
 * content-script bridge, which runs on the app's own page where no other
 * site can listen. Nothing else ever sees it, so a page that embeds this
 * frame and starts posting cards has nothing to send.
 *
 * Until the app has been opened once there is no secret and nothing is
 * accepted here — the older routes cover that gap.
 */
async function tokenMatches(offered: unknown): Promise<boolean> {
  if (typeof offered !== "string" || offered.length < 16) return false;
  const known = await getMeta<string>(TOKEN_KEY);
  if (typeof known !== "string" || known.length < 16) return false;
  // Length-independent comparison; these are equal-length random strings.
  if (known.length !== offered.length) return false;
  let diff = 0;
  for (let i = 0; i < known.length; i++) diff |= known.charCodeAt(i) ^ offered.charCodeAt(i);
  return diff === 0;
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
  // The embedder is whatever page the extension is running in, so its origin
  // is not known ahead of time; the reply carries no deck contents, only the
  // ids that were just handed in.
  parent.postMessage({ source: FROM_FRAME, type, ...payload }, "*");
}

/** No more than one page of mining in a single handover. */
const MAX_CARDS = 500;

window.addEventListener("message", (ev: MessageEvent) => {
  const data = ev.data as { source?: string; type?: string; cards?: unknown[]; token?: unknown } | null;
  if (data?.source !== FROM_EXTENSION || data.type !== "cards" || !Array.isArray(data.cards)) return;

  const offered = data.cards.filter(looksLikeCard).slice(0, MAX_CARDS);
  void accountReady
    .then(() => tokenMatches(data.token))
    .then((allowed) => {
      if (!allowed) return; // not the extension; say nothing at all
      if (offered.length === 0) {
        reply("stored", { ids: [], added: 0 });
        return;
      }
      void receive(offered).then(
        (added) => reply("stored", { ids: offered.map((c) => c.id), added }),
        (err) => reply("failed", { error: err instanceof Error ? err.message : String(err) }),
      );
    });
});

reply("ready");
