import {
  MINING_DECK_ID,
  orderOf,
  positionBetween,
  type Card,
  type DeckInfo,
} from "@yomeyo/core";
import { type AccountInfo } from "./cloud.js";
import { cardsInDeck, rememberDeck } from "./my-decks.js";
import { deleteCards, saveCard, saveCards } from "./store.js";
import { speakerButton } from "./audio.js";
import { toast } from "./toast.js";
import { canShare, flushSharedDeck, isSharedByMe, touchSharedDeck } from "./deck-share.js";
import {
  addDrafts,
  draftsFromRequest,
  draftsFromText,
  generatorAvailable,
  type Draft,
} from "./deck-build.js";

/**
 * Editing a deck: its name, its words, and the order they are met in.
 *
 * Every deck on the device can be opened here, however it arrived — imported
 * from Anki, added from the library, or built by typing. A deck is a list of
 * words somebody chose, and the choosing does not stop at the import: a card
 * with a wrong reading should be fixable where it is, a word nobody needs
 * should be removable, and the twenty words that ought to come first should be
 * able to come first.
 *
 * Order is the one that needs saying. New cards are introduced oldest-first,
 * which for an imported deck means the order the file had. Moving a card
 * writes a position on that one card, halfway between its new neighbours — so
 * rearranging a six-thousand-word deck is one write per move, not six
 * thousand.
 */

/** How many rows to draw at once. A deck of thousands needs the search box. */
const PAGE = 300;

interface EditorState {
  filter: string;
  drafts: Draft[];
  busy: boolean;
}

const state: EditorState = { filter: "", drafts: [], busy: false };

export interface EditorOptions {
  /** Whoever is signed in, for publishing; null when nobody is. */
  account: AccountInfo | null;
  /** The admin may ask Claude for a word list. Nobody else may spend it. */
  isAdmin: boolean;
  /** Back to the deck list. */
  onBack: () => void;
  /**
   * Open the editor again on this deck. Sharing re-files a deck under a
   * library id — that is what lets the rules tell who may change it — so the
   * deck being edited is, from that moment, a different id.
   */
  onReopen?: (deckId: string) => void;
}

