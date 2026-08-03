import {
  buildQueue,
  deckStats,
  dropAfter,
  furiganaSegments,
  gradeCard,
  gradePreview,
  moraeOf,
  pitchLevels,
  type Card,
  type DeckConfig,
  type Grade,
} from "@yomeyo/core";
import { liveCards, saveCard } from "./store.js";
import { clipSpeakerButton, playStoredAudio, playWord, speakerButton } from "./audio.js";
import { cardInDeck, deckPicker, getDeckChoice } from "./deck-picker.js";
import { getMedia } from "./media.js";
import { getAdvancedMode } from "./prefs.js";
import { getDailyCounts, getDeckConfig, recordReview } from "./deck.js";

/** Review page: daily flashcards, scheduled by FSRS (or SM-2 if switched off). */

const DECK_CHOICE_KEY = "reviewDeck";

export async function renderReview(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const deckChoice = await getDeckChoice(DECK_CHOICE_KEY);
  const cards = (await liveCards()).filter((card) => cardInDeck(card, deckChoice));
  const advanced = await getAdvancedMode();
  if (!isCurrent()) return; // a newer render has taken over
  const now = Date.now();
  const config = await getDeckConfig();
  const counts = await getDailyCounts(now);
  const stats = deckStats(cards, now);
  const queue = buildQueue(cards, now, config, {
    introducedToday: counts.introduced,
    reviewedToday: counts.reviewed,
  });

  const newLeft = Math.max(0, config.newPerDay - counts.introduced);

  main.innerHTML = `
    <h1>Review</h1>
    <p class="subtitle">${
      // The scheduler's name is jargon anyone in basic mode never chose to see.
      !advanced
        ? "Today's flashcards"
        : config.fsrs
          ? `FSRS · ${Math.round(config.desiredRetention * 100)}% target retention`
          : "SM-2 scheduling"
    }</p>
    <div id="deck-choice-row" style="margin-bottom:12px"></div>
    <div class="stats-row">
      <div class="stat"><div class="num">${queue.length}</div><div class="lbl">to study</div></div>
      <div class="stat"><div class="num">${newLeft}</div><div class="lbl">new left</div></div>
      <div class="stat"><div class="num">${stats.learning}</div><div class="lbl">learning</div></div>
      <div class="stat"><div class="num">${stats.review}</div><div class="lbl">known</div></div>
    </div>
    <div id="review-area"></div>
  `;

  main
    .querySelector<HTMLDivElement>("#deck-choice-row")!
    .appendChild(await deckPicker(DECK_CHOICE_KEY, deckChoice, () => void renderReview(main, isCurrent)));

  const area = main.querySelector<HTMLDivElement>("#review-area")!;
  const numbers = main.querySelectorAll<HTMLElement>(".stat .num");

  /** Keep all four counters honest while reviewing, not just on entry. */
  const refreshStats = async (remaining: number): Promise<void> => {
    const at = Date.now();
    const live = await getDailyCounts(at);
    const fresh = deckStats((await liveCards()).filter((card) => cardInDeck(card, deckChoice)), at);
    numbers[0].textContent = String(remaining);
    numbers[1].textContent = String(Math.max(0, config.newPerDay - live.introduced));
    numbers[2].textContent = String(fresh.learning);
    numbers[3].textContent = String(fresh.review);
  };

  showNext(area, queue, config, stats.due, refreshStats);
}

