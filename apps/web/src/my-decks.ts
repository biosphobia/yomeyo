import { MINING_DECK_ID, deckOf, type Card, type DeckInfo } from "@yomeyo/core";
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

let cached: DeckInfo[] | null = null;
onAccountChange(() => {
  cached = null;
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
  return [
    {
      id: MINING_DECK_ID,
      name: "Mined words",
      kind: "mining" as const,
      cardCount: counts.get(MINING_DECK_ID) ?? 0,
      description: "The words you saved yourself while reading.",
    },
    ...premade,
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
  if (at >= 0) next[at] = { ...next[at], ...deck };
  else next.push(deck);
  await write(next);
}

export async function forgetDeck(id: string): Promise<void> {
  await write((await stored()).filter((deck) => deck.id !== id));
}

/** Whether this device already has the library deck with this id. */
export async function hasDeck(id: string): Promise<boolean> {
  return (await stored()).some((deck) => deck.id === id);
}

/** The cards in one deck. */
export async function cardsInDeck(id: string): Promise<Card[]> {
  return [...(await loadCards()).values()].filter((card) => !card.deleted && deckOf(card) === id);
}
