import { screenHeader } from "./screen.js";
import {
  buildQueue,
  deckOf,
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
import { clipSpeakerButton, playStoredAudio, playWord, prefetchAudio, speakerButton } from "./audio.js";
import { cardInDeck, getDeckChoice } from "./deck-picker.js";
import { deckTabs } from "./deck-tabs.js";
import { getMedia } from "./media.js";
import { getAdvancedMode } from "./prefs.js";
import { getDailyCounts, getDeckConfig, recordReview, unrecordReview } from "./deck.js";

/** Review page: daily flashcards, scheduled by FSRS (or SM-2 if switched off). */

const DECK_CHOICE_KEY = "reviewDeck";

export async function renderReview(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const deckChoice = await getDeckChoice(DECK_CHOICE_KEY);
  const everything = await liveCards();
  const cards = everything.filter((card) => cardInDeck(card, deckChoice));
  const advanced = await getAdvancedMode();
  if (!isCurrent()) return; // a newer render has taken over
  const now = Date.now();
  const config = await getDeckConfig(deckChoice);
  const stats = deckStats(cards, now);

  // One deck is studied at a time, as in Anki, and it is scheduled by its
  // own options and spends its own daily allowance.
  const counts = await getDailyCounts(now, deckChoice);
  const queue = buildQueue(cards, now, config, {
    introducedToday: counts.introduced,
    reviewedToday: counts.reviewed,
  });
  const newLeft = Math.max(0, config.newPerDay - counts.introduced);

  // What every other deck owes, for the numbers on their tabs. A deck the
  // reader is not in still has to be able to say "there is work here".
  const owed = new Map<string, number>();
  for (const deckId of new Set(everything.map((card) => deckOf(card)))) {
    if (deckId === deckChoice) {
      owed.set(deckId, queue.length);
      continue;
    }
    const otherConfig = await getDeckConfig(deckId);
    const otherCounts = await getDailyCounts(now, deckId);
    owed.set(
      deckId,
      buildQueue(
        everything.filter((card) => deckOf(card) === deckId),
        now,
        otherConfig,
        { introducedToday: otherCounts.introduced, reviewedToday: otherCounts.reviewed },
      ).length,
    );
  }
  if (!isCurrent()) return;

  main.innerHTML = `
    ${screenHeader("Review")}
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
    <div class="glosses" id="review-lifetime" style="text-align:center;margin-top:10px"></div>
  `;

  // The lifetime line, quietly under everything: today's count and the
  // total ever, from the permanent record.
  void import("./review-stats.js")
    .then(async (m) => {
      const line = main.querySelector<HTMLDivElement>("#review-lifetime");
      if (!line) return;
      const [todayStats, lifetime] = await Promise.all([
        m.dayReviewStats(m.reviewDateKey()),
        m.lifetimeReviewStats(),
      ]);
      const total = m.reviewsOf(lifetime);
      if (total === 0) return;
      line.textContent = `${m.reviewsOf(todayStats)} reviews today · ${total.toLocaleString()} lifetime across ${lifetime.days} day${lifetime.days === 1 ? "" : "s"}`;
    })
    .catch(() => undefined);

  const redraw = (): void => void renderReview(main, isCurrent);
  main.querySelector<HTMLDivElement>("#deck-choice-row")!.appendChild(
    await deckTabs({
      key: DECK_CHOICE_KEY,
      current: deckChoice,
      badge: (deck) => owed.get(deck.id) ?? 0,
      onChange: redraw,
      onEdited: redraw,
    }),
  );

  const area = main.querySelector<HTMLDivElement>("#review-area")!;
  const numbers = main.querySelectorAll<HTMLElement>(".stat .num");

  /** Keep all four counters honest while reviewing, not just on entry. */
  const refreshStats = async (remaining: number): Promise<void> => {
    const at = Date.now();
    const deckCounts = await getDailyCounts(at, deckChoice);
    const fresh = deckStats((await liveCards()).filter((card) => cardInDeck(card, deckChoice)), at);
    numbers[0].textContent = String(remaining);
    numbers[1].textContent = String(Math.max(0, config.newPerDay - deckCounts.introduced));
    numbers[2].textContent = String(fresh.learning);
    numbers[3].textContent = String(fresh.review);
  };

  /*
   * Fetch the words you are about to be asked, before you are asked them.
   *
   * A clip is cached the first time it plays, which means the first play of
   * every new word is a round trip you sit through with the answer already
   * on screen — and offline it is not a round trip, it is the device voice
   * instead of a recording. Pulling the queue down while the first card is
   * still being read moves that wait somewhere it costs nothing, and a
   * session started on the train has its recordings already.
   *
   * Quiet throughout: anything cached is skipped, failures are ignored, and
   * leaving the screen stops the rest — which is what the generation token
   * already knows, rather than a flag something has to remember to set.
   */
  const audioAhead = {
    get aborted(): boolean {
      return !isCurrent();
    },
  };
  const wanted = (cards: Card[]): { term: string; reading: string }[] =>
    cards
      // A card that brought its own recording plays that; nothing to fetch.
      .filter((card) => !card.audio)
      .map((card) => ({ term: card.term, reading: card.reading }));
  void prefetchAudio(wanted(queue.slice(0, 30)), audioAhead).catch(() => undefined);

  const session: Session = {
    area,
    queue,
    audioAhead,
    prefetchAhead: () => {
      if (audioAhead.aborted) return;
      void prefetchAudio(wanted(queue.slice(0, 10)), audioAhead).catch(() => undefined);
    },
    config,
    deckId: deckChoice,
    totalDue: stats.due,
    emptyNote:
      cards.length === 0
        ? "This deck has no words yet."
        : stats.due > 0
          ? "Daily limit reached. More tomorrow."
          : "All caught up!",
    refreshStats,
    history: [],
  };
  showNext(session);

  // Anki undoes the last answer with Ctrl+Z, and so does this. The plain z
  // is here too: on a phone keyboard the chord is nobody's idea of a shortcut.
  const onKey = (ev: KeyboardEvent): void => {
    if (!main.isConnected || !isCurrent()) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    const typing = (ev.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
    if (typing) return;
    if (ev.key !== "z" && ev.key !== "Z") return;
    ev.preventDefault();
    void undoLast(session);
  };
  document.addEventListener("keydown", onKey);
}

/** One answered card, kept so it can be put back exactly as it was. */
interface Answered {
  before: Card;
  grade: Grade;
  wasNew: boolean;
  at: number;
  deckId: string;
}

interface Session {
  area: HTMLElement;
  queue: Card[];
  /** True once the screen is left, so the download queue stops with it. */
  audioAhead: { readonly aborted: boolean };
  /** Top up the clips held for the cards still to come. */
  prefetchAhead: () => void;
  config: DeckConfig;
  deckId: string;
  totalDue: number;
  /** What to say when the queue runs out, which depends on why it did. */
  emptyNote: string;
  refreshStats: (remaining: number) => Promise<void>;
  /** Answers given this sitting, newest last. Undo pops from the end. */
  history: Answered[];
  /** The card on screen last, so the next draw avoids repeating it. */
  lastId?: string;
  /** Set by undo: the next card must be this one, not a random draw. */
  forceNextId?: string;
}

/** How many answers back you can go. Anki's own limit is about this deep. */
const UNDO_DEPTH = 30;

/**
 * Put the last answer back.
 *
 * The card returns exactly as it was — its due date, its memory state, its
 * step, its lapse count — and today's counters give back the review as
 * well, so an undo leaves nothing behind. It comes back to the front of the
 * queue rather than to wherever the scheduler would have put it, because
 * the reason you undid it is that you meant to answer it differently.
 */
async function undoLast(session: Session): Promise<void> {
  const last = session.history.pop();
  if (!last) return;
  // A fresh stamp, or the next sync would hand the graded copy straight back.
  await saveCard({ ...last.before, updatedAt: Date.now() });
  await unrecordReview(last.wasNew, last.at, last.deckId);
  void import("./review-stats.js")
    .then((m) => m.unrecordGradedReview(last.grade, last.wasNew, last.at))
    .catch(() => undefined);

  // If the answer put the card back in the queue for another step, that
  // copy goes: the card is about to be asked again anyway.
  const at = session.queue.findIndex((c) => c.id === last.before.id);
  if (at >= 0) session.queue.splice(at, 1);
  session.queue.unshift(last.before);
  // The undone card comes back itself — the reason you undid it is that
  // you meant to answer it differently, not to be dealt something else.
  session.forceNextId = last.before.id;
  await session.refreshStats(session.queue.length);
  showNext(session);
}

/**
 * Draw the next card: at random, at the moment it is needed.
 *
 * A queue shuffled once and then consumed in order is random exactly once.
 * The moment a learning card rejoins the back, the sitting settles into a
 * loop, and a loop is a sequence, and a sequence gets memorised — "after
 * this one comes the fish" is not a memory of the fish. So the draw
 * happens per card, from whatever is currently ready, with three rules:
 * the card just answered is not drawn again while anything else waits;
 * undo brings back exactly the card that was undone; and a draw that
 * lands on a new card takes the EARLIEST new card, so introductions stay
 * chronological even though everything else is dice.
 */
function drawCard(session: Session): Card | undefined {
  const { queue } = session;
  if (queue.length === 0) return undefined;

  if (session.forceNextId) {
    const at = queue.findIndex((c) => c.id === session.forceNextId);
    session.forceNextId = undefined;
    if (at >= 0) return queue.splice(at, 1)[0];
  }

  const now = Date.now();
  const ready = queue.filter((c) => c.due <= now);
  if (ready.length === 0) {
    // Everything left is a learning step still cooling down: take the one
    // that comes ready soonest, exactly like the learn-ahead rule.
    const soonest = queue.reduce((a, b) => (a.due <= b.due ? a : b));
    return queue.splice(queue.indexOf(soonest), 1)[0];
  }

  let pool = ready.filter((c) => c.id !== session.lastId);
  if (pool.length === 0) pool = ready;
  const drawn = pool[Math.floor(Math.random() * pool.length)];
  // New cards yield to the front of their own line.
  const chosen = drawn.state === "new" ? pool.find((c) => c.state === "new")! : drawn;
  return queue.splice(queue.indexOf(chosen), 1)[0];
}

function showNext(session: Session): void {
  const { area, queue } = session;
  const card = drawCard(session);
  if (!card) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="big">🎉</div>
        <div>${session.emptyNote}</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          ${session.history.length > 0 ? `<button id="undo-btn" class="ghost">↩ Undo last answer</button>` : ""}
          <a href="#decks"><button class="secondary">Browse decks</button></a>
        </div>
      </div>
    `;
    area.querySelector<HTMLButtonElement>("#undo-btn")?.addEventListener("click", () => void undoLast(session));
    return;
  }

  session.lastId = card.id;
  const preview = gradePreview(card, Date.now(), session.config);

  area.innerHTML = `
    <div class="card-panel review-card">
      ${card.leech ? `<div class="leech-tag">Leech · ${card.lapses} lapses</div>` : ""}
      <div class="review-term" lang="ja">${escapeHtml(card.term)}</div>
      <div id="answer" style="display:none">
        <div id="reading-row" class="review-reading" lang="ja"><span>${readingHtml(card)}</span></div>
        <div class="review-glosses">${escapeHtml(card.glosses.join(" · "))}</div>
        ${
          // The sentence the word was mined from, whole, and only once the
          // answer is up. It used to sit on the front with the word blanked
          // out to 〇〇, which is a hint nobody asked for and clutter for the
          // rest of the card's life; here it is the context it was saved as.
          card.sentenceFurigana
            ? `<div class="review-sentence" lang="ja">${rubyHtml(card.sentenceFurigana)}</div>`
            : card.sentence
              ? `<div class="review-sentence" lang="ja">${escapeHtml(card.sentence)}</div>`
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
      ${
        session.history.length > 0
          ? `<div class="undo-row"><button id="undo-btn" class="ghost">↩ Undo</button></div>`
          : ""
      }
    </div>
  `;

  area.querySelector<HTMLButtonElement>("#undo-btn")?.addEventListener("click", () => void undoLast(session));

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
      const updated = gradeCard(card, grade, now, session.config);
      await saveCard(updated);
      await recordReview(wasNew, now, deckOf(card));
      // Everything undo needs to put this back, before anything changed it.
      session.history.push({ before: card, grade, wasNew, at: now, deckId: deckOf(card) });
      if (session.history.length > UNDO_DEPTH) session.history.shift();
      // The permanent record: how each button fell, per day, for ever.
      void import("./review-stats.js")
        .then((m) => m.recordGradedReview(grade, wasNew, now))
        .catch(() => undefined);

      // Cards still due within this session (short learning steps) rejoin the
      // queue so they come round again, as they would in Anki.
      if (updated.state !== "review" && updated.due <= now + 20 * 60 * 1000) {
        queue.push(updated);
      }
      await session.refreshStats(queue.length);
      session.prefetchAhead();
      showNext(session);
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
