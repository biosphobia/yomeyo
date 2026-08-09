import { DEFAULT_DECK_CONFIG, type DeckConfig } from "./deck-config.js";
import { orderOf } from "./deck-library.js";
import { RATING, intervalFor, nextMemoryState, type FsrsRating, type MemoryState } from "./fsrs.js";
import { DEFAULT_SRS_CONFIG, gradeCard as gradeSm2 } from "./srs.js";
import type { Card, CardState, Grade } from "./types.js";

/**
 * Card scheduling, Anki-style: short learning steps first, then either FSRS
 * or SM-2 for the long-term intervals.
 *
 * Learning steps are deliberately kept outside FSRS, exactly as Anki does it.
 * FSRS models memory over days; the 20-second and 1-minute steps that get a
 * brand-new word into your head are a different job.
 */

const DAY_MS = 86_400_000;

const RATING_OF: Record<Grade, FsrsRating> = {
  again: RATING.again,
  hard: RATING.hard,
  good: RATING.good,
  easy: RATING.easy,
};

function memoryOf(card: Card): MemoryState | null {
  return typeof card.stability === "number" && typeof card.difficulty === "number"
    ? { stability: card.stability, difficulty: card.difficulty }
    : null;
}

/** Days since the card was last reviewed; 0 for a same-day repeat. */
function elapsedDays(card: Card, now: number): number {
  if (!card.lastReview) return 0;
  return Math.max(0, (now - card.lastReview) / DAY_MS);
}

/**
 * Apply a review. Returns a new card; the original is untouched.
 *
 * `config` defaults to the shipped preset, so callers that do not care about
 * deck options still get sensible scheduling.
 */
export function gradeCard(
  card: Card,
  grade: Grade,
  now: number,
  config: DeckConfig = DEFAULT_DECK_CONFIG,
): Card {
  if (!config.fsrs) {
    // SM-2, with the deck's steps and intervals.
    return gradeSm2(card, grade, now, {
      ...DEFAULT_SRS_CONFIG,
      learningStepsMin: config.learningStepsSec.map((s) => s / 60),
      relearningStepsMin: config.relearningStepsSec.map((s) => s / 60),
      graduatingIntervalDays: config.graduatingIntervalDays,
      easyIntervalDays: config.easyIntervalDays,
      startingEase: config.startingEase,
      maxIntervalDays: config.maxIntervalDays,
    });
  }

  const rating = RATING_OF[grade];
  const next: Card = { ...card, reps: card.reps + 1, updatedAt: now, lastReview: now };

  // Memory state advances on every review, including learning steps — that
  // is what makes the interval right the moment the card graduates.
  const memory = nextMemoryState(memoryOf(card), rating, elapsedDays(card, now), config.fsrsWeights);
  next.stability = memory.stability;
  next.difficulty = memory.difficulty;

  const inLearning = card.state === "new" || card.state === "learning" || card.state === "relearning";
  const steps = card.state === "relearning" ? config.relearningStepsSec : config.learningStepsSec;

  if (inLearning && steps.length > 0) {
    const learningState: CardState = card.state === "relearning" ? "relearning" : "learning";

    if (grade === "again") {
      next.state = learningState;
      next.stepIndex = 0;
      next.due = now + steps[0] * 1000;
      return next;
    }
    if (grade === "hard") {
      // Anki repeats the current step, a little longer.
      next.state = learningState;
      next.stepIndex = card.stepIndex;
      next.due = now + steps[Math.min(card.stepIndex, steps.length - 1)] * 1500;
      return next;
    }
    if (grade === "good" && card.stepIndex + 1 < steps.length) {
      next.state = learningState;
      next.stepIndex = card.stepIndex + 1;
      next.due = now + steps[card.stepIndex + 1] * 1000;
      return next;
    }
    // "good" on the last step, or "easy" at any point, graduates the card.
    // FSRS decides the first real interval from the state built up above —
    // but an "easy" graduation is capped at the deck's easy interval: raw
    // FSRS hands a brand-new card a month off, which nobody asked for.
    return graduate(next, memory, config, now, grade === "easy" ? config.easyIntervalDays : undefined);
  }

  // A review card.
  if (grade === "again") {
    next.lapses = card.lapses + 1;
    if (next.lapses >= config.leechThreshold) next.leech = true;

    if (config.relearningStepsSec.length > 0) {
      next.state = "relearning";
      next.stepIndex = 0;
      next.due = now + config.relearningStepsSec[0] * 1000;
      next.intervalDays = 0;
      return next;
    }
  }

  return graduate(next, memory, config, now);
}

function graduate(card: Card, memory: MemoryState, config: DeckConfig, now: number, capDays?: number): Card {
  const days = intervalFor(memory.stability, config.desiredRetention, config.fsrsWeights);
  const clamped = Math.min(Math.max(Math.round(days), 1), config.maxIntervalDays, capDays ?? Infinity);
  return {
    ...card,
    state: "review",
    stepIndex: 0,
    intervalDays: clamped,
    due: now + clamped * DAY_MS,
  };
}

/**
 * What each button would do, for the labels on the review screen.
 * Anki shows these so you can see the cost of a rating before choosing.
 */
export function gradePreview(
  card: Card,
  now: number,
  config: DeckConfig = DEFAULT_DECK_CONFIG,
): Record<Grade, number> {
  const grades: Grade[] = ["again", "hard", "good", "easy"];
  const out = {} as Record<Grade, number>;
  for (const grade of grades) out[grade] = gradeCard(card, grade, now, config).due - now;
  return out;
}

/**
 * The cards to study now, respecting the deck's daily limits.
 *
 * `introducedToday` / `reviewedToday` are counts the caller keeps; Anki holds
 * the same numbers per day per deck.
 */
export function buildQueue(
  cards: Card[],
  now: number,
  config: DeckConfig = DEFAULT_DECK_CONFIG,
  counts: { introducedToday?: number; reviewedToday?: number } = {},
): Card[] {
  const introduced = counts.introducedToday ?? 0;
  const reviewed = counts.reviewedToday ?? 0;

  const live = cards.filter((c) => !c.deleted && c.due <= now);
  const suspended = (c: Card) => c.leech && config.leechAction === "suspend";

  const learning = live.filter(
    (c) => !suspended(c) && (c.state === "learning" || c.state === "relearning"),
  );
  const due = live.filter((c) => !suspended(c) && c.state === "review");
  const fresh = live.filter((c) => !suspended(c) && c.state === "new");

  const reviewRoom = Math.max(0, config.maxReviewsPerDay - reviewed);
  const newRoom = Math.max(0, config.newPerDay - introduced);

  const ordered = config.newCardOrder === "random" ? shuffle(fresh, now) : [...fresh];

  return [
    // Learning cards are never limited: they are already in flight.
    ...learning.sort((a, b) => a.due - b.due),
    ...due.sort((a, b) => a.due - b.due).slice(0, reviewRoom),
    ...ordered
      // The order the words arrived in, unless the deck has been
      // rearranged, in which case the order somebody chose.
      .sort((a, b) => orderOf(a) - orderOf(b))
      .slice(0, config.newIgnoresReviewLimit ? newRoom : Math.min(newRoom, Math.max(0, reviewRoom))),
  ];
}

/** Deterministic shuffle, so the same day gives the same order. */
function shuffle(cards: Card[], seed: number): Card[] {
  const out = [...cards];
  let state = Math.floor(seed / DAY_MS) + 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
