import { createCard, type LookupMatch } from "@yomeyo/core";
import { hasCardForTerm, saveCard } from "./store.js";
import { speakerButton } from "./audio.js";

/**
 * Shared lookup-result popup: shows candidate words for a tap and lets the
 * user save any of them as a flashcard.
 */

let currentPopup: HTMLElement | null = null;

export function closePopup(): void {
  currentPopup?.remove();
  currentPopup = null;
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

      if (entry.pos.length > 0) {
        const pos = document.createElement("div");
        pos.className = "pos";
        pos.textContent = entry.pos.join(", ");
        word.appendChild(pos);
      }

      row.appendChild(word);
      row.appendChild(speakerButton(entry.term, entry.reading));

      const saveBtn = document.createElement("button");
      saveBtn.textContent = "+ Save";
      if (await hasCardForTerm(entry.term, entry.reading)) {
        saveBtn.textContent = "✓ Saved";
        saveBtn.classList.add("saved");
        saveBtn.disabled = true;
      }
      saveBtn.addEventListener("click", async () => {
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
        await saveCard(card);
        saveBtn.textContent = "✓ Saved";
        saveBtn.classList.add("saved");
        context.onSaved?.();
      });
      row.appendChild(saveBtn);

      popup.appendChild(row);
    }
  }

  document.body.appendChild(popup);

  // Dismiss when tapping outside the popup.
  setTimeout(() => {
    const dismiss = (ev: Event) => {
      if (currentPopup && !currentPopup.contains(ev.target as Node)) {
        closePopup();
        document.removeEventListener("pointerdown", dismiss);
      }
    };
    document.addEventListener("pointerdown", dismiss);
  }, 0);
}
