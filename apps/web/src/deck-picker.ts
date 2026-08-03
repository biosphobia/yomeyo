import { deckOf, type Card } from "@yomeyo/core";
import { listDecks } from "./my-decks.js";
import { getMeta, setMeta } from "./db.js";

/**
 * Choosing which deck a screen is looking at.
 *
 * Review and Words both offer the same choice — everything, the mining
 * deck, or one premade deck — and each remembers its own, so studying one
 * deck does not narrow what the word list shows. A remembered deck that no
 * longer exists falls back to everything rather than an empty screen.
 */

export const ALL_DECKS = "all";

export async function getDeckChoice(key: string): Promise<string> {
  const stored = (await getMeta<string>(key)) ?? ALL_DECKS;
  if (stored === ALL_DECKS) return stored;
  const decks = await listDecks();
  return decks.some((deck) => deck.id === stored) ? stored : ALL_DECKS;
}

export function cardInDeck(card: Card, choice: string): boolean {
  return choice === ALL_DECKS || deckOf(card) === choice;
}

/** A ready-to-insert selector; `onChange` fires after the choice is saved. */
export async function deckPicker(
  key: string,
  current: string,
  onChange: (choice: string) => void,
): Promise<HTMLSelectElement> {
  const decks = await listDecks();
  const select = document.createElement("select");
  select.className = "deck-pick";
  select.setAttribute("aria-label", "Which deck to show");

  const options = [
    { id: ALL_DECKS, label: "All decks" },
    ...decks.map((deck) => ({ id: deck.id, label: `${deck.name} (${deck.cardCount})` })),
  ];
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.id;
    el.textContent = option.label;
    el.selected = option.id === current;
    select.appendChild(el);
  }

  select.addEventListener("change", () => {
    void setMeta(key, select.value).then(() => onChange(select.value));
  });
  return select;
}
