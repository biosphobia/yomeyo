/**
 * FSRS-6 — the scheduler Anki uses when FSRS is enabled.
 *
 * Where SM-2 multiplies an interval by an ease factor, FSRS models two
 * quantities per card and derives the interval from them:
 *
 *   stability  S — days until recall probability falls to 90%
 *   difficulty D — 1..10, how hard this card is for you
 *
 * Recall probability after t days is
 *
 *   R(t, S) = (1 + FACTOR · t/S) ^ DECAY
 *
 * and the interval for a target retention r inverts it. FSRS-6 takes 21
 * weights; the last is the decay itself, which earlier versions fixed.
 *
 * Weights are per-user: Anki's optimiser fits them to your review history,
 * so they are settings rather than constants.
 */

/** FSRS-6 uses 21 weights. */
export type FsrsWeights = readonly number[];

/** Anki's FSRS-6 defaults, used when no optimised set has been pasted in. */
export const DEFAULT_FSRS_WEIGHTS: FsrsWeights = [
  0.2172, 1.1771, 3.2602, 16.1507, 7.0114, 0.57, 2.0966, 0.0069, 1.5261, 0.112, 1.0178, 1.849,
  0.1133, 0.3127, 2.2934, 0.2191, 3.0004, 0.7536, 0.3332, 0.1437, 0.2,
];

export const FSRS_WEIGHT_COUNT = 21;

/** Ratings, in FSRS's 1..4 order. */
export const RATING = { again: 1, hard: 2, good: 3, easy: 4 } as const;
export type FsrsRating = (typeof RATING)[keyof typeof RATING];

/** What FSRS remembers about a card. */
export interface MemoryState {
  stability: number;
  difficulty: number;
}

const MIN_STABILITY = 0.001;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Decay is weight 20 in FSRS-6; earlier versions hard-coded -0.5. */
export function decayOf(w: FsrsWeights): number {
  return -w[20];
}

/** FACTOR makes R(S, S) exactly 0.9, whatever the decay is. */
export function factorOf(w: FsrsWeights): number {
  return Math.pow(0.9, 1 / decayOf(w)) - 1;
}

/** Probability of recall after `elapsedDays` at a given stability. */
export function retrievability(elapsedDays: number, stability: number, w: FsrsWeights): number {
  if (stability <= 0) return 0;
  const days = Math.max(0, elapsedDays);
  return Math.pow(1 + factorOf(w) * (days / stability), decayOf(w));
}

/** Days until recall probability falls to `desiredRetention`. */
export function intervalFor(stability: number, desiredRetention: number, w: FsrsWeights): number {
  const retention = clamp(desiredRetention, 0.7, 0.99);
  const decay = decayOf(w);
  return (stability / factorOf(w)) * (Math.pow(retention, 1 / decay) - 1);
}

/** Stability of a brand-new card after its first rating. */
export function initialStability(rating: FsrsRating, w: FsrsWeights): number {
  return Math.max(w[rating - 1], MIN_STABILITY);
}

/** Difficulty of a brand-new card after its first rating. */
export function initialDifficulty(rating: FsrsRating, w: FsrsWeights): number {
  return clamp(w[4] - Math.exp(w[5] * (rating - 1)) + 1, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/**
 * Difficulty after a review: move by the rating, damped near the ends of the
 * scale, then revert slightly toward the difficulty an "easy" first rating
 * would have given. Without that reversion difficulty only ever ratchets up.
 */
export function nextDifficulty(difficulty: number, rating: FsrsRating, w: FsrsWeights): number {
  const delta = -w[6] * (rating - 3);
  const damped = difficulty + delta * ((10 - difficulty) / 9);
  const reverted = w[7] * initialDifficulty(RATING.easy, w) + (1 - w[7]) * damped;
  return clamp(reverted, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/** Stability after a successful review (hard, good or easy). */
export function stabilityAfterRecall(
  state: MemoryState,
  rating: FsrsRating,
  recall: number,
  w: FsrsWeights,
): number {
  const hardPenalty = rating === RATING.hard ? w[15] : 1;
  const easyBonus = rating === RATING.easy ? w[16] : 1;
  const growth =
    Math.exp(w[8]) *
    (11 - state.difficulty) *
    Math.pow(state.stability, -w[9]) *
    (Math.exp((1 - recall) * w[10]) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(state.stability * (1 + growth), MIN_STABILITY);
}

/** Stability after a lapse. Never rewards forgetting with a longer interval. */
export function stabilityAfterLapse(
  state: MemoryState,
  recall: number,
  w: FsrsWeights,
): number {
  const longTerm =
    w[11] *
    Math.pow(state.difficulty, -w[12]) *
    (Math.pow(state.stability + 1, w[13]) - 1) *
    Math.exp((1 - recall) * w[14]);
  // A lapse must not leave stability above what a same-day review would give.
  const shortTerm = state.stability / Math.exp(w[17] * w[18]);
  return Math.max(Math.min(longTerm, shortTerm), MIN_STABILITY);
}

/**
 * Stability for a review on the same day the card was last seen — a learning
 * step, rather than a real recall test. FSRS-6 shrinks the effect as
 * stability grows (w19), so drilling a mature card cannot inflate it.
 */
export function shortTermStability(stability: number, rating: FsrsRating, w: FsrsWeights): number {
  let change = Math.exp(w[17] * (rating - 3 + w[18])) * Math.pow(stability, -w[19]);
  if (rating >= RATING.good) change = Math.max(change, 1);
  return Math.max(stability * change, MIN_STABILITY);
}

/**
 * Advance a card's memory state by one review.
 *
 * `elapsedDays` is the time since the previous review; 0 means the same day,
 * which is treated as a learning step rather than a recall test.
 */
export function nextMemoryState(
  previous: MemoryState | null,
  rating: FsrsRating,
  elapsedDays: number,
  w: FsrsWeights,
): MemoryState {
  if (!previous) {
    return {
      stability: initialStability(rating, w),
      difficulty: initialDifficulty(rating, w),
    };
  }

  const difficulty = nextDifficulty(previous.difficulty, rating, w);

  if (elapsedDays < 1) {
    return { stability: shortTermStability(previous.stability, rating, w), difficulty };
  }

  const recall = retrievability(elapsedDays, previous.stability, w);
  const stability =
    rating === RATING.again
      ? stabilityAfterLapse(previous, recall, w)
      : stabilityAfterRecall(previous, rating, recall, w);

  return { stability, difficulty };
}

/** Parse and validate a pasted FSRS parameter list. */
export function parseFsrsWeights(text: string): number[] {
  const values = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (values.some((v) => !Number.isFinite(v))) {
    throw new Error("FSRS parameters must be a comma-separated list of numbers.");
  }
  if (values.length !== FSRS_WEIGHT_COUNT) {
    throw new Error(
      `FSRS-6 needs ${FSRS_WEIGHT_COUNT} parameters; that list has ${values.length}.`,
    );
  }
  if (values[20] <= 0) {
    throw new Error("The last FSRS parameter (decay) must be greater than zero.");
  }
  return values;
}
