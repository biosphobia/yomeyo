import type { Card } from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";
import { liveCards, resetCards, saveCard } from "./store.js";
import { speakerButton } from "./audio.js";
import { extensionStatus } from "./extension-bridge.js";
import { getAdvancedMode } from "./prefs.js";
import { ALL_DECKS, cardInDeck, deckPicker, getDeckChoice } from "./deck-picker.js";
import { toast } from "./toast.js";

/**
 * Words page: browse, edit and delete cards, one deck at a time or all
 * together; JSON export/import in Advanced mode. With one deck chosen its
 * progress can be reset — every card back to new, for starting a premade
 * deck over (or unwinding an import that brought scheduling you did not
 * want after all).
 *
 * Only words already seen in review show by default: a premade deck's
 * thousands of unmet cards would bury the ones being learned. A toggle
 * brings the unseen rest into view.
 */

const DECK_CHOICE_KEY = "wordsDeck";
const SHOW_UNSEEN_KEY = "wordsShowUnseen";

export async function renderWords(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const deckChoice = await getDeckChoice(DECK_CHOICE_KEY);
  const showUnseen = (await getMeta<boolean>(SHOW_UNSEEN_KEY)) ?? false;
  const all = (await liveCards())
    .filter((card) => cardInDeck(card, deckChoice))
    .sort((a, b) => b.createdAt - a.createdAt);
  const seen = all.filter((card) => card.state !== "new");
  const cards = showUnseen ? all : seen;
  const advanced = await getAdvancedMode();
  if (!isCurrent()) return; // a newer render has taken over

  main.innerHTML = `
    <h1>Words</h1>
    <p class="subtitle">${seen.length} seen · ${all.length} word${all.length === 1 ? "" : "s"}</p>
    <div class="row-actions" style="margin-bottom:14px" id="deck-bar">
      <label class="unseen-toggle">
        <input type="checkbox" id="show-unseen" ${showUnseen ? "checked" : ""} />
        Show unseen
      </label>
      ${deckChoice !== ALL_DECKS ? `<button id="reset-deck" class="ghost">Reset progress…</button>` : ""}
    </div>
    ${
      advanced
        ? `<div class="row-actions" style="margin-bottom:14px">
             <button id="export-btn" class="secondary">Export JSON</button>
             <button id="import-btn" class="secondary">Import JSON</button>
             <input type="file" id="import-file" accept="application/json" style="display:none" />
           </div>`
        : ""
    }
    <div id="word-list" class="card-panel" style="padding:6px 14px"></div>
  `;

  const deckBar = main.querySelector<HTMLDivElement>("#deck-bar")!;
  deckBar.prepend(await deckPicker(DECK_CHOICE_KEY, deckChoice, () => void renderWords(main, isCurrent)));

  main.querySelector<HTMLInputElement>("#show-unseen")!.addEventListener("change", async (ev) => {
    await setMeta(SHOW_UNSEEN_KEY, (ev.target as HTMLInputElement).checked);
    void renderWords(main, isCurrent);
  });

  main.querySelector<HTMLButtonElement>("#reset-deck")?.addEventListener("click", async () => {
    if (
      !confirm(
        `Reset this deck's progress?\n\nAll ${all.length.toLocaleString()} cards start over as new. ` +
          `The words stay; the review history does not come back.`,
      )
    ) {
      return;
    }
    const count = await resetCards(all);
    toast(`Reset ${count.toLocaleString()} cards to new`);
    void renderWords(main, isCurrent);
  });

  const list = main.querySelector<HTMLDivElement>("#word-list")!;
  if (all.length === 0) {
    // An empty deck is ambiguous when the extension is the thing being used:
    // it can mean nothing was saved, or that words are sitting in an
    // extension that cannot hand them over. Say which.
    const ext = extensionStatus();
    const aboutExtension = ext.connected
      ? `The browser extension is connected${ext.version ? ` (${escapeHtml(ext.version)})` : ""}. Anything you save with it appears here by itself.`
      : `Using the browser extension? Its words appear here by themselves. If none arrive, reinstall it or press <b>Send them now</b> in its popup.`;
    list.innerHTML = `<div class="empty-state"><div class="big">📖</div>No words here.<br/>
      Save words with the extension, or pick another deck above.<br/><br/>
      <span style="font-size:0.85rem;opacity:0.85">${aboutExtension}</span></div>`;
  } else if (cards.length === 0) {
    // The deck has words; none have come up in review yet.
    list.innerHTML = `<div class="empty-state"><div class="big">📖</div>No words seen here yet.<br/>
      They appear as you study in Review. Switch on <b>Show unseen</b> to browse the whole deck.</div>`;
  }

  for (const card of cards) {
    list.appendChild(wordRow(card, main, isCurrent));
  }

  if (!advanced) return; // no export/import buttons to wire up

  main.querySelector<HTMLButtonElement>("#export-btn")!.addEventListener("click", async () => {
    const data = JSON.stringify(await liveCards(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yomeyo-deck-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const fileInput = main.querySelector<HTMLInputElement>("#import-file")!;
  main.querySelector<HTMLButtonElement>("#import-btn")!.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported)) throw new Error("not an array");
      let count = 0;
      for (const card of imported) {
        if (card && typeof card.id === "string" && typeof card.term === "string") {
          await saveCard({ ...card, updatedAt: card.updatedAt ?? Date.now() });
          count++;
        }
      }
      alert(`Imported ${count} cards.`);
      renderWords(main);
    } catch {
      alert("That file doesn't look like a Yomeyo deck export.");
    }
  });
}

