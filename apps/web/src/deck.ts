import { DEFAULT_DECK_CONFIG, type DeckConfig } from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";

/**
 * Deck options, and the per-day counters the daily limits need.
 *
 * Anki tracks "introduced today" and "reviewed today" per deck; the same
 * counts are kept here, keyed by day so they reset at the day boundary.
 */

const CONFIG_KEY = "deckConfig";
const COUNTS_KEY = "dailyCounts";

let cached: DeckConfig | null = null;

export async function getDeckConfig(): Promise<DeckConfig> {
  if (!cached) {
    const stored = await getMeta<Partial<DeckConfig>>(CONFIG_KEY);
    // Merge over the defaults so a config saved by an older version still
    // gets any newly-added options.
    cached = { ...DEFAULT_DECK_CONFIG, ...(stored ?? {}) };
  }
  return cached;
}

export async function saveDeckConfig(config: DeckConfig): Promise<void> {
  cached = config;
  await setMeta(CONFIG_KEY, config);
}

export async function resetDeckConfig(): Promise<DeckConfig> {
  cached = { ...DEFAULT_DECK_CONFIG };
  await setMeta(CONFIG_KEY, cached);
  return cached;
}

interface DailyCounts {
  day: string;
  introduced: number;
  reviewed: number;
}

/** Local calendar day, so the limits roll over at local midnight. */
function today(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export async function getDailyCounts(now = Date.now()): Promise<{ introduced: number; reviewed: number }> {
  const stored = await getMeta<DailyCounts>(COUNTS_KEY);
  if (!stored || stored.day !== today(now)) return { introduced: 0, reviewed: 0 };
  return { introduced: stored.introduced, reviewed: stored.reviewed };
}

/** Record a review; `wasNew` means the card was being introduced. */
export async function recordReview(wasNew: boolean, now = Date.now()): Promise<void> {
  const counts = await getDailyCounts(now);
  await setMeta(COUNTS_KEY, {
    day: today(now),
    introduced: counts.introduced + (wasNew ? 1 : 0),
    reviewed: counts.reviewed + (wasNew ? 0 : 1),
  } satisfies DailyCounts);
}
