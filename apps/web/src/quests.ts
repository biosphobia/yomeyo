import { getMeta, setMeta } from "./db.js";

/**
 * Daily quests.
 *
 * Each local calendar day gets a small set of quests, picked
 * deterministically from the pool below — every device agrees on the day's
 * quests without anything to sync. Screens report plain events ("a kana was
 * answered right", "a level was cleared") and the log stores per-day event
 * counts; quests are just goals laid over those counts, which means the
 * pool can be changed later without corrupting any history.
 *
 * To add or change quests, edit QUEST_POOL — nothing else has to move.
 */

export interface QuestDef {
  id: string;
  title: string;
  detail: string;
  goal: number;
  /** The event this quest counts. */
  event: string;
}

/** The pool a day's quests are drawn from. */
export const QUEST_POOL: QuestDef[] = [
  {
    id: "kana-warmup",
    title: "Kana warm-up",
    detail: "Answer 20 kana questions correctly.",
    goal: 20,
    event: "kana-correct",
  },
  {
    id: "kana-climb",
    title: "One rung higher",
    detail: "Clear a level in the kana game.",
    goal: 1,
    event: "kana-level",
  },
  {
    id: "kana-marathon",
    title: "Kana marathon",
    detail: "Answer 50 kana questions correctly.",
    goal: 50,
    event: "kana-correct",
  },
  {
    id: "kana-flawless",
    title: "Flawless",
    detail: "Clear a kana level without a single miss.",
    goal: 1,
    event: "kana-level-perfect",
  },
];

/** How many quests a day gets. */
const PER_DAY = 2;

/** A local-time day key, YYYY-MM-DD — quests turn over at local midnight. */
export function dateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  // mulberry32: tiny, deterministic, plenty for picking quests.
  let state = seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The quests of one day, the same on every device. */
export function questsForDay(key: string): QuestDef[] {
  return seededShuffle(QUEST_POOL, hashKey(key)).slice(0, PER_DAY);
}

// ---------------- the event log ----------------

const LOG_KEY = "questLog";

/** dateKey → event name → count. */
type QuestLog = Record<string, Record<string, number>>;

let cached: QuestLog | null = null;

async function log(): Promise<QuestLog> {
  cached ??= (await getMeta<QuestLog>(LOG_KEY)) ?? {};
  return cached;
}

/**
 * Count an event towards today's quests. Fire-and-forget from the screens
 * that produce events; nothing about quests needs to be known there.
 */
export async function recordQuestEvent(event: string, amount = 1): Promise<void> {
  const all = await log();
  const today = dateKey();
  const day = (all[today] ??= {});
  day[event] = (day[event] ?? 0) + amount;
  await setMeta(LOG_KEY, all);
}

export async function eventsOf(key: string): Promise<Record<string, number>> {
  return (await log())[key] ?? {};
}

export function questProgress(quest: QuestDef, events: Record<string, number>): number {
  return Math.min(quest.goal, events[quest.event] ?? 0);
}

export async function dayComplete(key: string): Promise<boolean> {
  const events = await eventsOf(key);
  return questsForDay(key).every((quest) => questProgress(quest, events) >= quest.goal);
}

/**
 * Consecutive fully-completed days ending today (or yesterday, so a streak
 * is not "broken" at breakfast before today's quests are even possible).
 */
export async function dayStreak(now: Date = new Date()): Promise<number> {
  let streak = 0;
  const cursor = new Date(now);
  if (!(await dayComplete(dateKey(cursor)))) cursor.setDate(cursor.getDate() - 1);
  while (await dayComplete(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
