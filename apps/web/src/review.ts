import {
  DEFAULT_SRS_CONFIG,
  deckStats,
  dueCards,
  gradeCard,
  type Card,
  type Grade,
} from "@yomeyo/core";
import { liveCards, saveCard } from "./store.js";

/** Review page: Anki-style daily flashcards. */

export async function renderReview(main: HTMLElement): Promise<void> {
  const cards = await liveCards();
  const now = Date.now();
  const stats = deckStats(cards, now);
  const queue = dueCards(cards, now);

  main.innerHTML = `
    <h1>Review</h1>
    <p class="subtitle">Grade honestly — the scheduler adapts to you.</p>
    <div class="stats-row">
      <div class="stat"><div class="num">${stats.due}</div><div class="lbl">due</div></div>
      <div class="stat"><div class="num">${stats.newCount}</div><div class="lbl">new</div></div>
      <div class="stat"><div class="num">${stats.learning}</div><div class="lbl">learning</div></div>
      <div class="stat"><div class="num">${stats.review}</div><div class="lbl">known</div></div>
    </div>
    <div id="review-area"></div>
  `;

  const area = main.querySelector<HTMLDivElement>("#review-area")!;
  showNext(area, queue);
}

function showNext(area: HTMLElement, queue: Card[]): void {
  const card = queue.shift();
  if (!card) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="big">🎉</div>
        <div>All caught up!<br/>Mine some new words in the Reader, or check back later.</div>
      </div>
    `;
    return;
  }

  area.innerHTML = `
    <div class="card-panel review-card">
      <div class="review-term" lang="ja">${escapeHtml(card.term)}</div>
      ${card.sentence ? `<div class="review-sentence" lang="ja">${escapeHtml(hideTerm(card.sentence, card.term))}</div>` : ""}
      <div id="answer" style="display:none">
        <div class="review-reading" lang="ja">${escapeHtml(card.reading)}</div>
        <div class="review-glosses">${escapeHtml(card.glosses.join(" · "))}</div>
      </div>
      <div class="row-actions" style="justify-content:center">
        <button id="show-btn">Show answer</button>
      </div>
      <div class="grade-row" id="grades" style="display:none">
        ${gradeButton(card, "again", "Again")}
        ${gradeButton(card, "hard", "Hard")}
        ${gradeButton(card, "good", "Good")}
        ${gradeButton(card, "easy", "Easy")}
      </div>
    </div>
  `;

  const showBtn = area.querySelector<HTMLButtonElement>("#show-btn")!;
  showBtn.addEventListener("click", () => {
    area.querySelector<HTMLElement>("#answer")!.style.display = "";
    area.querySelector<HTMLElement>("#grades")!.style.display = "";
    showBtn.style.display = "none";
  });

  area.querySelectorAll<HTMLButtonElement>("[data-grade]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const grade = btn.dataset.grade as Grade;
      const now = Date.now();
      const updated = gradeCard(card, grade, now);
      await saveCard(updated);
      // Cards still due within this session (short learning steps) rejoin
      // the back of the queue so they come around again.
      if (updated.due <= now + 20 * 60 * 1000 && updated.state !== "review") {
        queue.push(updated);
      }
      showNext(area, queue);
    });
  });
}

function gradeButton(card: Card, grade: Grade, label: string): string {
  const preview = gradeCard(card, grade, Date.now(), DEFAULT_SRS_CONFIG);
  return `<button class="grade-${grade}" data-grade="${grade}">${label}<span class="interval">${formatDelay(preview.due - Date.now())}</span></button>`;
}

function formatDelay(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)}m`;
  const days = ms / 86400000;
  if (days < 1.5) return "1d";
  if (days < 30) return `${Math.round(days)}d`;
  return `${(days / 30.4).toFixed(1)}mo`;
}

/** Mask the target word in its sentence so the front isn't a giveaway. */
function hideTerm(sentence: string, term: string): string {
  return sentence.split(term).join("〇".repeat(Math.min(term.length, 4)));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
