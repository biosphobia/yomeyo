import { buildQueue, deckStats, gradeCard, gradePreview, type Card, type DeckConfig, type Grade } from "@yomeyo/core";
import { liveCards, saveCard } from "./store.js";
import { speak, speakerButton } from "./audio.js";
import { getDailyCounts, getDeckConfig, recordReview } from "./deck.js";

/** Review page: daily flashcards, scheduled by FSRS (or SM-2 if switched off). */

export async function renderReview(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const cards = await liveCards();
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
      config.fsrs
        ? `FSRS · ${Math.round(config.desiredRetention * 100)}% target retention`
        : "SM-2 scheduling"
    }</p>
    <div class="stats-row">
      <div class="stat"><div class="num">${queue.length}</div><div class="lbl">to study</div></div>
      <div class="stat"><div class="num">${newLeft}</div><div class="lbl">new left</div></div>
      <div class="stat"><div class="num">${stats.learning}</div><div class="lbl">learning</div></div>
      <div class="stat"><div class="num">${stats.review}</div><div class="lbl">known</div></div>
    </div>
    <div id="review-area"></div>
  `;

  const area = main.querySelector<HTMLDivElement>("#review-area")!;
  const numbers = main.querySelectorAll<HTMLElement>(".stat .num");

  /** Keep the counters honest while reviewing, not just on entry. */
  const refreshStats = async (remaining: number): Promise<void> => {
    const live = await getDailyCounts(Date.now());
    numbers[0].textContent = String(remaining);
    numbers[1].textContent = String(Math.max(0, config.newPerDay - live.introduced));
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
        <div id="reading-row" class="review-reading" lang="ja">${escapeHtml(card.reading)}</div>
        <div class="review-glosses">${escapeHtml(card.glosses.join(" · "))}</div>
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

  const showBtn = area.querySelector<HTMLButtonElement>("#show-btn")!;
  showBtn.addEventListener("click", () => {
    area.querySelector<HTMLElement>("#answer")!.style.display = "";
    area.querySelector<HTMLElement>("#grades")!.style.display = "";
    showBtn.style.display = "none";
    void speak(card.reading || card.term).catch(() => {
      /* no Japanese voice on this device */
    });
  });

  area.querySelector<HTMLElement>("#reading-row")?.appendChild(speakerButton(card.term, card.reading));

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
