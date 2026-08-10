import { MINING_DECK_ID, deckOf, type Card } from "@yomeyo/core";
import { listDecks } from "./my-decks.js";
import { getMeta, setMeta } from "./db.js";

/**
 * Which deck a screen is looking at.
 *
 * Always exactly one, the way Anki works: you study a deck, you do not
 * study everything at once. Review and Words each remember their own
 * choice, so studying one deck does not narrow what the word list shows,
 * and a remembered deck that has since been deleted falls back to the
 * mining deck rather than to an empty screen.
 */

export async function getDeckChoice(key: string): Promise<string> {
  const stored = await getMeta<string>(key);
  const decks = await listDecks();
  if (stored && decks.some((deck) => deck.id === stored)) return stored;
  return decks[0]?.id ?? MINING_DECK_ID;
}

export async function setDeckChoice(key: string, id: string): Promise<void> {
  await setMeta(key, id);
}

export function cardInDeck(card: Card, choice: string): boolean {
  return deckOf(card) === choice;
}
