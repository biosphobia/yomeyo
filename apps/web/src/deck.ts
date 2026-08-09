import { DEFAULT_DECK_CONFIG, type DeckConfig } from "@yomeyo/core";
import { getMeta, setMeta, onAccountChange } from "./db.js";

/**
 * Deck options, and the per-day counters the daily limits need.
 *
 * There is one set of global options (the Settings screen edits those), and
 * any deck can carry its own partial override — its own new-cards-per-day,
 * its own review cap — which is laid over the global set when that deck is
 * scheduled. Anki calls the same idea a preset.
 *
 * The daily counters are per deck, as Anki keeps them, so one deck hitting
 * its limit never spends another deck's allowance.
 */

const CONFIG_KEY = "deckConfig";
const OVERRIDE_PREFIX = "deckConfig:";
const COUNTS_KEY = "dailyCounts2";

let cached: DeckConfig | null = null;
const overrides = new Map<string, Partial<DeckConfig> | null>();

// Deck options belong to the account, not the browser.
onAccountChange(() => {
  cached = null;
  overrides.clear();
});

async function globalConfig(): Promise<DeckConfig> {
  if (!cached) {
    const stored = await getMeta<Partial<DeckConfig>>(CONFIG_KEY);
    // Merge over the defaults so a config saved by an older version still
    // gets any newly-added options.
    cached = { ...DEFAULT_DECK_CONFIG, ...(stored ?? {}) };
  }
  return cached;
}

/**
 * The options a deck is scheduled with: the global set, with the deck's own
 * override (if it has one) on top. No deckId means the global set itself.
 */
export async function getDeckConfig(deckId?: string): Promise<DeckConfig> {
  const global = await globalConfig();
  if (!deckId) return global;
  const own = await getDeckOverride(deckId);
  return own ? { ...global, ...own } : global;
}

/** A deck's own partial settings, or null when it follows the global set. */
export async function getDeckOverride(deckId: string): Promise<Partial<DeckConfig> | null> {
  if (!overrides.has(deckId)) {
    const stored = await getMeta<Partial<DeckConfig>>(OVERRIDE_PREFIX + deckId);
    overrides.set(deckId, stored && Object.keys(stored).length > 0 ? stored : null);
  }
  return overrides.get(deckId) ?? null;
}

/** Give a deck its own settings, or null to put it back on the global set. */
export async function saveDeckOverride(deckId: string, own: Partial<DeckConfig> | null): Promise<void> {
  overrides.set(deckId, own && Object.keys(own).length > 0 ? own : null);
  await setMeta(OVERRIDE_PREFIX + deckId, own ?? {});
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

interface DeckCounts {
  introduced: number;
  reviewed: number;
}

interface DailyCounts {
  day: string;
  perDeck: Record<string, DeckCounts>;
}

/** Local calendar day, so the limits roll over at local midnight. */
function today(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function todaysCounts(now: number): Promise<DailyCounts> {
  const stored = await getMeta<DailyCounts>(COUNTS_KEY);
  if (stored && stored.day === today(now) && stored.perDeck) return stored;
  return { day: today(now), perDeck: {} };
}

/**
 * Today's counts: one deck's when named, everything summed when not.
 */
export async function getDailyCounts(now = Date.now(), deckId?: string): Promise<DeckCounts> {
  const counts = await todaysCounts(now);
  if (deckId) return counts.perDeck[deckId] ?? { introduced: 0, reviewed: 0 };
  let introduced = 0;
  let reviewed = 0;
  for (const deck of Object.values(counts.perDeck)) {
    introduced += deck.introduced;
    reviewed += deck.reviewed;
  }
  return { introduced, reviewed };
}

/** Record a review against its deck; `wasNew` means the card was introduced. */
export async function recordReview(wasNew: boolean, now = Date.now(), deckId = "mining"): Promise<void> {
  const counts = await todaysCounts(now);
  const deck = (counts.perDeck[deckId] ??= { introduced: 0, reviewed: 0 });
  if (wasNew) deck.introduced++;
  else deck.reviewed++;
  await setMeta(COUNTS_KEY, counts);
}
