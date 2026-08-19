import type { FsrsWeights } from "./fsrs.js";

/**
 * Deck settings, matching the options Anki exposes on a preset.
 *
 * Defaults here mirror a sentence-mining preset: FSRS on at 80% retention,
 * 20 new cards a day, effectively no review cap, sub-minute first learning
 * step, and leeches tagged rather than suspended.
 */
export interface DeckConfig {
  // --- scheduler ---
  /** Use FSRS. With this off the SM-2 scheduler is used instead. */
  fsrs: boolean;
  /** Target recall probability, 0.7–0.99. Lower means longer intervals. */
  desiredRetention: number;
  fsrsWeights: FsrsWeights;

  // --- daily limits ---
  newPerDay: number;
  maxReviewsPerDay: number;
  /** Introduce new cards even when the review limit is reached. */
  newIgnoresReviewLimit: boolean;
  /**
   * The hour a new study day begins, local time. Anki calls this "next day
   * starts at" and defaults it to 4am: a session at one in the morning is
   * the end of the previous day's studying, not the start of the next
   * day's, so it must not hand out a second helping of new cards.
   */
  rolloverHour: number;

  // --- new cards ---
  /** Learning steps, in seconds. Anki writes these as "20s 1m 5m". */
  learningStepsSec: number[];
  /** Order new cards are introduced in. */
  newCardOrder: "added" | "random";

  // --- lapses ---
  relearningStepsSec: number[];
  /** Lapses before a card is treated as a leech. */
  leechThreshold: number;
  leechAction: "tag" | "suspend";

  // --- SM-2, plus the one FSRS borrows ---
  graduatingIntervalDays: number;
  /**
   * The interval an "easy" graduation from learning gets. Under FSRS it is
   * a cap: raw FSRS would hand a brand-new card a month off.
   */
  easyIntervalDays: number;
  startingEase: number;
  maxIntervalDays: number;
}

/**
 * Parameters carried over from the deck this app was set up to replace —
 * an FSRS-6 set already optimised against a real mining deck's history.
 * Re-run Anki's optimiser (or replace these) once you have your own reviews.
 */
export const MINING_DECK_FSRS_WEIGHTS: FsrsWeights = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

export const DEFAULT_DECK_CONFIG: DeckConfig = {
  fsrs: true,
  desiredRetention: 0.8,
  fsrsWeights: MINING_DECK_FSRS_WEIGHTS,

  newPerDay: 20,
  maxReviewsPerDay: 9999,
  newIgnoresReviewLimit: false,
  rolloverHour: 4,

  learningStepsSec: [20, 60, 300],
  newCardOrder: "added",

  relearningStepsSec: [180],
  leechThreshold: 5,
  leechAction: "tag",

  graduatingIntervalDays: 1,
  easyIntervalDays: 5,
  startingEase: 2.5,
  maxIntervalDays: 365 * 10,
};

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Parse Anki-style step lists: "20s 1m 5m", "3m", "1 10" (bare = minutes).
 * Returns seconds.
 */
export function parseSteps(text: string): number[] {
  const steps: number[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const match = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(token);
    if (!match) throw new Error(`"${token}" is not a valid step (try 20s, 1m, 10m).`);
    const value = Number(match[1]);
    if (value <= 0) throw new Error("Steps must be longer than zero.");
    steps.push(Math.round(value * UNITS[(match[2] || "m").toLowerCase()]));
  }
  if (steps.length === 0) throw new Error("Enter at least one step.");
  return steps;
}

/** Render steps the way Anki shows them. */
export function formatSteps(stepsSec: number[]): string {
  return stepsSec
    .map((sec) => {
      if (sec % 86400 === 0) return `${sec / 86400}d`;
      if (sec % 3600 === 0) return `${sec / 3600}h`;
      if (sec % 60 === 0) return `${sec / 60}m`;
      return `${sec}s`;
    })
    .join(" ");
}

/**
 * When the study day containing `at` began, in local time.
 *
 * Everything that counts "per day" asks this rather than dividing by 86400:
 * a day is not a fixed slice of the epoch, it starts at the hour the deck
 * says it does, and daylight saving moves it by an hour twice a year.
 */
export function dayStart(at: number, rolloverHour = DEFAULT_DECK_CONFIG.rolloverHour): number {
  const hour = Math.min(23, Math.max(0, Math.round(rolloverHour)));
  const here = new Date(at);
  const boundary = (offset: number): number =>
    new Date(here.getFullYear(), here.getMonth(), here.getDate() + offset, hour, 0, 0, 0).getTime();
  const start = boundary(0);
  // Before today's boundary means we are still inside yesterday's day.
  return start <= at ? start : boundary(-1);
}

/** When the study day containing `at` ends: the next rollover boundary. */
export function dayEnd(at: number, rolloverHour = DEFAULT_DECK_CONFIG.rolloverHour): number {
  const hour = Math.min(23, Math.max(0, Math.round(rolloverHour)));
  const start = new Date(dayStart(at, rolloverHour));
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, hour, 0, 0, 0).getTime();
}

/** The study day containing `at`, as YYYY-MM-DD of the day it belongs to. */
export function dayKey(at: number, rolloverHour = DEFAULT_DECK_CONFIG.rolloverHour): string {
  const d = new Date(dayStart(at, rolloverHour));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
