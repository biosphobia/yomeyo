import { MINING_DECK_ID, deckOf, type Card, type DeckGone, type DeckInfo } from "@yomeyo/core";
import { getMeta, onAccountChange, setMeta } from "./db.js";
import { loadCards } from "./store.js";

/**
 * The decks on this device, and how many words are in each.
 *
 * The mining deck is not stored — it is simply everything that does not
 * belong to another deck, which is what every card was before decks existed.
 * Only premade decks need a record, because their name, where they came from
 * and whether they have been shared cannot be worked out from the cards.
 */

const DECKS_KEY = "deckList";
/**
 * Decks removed here, so removing one on this device is not undone by the
 * next sync from a device that still has it. Kept small: a tombstone is only
 * needed until every device has seen it.
 */
const GONE_KEY = "deckTombstones";
const GONE_MAX = 60;

/** What a deck is called when its record has been lost but its words survive. */
export const UNNAMED = "Unnamed deck";

export type { DeckGone } from "@yomeyo/core";

let cached: DeckInfo[] | null = null;
let goneCache: DeckGone[] | null = null;
onAccountChange(() => {
  cached = null;
  goneCache = null;
});

async function stored(): Promise<DeckInfo[]> {
  if (!cached) cached = (await getMeta<DeckInfo[]>(DECKS_KEY)) ?? [];
  return cached;
}

async function write(decks: DeckInfo[]): Promise<void> {
  cached = decks;
  await setMeta(DECKS_KEY, decks);
}

/** Every deck on this device, the mining deck first, each with a live count. */
export async function listDecks(): Promise<DeckInfo[]> {
  const cards = [...(await loadCards()).values()].filter((c) => !c.deleted);
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(deckOf(card), (counts.get(deckOf(card)) ?? 0) + 1);

  const premade = (await stored()).map((deck) => ({ ...deck, cardCount: counts.get(deck.id) ?? 0 }));

  /*
   * Words whose deck nothing here has a record of.
   *
   * Cards have always synced and, until recently, the record of the deck
   * they belong to did not — so a second device could hold six thousand
   * words under an id it knew nothing about, and show an empty Decks screen
   * over the top of them. The record is what carries the name, so these have
   * none until one arrives; what they do have is the words, and an unnamed
   * deck you can open and rename beats a deck you cannot see.
   */
  const known = new Set([MINING_DECK_ID, ...premade.map((deck) => deck.id)]);
  const orphans: DeckInfo[] = [...counts.keys()]
    .filter((id) => !known.has(id))
    .map((id) => ({
      id,
      name: UNNAMED,
      kind: "premade" as const,
      cardCount: counts.get(id) ?? 0,
      description: "Found on this device without a name. Rename it in Edit words.",
    }));

  return [
    {
      id: MINING_DECK_ID,
      name: "Mined words",
      kind: "mining" as const,
      cardCount: counts.get(MINING_DECK_ID) ?? 0,
      description: "The words you saved yourself while reading.",
    },
    ...premade,
    ...orphans,
  ];
}

export async function getDeck(id: string): Promise<DeckInfo | undefined> {
  return (await listDecks()).find((deck) => deck.id === id);
}

/** Record a premade deck, or update what is known about one. */
export async function rememberDeck(deck: DeckInfo): Promise<void> {
  const decks = await stored();
  const at = decks.findIndex((d) => d.id === deck.id);
  const next = decks.slice();
  // Stamped, so a sync can tell which of two copies of a deck is the later.
  const stamped = { ...deck, updatedAt: deck.updatedAt ?? Date.now() };
  if (at >= 0) next[at] = { ...next[at], ...stamped };
  else next.push(stamped);
  await write(next);
  // Adding a deck back undoes its removal.
  const gone = (await tombstones()).filter((t) => t.id !== deck.id);
  await setMeta(GONE_KEY, gone);
  goneCache = gone;
}

export async function forgetDeck(id: string): Promise<void> {
  await write((await stored()).filter((deck) => deck.id !== id));
  const gone = [{ id, at: Date.now() }, ...(await tombstones()).filter((t) => t.id !== id)].slice(0, GONE_MAX);
  await setMeta(GONE_KEY, gone);
  goneCache = gone;
}

/** Decks removed on this device, newest first. */
export async function tombstones(): Promise<DeckGone[]> {
  goneCache ??= (await getMeta<DeckGone[]>(GONE_KEY)) ?? [];
  return goneCache;
}

/** Replace the whole record, after a sync has merged it with another device. */
export async function replaceDecks(decks: DeckInfo[], gone: DeckGone[]): Promise<void> {
  await write(decks);
  goneCache = gone.slice(0, GONE_MAX);
  await setMeta(GONE_KEY, goneCache);
}

/** Whether this device already has the library deck with this id. */
export async function hasDeck(id: string): Promise<boolean> {
  return (await stored()).some((deck) => deck.id === id);
}

/** The cards in one deck. */
export async function cardsInDeck(id: string): Promise<Card[]> {
  return [...(await loadCards()).values()].filter((card) => !card.deleted && deckOf(card) === id);
}