function showNext(
  area: HTMLElement,
  queue: Card[],
  config: DeckConfig,
  totalDue: number,
  refreshStats: (remaining: number) => Promise<void>,
): void {
  const card = queue.shift();
  if (!card) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="big">🎉</div>
        <div>${
          totalDue > 0
            ? "That's the daily limit — more cards are waiting tomorrow."
            : "All caught up!<br/>Mine some new words in the Reader, or check back later."
        }</div>
      </div>
    `;
    return;
  }

  const preview = gradePreview(card, Date.now(), config);

  area.innerHTML = `
    <div class="card-panel review-card">
      ${card.leech ? `<div class="leech-tag">Leech · ${card.lapses} lapses</div>` : ""}
      <div class="review-term" lang="ja">${escapeHtml(card.term)}</div>
      ${card.sentence ? `<div class="review-sentence" lang="ja">${escapeHtml(hideTerm(card.sentence, card.term))}</div>` : ""}
      <div id="answer" style="display:none">
        <div id="reading-row" class="review-reading" lang="ja">${readingHtml(card)}</div>
        <div class="review-glosses">${escapeHtml(card.glosses.join(" · "))}</div>
        ${
          card.sentenceFurigana
            ? `<div class="review-sentence" lang="ja">${rubyHtml(card.sentenceFurigana)}</div>`
            : ""
        }
        ${card.sentenceMeaning ? `<div class="review-sentence">${escapeHtml(card.sentenceMeaning)}</div>` : ""}
        ${card.notes ? `<div class="review-notes">${escapeHtml(card.notes)}</div>` : ""}
        ${card.image ? `<div class="review-image"><img id="card-image" alt="" /></div>` : ""}
      </div>
      <div class="row-actions" style="justify-content:center">
        <button id="show-btn">Show answer</button>
      </div>
      <div class="grade-row" id="grades" style="display:none">
        ${gradeButton("again", "Again", preview.again)}
        ${gradeButton("hard", "Hard", preview.hard)}
        ${gradeButton("good", "Good", preview.good)}
        ${gradeButton("easy", "Easy", preview.easy)}
      </div>
    </div>
  `;

  // A picture the card brought with it is part of the answer: shown once it
  // is decoded, and simply absent on a device that does not hold the file.
  const image = area.querySelector<HTMLImageElement>("#card-image");
  if (image && card.image) {
    void getMedia(card.image).then((blob) => {
      if (!blob) {
        image.closest(".review-image")?.remove();
        return;
      }
      const url = URL.createObjectURL(blob);
      image.onload = () => URL.revokeObjectURL(url);
      image.onerror = () => {
        URL.revokeObjectURL(url);
        image.closest(".review-image")?.remove();
      };
      image.src = url;
    });
  }

  const showBtn = area.querySelector<HTMLButtonElement>("#show-btn")!;
  showBtn.addEventListener("click", () => {
    area.querySelector<HTMLElement>("#answer")!.style.display = "";
    area.querySelector<HTMLElement>("#grades")!.style.display = "";
    showBtn.style.display = "none";
    // The deck's own recording first; then a Forvo recording, TTS, the
    // device voice — each only ever standing in for the one before it.
    void (async () => {
      if (card.audio && (await playStoredAudio(card.audio))) return;
      await playWord(card.term, card.reading);
    })().catch(() => {
      /* no audio available on this device */
    });
    // The sentence clip appears with the answer: played sooner, it would
    // read out the very word the front is hiding.
    if (card.sentenceAudio) {
      area
        .querySelector<HTMLElement>(".review-sentence")
        ?.appendChild(clipSpeakerButton(card.sentenceAudio, "Play the sentence audio"));
    }
  });

  area.querySelector<HTMLElement>("#reading-row")?.appendChild(speakerButton(card.term, card.reading, card.audio));

  area.querySelectorAll<HTMLButtonElement>("[data-grade]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const grade = btn.dataset.grade as Grade;
      const now = Date.now();
      const wasNew = card.state === "new";
      const updated = gradeCard(card, grade, now, config);
      await saveCard(updated);
      await recordReview(wasNew, now);

      // Cards still due within this session (short learning steps) rejoin the
      // queue so they come round again, as they would in Anki.
      if (updated.state !== "review" && updated.due <= now + 20 * 60 * 1000) {
        queue.push(updated);
      }
      await refreshStats(queue.length);
      showNext(area, queue, config, totalDue, refreshStats);
    });
  });
}

function gradeButton(grade: Grade, label: string, deltaMs: number): string {
  return `<button class="grade-${grade}" data-grade="${grade}">${label}<span class="interval">${formatDelay(
    deltaMs,
  )}</span></button>`;
}

function formatDelay(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = ms / 3600000;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = ms / 86400000;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30.4).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Mask the target word in its sentence so the front isn't a giveaway. */
function hideTerm(sentence: string, term: string): string {
  return sentence.split(term).join("〇".repeat(Math.min(term.length, 4)));
}

/**
 * The reading, drawn with its pitch when the card knows it: a line over the
 * high morae, a leg where the pitch drops, and the accent numbers after.
 */
function readingHtml(card: Card): string {
  const accents = card.pitchAccents ?? [];
  if (!card.reading || accents.length === 0) return escapeHtml(card.reading);
  const morae = moraeOf(card.reading);
  const levels = pitchLevels(morae.length, accents[0]);
  const drop = dropAfter(morae.length, accents[0]);
  const spans = morae
    .map(
      (mora, i) =>
        `<span class="mora${levels[i] ? " high" : ""}${i === drop ? " drop" : ""}">${escapeHtml(mora)}</span>`,
    )
    .join("");
  const numbers = accents.map((a) => `[${a}]`).join(" ");
  return `<span class="pitch">${spans}</span><span class="pitch-num">${numbers}</span>`;
}

/** Anki furigana notation as real ruby text. */
function rubyHtml(notation: string): string {
  return furiganaSegments(notation)
    .map((segment) =>
      segment.ruby !== undefined
        ? `<ruby>${escapeHtml(segment.text)}<rt>${escapeHtml(segment.ruby)}</rt></ruby>`
        : escapeHtml(segment.text),
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
