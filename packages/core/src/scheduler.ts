import { DEFAULT_DECK_CONFIG, dayStart, type DeckConfig } from "./deck-config.js";
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
    return graduate(next, memory, config, now, grade === "easy" ? config.easyIntervalDays : undefined, grade);
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

  return graduate(next, memory, config, now, undefined, grade);
}

function graduate(
  card: Card,
  memory: MemoryState,
  config: DeckConfig,
  now: number,
  capDays?: number,
  grade: Grade = "good",
): Card {
  const days = intervalFor(memory.stability, config.desiredRetention, config.fsrsWeights);
  const ceiling = Math.min(config.maxIntervalDays, capDays ?? Infinity);
  const clamped = Math.min(Math.max(Math.round(days), 1), ceiling);
  const fuzzed = applyFuzz(clamped, ceiling, roll(fuzzSeed(card, grade)));
  return {
    ...card,
    state: "review",
    stepIndex: 0,
    intervalDays: fuzzed,
    due: now + fuzzed * DAY_MS,
  };
}

// ---------------- fuzz ----------------

/**
 * Anki's interval fuzz, and the reason for it.
 *
 * Two cards learned in the same sitting are scheduled the same number of
 * days out, and so are their children, and so on — left alone, a deck
 * congeals into clumps that all come due on the same handful of days. So
 * every interval past a couple of days is nudged by a few percent, and the
 * clumps come apart on their own.
 *
 * The bands are Anki's: the further out a card is, the smaller the nudge
 * needs to be in proportion, because a day either way matters less.
 */
const FUZZ_BANDS: [start: number, end: number, factor: number][] = [
  [2.5, 7.0, 0.15],
  [7.0, 20.0, 0.1],
  [20.0, Infinity, 0.05],
];

function applyFuzz(days: number, maxDays: number, chance: number): number {
  // Anything inside a couple of days is left exactly where it is: there is
  // nowhere for it to go, and moving it would undo the schedule.
  if (days < 2.5) return days;
  let delta = 1;
  for (const [start, end, factor] of FUZZ_BANDS) {
    delta += factor * Math.max(Math.min(days, end) - start, 0);
  }
  const high = Math.min(Math.round(days + delta), maxDays);
  const low = Math.min(Math.max(2, Math.round(days - delta)), high);
  return low + Math.floor(chance * (high - low + 1));
}

/**
 * The fuzz is random but not capricious: it is drawn from the card itself,
 * so the interval the buttons promise is the interval the card gets. Anki
 * does exactly this — seed the generator from the card and its review
 * count — because a preview that disagrees with the answer is a bug you
 * cannot see until you look twice.
 */
function fuzzSeed(card: Card, grade: Grade): number {
  return seedOf(`${card.id}|${card.reps}|${grade}`);
}

/** A number from a string, stably. */
function seedOf(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** One number in [0, 1) from a seed. */
function roll(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

  const alive = cards.filter((c) => !c.deleted);
  const suspended = (c: Card) => c.leech && config.leechAction === "suspend";
  const live = alive.filter((c) => !suspended(c) && c.due <= now);

  const learning = live.filter((c) => c.state === "learning" || c.state === "relearning");
  const due = live.filter((c) => c.state === "review");
  const fresh = live.filter((c) => c.state === "new");

  const reviewRoom = Math.max(0, config.maxReviewsPerDay - reviewed);
  const newRoom = Math.max(0, config.newPerDay - introduced);

  // New cards arrive in the order the words did — chronological, or the
  // order somebody dragged the deck into — unless the deck asked for
  // random. (The sort used to run over the shuffle too, which quietly
  // turned "random" back into "added".)
  const ordered =
    config.newCardOrder === "random"
      ? shuffle(fresh, now)
      : [...fresh].sort((a, b) => orderOf(a) - orderOf(b));

  const queue = [
    // Learning cards are never limited: they are already in flight.
    ...learning.sort((a, b) => a.due - b.due),
    ...byDueThenRandom(due, now, config.rolloverHour).slice(0, reviewRoom),
    ...ordered.slice(0, config.newIgnoresReviewLimit ? newRoom : Math.min(newRoom, Math.max(0, reviewRoom))),
  ];
  if (queue.length > 0) return queue;

  // Nothing is due — but a learning card a few minutes out is worth
  // finishing rather than closing the app for. Anki calls this the
  // learn-ahead limit and defaults it to twenty minutes; the alternative
  // is being told to come back at 3:04pm.
  return alive
    .filter(
      (c) =>
        !suspended(c) &&
        (c.state === "learning" || c.state === "relearning") &&
        c.due > now &&
        c.due <= now + LEARN_AHEAD_MS,
    )
    .sort((a, b) => a.due - b.due);
}

/** Anki's learn-ahead limit: how far into the future a step may be pulled. */
const LEARN_AHEAD_MS = 20 * 60 * 1000;

/**
 * The review order: due date, then random — freshly random on every build.
 *
 * Sorting purely by the timestamp brings the cards back in the order they
 * were answered in, sitting after sitting — the same words in the same
 * run, which becomes its own cue. Cards owed from the same DAY are
 * therefore shuffled among themselves, while an older day's backlog still
 * comes first. The shuffle is a fresh draw each time the queue is built:
 * within a sitting the queue is consumed in memory and never reshuffles
 * under the reader, but leaving and coming back deals a new order, so
 * even a second pass in one evening is not the same run twice.
 *
 * A "day" here is the deck's own day, beginning at its rollover hour, so a
 * card answered at one in the morning belongs to the session it was part of.
 */
function byDueThenRandom(cards: Card[], now: number, rolloverHour: number): Card[] {
  const day = (at: number): number => dayStart(at, rolloverHour);
  const today = day(now);
  const rank = new Map<string, number>();
  for (const card of cards) rank.set(card.id, Math.random());
  return [...cards].sort((a, b) => {
    // Everything owed from before today is one bucket, oldest day first.
    const dayA = Math.min(day(a.due), today);
    const dayB = Math.min(day(b.due), today);
    if (dayA !== dayB) return dayA - dayB;
    return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
  });
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
