import { getMeta, onAccountChange, setMeta } from "./db.js";
import { KANA_GROUPS, type KanaGroup } from "./kana-data.js";
import { XP_DAY_BONUS, XP_PER_QUEST, addXp } from "./levels.js";
import { toast } from "./toast.js";

/**
 * Daily quests, on a schedule.
 *
 * The journey starts the first day quests are ever looked at (or earned
 * towards), and counts local days from there. The first week is a fixed
 * curriculum: two hiragana groups a day, in textbook order, practised
 * together with everything learned before. Day 8 is a milestone — the
 * final group, and the hiragana exam. After the schedule runs out, days
 * draw from the pool below.
 *
 * Screens report plain events ("a kana was answered right", "a level was
 * cleared with these groups in play") and the log stores per-day counts;
 * quests are goals laid over those counts, so both the schedule and the
 * pool can be reshaped later without corrupting any history.
 */

export interface QuestDef {
  id: string;
  title: string;
  detail: string;
  goal: number;
  /** The event this quest counts. */
  event: string;
}

/** A day's worth of quests, and whether the day is a milestone. */
export interface DayPlan {
  quests: QuestDef[];
  /** Set on landmark days — shown as 🏁 on the calendar. */
  milestone?: string;
  /** True for days before the journey began — cleared by grace, not effort. */
  beforeJourney?: boolean;
}

/** The pool for days beyond the scheduled curriculum. */
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

const PER_DAY = 2;

/** A local-time day key, YYYY-MM-DD — quests turn over at local midnight. */
export function dateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------- the schedule ----------------

const START_KEY = "questStart";
let startCached: string | null = null;
onAccountChange(() => {
  startCached = null;
});

/** The journey's day 1, fixed the first time anything asks. */
export async function questStart(): Promise<string> {
  if (startCached) return startCached;
  const stored = await getMeta<string>(START_KEY);
  if (stored) return (startCached = stored);
  const today = dateKey();
  await setMeta(START_KEY, today);
  return (startCached = today);
}

function localTime(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 1-based day number of `key` in the journey. */
function dayNumber(key: string, start: string): number {
  return Math.round((localTime(key) - localTime(start)) / 86400000) + 1;
}

/**
 * The day the hiragana exam falls on: the eighth of the journey, when the
 * last row is learned and everything before it is tested together.
 */
export const EXAM_DAY = 8;

/** The date of a numbered day of the journey. */
function keyOfDay(start: string, day: number): string {
  const [y, m, d] = start.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + day - 1));
}

export interface Countdown {
  /** The date it falls on, as a day key. */
  key: string;
  /** Whole days from today: 0 is today, negative is behind us. */
  daysAway: number;
}

/**
 * When the hiragana exam is, counted from today.
 *
 * Its date is not a fixed calendar date — it is the eighth day of *this*
 * learner's journey, which begins the first time they look at a quest. So it
 * is worked out rather than stored, and it moves for nobody once the journey
 * has started.
 */
export async function examCountdown(now: Date = new Date()): Promise<Countdown> {
  const start = await questStart();
  const key = keyOfDay(start, EXAM_DAY);
  const daysAway = Math.round((localTime(key) - localTime(dateKey(now))) / 86400000);
  return { key, daysAway };
}

/** How many level clears each new group asks for — one pass is a glance. */
const CLEARS_PER_GROUP = 2;

function groupQuest(group: KanaGroup, day: number): QuestDef {
  return {
    id: `learn-${group.id}`,
    title: `New kana: ${group.title}`,
    detail: `${group.entries.map((entry) => entry.kana).join(" ")}. Clear ${CLEARS_PER_GROUP} kana levels with this group selected.`,
    goal: CLEARS_PER_GROUP,
    event: `group-cleared:${group.id}`,
  };
}

/**
 * The day's volume: enough repetitions that the new kana actually stick —
 * roughly eight sightings each — clamped so no day is a marathon. Across
 * the week this drills the whole syllabary several hundred times over.
 */
function drillQuest(day: number, newKanaCount: number): QuestDef {
  const goal = Math.max(60, Math.min(120, newKanaCount * 8));
  return {
    id: `drill-day-${day}`,
    title: "Daily drill",
    detail: `Answer ${goal} kana questions correctly.`,
    goal,
    event: "kana-correct",
  };
}

/** The bragging-rights extras, appearing every other day, alternating. */
function vanityQuest(day: number): QuestDef {
  return day % 4 === 0
    ? {
        id: "hot-streak",
        title: "Hot streak",
        detail: "Reach a 20-answer streak.",
        goal: 1,
        event: "kana-streak-20",
      }
    : {
        id: "kana-flawless",
        title: "Flawless",
        detail: "Clear a kana level without a single miss.",
        goal: 1,
        event: "kana-level-perfect",
      };
}

/**
 * What a given day asks for. Future days answer too — their quests are
 * viewable ahead of time; they just cannot be attempted until they arrive.
 * Days from before the journey began ask for nothing and count as cleared:
 * nobody misses a quest that was never put to them.
 */
export async function planForDay(key: string): Promise<DayPlan> {
  return planForDayFrom(key, await questStart());
}

/**
 * The same plan, from an explicit journey start. The plan is a pure function
 * of the date and the start day, which is what lets the admin panel work out
 * anyone's day: their start travels in their synced progress.
 */
