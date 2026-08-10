import { MINING_DECK_ID, deckFace, type DeckInfo } from "@yomeyo/core";
import { listDecks, renameDeck, setDeckEmoji } from "./my-decks.js";
import { setDeckChoice } from "./deck-picker.js";
import { toast } from "./toast.js";

/**
 * The deck tabs: one small chip per deck, the way Anki's deck list works.
 *
 * A chip is the deck. Tapping it studies that deck. Each wears an emoji so
 * the row can be read at a glance rather than word by word, and the chip you
 * are on carries a pencil that opens a small panel for changing that emoji
 * and the deck's name. Nothing else is in the panel: everything deeper about
 * a deck already lives on the Decks screen.
 */

/** Faces offered in the picker. Anything else can be typed in. */
const FACES = [
  "⛏️", "📦", "📖", "📚", "✏️", "🧠", "💬", "🈶",
  "🌸", "🦊", "🐱", "🐶", "🐧", "🐼", "🍙", "🍜",
  "🍵", "🍡", "🎌", "🗻", "🏯", "🎏", "🎭", "🎧",
  "🎮", "🚀", "⭐", "🔥", "💧", "🌙", "☀️", "🌊",
];

export interface DeckTabOptions {
  /** Where the choice is remembered, so each screen keeps its own. */
  key: string;
  current: string;
  /** The number on the chip, e.g. how much that deck owes today. */
  badge?: (deck: DeckInfo) => number;
  onChange: (id: string) => void;
  /** Called after a rename or a new emoji, so the screen can redraw. */
  onEdited?: () => void;
}

export async function deckTabs(options: DeckTabOptions): Promise<HTMLElement> {
  const decks = await listDecks();
  const row = document.createElement("div");
  row.className = "deck-tabs-wrap";

  const tabs = document.createElement("div");
  tabs.className = "deck-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Decks");
  row.appendChild(tabs);

  const editorSlot = document.createElement("div");
  row.appendChild(editorSlot);

  for (const deck of decks) {
    const active = deck.id === options.current;
    const count = options.badge?.(deck) ?? 0;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `deck-tab${active ? " on" : ""}`;
    tab.dataset.id = deck.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(active));
    tab.innerHTML = `
      <span class="face" aria-hidden="true">${escapeHtml(deckFace(deck))}</span>
      <span class="nm">${escapeHtml(deck.name)}</span>
      ${count > 0 ? `<span class="badge">${count > 999 ? "999+" : count}</span>` : ""}
      ${active ? `<span class="pencil" role="button" tabindex="0" aria-label="Edit this deck">✎</span>` : ""}
    `;
    tab.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest(".pencil")) {
        ev.preventDefault();
        openEditor(editorSlot, deck, options);
        return;
      }
      if (active) return;
      void setDeckChoice(options.key, deck.id).then(() => options.onChange(deck.id));
    });
    tab.querySelector(".pencil")?.addEventListener("keydown", (ev) => {
      const key = (ev as KeyboardEvent).key;
      if (key !== "Enter" && key !== " ") return;
      ev.preventDefault();
      ev.stopPropagation();
      openEditor(editorSlot, deck, options);
    });
    tabs.appendChild(tab);
  }

  // The chip you are on may be off the end of the row on a phone.
  queueMicrotask(() => {
    tabs.querySelector<HTMLElement>(".deck-tab.on")?.scrollIntoView({ block: "nearest", inline: "center" });
  });

  return row;
}

function openEditor(slot: HTMLElement, deck: DeckInfo, options: DeckTabOptions): void {
  if (slot.firstChild) {
    slot.innerHTML = "";
    return; // the pencil closes what it opened
  }
  const mining = deck.id === MINING_DECK_ID;
  const panel = document.createElement("div");
  panel.className = "deck-tab-editor";
  panel.innerHTML = `
    <div class="deck-face-grid">
      ${FACES.map(
        (face) =>
          `<button type="button" class="face-pick${face === deckFace(deck) ? " on" : ""}" data-face="${escapeHtml(
            face,
          )}">${escapeHtml(face)}</button>`,
      ).join("")}
    </div>
    <div class="deck-editor-row">
      <input type="text" id="deck-face-any" maxlength="4" value="${escapeHtml(deck.emoji ?? "")}"
        placeholder="or any emoji" aria-label="Any emoji" />
      ${
        mining
          ? `<span class="glosses">The mined words deck is named by what it is.</span>`
          : `<input type="text" id="deck-tab-name" value="${escapeHtml(deck.name)}" aria-label="Deck name" />`
      }
      <button type="button" id="deck-tab-done">Done</button>
    </div>
  `;
  slot.appendChild(panel);

  const anyFace = panel.querySelector<HTMLInputElement>("#deck-face-any")!;
  for (const button of panel.querySelectorAll<HTMLButtonElement>(".face-pick")) {
    button.addEventListener("click", () => {
      anyFace.value = button.dataset.face ?? "";
      for (const other of panel.querySelectorAll(".face-pick")) other.classList.remove("on");
      button.classList.add("on");
    });
  }

  panel.querySelector<HTMLButtonElement>("#deck-tab-done")!.addEventListener("click", async () => {
    const name = panel.querySelector<HTMLInputElement>("#deck-tab-name")?.value ?? "";
    await setDeckEmoji(deck.id, anyFace.value);
    if (!mining && name.trim() && name.trim() !== deck.name) {
      if (await renameDeck(deck.id, name)) toast(`Renamed to ${name.trim()}`);
    }
    slot.innerHTML = "";
    options.onEdited?.();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
