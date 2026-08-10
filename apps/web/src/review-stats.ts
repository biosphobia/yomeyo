import { getMeta, onAccountChange, setMeta } from "./db.js";
import type { Grade } from "@yomeyo/core";

/**
 * The permanent record of flashcard reviews.
 *
 * Every graded card counts here, by local day: how many were answered, how
 * each button fell (again / hard / good / easy), and how many were brand
 * new that day. Nothing is ever pruned — the lifetime numbers are just the
 * sum of the days — and the whole log rides the synced progress, merged
 * per-day per-counter by max, so devices agree without double counting.
 */

export interface DayReviewStats {
  again: number;
  hard: number;
  good: number;
  easy: number;
  /** Of the reviews above, how many introduced a brand-new card. */
  introduced: number;
}

export type ReviewLog = Record<string, Partial<DayReviewStats>>;

const LOG_KEY = "reviewLog";

let cached: ReviewLog | null = null;
onAccountChange(() => {
  cached = null;
});

/** Local calendar day, YYYY-MM-DD — same shape the quest log uses. */
export function reviewDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function log(): Promise<ReviewLog> {
  cached ??= (await getMeta<ReviewLog>(LOG_KEY)) ?? {};
  return cached;
}

/** Count one graded card into today's record. */
export async function recordGradedReview(grade: Grade, wasNew: boolean, now = Date.now()): Promise<void> {
  const all = await log();
  const day = (all[reviewDateKey(new Date(now))] ??= {});
  day[grade] = (day[grade] ?? 0) + 1;
  if (wasNew) day.introduced = (day.introduced ?? 0) + 1;
  await setMeta(LOG_KEY, all);
}

/**
 * Take one back out again, for undo.
 *
 * The log merges across devices by taking the larger of two counts, so an
 * undo can in principle be handed back by a device that already saw the
 * higher number. That is the right trade: the alternative is a permanent
 * record that quietly counts answers nobody kept.
 */
export async function unrecordGradedReview(grade: Grade, wasNew: boolean, now = Date.now()): Promise<void> {
  const all = await log();
  const day = all[reviewDateKey(new Date(now))];
  if (!day) return;
  day[grade] = Math.max(0, (day[grade] ?? 0) - 1);
  if (wasNew) day.introduced = Math.max(0, (day.introduced ?? 0) - 1);
  await setMeta(LOG_KEY, all);
}

const filled = (day: Partial<DayReviewStats> | undefined): DayReviewStats => ({
  again: day?.again ?? 0,
  hard: day?.hard ?? 0,
  good: day?.good ?? 0,
  easy: day?.easy ?? 0,
  introduced: day?.introduced ?? 0,
});

export function reviewsOf(stats: DayReviewStats): number {
  return stats.again + stats.hard + stats.good + stats.easy;
}

/** One day's record, zeros when nothing was studied. */
export async function dayReviewStats(key: string): Promise<DayReviewStats> {
  return filled((await log())[key]);
}

/** Everything, summed: the lifetime numbers. */
export async function lifetimeReviewStats(): Promise<DayReviewStats & { days: number }> {
  const all = await log();
  const total: DayReviewStats & { days: number } = { again: 0, hard: 0, good: 0, easy: 0, introduced: 0, days: 0 };
  for (const day of Object.values(all)) {
    const f = filled(day);
    if (reviewsOf(f) === 0) continue;
    total.again += f.again;
    total.hard += f.hard;
    total.good += f.good;
    total.easy += f.easy;
    total.introduced += f.introduced;
    total.days++;
  }
  return total;
}
