import { getMeta, onAccountChange, setMeta } from "./db.js";
import { kanaSegments } from "./kana-data.js";
import { unlockAchievement } from "./achievements.js";

/** Answer this many kana questions and a certain heavy door unlocks. */
export const KANA_REVIEW_GOAL = 3000;

/** Every question ever answered in the kana games, all sessions counted. */
export async function totalKanaReviews(): Promise<number> {
  const total = (await allGames()).reduce((sum, game) => sum + (game.questions ?? 0), 0);
  // Anyone who crossed the line before the door existed is owed the key:
  // any read of the total settles that debt, no new answer required.
  if (total >= KANA_REVIEW_GOAL) void unlockAchievement("kana-3000");
  return total;
}

/**
 * The permanent record of the kana game, kept per account.
 *
 * Two things are stored, both in the account's own database so they follow
 * the person and never mix between accounts:
 *
 *  - `kanaStats`: one entry per kana, accumulating every answer ever given —
 *    right, wrong, timed out, and on a wrong answer *what* was answered
 *    instead, so confusions (さ read as ka) are countable. This is the raw
 *    material for showing someone more of the kana they struggle with.
 *
 *  - `kanaGameLog`: one entry per level run — when, which level, which
 *    groups, how many questions, how it ended. A run that is abandoned
 *    mid-way keeps its counts with the outcome left as "playing".
 *
 * On top of the counts sits a mastery rank per kana, a 0–5 star scale held
 * internally as a float. Right answers raise it — by less and less as the
 * rank climbs, so the last star is earned over dozens of answers, not a
 * handful — wrong answers cut it hard, and it decays as real days pass: a
 * rank held loosely fades in days, a five-star kana takes a month of
 * neglect to slip. Decay is applied lazily — whole days since the last
 * application — whenever the stats are read or written, so nothing needs
 * to run in the background.
 *
 * Answers inside word levels count for every kana in the word, at half
 * weight: the word confirms each kana a little, but a miss does not say
 * which kana failed, so no confusion is recorded for them.
 */

export interface KanaStat {
  correct: number;
  wrong: number;
  /** Of the wrong answers, how many were the clock running out. */
  timeouts: number;
  /** Wrong answer → how often it was given for this kana. */
  confusedWith: Record<string, number>;
  /** 0–5, fractional; `masteryStars` rounds it down to whole stars. */
  mastery: number;
  firstAnswered: number;
  lastAnswered: number;
  /** Decay has been applied up to this moment. */
  lastDecay: number;
}

export interface GameRecord {
  id: string;
  startedAt: number;
  endedAt: number | null;
  level: number;
  groups: string[];
  /** Distinct kana in play, or words on the word levels. */
  poolSize: number;
  words: boolean;
  /** Answers given, repeats included — misses requeue, so this can exceed poolSize. */
  questions: number;
  correct: number;
  wrong: number;
  timeouts: number;
  outcome: "playing" | "cleared" | "failed" | "quit";
}

export interface AnswerOutcome {
  correct: boolean;
  /** What was answered instead, when wrong: a chosen or typed romaji. */
  mistake?: string;
  timeout?: boolean;
}

const STATS_KEY = "kanaStats";
const GAMES_KEY = "kanaGameLog";

/**
 * Mastery gained per correct answer, by current whole-star rank. The climb
 * steepens: the first star takes four right answers, the fifth twenty — with
 * daily decay pushing back, five stars means a kana that is truly known.
 */
const GAIN_BY_STAR = [0.25, 0.2, 0.14, 0.09, 0.05];
/** Mastery lost on a wrong answer, at any rank. */
const LOSS = 0.5;
/** Word answers speak for several kana at once, each only half as loudly. */
const WORD_WEIGHT = 0.5;

/**
 * Stars lost per idle day, by current whole-star rank. Low ranks are fresh
 * memories and fade fast; a five-star kana is hard-won and hard to lose.
 */
const DECAY_PER_DAY = [0.3, 0.2, 0.12, 0.08, 0.05, 0.03];

const DAY_MS = 86400000;

export function masteryStars(mastery: number): number {
  return Math.max(0, Math.min(5, Math.floor(mastery)));
}

// Caches follow the active account; a switch must not leak one person's
// record into another's database.
let statsCached: Record<string, KanaStat> | null = null;
let gamesCached: GameRecord[] | null = null;
onAccountChange(() => {
  statsCached = null;
  gamesCached = null;
});

// All writes go through one chain, so an answer and the game-record update
// it belongs to can never interleave with the next answer's.
let chain: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch(() => {
    /* a failed write must not wedge every write after it */
  });
  return chain;
}

async function allStats(): Promise<Record<string, KanaStat>> {
  statsCached ??= (await getMeta<Record<string, KanaStat>>(STATS_KEY)) ?? {};
  return statsCached;
}

