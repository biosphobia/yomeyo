import { cardKey, createCard, onTap, type LookupMatch } from "@yomeyo/core";
import { hasCardForTerm, saveNewCard } from "./store.js";
import { speakerButton } from "./audio.js";
import { toast } from "./toast.js";

/**
 * The same word often appears under several dictionary entries in one popup.
 * Once it is saved, every other button for that word must show it too, or a
 * second tap looks like it saved a second copy.
 */
function markDuplicates(popup: HTMLElement, term: string, reading: string): void {
  const key = cardKey(term, reading);
  popup.querySelectorAll<HTMLButtonElement>(`button[data-word="${CSS.escape(key)}"]`).forEach((btn) => {
    btn.textContent = "✓ Saved";
    btn.classList.add("saved");
    btn.disabled = true;
  });
}

/**
 * Shared lookup-result popup: shows candidate words for a tap and lets the
 * user save any of them as a flashcard.
 */

let currentPopup: HTMLElement | null = null;
let detachAnchor: (() => void) | null = null;

export function closePopup(): void {
  detachAnchor?.();
  detachAnchor = null;
  currentPopup?.remove();
  currentPopup = null;
}

/** Height of the bottom navigation bar the popup has to clear. */
const NAV_HEIGHT = 64;

/**
 * Keep the popup inside the part of the page you can actually see.
 *
 * A fixed element sits in the layout viewport, but on a phone that is not
 * what is on screen: Chrome's URL bar and — much worse — the on-screen
 * keyboard shrink the *visual* viewport without changing the layout one. The
 * popup then renders underneath them, and its Save button cannot be tapped
 * because it is not on the screen at all. Measuring the gap and lifting the
 * popup by it keeps the button reachable in every case.
 */
function anchorToVisibleViewport(popup: HTMLElement): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  const place = (): void => {
    const hidden = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    popup.style.bottom = `calc(${hidden + NAV_HEIGHT}px + env(safe-area-inset-bottom))`;
    // Never take more than half of what is visible, and never so little that
    // the first entry is cut off.
    popup.style.maxHeight = `${Math.max(180, Math.round(vv.height * 0.46))}px`;
  };

  place();
  vv.addEventListener("resize", place);
  vv.addEventListener("scroll", place);
  return () => {
    vv.removeEventListener("resize", place);
    vv.removeEventListener("scroll", place);
  };
}

export interface PopupContext {
  /** The sentence surrounding the tapped word, for the card back. */
  sentence?: string;
  source?: string;
  /** Called after a card is saved (e.g. to refresh counters). */
  onSaved?: () => void;
}

export async function showLookupPopup(matches: LookupMatch[], context: PopupContext = {}): Promise<void> {
  closePopup();
  if (matches.length === 0) return;

  const popup = document.createElement("div");
  popup.className = "lookup-popup";
  currentPopup = popup;

  const shown = matches.slice(0, 8);
  for (const match of shown) {
    for (const entry of match.entries.slice(0, 2)) {
      const row = document.createElement("div");
      row.className = "lookup-entry";

      const word = document.createElement("div");
      word.className = "word";
      const title = document.createElement("div");
      const term = document.createElement("span");
      term.className = "term";
      term.textContent = entry.term;
      title.appendChild(term);
      if (entry.reading && entry.reading !== entry.term) {
        const reading = document.createElement("span");
        reading.className = "reading";
        reading.textContent = entry.reading;
        title.appendChild(reading);
      }
      word.appendChild(title);

      if (match.reasons.length > 0) {
        const reasons = document.createElement("div");
        reasons.className = "reasons";
        reasons.textContent = `${match.matchedText} ← ${match.reasons.join(" ← ")}`;
        word.appendChild(reasons);
      }

      const glosses = document.createElement("div");
      glosses.className = "glosses";
      glosses.textContent = entry.glosses.join(" · ");
      word.appendChild(glosses);

      if (entry.pos.length > 0 || entry.source) {
        const pos = document.createElement("div");
        pos.className = "pos";
        // Name the dictionary when more than one can answer, so a
        // monolingual definition is not mistaken for the built-in one.
        pos.textContent = [entry.source, entry.pos.join(", ")].filter(Boolean).join(" · ");
        word.appendChild(pos);
      }

      row.appendChild(word);
      row.appendChild(speakerButton(entry.term, entry.reading));

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "save";
      saveBtn.textContent = "+ Save";
      if (await hasCardForTerm(entry.term, entry.reading)) {
        saveBtn.textContent = "✓ Saved";
        saveBtn.classList.add("saved");
        saveBtn.disabled = true;
      }
      // onTap, not a plain click listener: inside this scrollable panel a
      // finger that drifts a few pixels never produces a click at all.
      onTap(saveBtn, async () => {
        if (saveBtn.disabled) return;
        saveBtn.disabled = true;
        const card = createCard(
          {
            term: entry.term,
            reading: entry.reading,
            glosses: entry.glosses,
            sentence: context.sentence,
            source: context.source,
          },
          Date.now(),
        );
        const outcome = await saveNewCard(card);
        saveBtn.textContent = "✓ Saved";
        saveBtn.classList.add("saved");
        // Say what happened: a silent button is indistinguishable from a
        // broken one, and "already in your deck" is useful to know.
        toast(
          outcome === "duplicate"
            ? `${entry.term} is already in your deck`
            : `Saved ${entry.term}`,
        );
        // Other entries for the same word are now duplicates too.
        markDuplicates(popup, entry.term, entry.reading);
        context.onSaved?.();
      });
      saveBtn.dataset.word = cardKey(entry.term, entry.reading);
      row.appendChild(saveBtn);

      popup.appendChild(row);
    }
  }

  document.body.appendChild(popup);

  const detachViewport = anchorToVisibleViewport(popup);

  // Dismiss when tapping outside the popup. Registered on the next tick so
  // the tap that opened the popup does not immediately close it.
  const dismiss = (ev: Event) => {
    if (popup.isConnected && !popup.contains(ev.target as Node)) closePopup();
  };
  const timer = setTimeout(() => document.addEventListener("pointerdown", dismiss), 0);

  detachAnchor = () => {
    clearTimeout(timer);
    document.removeEventListener("pointerdown", dismiss);
    detachViewport();
  };
}