function wordRow(card: Card, main: HTMLElement, isCurrent: () => boolean): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "word-row";
  row.innerHTML = `
    <div class="word">
      <div><span class="term" lang="ja"><b>${escapeHtml(card.term)}</b></span>
        <span class="reading" style="color:var(--accent);font-size:0.85rem">${escapeHtml(card.reading)}</span></div>
      <div class="glosses">${escapeHtml(card.glosses.join(" · "))}</div>
    </div>
    <div class="due">${dueLabel(card.due, card.state)}</div>
    <button class="ghost edit-btn" title="Edit">✎</button>
    <button class="ghost delete-btn" title="Delete">✕</button>
  `;
  row.querySelector<HTMLButtonElement>(".delete-btn")!.addEventListener("click", async () => {
    await saveCard({ ...card, deleted: true, updatedAt: Date.now() });
    row.remove();
  });
  row.querySelector<HTMLButtonElement>(".edit-btn")!.addEventListener("click", () => {
    editRow(row, card, main, isCurrent);
  });
  row.querySelector(".word")!.after(speakerButton(card.term, card.reading, card.audio));
  return row;
}

/**
 * Swap one row for an editor of the card's text — what shows on the front
 * and the back. Scheduling is not editable here; that is what grading and
 * the deck reset are for.
 */
function editRow(row: HTMLDivElement, card: Card, main: HTMLElement, isCurrent: () => boolean): void {
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
      // Cleared fields disappear rather than lingering as empty strings.
      ...(sentence ? { sentence } : {}),
      ...(sentenceMeaning ? { sentenceMeaning } : {}),
      ...(notes ? { notes } : {}),
      updatedAt: Date.now(),
    });
    void renderWords(main, isCurrent);
  });
  row.querySelector<HTMLButtonElement>(".cancel-edit")!.addEventListener("click", () => {
    row.replaceWith(wordRow(card, main, isCurrent));
  });
}

function dueLabel(due: number, state: string): string {
  if (state === "new") return "new";
  const diff = due - Date.now();
  if (diff <= 0) return "due";
  const days = Math.round(diff / 86400000);
  if (days === 0) return "today";
  return `${days}d`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