export async function renderDeckEditor(
  body: HTMLElement,
  deck: DeckInfo,
  options: EditorOptions,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const cards = (await cardsInDeck(deck.id)).sort((a, b) => orderOf(a) - orderOf(b));
  const canGenerate = options.isAdmin && (await generatorAvailable());
  if (!isCurrent()) return;

  const mining = deck.id === MINING_DECK_ID;
  const mine = isSharedByMe(deck, options.account);
  const shareable = canShare(deck, options.account) && cards.length > 0;
  const shown = state.filter
    ? cards.filter((card) => matches(card, state.filter))
    : cards;

  body.innerHTML = `
    <div class="row-actions" style="margin-bottom:12px">
      <button id="deck-back" class="ghost">← All decks</button>
    </div>

    <div class="card-panel">
      <b>${mining ? "Mined words" : "Deck"}</b>
      ${
        mining
          ? `<div class="glosses">The words you saved yourself. This one is named by what it is.</div>`
          : `<label>Name</label>
             <input type="text" id="deck-name" value="${escapeAttr(deck.name)}" />
             <label>Description</label>
             <input type="text" id="deck-desc" value="${escapeAttr(deck.description ?? "")}"
               placeholder="What is in it, in one line" />
             <div class="row-actions" style="margin-top:10px">
               <button id="deck-rename">Save name</button>
               ${shareable ? `<button id="deck-share" class="secondary">Share with everyone</button>` : ""}
               ${mine ? `<button id="deck-republish" class="secondary">Update the shared copy now</button>` : ""}
             </div>
             ${
               mine
                 ? `<div class="glosses" style="margin-top:8px">Shared. Every change you make
                      here reaches the library on its own, a few seconds later.</div>`
                 : ""
             }`
      }
      <div class="glosses" style="margin-top:8px">${cards.length.toLocaleString()} word${
        cards.length === 1 ? "" : "s"
      }${deck.source ? ` · from ${escapeHtml(deck.source)}` : ""}</div>
    </div>

    <div class="card-panel">
      <b>Add words</b>
      <div class="glosses">One per line. The dictionary fills in the reading and
        the meaning; write your own with <code>word | reading | meaning</code>.</div>
      <textarea id="deck-input" placeholder="食べる&#10;学校 | がっこう | school&#10;ねこ"></textarea>
      <div class="row-actions" style="margin-top:10px">
        <button id="deck-look-up" ${state.busy ? "disabled" : ""}>Look these up</button>
      </div>
    </div>

    ${
      canGenerate
        ? `<div class="card-panel">
             <b>Ask for a word list</b>
             <div class="glosses">Describe the deck and Claude drafts it. Every word it
               gives back is checked against the dictionary before it can become a card.</div>
             <input type="text" id="deck-ask" placeholder="e.g. 40 kitchen and cooking words, N4 level" />
             <div class="row-actions" style="margin-top:10px">
               <label class="unseen-toggle">How many
                 <input type="number" id="deck-ask-count" min="5" max="60" value="30"
                   style="width:70px;margin-left:6px" />
               </label>
               <button id="deck-generate" ${state.busy ? "disabled" : ""}>Draft it</button>
             </div>
           </div>`
        : ""
    }

    <div id="deck-drafts"></div>

    <div class="card-panel">
      <b>Words</b>
      <input type="search" id="deck-filter" placeholder="Search this deck…"
        value="${escapeAttr(state.filter)}" style="margin:8px 0" />
      <div id="deck-cards" style="padding:0"></div>
      ${
        shown.length > PAGE
          ? `<div class="glosses">Showing the first ${PAGE} of ${shown.length.toLocaleString()}. Search to reach the rest.</div>`
          : ""
      }
    </div>
  `;

  body.querySelector<HTMLButtonElement>("#deck-back")!.addEventListener("click", () => {
    // Anything still settling goes now, so closing the editor is not a way to
    // leave the library a version behind.
    if (mine) void flushSharedDeck(deck.id);
    options.onBack();
  });

  const redraw = (): void => void renderDeckEditor(body, deck, options, isCurrent);

  // ---------------- the deck itself ----------------

  body.querySelector<HTMLButtonElement>("#deck-rename")?.addEventListener("click", async () => {
    const name = body.querySelector<HTMLInputElement>("#deck-name")!.value.trim();
    if (!name) {
      toast("A deck needs a name.", "error");
      return;
    }
    const description = body.querySelector<HTMLInputElement>("#deck-desc")!.value.trim();
    await rememberDeck({ ...deck, name, description, updatedAt: Date.now() });
    deck = { ...deck, name, description };
    touchSharedDeck(deck.id);
    toast(`Renamed to ${name}`);
    redraw();
  });

  body.querySelector<HTMLButtonElement>("#deck-share")?.addEventListener("click", async (ev) => {
    const button = ev.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Sharing…";
    try {
      const { shareDeck } = await import("./anki-import.js");
      const id = await shareDeck(options.account!, deck.id, deck.name, deck.source ?? "");
      toast(`${deck.name} is now in the shared library`);
      // Same deck, new id: reopen it there rather than leaving the editor
      // pointed at an id that no longer has any cards under it.
      if (options.onReopen) options.onReopen(id);
      else options.onBack();
    } catch (err) {
      button.disabled = false;
      button.textContent = "Share with everyone";
      toast(err instanceof Error ? err.message : "Could not share that deck.", "error");
    }
  });

  body.querySelector<HTMLButtonElement>("#deck-republish")?.addEventListener("click", async (ev) => {
    const button = ev.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Updating…";
    try {
      const { publishDeck } = await import("./library.js");
      const { ensureProfile } = await import("./profile.js");
      const published = await publishDeck(options.account!, cards, {
        name: deck.name,
        description: deck.description,
        source: deck.source,
        ownerName: (await ensureProfile()).name,
        // Over the top of the existing deck: same id, so everyone who has it
        // keeps having it, and the library shows one deck rather than two.
        deckId: deck.id,
      });
      await rememberDeck({ ...deck, cardCount: cards.length, publishedAt: published.publishedAt, shared: true });
      toast(`The shared copy of ${deck.name} is up to date`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update the shared copy.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Update the shared copy";
    }
  });

  // ---------------- drafting ----------------

  const withBusy = async (button: HTMLButtonElement, label: string, work: () => Promise<void>) => {
    if (state.busy) return;
    state.busy = true;
    button.disabled = true;
    const was = button.textContent;
    button.textContent = label;
    try {
      await work();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That did not work.", "error");
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = was;
    }
  };

  body.querySelector<HTMLButtonElement>("#deck-look-up")!.addEventListener("click", async (ev) => {
    const text = body.querySelector<HTMLTextAreaElement>("#deck-input")!.value;
    await withBusy(ev.currentTarget as HTMLButtonElement, "Looking up…", async () => {
      state.drafts = await draftsFromText(text, deck.id);
      if (state.drafts.length === 0) toast("Nothing to add from that.", "error");
      redraw();
    });
  });

  body.querySelector<HTMLButtonElement>("#deck-generate")?.addEventListener("click", async (ev) => {
    const request = body.querySelector<HTMLInputElement>("#deck-ask")!.value.trim();
    if (!request) {
      toast("Say what the deck should be about.", "error");
      return;
    }
    const count = Math.max(5, Math.min(60, Number(body.querySelector<HTMLInputElement>("#deck-ask-count")!.value) || 30));
    await withBusy(ev.currentTarget as HTMLButtonElement, "Writing…", async () => {
      state.drafts = await draftsFromRequest(request, count, deck.id);
      if (state.drafts.length === 0) toast("Nothing usable came back.", "error");
      redraw();
    });
  });

  drawDrafts(body.querySelector<HTMLDivElement>("#deck-drafts")!, deck, redraw);

  // ---------------- the words ----------------

  const search = body.querySelector<HTMLInputElement>("#deck-filter")!;
  search.addEventListener("input", () => {
    state.filter = search.value;
    const at = search.selectionStart;
    redrawList();
    const next = body.querySelector<HTMLInputElement>("#deck-filter");
    if (next) {
      next.focus();
      next.setSelectionRange(at ?? next.value.length, at ?? next.value.length);
    }
  });

  const redrawList = (): void => {
    const list = body.querySelector<HTMLDivElement>("#deck-cards");
    if (list) drawCards(list, cards, deck, redraw);
  };
  redrawList();
}

// ---------------- drafts awaiting a look ----------------

function drawDrafts(box: HTMLDivElement, deck: DeckInfo, redraw: () => void): void {
  if (state.drafts.length === 0) {
    box.innerHTML = "";
    return;
  }
  const fresh = state.drafts.filter((draft) => !draft.have);
  const unknown = state.drafts.filter((draft) => !draft.known).length;

  box.innerHTML = `
    <div class="card-panel">
      <b>${state.drafts.length} drafted</b>
      <div class="glosses">${fresh.length} to add${
        unknown > 0
          ? ` · <span class="err-text">${unknown} not in the dictionary</span> — check those before adding`
          : ""
      }</div>
      <div class="draft-list" id="draft-list"></div>
      <div class="row-actions" style="margin-top:10px">
        <button id="draft-add" ${fresh.length === 0 ? "disabled" : ""}>Add ${fresh.length} to ${escapeHtml(deck.name)}</button>
        <button id="draft-clear" class="secondary">Discard</button>
      </div>
    </div>
  `;

  const list = box.querySelector<HTMLDivElement>("#draft-list")!;
  for (const [index, draft] of state.drafts.entries()) {
    const row = document.createElement("div");
    row.className = `word-row draft${draft.have ? " held" : ""}`;
    row.innerHTML = `
      <div class="word">
        <div><span class="term" lang="ja"><b>${escapeHtml(draft.term)}</b></span>
          <span class="reading" style="color:var(--accent);font-size:0.85rem">${escapeHtml(draft.reading)}</span>
          ${draft.known ? "" : `<span class="draft-flag" title="The dictionary does not have this word">?</span>`}
        </div>
        <div class="glosses">${escapeHtml(draft.glosses.join(" · "))}</div>
        ${draft.sentence ? `<div class="glosses" lang="ja">${escapeHtml(draft.sentence)}</div>` : ""}
        ${
          draft.have
            ? `<div class="glosses">${
                draft.have === "here" ? "already in this deck" : "already in another deck — left where it is"
              }</div>`
            : ""
        }
      </div>
      <button class="ghost draft-drop" title="Drop this one">✕</button>
    `;
    row.querySelector<HTMLButtonElement>(".draft-drop")!.addEventListener("click", () => {
      state.drafts.splice(index, 1);
      drawDrafts(box, deck, redraw);
    });
    list.appendChild(row);
  }

  box.querySelector<HTMLButtonElement>("#draft-clear")!.addEventListener("click", () => {
    state.drafts = [];
    redraw();
  });
  box.querySelector<HTMLButtonElement>("#draft-add")!.addEventListener("click", async (ev) => {
    const button = ev.currentTarget as HTMLButtonElement;
    button.disabled = true;
    const result = await addDrafts(state.drafts, deck.id);
    state.drafts = [];
    touchSharedDeck(deck.id);
    toast(
      `Added ${result.added.toLocaleString()} word${result.added === 1 ? "" : "s"}` +
        (result.elsewhere > 0 ? ` · ${result.elsewhere} are in another deck already` : ""),
    );
    redraw();
  });
}

// ---------------- the card list ----------------

function matches(card: Card, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return (
    card.term.toLowerCase().includes(needle) ||
    card.reading.toLowerCase().includes(needle) ||
    card.glosses.some((gloss) => gloss.toLowerCase().includes(needle))
  );
}

function drawCards(list: HTMLDivElement, cards: Card[], deck: DeckInfo, redraw: () => void): void {
  const shown = cards.filter((card) => matches(card, state.filter)).slice(0, PAGE);
  list.innerHTML = "";
  if (shown.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="big">📇</div>${
      cards.length === 0 ? "No words in this deck yet." : "Nothing matches that."
    }</div>`;
    return;
  }
  // Moving is only meaningful against the whole deck, in its real order.
  const ordered = state.filter ? null : cards;
  for (const card of shown) {
    list.appendChild(cardRow(card, ordered, deck, redraw));
  }
}

function cardRow(card: Card, ordered: Card[] | null, deck: DeckInfo, redraw: () => void): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "word-row";
  const at = ordered ? ordered.indexOf(card) : -1;
  row.innerHTML = `
    ${
      ordered
        ? `<div class="card-move">
             <button class="ghost move-up" title="Move up" ${at === 0 ? "disabled" : ""}>▲</button>
             <span class="card-index">${at + 1}</span>
             <button class="ghost move-down" title="Move down" ${
               at === ordered.length - 1 ? "disabled" : ""
             }>▼</button>
           </div>`
        : ""
    }
    <div class="word">
      <div><span class="term" lang="ja"><b>${escapeHtml(card.term)}</b></span>
        <span class="reading" style="color:var(--accent);font-size:0.85rem">${escapeHtml(card.reading)}</span></div>
      <div class="glosses">${escapeHtml(card.glosses.join(" · "))}</div>
      ${card.sentence ? `<div class="glosses" lang="ja">${escapeHtml(card.sentence)}</div>` : ""}
    </div>
    <button class="ghost edit-btn" title="Edit">✎</button>
    <button class="ghost delete-btn" title="Delete">✕</button>
  `;

  row.querySelector<HTMLButtonElement>(".move-up")?.addEventListener("click", async () => {
    await move(ordered!, at, -1);
    touchSharedDeck(deck.id);
    redraw();
  });
  row.querySelector<HTMLButtonElement>(".move-down")?.addEventListener("click", async () => {
    await move(ordered!, at, 1);
    touchSharedDeck(deck.id);
    redraw();
  });
  row.querySelector<HTMLButtonElement>(".delete-btn")!.addEventListener("click", async () => {
    if (!confirm(`Delete “${card.term}” from ${deck.name}?`)) return;
    await deleteCards([card]);
    touchSharedDeck(deck.id);
    row.remove();
  });
  row.querySelector<HTMLButtonElement>(".edit-btn")!.addEventListener("click", () => {
    editRow(row, card, ordered, deck, redraw);
  });
  row.querySelector(".word")!.after(speakerButton(card.term, card.reading, card.audio));
  return row;
}

/**
 * Move one card one place, by giving it a position between its new
 * neighbours.
 *
 * A deck whose cards all share a timestamp — a text export imported in one
 * go — has no gaps to move into, so the first move numbers the deck once and
 * every move after it is a single write.
 */
async function move(ordered: Card[], at: number, delta: number): Promise<void> {
  const to = at + delta;
  if (to < 0 || to >= ordered.length) return;
  const cards = await ensureSpread(ordered);
  const card = cards[at];
  const [before, after] =
    delta < 0 ? [cards[to - 1], cards[to]] : [cards[to], cards[to + 1]];
  await saveCard({ ...card, order: positionBetween(before, after), updatedAt: Date.now() });
}

/** Give every card in the deck room to move between, if it has none. */
async function ensureSpread(cards: Card[]): Promise<Card[]> {
  let tight = false;
  for (let i = 1; i < cards.length; i++) {
    if (orderOf(cards[i]) <= orderOf(cards[i - 1])) {
      tight = true;
      break;
    }
  }
  if (!tight) return cards;
  const base = orderOf(cards[0]);
  const spread = cards.map((card, i) => ({ ...card, order: base + i * 60_000, updatedAt: Date.now() }));
  await saveCards(spread);
  return spread;
}

/** The same editor the Words screen offers, on a card inside its deck. */
function editRow(
  row: HTMLDivElement,
  card: Card,
  ordered: Card[] | null,
  deck: DeckInfo,
  redraw: () => void,
): void {
  row.innerHTML = `
    <div class="word" style="flex:1">
      <label>Word</label>
      <input type="text" class="edit-term" lang="ja" value="${escapeAttr(card.term)}" />
      <label>Reading</label>
      <input type="text" class="edit-reading" lang="ja" value="${escapeAttr(card.reading)}" />
      <label>Meanings (separate with ;)</label>
      <input type="text" class="edit-glosses" value="${escapeAttr(card.glosses.join("; "))}" />
      <label>Sentence</label>
      <input type="text" class="edit-sentence" lang="ja" value="${escapeAttr(card.sentence ?? "")}" />
      <label>Sentence meaning</label>
      <input type="text" class="edit-sentence-meaning" value="${escapeAttr(card.sentenceMeaning ?? "")}" />
      <label>Notes</label>
      <textarea class="edit-notes">${escapeHtml(card.notes ?? "")}</textarea>
      <div class="row-actions" style="margin-top:8px">
        <button class="save-edit">Save</button>
        <button class="ghost cancel-edit">Cancel</button>
      </div>
    </div>
  `;
  const value = (selector: string) => row.querySelector<HTMLInputElement>(selector)!.value.trim();

  row.querySelector<HTMLButtonElement>(".save-edit")!.addEventListener("click", async () => {
    const term = value(".edit-term");
    if (!term) {
      toast("A card needs a word on its front.", "error");
      return;
    }
    const sentence = value(".edit-sentence");
    const sentenceMeaning = value(".edit-sentence-meaning");
    const notes = row.querySelector<HTMLTextAreaElement>(".edit-notes")!.value.trim();
    const { sentence: _s, sentenceMeaning: _m, notes: _n, ...rest } = card;
    await saveCard({
      ...rest,
      term,
      reading: value(".edit-reading"),
      glosses: value(".edit-glosses")
        .split(/\s*;\s*/)
        .filter(Boolean),
      ...(sentence ? { sentence } : {}),
      ...(sentenceMeaning ? { sentenceMeaning } : {}),
      ...(notes ? { notes } : {}),
      updatedAt: Date.now(),
    });
    touchSharedDeck(deck.id);
    redraw();
  });
  row.querySelector<HTMLButtonElement>(".cancel-edit")!.addEventListener("click", () => {
    row.replaceWith(cardRow(card, ordered, deck, redraw));
  });
}

/** Forget any half-finished drafts when the editor is left. */
export function resetEditor(): void {
  state.drafts = [];
  state.filter = "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
