import { MINING_DECK_ID, canShareDeck, isSharedBy, type DeckInfo } from "@yomeyo/core";
import type { AccountInfo } from "./cloud.js";
import { cardsInDeck, getDeck, rememberDeck } from "./my-decks.js";

/**
 * Keeping a shared deck the same as the deck you have.
 *
 * Publishing used to be a one-off: a snapshot went to the library and every
 * edit afterwards — a fixed reading, ten new words, a rename — stayed on the
 * device that made it, while everyone else studied the version from the day
 * it was published. That is worse than not sharing, because it is silently
 * wrong rather than obviously missing.
 *
 * So a shared deck updates itself. Every change to one calls `touchSharedDeck`
 * and, a few seconds later, the library copy is rewritten from what is
 * actually here. The delay is the point: reordering a deck is twenty changes
 * in ten seconds, and each one would otherwise repack and reupload the whole
 * thing.
 */

/** Long enough to swallow a burst of edits, short enough to feel immediate. */
const SETTLE_MS = 4000;

/** Whether this deck could be published under the signed-in account. */
export function canShare(deck: DeckInfo, account: AccountInfo | null): boolean {
  return canShareDeck(deck, account?.uid ?? null);
}

/** Whether this deck is the shared library's copy, published by this account. */
export function isSharedByMe(deck: DeckInfo, account: AccountInfo | null): boolean {
  return isSharedBy(deck, account?.uid ?? null);
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Something in this deck changed. If it is shared, the library will hear
 * about it shortly.
 *
 * Deliberately fire-and-forget: an edit is saved locally the moment it is
 * made, and whether the library has caught up is not something anyone should
 * have to wait on mid-sentence.
 */
export function touchSharedDeck(deckId: string | undefined): void {
  if (!deckId || deckId === MINING_DECK_ID) return;
  clearTimeout(pending.get(deckId));
  pending.set(
    deckId,
    setTimeout(() => {
      pending.delete(deckId);
      void publishUpdate(deckId).catch(() => undefined);
    }, SETTLE_MS),
  );
}

/** Push any waiting update now, and wait for it. For a screen that is leaving. */
export async function flushSharedDeck(deckId: string): Promise<void> {
  clearTimeout(pending.get(deckId));
  pending.delete(deckId);
  await publishUpdate(deckId).catch(() => undefined);
}

/**
 * Rewrite the library's copy from the deck as it stands here.
 *
 * Quietly does nothing for a deck that is not shared, is not this account's,
 * or has been emptied — an empty deck cannot be published, and replacing a
 * good copy with nothing would be the worst reading of "update it".
 */
async function publishUpdate(deckId: string): Promise<boolean> {
  const deck = await getDeck(deckId);
  if (!deck?.shared || !deck.ownerUid) return false;

  const { currentAccount } = await import("./cloud.js");
  const account = await currentAccount().catch(() => null);
  if (!account || account.uid !== deck.ownerUid) return false;

  const cards = await cardsInDeck(deckId);
  if (cards.length === 0) return false;

  // Is it still in the library? The admin may have withdrawn it, and an
  // update that quietly puts a moderated deck back would make automatic
  // updating a way around moderation. A deck that has gone stops being
  // shared here too, so the screen stops claiming otherwise.
  const { firestoreApi } = await import("./cloud.js");
  const { db, storeApi } = await firestoreApi();
  const inLibrary = await storeApi.getDoc(storeApi.doc(db, "decks", deck.id));
  if (!inLibrary.exists?.()) {
    await rememberDeck({ ...deck, shared: false, updatedAt: Date.now() });
    return false;
  }

  const { publishDeck } = await import("./library.js");
  const { ensureProfile } = await import("./profile.js");
  const published = await publishDeck(account, cards, {
    name: deck.name,
    description: deck.description,
    source: deck.source,
    ownerName: (await ensureProfile()).name,
    deckId: deck.id,
  });
  await rememberDeck({
    ...deck,
    cardCount: cards.length,
    publishedAt: published.publishedAt,
    shared: true,
    updatedAt: Date.now(),
  });
  return true;
}