export function planForDayFrom(key: string, start: string): DayPlan {
  const day = dayNumber(key, start);
  const hiragana = KANA_GROUPS.filter((group) => group.script === "hiragana");

  if (day < 1) return { quests: [], beforeJourney: true };

  // Week one: two groups a day, in order, on top of the ones before —
  // drilled hard enough that a week covers the whole syllabary properly.
  if (day >= 1 && day <= 7) {
    const first = hiragana[(day - 1) * 2];
    const second = hiragana[(day - 1) * 2 + 1];
    const quests = [
      groupQuest(first, day),
      groupQuest(second, day),
      drillQuest(day, first.entries.length + second.entries.length),
    ];
    if (day % 2 === 0) quests.push(vanityQuest(day));
    return { quests };
  }

  // Day 8: the last group, the exam over everything, and a full drill.
  if (day === EXAM_DAY) {
    const finalGroup = hiragana[hiragana.length - 1];
    return {
      milestone: "Hiragana complete",
      quests: [
        groupQuest(finalGroup, day),
        drillQuest(day, finalGroup.entries.length + 8),
        {
          id: "hiragana-exam",
          title: "Hiragana exam",
          detail: "The final hiragana test. Coming soon.",
          goal: 1,
          event: "hiragana-exam",
        },
        vanityQuest(day),
      ],
    };
  }

  return { quests: seededShuffle(QUEST_POOL, hashKey(key)).slice(0, PER_DAY) };
}

export async function questsForDay(key: string): Promise<QuestDef[]> {
  return (await planForDay(key)).quests;
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

// ---------------- the event log ----------------

const LOG_KEY = "questLog";

/** dateKey → event name → count. */
type QuestLog = Record<string, Record<string, number>>;

let cached: QuestLog | null = null;
onAccountChange(() => {
  cached = null;
});

async function log(): Promise<QuestLog> {
  cached ??= (await getMeta<QuestLog>(LOG_KEY)) ?? {};
  return cached;
}

/**
 * Count an event towards today's quests. Fire-and-forget from the screens
 * that produce events; nothing about quests needs to be known there.
 */
export async function recordQuestEvent(event: string, amount = 1): Promise<void> {
  await recordQuestEvents([event], amount);
}

/** Several events at once, one write — a level clear reports a bundle. */
export async function recordQuestEvents(events: string[], amount = 1): Promise<void> {
  await questStart(); // earning anything fixes day 1
  const all = await log();
  const today = dateKey();
  const day = (all[today] ??= {});
  for (const event of events) day[event] = (day[event] ?? 0) + amount;
  await setMeta(LOG_KEY, all);
  // The milestone exams each carry one of the mystery door's keys. Nothing
  // here says so; the toast the grant shows is deliberately unexplained.
  if (events.includes("hiragana-exam")) {
    void import("./door-keys.js").then((m) => m.grantDoorKey("hiragana")).catch(() => undefined);
  }
  if (events.includes("katakana-exam")) {
    void import("./door-keys.js").then((m) => m.grantDoorKey("katakana")).catch(() => undefined);
  }
  await grantQuestXp(today).catch(() => {
    /* a missed award is re-attempted on the next event */
  });
}

// ---------------- XP for completed quests ----------------

/** dateKey → ids already paid out ("day!" marks the whole-day bonus). */
const AWARD_KEY = "questXpAwarded";

/**
 * Pay out XP for any of today's quests that just crossed their goal, and the
 * day bonus when the whole day is done. Each is paid exactly once, however
 * often the counts move afterwards.
 */
async function grantQuestXp(key: string): Promise<void> {
  const plan = await planForDay(key);
  if (plan.quests.length === 0) return;
  const events = await eventsOf(key);
  const awarded = (await getMeta<Record<string, string[]>>(AWARD_KEY)) ?? {};
  const paid = new Set(awarded[key] ?? []);
  let gained = 0;
  const titles: string[] = [];
  for (const quest of plan.quests) {
    if (paid.has(quest.id) || questProgress(quest, events) < quest.goal) continue;
    paid.add(quest.id);
    titles.push(quest.title);
    gained += XP_PER_QUEST;
  }
  const allDone = plan.quests.every((quest) => questProgress(quest, events) >= quest.goal);
  if (allDone && !paid.has("day!")) {
    paid.add("day!");
    gained += XP_DAY_BONUS;
  }
  if (gained === 0) return;
  awarded[key] = [...paid];
  await setMeta(AWARD_KEY, awarded);
  const { before, after } = await addXp(gained);
  toast(
    after.level > before.level
      ? `+${gained} XP · Level up! Level ${after.level}`
      : `+${gained} XP${titles.length > 0 ? ` · ${titles.join(", ")}` : " · Day complete"}`,
  );
}

export async function eventsOf(key: string): Promise<Record<string, number>> {
  return (await log())[key] ?? {};
}

export function questProgress(quest: QuestDef, events: Record<string, number>): number {
  return Math.min(quest.goal, events[quest.event] ?? 0);
}

export async function dayComplete(key: string): Promise<boolean> {
  const events = await eventsOf(key);
  return (await questsForDay(key)).every((quest) => questProgress(quest, events) >= quest.goal);
}

/**
 * Consecutive fully-completed days ending today (or yesterday, so a streak
 * is not "broken" at breakfast before today's quests are even possible).
 * Days from before the journey are cleared by grace but earn no streak, so
 * the walk stops at day 1.
 */
export async function dayStreak(now: Date = new Date()): Promise<number> {
  const start = await questStart();
  let streak = 0;
  const cursor = new Date(now);
  if (!(await dayComplete(dateKey(cursor)))) cursor.setDate(cursor.getDate() - 1);
  while (dateKey(cursor) >= start && (await dayComplete(dateKey(cursor)))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
