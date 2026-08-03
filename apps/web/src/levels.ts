import { getMeta, onAccountChange, setMeta } from "./db.js";

/**
 * The account level: a lifetime XP total and the level it works out to.
 *
 * XP comes from the calendar — each quest completed pays a fixed amount,
 * finishing a whole day pays a bonus on top (see quests.ts, which does the
 * awarding). The total lives in the account's own database, so it follows
 * the person; someone not signed in levels up the same way, in the local
 * database, exactly like their deck.
 *
 * Levels get steadily longer: the step from level n to n+1 costs
 * 50 + 25·(n−1) XP, so early levels come quickly and later ones are earned.
 */

const XP_KEY = "xpTotal";

export const XP_PER_QUEST = 20;
export const XP_DAY_BONUS = 30;

/** XP needed to go from `level` to the next. */
export function xpToNext(level: number): number {
  return 50 + (level - 1) * 25;
}

export interface LevelState {
  level: number;
  /** XP earned within the current level. */
  into: number;
  /** XP the current level costs in full. */
  need: number;
  total: number;
}

export function levelFromXp(total: number): LevelState {
  let level = 1;
  let rest = Math.max(0, Math.floor(total));
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level), total: Math.max(0, Math.floor(total)) };
}

let cached: number | null = null;
onAccountChange(() => {
  cached = null;
});

export async function totalXp(): Promise<number> {
  cached ??= (await getMeta<number>(XP_KEY)) ?? 0;
  return cached;
}

export async function levelState(): Promise<LevelState> {
  return levelFromXp(await totalXp());
}

/** Bank XP; returns the state before and after, so callers can spot a level-up. */
export async function addXp(amount: number): Promise<{ before: LevelState; after: LevelState }> {
  const before = levelFromXp(await totalXp());
  cached = before.total + Math.max(0, Math.floor(amount));
  await setMeta(XP_KEY, cached);
  return { before, after: levelFromXp(cached) };
}