async function allGames(): Promise<GameRecord[]> {
  gamesCached ??= (await getMeta<GameRecord[]>(GAMES_KEY)) ?? [];
  return gamesCached;
}

function blankStat(now: number): KanaStat {
  return {
    correct: 0,
    wrong: 0,
    timeouts: 0,
    confusedWith: {},
    mastery: 0,
    firstAnswered: now,
    lastAnswered: now,
    lastDecay: now,
  };
}

/**
 * Apply the decay owed since it was last applied, one whole day at a time so
 * the rate follows the rank down. Returns true when anything changed.
 */
function applyDecay(stat: KanaStat, now: number): boolean {
  let days = Math.floor((now - stat.lastDecay) / DAY_MS);
  if (days <= 0) return false;
  stat.lastDecay += days * DAY_MS;
  // A long absence drains any rank to zero well within this cap.
  days = Math.min(days, 400);
  while (days-- > 0 && stat.mastery > 0) {
    stat.mastery = Math.max(0, stat.mastery - DECAY_PER_DAY[masteryStars(stat.mastery)]);
  }
  return true;
}

/** Count one answer into a kana's permanent record. */
function applyAnswer(stat: KanaStat, outcome: AnswerOutcome, word: boolean, now: number): void {
  applyDecay(stat, now);
  stat.lastAnswered = now;
  const weight = word ? WORD_WEIGHT : 1;
  if (outcome.correct) {
    stat.correct++;
    const gain = GAIN_BY_STAR[Math.min(GAIN_BY_STAR.length - 1, masteryStars(stat.mastery))];
    stat.mastery = Math.min(5, stat.mastery + gain * weight);
  } else {
    stat.wrong++;
    if (outcome.timeout) stat.timeouts++;
    const mistake = outcome.mistake?.trim().toLowerCase();
    // A word miss does not say which kana was misread, so no confusion there.
    if (mistake && !word) stat.confusedWith[mistake] = (stat.confusedWith[mistake] ?? 0) + 1;
    stat.mastery = Math.max(0, stat.mastery - LOSS * weight);
  }
}

/**
 * Every kana's record, with decay brought up to date (and persisted when
 * that changed anything). The map is keyed by the kana itself.
 */
export async function kanaStats(): Promise<Record<string, KanaStat>> {
  const now = Date.now();
  let decayed = false;
  await enqueue(async () => {
    const stats = await allStats();
    for (const stat of Object.values(stats)) {
      if (applyDecay(stat, now)) decayed = true;
    }
    if (decayed) await setMeta(STATS_KEY, stats);
  });
  return allStats();
}

/** Every level run ever played, oldest first. */
export async function kanaGameLog(): Promise<GameRecord[]> {
  await chain; // let in-flight answers land first
  return allGames();
}

export interface GameSession {
  /** One answered question: a single kana, or a whole word on word levels. */
  answer(kana: string, outcome: AnswerOutcome): void;
  end(outcome: "cleared" | "failed" | "quit"): void;
}

/**
 * Open the permanent record for one level run. The record is written the
 * moment the run starts and updated on every answer, so nothing is lost if
 * the run never ends properly.
 */
export function startGameSession(info: {
  level: number;
  groups: string[];
  poolSize: number;
  words: boolean;
}): GameSession {
  const record: GameRecord = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    endedAt: null,
    level: info.level,
    groups: [...info.groups],
    poolSize: info.poolSize,
    words: info.words,
    questions: 0,
    correct: 0,
    wrong: 0,
    timeouts: 0,
    outcome: "playing",
  };

  void enqueue(async () => {
    const games = await allGames();
    games.push(record);
    await setMeta(GAMES_KEY, games);
  });

  let ended = false;
  return {
    answer(kana, outcome) {
      void enqueue(async () => {
        const now = Date.now();
        record.questions++;
        if (outcome.correct) record.correct++;
        else {
          record.wrong++;
          if (outcome.timeout) record.timeouts++;
        }
        // The three-thousandth answer, whenever it lands, opens the casino.
        const total = (await allGames()).reduce((sum, game) => sum + (game.questions ?? 0), 0);
        if (total >= KANA_REVIEW_GOAL) void unlockAchievement("kana-3000");
        // Words stay out of the mastery record entirely: a word miss says
        // nothing sure about any one kana in it, and the word levels are
        // meant to be pure chance, not steered. Only lone kana teach the
        // record anything.
        if (!info.words) {
          const stats = await allStats();
          applyAnswer((stats[kana] ??= blankStat(now)), outcome, false, now);
          await setMeta(STATS_KEY, stats);
        }
        await setMeta(GAMES_KEY, await allGames());
      });
    },
    end(outcome) {
      if (ended) return;
      ended = true;
      void enqueue(async () => {
        record.outcome = outcome;
        record.endedAt = Date.now();
        await setMeta(GAMES_KEY, await allGames());
      });
    },
  };
}
