import { getMeta, onAccountChange, setMeta } from "./db.js";

/**
 * Yennies: what studying pays.
 *
 * Two sources, and both are quiet. Answering correctly in the kana game or a
 * grammar unit earns a little per right answer, banked when the run ends.
 * Levelling up pays a burst — a bigger one each time, though levels get
 * exponentially longer, so what an hour of study is worth in yennies falls
 * steadily as the account grows. That is the point: the burst should feel
 * like an occasion rather than a wage.
 *
 * Deliberately invisible while playing. The balance is shown on the screen
 * that ends a run and in the Gacha tab, and nowhere else — a counter ticking
 * up in the corner of a drill is a reason to keep tapping, which is not the
 * reason anyone should be here.
 *
 * The balance lives in the account's own database, so it follows the person
 * and works exactly the same for someone who has not signed in.
 */

const KEY = "yennies";

/** One yenny per right answer: enough to add up, too little to farm. */
export const PER_CORRECT = 1;

/**
 * What reaching `level` pays. Grows with the level, but far more slowly than
 * the XP that level costs — see `xpToNext`.
 */
export function levelReward(level: number): number {
  return 50 + (level - 1) * 10;
}

/** Everything reaching this level pays, when several are crossed at once. */
export function rewardBetween(before: number, after: number): number {
  let total = 0;
  for (let level = before + 1; level <= after; level++) total += levelReward(level);
  return total;
}

let cached: number | null = null;
onAccountChange(() => {
  cached = null;
});

export async function yennies(): Promise<number> {
  cached ??= (await getMeta<number>(KEY)) ?? 0;
  return cached;
}

/** Bank yennies. Returns the new balance; never toasts, never draws. */
export async function earnYennies(amount: number): Promise<number> {
  const add = Math.max(0, Math.floor(amount));
  const next = (await yennies()) + add;
  cached = next;
  await setMeta(KEY, next);
  return next;
}

/**
 * Take yennies out — for the gacha. False when the balance will not cover it,
 * in which case nothing is taken.
 */
export async function spendYennies(amount: number): Promise<boolean> {
  const cost = Math.max(0, Math.floor(amount));
  const have = await yennies();
  if (have < cost) return false;
  cached = have - cost;
  await setMeta(KEY, cached);
  return true;
}

/** "1,240 ¥" — one place, so the currency reads the same everywhere. */
export function formatYennies(amount: number): string {
  return `${amount.toLocaleString()} ¥`;
}
