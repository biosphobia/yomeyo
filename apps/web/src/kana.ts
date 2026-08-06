import { getMeta, setMeta } from "./db.js";
import { playKana, playWord, prefetchAudio, spokenKana } from "./audio.js";
import { cheerBox, preloadReactions, showReaction } from "./feedback.js";
import { recordQuestEvents } from "./quests.js";
import { unlockAll } from "./unlock.js";
import { PER_CORRECT, earnYennies, formatYennies, spendYennies, yennies } from "./yennies.js";
import { kanaStats, startGameSession, type GameSession, type KanaStat } from "./kana-stats.js";
import { renderKanaStats } from "./kana-stats-view.js";
import { screenHeader } from "./screen.js";
import { assetUrl, loadDictionary } from "./store.js";
import { KANA_GROUPS, isCorrect, kanaSegments, type KanaEntry, type KanaGroup } from "./kana-data.js";
import type { DictEntry } from "@yomeyo/core";
import {
  BASE_STAGES,
  buildRoad,
  generateTail,
  nodeById,
  renderRoadMap,
  tierOf,
  type Mechanic,
  type ModEffects,
  type RoadNode,
  type StoredTail,
} from "./kana-road.js";

/**
 * The kana game.
 *
 * First the learner picks which groups to practice — any mix of rows from
 * either syllabary. Then the game runs along the road in `kana-road.ts`:
 * seven stages single file (learn, choice, type, lives, timed, words,
 * words timed), and past those a randomly dealt stretch of forks — flash,
 * echo, sort race, simon, sharpshooter, alien names, arranged fresh each
 * game — where the player picks their tile on a fork screen. While
 * playing, the map rides above the quiz, walking itself along the route.
 *
 * A missed item goes back into the queue, so a level is only done when
 * everything has been answered correctly; the progress bar shows how far
 * that is. Completing a level unlocks the next stage and restores one
 * heart. Every answer is spoken, and right/wrong pop the reactions from
 * `public/feedback/`, which stay editable on GitHub.
 *
 * No two runs of a level are the same. Which kana it asks about is drawn
 * from the permanent record, weakest first; which words it asks are drawn
 * fresh from the dictionary every time.
 */

const GAME_KEY = "kanaGame";

interface GameState {
  groups: string[];
  /** The next stage to clear; stages below it are done. */
  unlocked: number;
  health: number;
  /** Start at level 1 — for someone who already knows the shapes. */
  skipLearn?: boolean;
  /** Which tile was taken at each cleared stage, for the map. */
  path?: Record<string, string>;
  /** This game's deal of the road past the fixed stages. */
  road?: StoredTail;
}

/**
 * A new deal of the random stretch, for a game starting (or starting over).
 * The route walked through the old tail is forgotten with the tail itself —
 * its tile ids point at a road that no longer exists.
 */
function freshTail(game: GameState): void {
  game.road = generateTail();
  game.path = Object.fromEntries(
    Object.entries(game.path ?? {}).filter(([stage]) => Number(stage) < BASE_STAGES),
  );
}

const MAX_HEALTH = 5;

/**
 * Where the road goes back to once it has been cleared.
 *
 * Stage 1, not 0: anybody who has just walked the whole road does not need
 * the tutorial that only shows each kana with its sound.
 */
const RESTART_AT = 1;

/**
 * How many questions a level asks, by mechanic.
 *
 * "Every kana at least twice" is honest for a row or two and punishing for a
 * whole syllabary: all of hiragana and katakana is 92 kana, so 184 questions,
 * four levels running. Nobody finishes that, and a drill nobody finishes
 * teaches nothing.
 *
 * So a level is capped, and the questions inside the cap go to the kana this
 * device knows least — the permanent record already knows which those are.
 * The heavier a mechanic's questions, the fewer of them: a sharpshooter
 * grid or a simon sequence is several answers wearing one number.
 */
const CAPS: Record<Mechanic, number> = {
  learn: 36,
  choice: 30,
  type: 28,
  lives: 24,
  timed: 20,
  words: 14,
  "words-timed": 12,
  flash: 20,
  echo: 24,
  sort: 24,
  simon: 7,
  sharpshooter: 9,
  alien: 10,
  onebehind: 16,
  dictation: 10,
  speed: 20,
  whichmissing: 10,
  fishing: 10,
  whack: 8,
  rain: 14,
  taiko: 18,
  ghost: 12,
  duel: 12,
  rest: 0,
};

/** Seconds per question, where a mechanic runs on a clock. */
const TIMERS: Partial<Record<Mechanic, number>> = {
  timed: 6,
  "words-timed": 10,
  sort: 4,
  sharpshooter: 10,
  fishing: 10,
  rain: 6,
  ghost: 9,
  duel: 6,
};

/** Speed ladder: where the clock starts, how it shrinks, where it stops. */
const SPEED_START = 5.5;
const SPEED_STEP = 0.3;
const SPEED_FLOOR = 2;
/** Kana rain: each catch quickens the fall, down to a floor. */
const RAIN_STEP = 0.15;
const RAIN_FLOOR = 3;

/**
 * Everything the road can bend about one run of one level, assembled from
 * the stage's tier and the tile's modifier. The mechanics read these
 * instead of their own constants, so a bend needs no code of its own.
 */
interface LevelRules {
  timerSec: number;
  /** For mechanics that keep their own rhythm (whack, taiko): <1 is faster. */
  pace: number;
  flashMs: number;
  seqExtra: number;
  alienExtra: number;
  buckets: number;
  crowded: boolean;
  fade: boolean;
  oneListen: boolean;
  decoys: number;
  payout: number;
  mirror: boolean;
  ghostShy: boolean;
  steep: boolean;
}

/** The tier's own sharpening, before any modifier has its say. */
function rulesFor(mechanic: Mechanic, tier: 1 | 2 | 3, fx: ModEffects): LevelRules {
  const tierScale = tier === 1 ? 1 : tier === 2 ? 0.85 : 0.7;
  let timerSec = mechanic === "speed" ? SPEED_START : TIMERS[mechanic] ?? 0;
  timerSec *= tierScale * (fx.timerScale ?? 1);
  if (timerSec === 0 && fx.addTimer) timerSec = fx.addTimer;
  return {
    timerSec,
    pace: tierScale * (fx.timerScale ?? 1),
    flashMs: fx.flashMs ?? (tier === 1 ? 700 : tier === 2 ? 550 : 420),
    seqExtra: (tier === 3 ? 1 : 0) + (fx.seqExtra ?? 0),
    alienExtra: (tier === 3 ? 1 : 0) + (fx.alienExtra ?? 0),
    buckets: fx.buckets ?? 3,
    crowded: (fx.crowded ?? false) || tier === 3,
    fade: fx.fade ?? false,
    oneListen: fx.oneListen ?? false,
    decoys: fx.decoys ?? 0,
    payout: fx.payout ?? 1,
    mirror: fx.mirror ?? false,
    ghostShy: fx.ghostShy ?? false,
    steep: fx.steep ?? false,
  };
}

/**
 * The correct-answer streak: consecutive right answers, across levels,
 * reset by any miss. The running count lives for the session; the best
 * ever is kept on the device.
 */
const BEST_STREAK_KEY = "kanaBestStreak";

/**
 * The word levels draw from the dictionary afresh every single time.
 *
 * Both word levels run their own search and their own draw, so the words on
 * level 6 are not the words from level 5 a minute earlier, and neither is
 * what you saw last night. `WORD_CANDIDATES` is how deep into the frequency
 * list a draw may reach — deep enough that fourteen words are a real choice
 * rather than a shuffle of the same three hundred — and the recent list is
 * long enough to hold several games' worth out of the way.
 */
const WORD_CANDIDATES = 1200;
const RECENT_WORDS_KEY = "kanaRecentWords";
const RECENT_WORDS = 240;
let streak = 0;
let bestStreak = 0;

/**
 * The running streak, for the quiz header.
 *
 * Just the number: the best-ever belongs on the Stats screen, and on a phone
 * "🔥 13 · best 13" was long enough to push the question count off the row.
 */
function streakHtml(): string {
  if (streak === 0) return "";
  return `<span class="kana-streak">🔥 ${streak}</span>`;
}

async function getGame(): Promise<GameState | null> {
  const stored = await getMeta<GameState>(GAME_KEY);
  return stored && Array.isArray(stored.groups) && stored.groups.length > 0 ? stored : null;
}

async function saveGame(game: GameState): Promise<void> {
  await setMeta(GAME_KEY, game);
}

// ---------------- romaji for whole words ----------------

/** Every kana (and digraph) to its accepted spellings, across both scripts. */
const ROMAJI_MAP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of KANA_GROUPS) {
    for (const entry of group.entries) map.set(entry.kana, entry.romaji);
  }
  return map;
})();

/** Does this typed romaji spell this kana string, in any accepted spelling? */
function romajiMatches(input: string, kana: string): boolean {
  const typed = input.trim().toLowerCase();
  const walk = (ki: number, ti: number): boolean => {
    if (ki === kana.length) return ti === typed.length;
    // Digraphs (きゃ) first, or the single kana would swallow their start.
    for (const length of [2, 1]) {
      const piece = kana.slice(ki, ki + length);
      const spellings = piece.length === length ? ROMAJI_MAP.get(piece) : undefined;
      if (!spellings) continue;
      for (const spelling of spellings) {
        if (typed.startsWith(spelling, ti) && walk(ki + length, ti + spelling.length)) return true;
      }
    }
    return false;
  };
  return walk(0, 0);
}

/**
 * The same sounds, written in katakana.
 *
 * Only for handing to a synthesiser: the learner still sees the kana they
 * chose. Hiragana and katakana sit one block apart in Unicode, so this is a
 * shift of every character in that block and a no-op for everything else.
 */
function katakana(text: string): string {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      return code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : ch;
    })
    .join("");
}

/** The primary spelling of a kana string, for showing corrections. */
function primaryRomaji(kana: string): string {
  let out = "";
  let at = 0;
  while (at < kana.length) {
    const digraph = ROMAJI_MAP.get(kana.slice(at, at + 2));
    if (digraph) {
      out += digraph[0];
      at += 2;
      continue;
    }
    const single = ROMAJI_MAP.get(kana[at]);
    out += single ? single[0] : kana[at];
    at += 1;
  }
  return out;
}

// ---------------- the screens ----------------

/** Play or the record of playing. Remembered while the app is open. */
let view: "play" | "stats" = "play";

export async function renderKana(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  // Warmed as the screen opens, not as a level starts: the reactions have to
  // be in hand the instant an answer lands, and picking your kana is exactly
  // the free half-second in which to fetch them.
  void preloadReactions();
  const game = await getGame();
  // A save from before the road was dealt gets its deal now, once.
  if (game && !game.road) {
    freshTail(game);
    await saveGame(game);
  }
  await unlockAll();
  if (!isCurrent()) return;

  main.innerHTML = `
    ${screenHeader("Kana", await yennies())}
    <div class="segmented">
      <button data-view="play" class="${view === "play" ? "on" : ""}">Play</button>
      <button data-view="stats" class="${view === "stats" ? "on" : ""}">Stats</button>
    </div>
    <div id="kana-body"></div>
  `;

  for (const button of main.querySelectorAll<HTMLButtonElement>(".segmented button")) {
    button.addEventListener("click", () => {
      view = button.dataset.view as typeof view;
      void renderKana(main, isCurrent);
    });
  }

  const body = main.querySelector<HTMLDivElement>("#kana-body")!;
  if (view === "stats") void renderKanaStats(body);
  else renderSelection(body, game, main, isCurrent);
}

function renderSelection(
  body: HTMLDivElement,
  game: GameState | null,
  main: HTMLElement,
  isCurrent: () => boolean,
): void {
  const chosen = new Set(game?.groups ?? []);

  const section = (script: "hiragana" | "katakana", label: string): string => {
    const groups = KANA_GROUPS.filter((group) => group.script === script);
    return `
      <div class="kana-script-head">
        <h2 class="kana-script">${label}</h2>
        <span class="kana-bulk" data-script="${script}" data-all="1">All</span> ·
        <span class="kana-bulk" data-script="${script}" data-all="0">None</span>
      </div>
      <div class="kana-select-grid">
        ${groups
          .map(
            (group) => `
            <label class="kana-group${chosen.has(group.id) ? " on" : ""}" data-group="${group.id}">
              <input type="checkbox" ${chosen.has(group.id) ? "checked" : ""} />
              <div>
                <div class="kana-group-title">${group.title}</div>
                <div class="kana-group-kana" lang="ja">${group.entries.map((entry) => entry.kana).join(" ")}</div>
              </div>
            </label>`,
          )
          .join("")}
      </div>`;
  };

  let skipLearn = game?.skipLearn ?? false;
  // The road this screen talks about: the saved game's own deal, or — for a
  // game about to be started fresh — the deal it will start with.
  const tail = game?.road ?? generateTail();
  const road = buildRoad(tail);

  body.innerHTML = `
    ${section("hiragana", "Hiragana ひらがな")}
    ${section("katakana", "Katakana カタカナ")}
    <label class="kana-skip-row">
      <input type="checkbox" id="kana-skip" ${skipLearn ? "checked" : ""} />
      Skip level 0 (tutorial)
    </label>
    <div class="kana-start-row">
      <button id="kana-start" disabled>Start</button>
      <span class="glosses" id="kana-start-note"></span>
    </div>
  `;
  // Deliberately no level list here: the road past the first fork is dealt
  // fresh per game, and reading it off a menu would spoil the walk.

  body.querySelector<HTMLInputElement>("#kana-skip")!.addEventListener("change", (ev) => {
    skipLearn = (ev.target as HTMLInputElement).checked;
    refresh();
  });

  const startButton = body.querySelector<HTMLButtonElement>("#kana-start")!;
  const note = body.querySelector<HTMLSpanElement>("#kana-start-note")!;
  const refresh = (): void => {
    const count = [...chosen].reduce(
      (sum, id) => sum + (KANA_GROUPS.find((group) => group.id === id)?.entries.length ?? 0),
      0,
    );
    startButton.disabled = chosen.size === 0;
    const resuming = game !== null && sameGroups(game.groups, chosen) && game.unlocked > 0;
    startButton.textContent = resuming ? "Continue" : "Start";
    // A game whose road is already finished starts over. Without this a
    // save written before the rollback existed — or any future way of getting
    // past the end — parks on the last level and never leaves it.
    const startAt = resuming && game
      ? game.unlocked >= road.length
        ? RESTART_AT
        : game.unlocked
      : skipLearn
        ? 1
        : 0;
    const ahead = road[startAt];
    note.textContent =
      chosen.size === 0
        ? "Pick at least one group."
        : `${count} kana · from level ${startAt}: ${
            ahead.length === 1 ? ahead[0].name : "the road forks — your choice"
          }`;
  };

  for (const label of body.querySelectorAll<HTMLLabelElement>(".kana-group")) {
    label.querySelector("input")!.addEventListener("change", (ev) => {
      const id = label.dataset.group!;
      if ((ev.target as HTMLInputElement).checked) chosen.add(id);
      else chosen.delete(id);
      label.classList.toggle("on", chosen.has(id));
      refresh();
    });
  }
  for (const bulk of body.querySelectorAll<HTMLSpanElement>(".kana-bulk")) {
    bulk.addEventListener("click", () => {
      const groups = KANA_GROUPS.filter((group) => group.script === bulk.dataset.script);
      for (const group of groups) {
        if (bulk.dataset.all === "1") chosen.add(group.id);
        else chosen.delete(group.id);
      }
      renderSelection(body, { groups: [...chosen], unlocked: game?.unlocked ?? 0, health: game?.health ?? MAX_HEALTH }, main, isCurrent);
    });
  }

  startButton.addEventListener("click", async () => {
    view = "play";
    // A different pool is a different game: the levels start over.
    const next: GameState =
      game && sameGroups(game.groups, chosen)
        ? { ...game, skipLearn }
        : { groups: [...chosen].sort(), unlocked: 0, health: MAX_HEALTH, skipLearn, road: tail };
    if (skipLearn) next.unlocked = Math.max(next.unlocked, 1);
    // Same guard as the note on the selection screen: a finished road
    // starts over rather than clamping onto its last stage — and starting
    // over rolls a fresh road to walk.
    if (next.unlocked >= buildRoad(next.road).length) {
      next.unlocked = RESTART_AT;
      freshTail(next);
    }
    await saveGame(next);
    void runLevel(body, next, next.unlocked, undefined, main, isCurrent);
  });

  refresh();
}

function sameGroups(stored: string[], chosen: Set<string>): boolean {
  return stored.length === chosen.size && stored.every((id) => chosen.has(id));
}

function poolOf(game: GameState): KanaEntry[] {
  return KANA_GROUPS.filter((group) => game.groups.includes(group.id)).flatMap(
    (group) => group.entries,
  );
}

function heartsHtml(health: number): string {
  return `<span class="kana-hearts">${"❤️".repeat(health)}${"🤍".repeat(MAX_HEALTH - health)}</span>`;
}

// ---------------- the level engine ----------------

/** One thing to answer: a kana, a word — or one round of a stranger game. */
interface Item {
  kana: string;
  gloss?: string;
  /** For single kana, the entry with its accepted spellings. */
  entry?: KanaEntry;
  /** For words: how the word is actually written, for finding a recording. */
  term?: string;
  /** For words: this spelling is several different words, so nobody's
   *  recording of it is reliably the one on screen. */
  ambiguous?: boolean;
  /** Not a word at all — an alien name. Said as a name, not read as text. */
  invented?: boolean;
  /** Simon: the spoken sequence, in order. `kana` is the sequence joined. */
  seq?: string[];
  /** Simon and sharpshooter: the tiles on the board, in display order. */
  grid?: string[];
  /** Sharpshooter: which grid tiles are the target sound. */
  hits?: number[];
  /** Sort race: the bucket labels, in their fixed on-screen order. */
  buckets?: string[];
  /** One behind: the kana ON SCREEN — the answer (`kana`) is the previous one. */
  show?: string;
  /** One behind: the opening question, where shown and asked are the same. */
  lead?: boolean;
  /** Taiko: the kana the VOICE says, which may not be the one shown. */
  say?: string;
  /** Taiko: do the shown kana and the spoken one match? */
  match?: boolean;
}

/**
 * How this item is asked for, in sound.
 *
 * A single kana is synthesised — nobody records one letter for its own sake.
 * A word is a real speaker's recording where one can be found for it, which
 * needs the word as it is actually WRITTEN: asking a recording service for
 * いこう and nothing else invites a recording of any of the words spelt that
 * way, which is how a drill on いこう came back saying something else.
 * Where the spelling is several different words, no recording of it is
 * reliably the right one, so those are read out instead.
 *
 * Everything that ends up synthesised is asked for in katakana. A synthesiser
 * reads Japanese by working out which words it is looking at, and あいあう is
 * not one word to it — it is あい and あう, said as two, with the join you can
 * hear. Handed the same sounds in katakana it has nothing to parse and simply
 * says them, which is what katakana is for in Japanese too: names and things
 * from nowhere. An alien's name is exactly that, and a spelling that could be
 * any of three words has no reading worth parsing for either — they all sound
 * the same, which is why it is being synthesised rather than looked up.
 */
function audioFor(item: Item): { term: string; reading: string; mode?: "tts" } {
  // A lone kana is asked for by the spelling that makes an engine say it —
  // handed は on its own, one says "wa". `playKana` does the same, so the
  // clip warmed here is the clip played.
  if (item.entry) {
    const text = spokenKana(item.kana);
    return { term: text, reading: text, mode: "tts" };
  }
  if (item.ambiguous || item.invented) {
    const text = katakana(item.kana);
    return { term: text, reading: text, mode: "tts" };
  }
  return { term: item.term ?? item.kana, reading: item.kana };
}

function playItem(item: Item): Promise<unknown> {
  const { term, reading, mode } = audioFor(item);
  if (item.entry) return playKana(item.kana);
  return playWord(term, reading, mode ? { mode } : {});
}

function itemMatches(item: Item, answer: string): boolean {
  return item.entry ? isCorrect(item.entry, answer) : romajiMatches(answer, item.kana);
}

function itemAnswer(item: Item): string {
  return item.entry ? item.entry.romaji[0] : primaryRomaji(item.kana);
}

async function runLevel(
  body: HTMLDivElement,
  game: GameState,
  level: number,
  nodeId: string | undefined,
  main: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  const pool = poolOf(game);
  const road = buildRoad(game.road);
  void preloadReactions();

  // The map rides above whatever the level shows, walks itself to the tile
  // in play, and never takes a touch. Everything below draws into the quiz
  // host so the strip survives from question to question.
  body.innerHTML = `<div id="kana-map-strip"></div><div id="kana-quiz-host"></div>`;
  const mapHost = body.querySelector<HTMLDivElement>("#kana-map-strip")!;
  const quiz = body.querySelector<HTMLDivElement>("#kana-quiz-host")!;
  const drawMap = (current?: RoadNode): void =>
    renderRoadMap(mapHost, road, {
      unlocked: game.unlocked,
      path: game.path ?? {},
      ...(current ? { current: { stage: level, id: current.id } } : {}),
    });

  // A fork reached without a choice made: the choosing IS the screen.
  if (road[level].length > 1 && nodeId === undefined) {
    drawMap();
    quiz.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">🛤️</div>
        <div class="kana-score">The road forks</div>
        <div class="glosses">Level ${level} — pick your tile:</div>
        <div class="kmap-fork">
          ${road[level]
            .map(
              (option) => `
            <button class="kmap-node open" data-id="${option.id}">
              <span class="kmap-icon">${option.icon}</span>
              <span class="kmap-name">${option.name}</span>
              <span class="kmap-detail">${escapeHtml(option.detail)}</span>
              ${
                option.modifier
                  ? `<span class="kmap-modline tier-${option.modifier.tier}">${option.modifier.icon} ${escapeHtml(option.modifier.name)}</span>
                     <span class="kmap-detail">${escapeHtml(option.modifier.detail)}</span>`
                  : ""
              }
            </button>`,
            )
            .join("")}
        </div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="kana-back" class="secondary">Change groups</button>
        </div>
      </div>`;
    for (const option of quiz.querySelectorAll<HTMLButtonElement>(".kmap-fork .kmap-node")) {
      option.addEventListener("click", () => {
        void runLevel(body, game, level, option.dataset.id, main, isCurrent);
      });
    }
    quiz.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
    return;
  }

  const node = nodeById(road, level, nodeId);
  const mechanic = node.mechanic;
  drawMap(node);

  // The hot spring asks nothing: hearts back, stage cleared, walk on.
  if (mechanic === "rest") {
    game.path = { ...game.path, [String(level)]: node.id };
    game.unlocked = Math.max(game.unlocked, level + 1);
    game.health = MAX_HEALTH;
    await saveGame(game);
    if (!isCurrent()) return;
    drawMap();
    const onward = level + 1 < road.length ? road[level + 1] : null;
    quiz.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">♨️</div>
        <div class="kana-score">Hot spring</div>
        <div class="glosses">Every heart back: ${heartsHtml(game.health)}<br/>Nothing asked. Nothing paid.</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          ${onward ? `<button id="kana-next">Back on the road</button>` : ""}
          <button id="kana-back" class="secondary">Stop here</button>
        </div>
      </div>`;
    quiz.querySelector("#kana-next")?.addEventListener("click", () => {
      void runLevel(body, game, level + 1, undefined, main, isCurrent);
    });
    quiz.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
    return;
  }

  // The duel gets its stage: Chito above the quiz, on a fuse.
  let duel: import("./kana-duel.js").DuelStage | null = null;
  let duelYou = 0;
  let duelChito = 0;
  if (mechanic === "duel") {
    const duelHost = document.createElement("div");
    duelHost.id = "kana-duel";
    quiz.before(duelHost);
    void import("./kana-duel.js").then(async (mod) => {
      const mounted = await mod.mountDuel(duelHost);
      if (!duelHost.isConnected) mounted.stop();
      else duel = mounted;
    });
  }

  const rules = rulesFor(mechanic, tierOf(level), node.modifier?.effects ?? {});
  // The clock is mutable because the speed ladder tightens it as it goes.
  let clockSec = rules.timerSec;
  const useLives = level >= 3 && mechanic !== "learn";
  const useChoices = mechanic === "choice";
  const learning = mechanic === "learn";
  const isWords = mechanic === "words" || mechanic === "words-timed";

  // A toll tile takes its toll on entry — what the purse holds, up to the
  // asking price. The wager is the modifier's raised payout on the way out.
  const toll = node.modifier?.effects.toll ?? 0;
  if (toll > 0) {
    const have = await yennies();
    await spendYennies(Math.min(toll, have));
  }

  let items: Item[];
  if (isWords) {
    // The dictionary may still have to come down the wire, which on mobile
    // data is long enough that a bare line of text reads as a hung screen.
    // So: say what is happening, and always leave a way out.
    quiz.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="glosses" id="kana-loading">Finding words made only of your kana…</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="kana-back" class="secondary">Change groups</button>
        </div>
      </div>`;
    let left = false;
    body.querySelector("#kana-back")!.addEventListener("click", () => {
      left = true; // the search finishes regardless; its result is now moot
      renderSelection(body, game, main, isCurrent);
    });
    const slow = setTimeout(() => {
      const line = body.querySelector("#kana-loading");
      if (line) line.textContent = "Downloading the dictionary… this happens once.";
    }, 4000);
    const words = await wordsFor(game, pool, CAPS[mechanic]);
    clearTimeout(slow);
    if (left || !isCurrent() || !body.isConnected) return;
    if (words === null || words.length < 5) {
      // The other way this used to strand somebody: a pool too small for the
      // word levels left the game unlocked at 5 or 6, so Continue landed on
      // this card every single time with nothing here to leave by except
      // changing the pool. There is a way back down the ladder now.
      quiz.innerHTML = `
        <div class="card-panel kana-quiz">
          <div class="big">🔍</div>
          <div>Not enough short words can be written with only these kana.</div>
          <div class="glosses" style="margin-top:8px">Add more groups, or go back and play the kana levels again.</div>
          <div class="row-actions" style="justify-content:center;margin-top:12px">
            <button id="kana-restart">Start from level ${RESTART_AT}</button>
            <button id="kana-back" class="secondary">Change groups</button>
          </div>
        </div>`;
      body.querySelector("#kana-restart")!.addEventListener("click", async () => {
        game.unlocked = RESTART_AT;
        game.health = MAX_HEALTH;
        await saveGame(game);
        void runLevel(body, game, RESTART_AT, undefined, main, isCurrent);
      });
      body.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
      return;
    }
    items = words;
  } else if (mechanic === "dictation") {
    // A word game at heart: real words where the pool can spell enough of
    // them, made-up ones where it cannot — the listening is the same drill.
    const words = await wordsFor(game, pool, CAPS[mechanic]).catch(() => null);
    if (!isCurrent() || !body.isConnected) return;
    items = await dictationItems(words, pool, rules);
  } else {
    items = await kanaItems(pool, mechanic, rules);
  }

  const queue = learning ? [...items] : shuffle([...items]);
  let done = 0;
  let health = game.health;
  // The door charges what the tile's bend says it charges.
  if (node.modifier?.effects.suddenDeath) health = 1;
  else if (node.modifier?.effects.hearts) health = Math.max(1, health + node.modifier.effects.hearts);
  let missedAny = false;
  let gotRight = 0;
  let active = true; // cleared on quit, so a pending auto-advance dies quietly

  // Every sound this level will need, fetched now rather than at the moment
  // it is wanted: an answer lands and the clip has to play immediately, and
  // a download started right then always arrives after the moment it was for.
  const warming = { aborted: false };
  const entryFor = new Map(pool.map((entry) => [entry.kana, entry]));
  // Simon and the silent one speak kana by kana; dictation speaks its word
  // whole. Each is warmed the way it will be played.
  const speaksSequence = mechanic === "simon" || mechanic === "whichmissing";
  void prefetchAudio(
    items.flatMap((item) => {
      if (speaksSequence && item.seq) return item.seq.map((kana) => audioFor({ kana, entry: entryFor.get(kana) }));
      // Taiko speaks one kana and shows another; both get said eventually.
      if (item.say) return [audioFor({ kana: item.say, entry: entryFor.get(item.say) }), audioFor(item)];
      return [audioFor(item)];
    }),
    warming,
  );
  let timer: ReturnType<typeof setInterval> | null = null;
  bestStreak = (await getMeta<number>(BEST_STREAK_KEY)) ?? bestStreak;

  // The learn level asks nothing, so it records nothing; every other run
  // goes into the permanent per-kana record from its first answer.
  const session: GameSession | null = learning
    ? null
    : startGameSession({
        level,
        groups: game.groups,
        poolSize: isWords ? items.length : new Set(items.map((item) => item.kana)).size,
        words: isWords,
      });

  // Whack's mole spawner and taiko's beat live beside the countdown clock,
  // never in its slot — a bend can give any level a clock, and the two must
  // not fight over one variable.
  let side: ReturnType<typeof setInterval> | null = null;
  const stopTimer = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (side !== null) clearInterval(side);
    side = null;
  };

  /**
   * Bank what the run earned and describe it, for the screen that ends it.
   *
   * Nothing about yennies appears while playing — a counter climbing beside
   * the questions is a reason to keep tapping, which is not the reason to be
   * here. Once, at the end, with the balance beside it.
   */
  const payout = async (): Promise<string> => {
    // A bent tile pays over the odds — that is what made it worth stepping on.
    const earned = Math.round(gotRight * PER_CORRECT * rules.payout);
    const balance = earned > 0 ? await earnYennies(earned) : await yennies();
    return `<div class="yen-line">${
      earned > 0 ? `<b>+${earned.toLocaleString()}</b>${rules.payout > 1 ? ` <span class="glosses">(×${rules.payout})</span>` : ""} · ` : ""
    }${formatYennies(balance)}</div>`;
  };

  const fail = async (): Promise<void> => {
    stopTimer();
    session?.end("failed");
    game.health = MAX_HEALTH; // a fresh attempt starts with fresh hearts
    await saveGame(game);
    if (!isCurrent()) return;
    const purse = await payout();
    if (!isCurrent()) return;
    quiz.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">💔</div>
        <div class="kana-score">Out of hearts</div>
        ${purse}
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="kana-retry">Try again</button>
          <button id="kana-back" class="secondary">Change groups</button>
        </div>
      </div>`;
    body.querySelector("#kana-retry")!.addEventListener("click", () => void runLevel(body, game, level, node.id, main, isCurrent));
    body.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
  };

  const finish = async (): Promise<void> => {
    stopTimer();
    session?.end("cleared");
    // The map remembers which tile this stage was cleared by.
    game.path = { ...game.path, [String(level)]: node.id };
    game.unlocked = Math.max(game.unlocked, level + 1);
    // Clearing the last level rolls the road back here, not in the button
    // on the trophy screen. Leaving that screen any other way — Change
    // groups, another tab, closing the app — used to save an unlocked value
    // past the end, which the selection screen clamped to the top level, so
    // Continue replayed the last level for ever.
    // Walking off the end also rolls a fresh road for the next lap.
    if (game.unlocked >= road.length) {
      game.unlocked = RESTART_AT;
      freshTail(game);
    }
    if (useLives) game.health = Math.min(MAX_HEALTH, health + 1);
    // Levels count towards the day's quests; the learn level is a stroll,
    // not a clear. The groups in play are reported too, so a quest can ask
    // for particular kana to have been practised.
    if (!learning) {
      // Awaited, not fired and forgotten: a quest finishing here can cross a
      // level, and the burst that pays has to be in the balance shown below.
      await recordQuestEvents([
        "kana-level",
        ...(missedAny ? [] : ["kana-level-perfect"]),
        ...game.groups.map((id) => `group-cleared:${id}`),
      ]).catch(() => undefined);
    }
    await saveGame(game);
    const purse = await payout();
    if (!isCurrent()) return;
    // The strip walks on to what was just unlocked.
    drawMap();
    const next = level + 1 < road.length ? road[level + 1] : null;

    if (!next) {
      // The end of the road.
      quiz.innerHTML = `
        <div class="card-panel kana-quiz">
          <div class="big">🏆</div>
          <div class="kana-score">The whole road clear</div>
          ${purse}
          <div class="row-actions" style="justify-content:center;margin-top:12px">
            <button id="kana-again">Play again</button>
            <button id="kana-back" class="secondary">Change groups</button>
          </div>
        </div>`;
      body.querySelector("#kana-again")!.addEventListener("click", async () => {
        game.health = MAX_HEALTH;
        await saveGame(game);
        void runLevel(body, game, RESTART_AT, undefined, main, isCurrent);
      });
      body.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
      return;
    }

    if (next.length > 1) {
      // A fork: the road ahead is the player's to pick, so nothing
      // auto-continues. The tiles here are the same tiles the map shows.
      quiz.innerHTML = `
        <div class="card-panel kana-quiz">
          <div class="big">🎉</div>
          <div class="kana-score">Level ${level} clear</div>
          <div class="glosses">${useLives ? `One heart restored: ${heartsHtml(game.health)}<br/>` : ""}
            The road forks. Level ${level + 1} — pick your tile:</div>
          ${purse}
          <div class="kmap-fork">
            ${next
              .map(
                (option) => `
              <button class="kmap-node open" data-id="${option.id}">
                <span class="kmap-icon">${option.icon}</span>
                <span class="kmap-name">${option.name}</span>
                <span class="kmap-detail">${escapeHtml(option.detail)}</span>
              </button>`,
              )
              .join("")}
          </div>
          <div class="row-actions" style="justify-content:center;margin-top:12px">
            <button id="kana-back" class="secondary">Stop here</button>
          </div>
        </div>`;
      for (const option of body.querySelectorAll<HTMLButtonElement>(".kmap-fork .kmap-node")) {
        option.addEventListener("click", () => {
          void runLevel(body, game, level + 1, option.dataset.id, main, isCurrent);
        });
      }
      body.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
      return;
    }

    // A straight stretch: the climb continues by itself; the button is for
    // the impatient.
    quiz.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">🎉</div>
        <div class="kana-score">Level ${level} clear</div>
        <div class="glosses">${useLives ? `One heart restored: ${heartsHtml(game.health)}<br/>` : ""}
          Starting level ${level + 1}: ${next[0].name}…</div>
        ${purse}
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="kana-next">Continue now</button>
          <button id="kana-back" class="secondary">Stop here</button>
        </div>
      </div>`;
    let advanced = false;
    const goNext = (): void => {
      if (advanced) return;
      advanced = true;
      void runLevel(body, game, level + 1, next[0].id, main, isCurrent);
    };
    const autoNext = setTimeout(goNext, 2200);
    body.querySelector("#kana-next")!.addEventListener("click", () => {
      clearTimeout(autoNext);
      goNext();
    });
    body.querySelector("#kana-back")!.addEventListener("click", () => {
      advanced = true; // stops the pending auto-continue
      clearTimeout(autoNext);
      renderSelection(body, game, main, isCurrent);
    });
  };

  const draw = (): void => {
    stopTimer();
    const item = queue[0];
    const total = done + queue.length;
    const percent = Math.round((done / total) * 100);

    // What sits where the big kana normally goes. The sound-first games
    // hide the glyph and put a speaker (and progress dots) in its place;
    // sharpshooter and fishing show the SOUND large; one behind shows the
    // NEXT kana while asking for the last.
    const hearButton = rules.oneListen
      ? `<div class="kana-hear kana-hear-once" title="One listen only">👂</div>`
      : `<button class="kana-hear" id="kana-hear" title="Play it again" aria-label="Play it again">🔊</button>`;
    const seqDots = item.seq
      ? `<div class="kana-simon-dots" id="kana-dots">${item.seq.map(() => `<span class="kana-dot"></span>`).join("")}</div>`
      : "";
    const mirrorCls = rules.mirror ? " kana-mirrored" : "";
    const bigArea = ((): string => {
      switch (mechanic) {
        case "echo":
          return hearButton;
        case "simon":
          return `${hearButton}${seqDots}`;
        case "dictation":
          return `${hearButton}${seqDots}
            ${item.gloss ? `<div class="kana-gloss">${escapeHtml(item.gloss)}</div>` : ""}
            <div class="kana-gloss">build what you heard, tile by tile</div>`;
        case "whichmissing":
          return `${hearButton}<div class="kana-gloss">three sounds played — tap the tile that was NOT one of them</div>`;
        case "fishing":
          return `<div class="kana-big">${escapeHtml(itemAnswer(item))}</div>
            <div class="kana-gloss">hook the fish that says it</div>`;
        case "sharpshooter":
          return `<div class="kana-big">${escapeHtml(itemAnswer(item))}</div>
            <div class="kana-gloss">tap every tile that says it — ${item.hits!.length} of them</div>`;
        case "whack":
          return `<div class="kana-big">${escapeHtml(itemAnswer(item))}</div>
            <div class="kana-gloss">whack every mole wearing it — three hits</div>`;
        case "taiko":
          return `<div class="kana-big${mirrorCls}" id="kana-big" lang="ja">${escapeHtml(item.kana)}</div>
            <div class="kana-gloss">hit the drum ONLY if this is what you hear</div>`;
        case "rain":
          return `<div class="kana-sky"><div class="kana-big kana-raindrop${mirrorCls}" id="kana-big" lang="ja"
              style="animation-duration:${clockSec}s">${escapeHtml(item.kana)}</div></div>
            <div class="kana-gloss">type it before it lands</div>`;
        case "ghost":
          return `<div class="kana-big kana-ghostly${rules.ghostShy ? " shy" : ""}${mirrorCls}" id="kana-big" lang="ja">${escapeHtml(item.kana)}</div>
            <div class="kana-gloss">name it the moment you see it</div>`;
        case "onebehind":
          return `<div class="kana-big${rules.fade ? " kana-fading" : ""}${mirrorCls}" id="kana-big" lang="ja">${escapeHtml(item.show ?? item.kana)}</div>
            <div class="kana-gloss">${item.lead ? "type THIS one — and remember it" : "type the one you saw BEFORE this"}</div>`;
        default:
          return `<div class="kana-big${mechanic === "flash" ? " kana-flashable" : ""}${rules.fade ? " kana-fading" : ""}${mirrorCls}" id="kana-big" lang="ja">${escapeHtml(item.kana)}</div>
            ${item.gloss ? `<div class="kana-gloss">${escapeHtml(item.gloss)}</div>` : ""}`;
      }
    })();

    const tileGrid = (tiles: string[]): string =>
      `<div class="kana-choices kana-grid" id="kana-grid">${tiles
        .map((kana, i) => `<button data-i="${i}" lang="ja">${escapeHtml(kana)}</button>`)
        .join("")}</div>`;

    const glyphChoices = (tiles: string[]): string =>
      `<div class="kana-choices kana-glyph-choices" id="kana-choices">${tiles
        .map((kana) => `<button data-choice="${escapeHtml(kana)}" lang="ja">${escapeHtml(kana)}</button>`)
        .join("")}</div>`;

    const answerArea = learning
      ? `<div class="kana-learn-romaji">${escapeHtml(itemAnswer(item))}</div>
         <div class="row-actions" style="justify-content:center">
           <button id="kana-next-card">Next (Enter)</button>
         </div>`
      : mechanic === "choice"
        ? `<div class="kana-choices" id="kana-choices">${choicesFor(item, pool)
            .map((choice) => `<button data-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`)
            .join("")}</div>`
        : mechanic === "echo"
          ? glyphChoices(echoChoicesFor(item, pool))
          : mechanic === "whichmissing"
            ? glyphChoices(item.grid!)
            : mechanic === "fishing"
              ? `<div class="kana-pond" id="kana-pond">${item
                  .grid!.map((kana, i) => {
                    const duration = (8 + Math.random() * 7).toFixed(1);
                    const delay = (-Math.random() * 12).toFixed(1);
                    const top = 4 + Math.random() * 78;
                    const reversed = Math.random() < 0.5;
                    return `<button class="kana-fish${reversed ? " rev" : ""}" data-i="${i}"
                      style="top:${top}%;animation-duration:${duration}s;animation-delay:${delay}s">
                      <span class="kana-fish-body">${reversed ? "🐟" : "🐠"}</span>
                      <span lang="ja">${escapeHtml(kana)}</span>
                    </button>`;
                  })
                  .join("")}</div>`
            : mechanic === "sort"
              ? `<div class="kana-buckets" id="kana-buckets">${item
                  .buckets!.map((label) => `<button data-choice="${escapeHtml(label)}">🗂️<span>${escapeHtml(label)}</span></button>`)
                  .join("")}</div>`
              : mechanic === "taiko"
                ? `<button class="kana-drum" id="kana-drum">🥁</button>
                   <div class="glosses" style="text-align:center">match → drum · no match → let it pass</div>`
                : mechanic === "whack"
                  ? `<div class="kana-holes" id="kana-holes">${Array.from(
                      { length: 9 },
                      (_, i) => `<div class="kana-hole" data-h="${i}"></div>`,
                    ).join("")}</div>
                    <div class="kana-whack-count" id="kana-whack-count"></div>`
                  : mechanic === "simon" || mechanic === "sharpshooter" || mechanic === "dictation"
                    ? tileGrid(item.grid!)
                    : `<input type="text" id="kana-answer" autocomplete="off" autocapitalize="none"
                        autocorrect="off" spellcheck="false" placeholder="type the romaji…" />`;

    quiz.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="kana-quiz-top">
          <button id="kana-quit" class="quiz-stop" title="Stop" aria-label="Stop">✕</button>
          <span class="glosses quiz-level">Level ${level}: ${node.name}</span>
          <span class="kana-count">${done + 1}/${total}</span>
          <span class="quiz-right">
            ${streakHtml()}${useLives ? heartsHtml(health) : ""}
          </span>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${percent}%"></div></div>
        ${
          node.modifier
            ? `<div class="kana-mod tier-${node.modifier.tier}">${node.modifier.icon} <b>${escapeHtml(node.modifier.name)}</b> — ${escapeHtml(node.modifier.detail)}</div>`
            : ""
        }
        ${clockSec > 0 ? `<div class="kana-timer"><div class="kana-timer-fill" id="kana-timer-fill"></div></div>` : ""}
        ${bigArea}
        ${answerArea}
        <div class="kana-feedback" id="kana-feedback"></div>
      </div>
      ${cheerBox("kana-cheer")}
    `;

    body.querySelector<HTMLButtonElement>("#kana-quit")!.addEventListener("click", () => {
      active = false;
      warming.aborted = true;
      stopTimer();
      session?.end("quit");
      renderSelection(body, game, main, isCurrent);
    });

    const feedback = body.querySelector<HTMLDivElement>("#kana-feedback")!;
    let settled = false;

    // A single kana is synthesised, a real word is a real speaker where one
    // has recorded it. Never let a silent device stop the quiz. A simon
    // sequence is spoken one kana at a time, with air between them.
    const say = (): void => {
      // Taiko replays what the VOICE said, not what the eyes saw.
      if (mechanic === "taiko" && item.say) {
        void playKana(item.say).catch(() => undefined);
        return;
      }
      if (item.seq && speaksSequence) {
        let at = 0;
        const step = (): void => {
          if (!body.isConnected) return;
          void playKana(item.seq![at]).catch(() => undefined);
          at++;
          if (at < item.seq!.length) setTimeout(step, 650);
        };
        step();
        return;
      }
      void playItem(item).catch(() => undefined);
    };

    const advance = (): void => {
      if (!active || !body.isConnected) return; // the screen was left mid-question
      queue.shift();
      done++;
      if (queue.length === 0) void finish();
      else draw();
    };

    const succeed = (): void => {
      settled = true;
      stopTimer();
      session?.answer(item.kana, { correct: true });
      gotRight++;
      streak++;
      if (streak > bestStreak) {
        bestStreak = streak;
        void setMeta(BEST_STREAK_KEY, bestStreak);
      }
      // Crossing 20 in a row is a quest-worthy moment, counted once per run.
      void recordQuestEvents(["kana-correct", ...(streak === 20 ? ["kana-streak-20"] : [])]);
      feedback.innerHTML = `<span class="ok-text">✓ ${escapeHtml(itemAnswer(item))}</span>
        <span class="kana-streak">🔥 ${streak}</span>`;
      void showReaction(body.querySelector("#kana-cheer"), "correct");
      say();
      // The speed ladder tightens its clock with every rung climbed, and
      // the rain falls a little faster with every catch.
      if (mechanic === "speed") clockSec = Math.max(SPEED_FLOOR, clockSec - SPEED_STEP * (rules.steep ? 2 : 1));
      if (mechanic === "rain") clockSec = Math.max(RAIN_FLOOR, clockSec - RAIN_STEP);
      if (mechanic === "duel") {
        duelYou++;
        duel?.you();
        duel?.score(duelYou, duelChito);
      }
      setTimeout(advance, 1100);
    };

    const miss = (label: string, mistake?: string, timeout = false): void => {
      settled = true;
      stopTimer();
      session?.answer(item.kana, { correct: false, mistake, timeout });
      streak = 0;
      missedAny = true;
      if (mechanic === "duel") {
        duelChito++;
        duel?.rival();
        duel?.score(duelYou, duelChito);
      }
      // Back into the deck: the level ends only when everything is right.
      queue.push(queue[0]);
      if (useLives) {
        health--;
        if (health <= 0) {
          feedback.innerHTML = `<span class="err-text">${label}</span>`;
          void showReaction(body.querySelector("#kana-cheer"), "wrong");
          say();
          setTimeout(() => void fail(), 900);
          return;
        }
      }
      feedback.innerHTML = `<span class="err-text">${label}</span>
        <div class="glosses">Enter (or tap) to continue${useLives ? ` · ${"❤️".repeat(health)}` : ""}</div>`;
      void showReaction(body.querySelector("#kana-cheer"), "wrong");
      say();
      const panel = body.querySelector<HTMLDivElement>(".kana-quiz")!;
      panel.tabIndex = -1;
      panel.focus();
      setTimeout(() => {
        panel.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") advance();
        });
        panel.addEventListener("click", (ev) => {
          if (!(ev.target as HTMLElement).closest("#kana-quit")) advance();
        });
      }, 0);
    };

    if (learning) {
      say();
      const nextButton = body.querySelector<HTMLButtonElement>("#kana-next-card")!;
      nextButton.focus();
      nextButton.addEventListener("click", advance);
      return;
    }

    // The sound-first levels speak up before anything is answered; the
    // speaker button plays it again as often as wanted.
    body.querySelector("#kana-hear")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      say();
    });
    if (["echo", "simon", "dictation", "whichmissing", "fishing", "taiko"].includes(mechanic)) setTimeout(say, 250);

    if (useChoices || mechanic === "echo" || mechanic === "whichmissing") {
      // The same buttons shape, pointed several ways: choice shows kana and
      // offers romaji; echo plays a sound and offers glyphs; the silent one
      // wants the glyph that was never played.
      const glyphAnswer = mechanic === "echo" || mechanic === "whichmissing" ? item.kana : null;
      for (const button of body.querySelectorAll<HTMLButtonElement>("#kana-choices button")) {
        button.addEventListener("click", () => {
          if (settled) return;
          const choice = button.dataset.choice!;
          const good = glyphAnswer !== null ? choice === glyphAnswer : itemMatches(item, choice);
          if (good) {
            button.classList.add("right");
            succeed();
          } else {
            button.classList.add("wrong");
            body
              .querySelector<HTMLButtonElement>(`#kana-choices button[data-choice="${cssEscape(glyphAnswer ?? itemAnswer(item))}"]`)
              ?.classList.add("right");
            const label =
              mechanic === "whichmissing"
                ? `✗ <b lang="ja">${escapeHtml(choice)}</b> was spoken — the quiet one was <b lang="ja">${escapeHtml(item.kana)}</b>`
                : `✗ ${escapeHtml(item.kana)} = <b>${escapeHtml(itemAnswer(item))}</b>`;
            miss(label, choice);
          }
        });
      }
    } else if (mechanic === "sort") {
      // The kana is a card; the buckets are where it goes. Dragging is the
      // game, tapping a bucket still counts — one hand, keyboard, whatever.
      const buckets = [...body.querySelectorAll<HTMLButtonElement>("#kana-buckets button")];
      const answerBucket = (button: HTMLButtonElement): void => {
        if (settled) return;
        const choice = button.dataset.choice!;
        if (itemMatches(item, choice)) {
          button.classList.add("right");
          succeed();
        } else {
          button.classList.add("wrong");
          body
            .querySelector<HTMLButtonElement>(`#kana-buckets button[data-choice="${cssEscape(itemAnswer(item))}"]`)
            ?.classList.add("right");
          miss(`✗ ${escapeHtml(item.kana)} goes in <b>${escapeHtml(itemAnswer(item))}</b>`, choice);
        }
      };
      for (const button of buckets) {
        button.addEventListener("click", () => answerBucket(button));
      }

      const big = body.querySelector<HTMLElement>("#kana-big");
      if (big) {
        big.classList.add("kana-draggable");
        const bucketAt = (x: number, y: number): HTMLButtonElement | undefined =>
          buckets.find((bucket) => {
            const box = bucket.getBoundingClientRect();
            return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
          });
        let float: HTMLElement | null = null;
        let dx = 0;
        let dy = 0;
        const settle = (): void => {
          float?.remove();
          float = null;
          big.classList.remove("is-dragging");
          for (const bucket of buckets) bucket.classList.remove("is-target");
        };
        big.addEventListener("pointerdown", (ev) => {
          if (settled || float) return;
          ev.preventDefault();
          const box = big.getBoundingClientRect();
          float = big.cloneNode(true) as HTMLElement;
          float.className = "kana-big kana-drag-float";
          float.style.width = `${box.width}px`;
          float.style.left = `${box.left}px`;
          float.style.top = `${box.top}px`;
          document.body.appendChild(float);
          big.classList.add("is-dragging");
          dx = ev.clientX - box.left;
          dy = ev.clientY - box.top;
          big.setPointerCapture?.(ev.pointerId);
          // The question can end under the drag (the clock, a tap); whatever
          // happens, the floating card must not outlive the pointer.
          window.addEventListener("pointerup", settle, { once: true });
        });
        big.addEventListener("pointermove", (ev) => {
          if (!float) return;
          ev.preventDefault();
          float.style.left = `${ev.clientX - dx}px`;
          float.style.top = `${ev.clientY - dy}px`;
          const over = settled ? undefined : bucketAt(ev.clientX, ev.clientY);
          for (const bucket of buckets) bucket.classList.toggle("is-target", bucket === over);
        });
        big.addEventListener("pointerup", (ev) => {
          if (!float) return;
          const over = bucketAt(ev.clientX, ev.clientY);
          settle();
          if (over) answerBucket(over);
        });
        big.addEventListener("pointercancel", settle);
      }
    } else if (mechanic === "simon" || mechanic === "dictation") {
      // Tap the sequence back. Any wrong tile ends the attempt; the right
      // tile lights, sounds, and fills a dot, so progress is felt.
      let at = 0;
      const dots = body.querySelectorAll<HTMLElement>("#kana-dots .kana-dot");
      for (const button of body.querySelectorAll<HTMLButtonElement>("#kana-grid button")) {
        button.addEventListener("click", () => {
          if (settled) return;
          const kana = item.grid![Number(button.dataset.i)];
          if (kana === item.seq![at]) {
            void playKana(kana).catch(() => undefined);
            button.classList.add("right");
            setTimeout(() => button.classList.remove("right"), 350);
            dots[at]?.classList.add("on");
            at++;
            if (at === item.seq!.length) succeed();
          } else {
            button.classList.add("wrong");
            miss(
              mechanic === "dictation"
                ? `✗ it was <b lang="ja">${escapeHtml(item.kana)}</b> (${escapeHtml(itemAnswer(item))})`
                : `✗ it was <b lang="ja">${escapeHtml(item.seq!.join(" "))}</b> (${escapeHtml(itemAnswer(item))})`,
              kana,
            );
          }
        });
      }
    } else if (mechanic === "sharpshooter") {
      // Find every tile with the target sound. One wrong tap is the miss;
      // right taps lock in, and the last one clears the item.
      const wanted = new Set(item.hits!);
      const found = new Set<number>();
      for (const button of body.querySelectorAll<HTMLButtonElement>("#kana-grid button")) {
        button.addEventListener("click", () => {
          if (settled) return;
          const index = Number(button.dataset.i);
          if (wanted.has(index)) {
            if (found.has(index)) return;
            found.add(index);
            button.classList.add("right");
            void playKana(item.grid![index]).catch(() => undefined);
            if (found.size === wanted.size) succeed();
          } else {
            button.classList.add("wrong");
            for (const hit of wanted) {
              body.querySelector<HTMLButtonElement>(`#kana-grid button[data-i="${hit}"]`)?.classList.add("right");
            }
            miss(
              `✗ ${escapeHtml(item.grid![index])} isn't <b>${escapeHtml(itemAnswer(item))}</b>`,
              item.grid![index],
            );
          }
        });
      }
    } else if (mechanic === "fishing") {
      // One right fish in the school. Hooking it freezes the pond and lands
      // the catch; hooking anything else freezes the pond around the one
      // that got away.
      const pond = body.querySelector<HTMLDivElement>("#kana-pond")!;
      const wanted = new Set(item.hits!);
      for (const fish of pond.querySelectorAll<HTMLButtonElement>(".kana-fish")) {
        fish.addEventListener("click", () => {
          if (settled) return;
          const index = Number(fish.dataset.i);
          pond.classList.add("frozen");
          if (wanted.has(index)) {
            fish.classList.add("caught");
            succeed();
          } else {
            fish.classList.add("wrong");
            for (const hit of wanted) {
              pond.querySelector<HTMLButtonElement>(`.kana-fish[data-i="${hit}"]`)?.classList.add("right");
            }
            miss(
              `✗ that one isn't <b>${escapeHtml(itemAnswer(item))}</b> — it was <b lang="ja">${escapeHtml(item.kana)}</b>`,
              item.grid![index],
            );
          }
        });
      }
    } else if (mechanic === "taiko") {
      // Go or no-go: the beat window closes on its own. Letting a mismatch
      // pass is a right answer that costs nothing but nerve.
      const beatMs = 2400 * rules.pace;
      side = setTimeout(() => {
        side = null;
        if (settled) return;
        if (item.match) {
          miss(`✗ it matched — <b lang="ja">${escapeHtml(item.kana)}</b> = <b>${escapeHtml(itemAnswer(item))}</b>`, undefined, true);
        } else {
          succeed();
        }
      }, beatMs) as unknown as ReturnType<typeof setInterval>;
      body.querySelector<HTMLButtonElement>("#kana-drum")!.addEventListener("click", () => {
        if (settled) return;
        if (item.match) {
          succeed();
        } else {
          miss(
            `✗ <b lang="ja">${escapeHtml(item.kana)}</b> says <b>${escapeHtml(itemAnswer(item))}</b> — the voice said <b>${escapeHtml(primaryRomaji(item.say ?? ""))}</b>`,
            item.say,
          );
        }
      });
    } else if (mechanic === "whack") {
      // Moles surface, wait a beat, and duck away. Three clean hits on the
      // called sound clear the item; one wrong bonk is the miss.
      const holes = [...body.querySelectorAll<HTMLElement>(".kana-hole")];
      const countEl = body.querySelector<HTMLElement>("#kana-whack-count")!;
      const targetSound = item.entry!.romaji[0];
      const wearing = pool.filter((entry) => entry.romaji[0] === targetSound);
      const foils = pool.filter((entry) => entry.romaji[0] !== targetSound);
      const NEED = 3;
      let hits = 0;
      const drawCount = (): void => {
        countEl.textContent = "🔨".repeat(hits) + "・".repeat(NEED - hits);
      };
      drawCount();
      const upMs = 1300 * rules.pace;
      const spawn = (): void => {
        if (settled || !body.isConnected) return;
        const free = holes.filter((hole) => !hole.querySelector(".kana-mole"));
        if (free.length === 0) return;
        const hole = free[Math.floor(Math.random() * free.length)];
        const isTarget = foils.length === 0 || Math.random() < 0.45;
        const entry = isTarget
          ? wearing[Math.floor(Math.random() * wearing.length)]
          : foils[Math.floor(Math.random() * foils.length)];
        const mole = document.createElement("button");
        mole.className = "kana-mole";
        mole.innerHTML = `<span lang="ja">${escapeHtml(entry.kana)}</span>`;
        mole.addEventListener("click", () => {
          if (settled) return;
          if (entry.romaji[0] === targetSound) {
            mole.classList.add("bonked");
            void playKana(entry.kana).catch(() => undefined);
            hits++;
            drawCount();
            setTimeout(() => mole.remove(), 260);
            if (hits >= NEED) succeed();
          } else {
            mole.classList.add("wrong");
            miss(
              `✗ <b lang="ja">${escapeHtml(entry.kana)}</b> says <b>${escapeHtml(entry.romaji[0])}</b>, not <b>${escapeHtml(targetSound)}</b>`,
              entry.kana,
            );
          }
        });
        hole.appendChild(mole);
        setTimeout(() => {
          if (!mole.classList.contains("bonked") && !mole.classList.contains("wrong")) mole.remove();
        }, upMs);
      };
      spawn();
      side = setInterval(spawn, 750 * rules.pace);
    } else {
      const input = body.querySelector<HTMLInputElement>("#kana-answer")!;
      input.focus();
      // The flash level shows the kana for a blink, then veils it; the
      // fading-ink bend lets it dissolve instead. Either way the answer
      // lifts the veil, so the correction is always seen.
      let flashTimer: ReturnType<typeof setTimeout> | null = null;
      if (mechanic === "flash") {
        const big = body.querySelector<HTMLElement>("#kana-big")!;
        flashTimer = setTimeout(() => {
          if (!settled && big.isConnected) big.classList.add("kana-veiled");
        }, rules.flashMs);
      }
      const reveal = (): void => {
        if (flashTimer !== null) clearTimeout(flashTimer);
        body.querySelector("#kana-big")?.classList.remove("kana-veiled", "kana-fading");
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        if (settled) return;
        const answer = input.value;
        if (!answer.trim()) return;
        input.disabled = true;
        reveal();
        if (itemMatches(item, answer)) succeed();
        else miss(`✗ ${escapeHtml(item.kana)} = <b>${escapeHtml(itemAnswer(item))}</b>`, answer);
      });
    }

    if (clockSec > 0) {
      const fill = body.querySelector<HTMLDivElement>("#kana-timer-fill")!;
      const startedAt = Date.now();
      const secondsThisQuestion = clockSec;
      timer = setInterval(() => {
        if (!body.isConnected) return stopTimer();
        const left = 1 - (Date.now() - startedAt) / (secondsThisQuestion * 1000);
        fill.style.width = `${Math.max(0, left * 100)}%`;
        if (left <= 0 && !settled) {
          const input = body.querySelector<HTMLInputElement>("#kana-answer");
          if (input) input.disabled = true;
          miss(`⏰ Time! ${escapeHtml(item.kana)} = <b>${escapeHtml(itemAnswer(item))}</b>`, undefined, true);
        }
      }, 100);
    }
  };

  draw();
}

// ---------------- which kana this run asks about ----------------

/**
 * How badly this kana needs to come up, from everything ever answered.
 *
 * The whole system in one number. A kana's mastery is a 0–5 rank that rises
 * with every right answer — by less and less as it climbs — falls hard on a
 * wrong one, and decays on its own as days pass, faster the lower it already
 * is. That rank is a live measure of struggle, and this turns it into how
 * often the kana is asked about:
 *
 *   never answered  8.0     the point of the whole exercise
 *   0 stars         6.0     six times as often as a kana you know
 *   1 star          4.2
 *   2 stars         2.8
 *   3 stars         1.8
 *   4 stars         1.2
 *   5 stars         1.0     still there, never dropped
 *
 * Squared, so the curve is steep where it matters: a kana you keep missing
 * crowds out the ones you have, and one that improves quietly steps back
 * without ever leaving. The floor of 1 is the important half of the promise —
 * a five-star kana still turns up, so it is never forgotten, and if it is,
 * decay drops its rank and it comes straight back to the front.
 *
 * A miss is felt at once: mastery loses half a star on the spot, so the kana
 * that just went wrong is markedly likelier in the very next level.
 */
function needOf(stat: KanaStat | undefined): number {
  if (!stat) return 8;
  const known = Math.max(0, Math.min(5, stat.mastery)) / 5;
  return 1 + 5 * (1 - known) ** 2;
}

/**
 * Draw `count` of them, by need, without repeats.
 *
 * Weighted rather than ranked: a straight "weakest first" list is the same
 * list every time, which teaches the order as much as the kana. This gives
 * the struggling ones most of the questions while leaving every kana a real
 * chance of appearing, so no two runs are alike.
 */
function drawByNeed(pool: KanaEntry[], weights: Map<string, number>, count: number): KanaEntry[] {
  const left = [...pool];
  const out: KanaEntry[] = [];
  let total = left.reduce((sum, entry) => sum + (weights.get(entry.kana) ?? 1), 0);
  while (out.length < count && left.length > 0) {
    let ticket = Math.random() * total;
    let at = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      ticket -= weights.get(left[i].kana) ?? 1;
      if (ticket <= 0) {
        at = i;
        break;
      }
    }
    const [taken] = left.splice(at, 1);
    total -= weights.get(taken.kana) ?? 1;
    out.push(taken);
  }
  return out;
}

/**
 * The questions for one non-word level: which kana, and how many.
 *
 * Within the cap, kana come up twice where there is room, which is what the
 * old "every kana at least twice" was for; a pool small enough for that to
 * fit is unchanged by any of this. Where there is not room, the questions go
 * where they are needed — see `needOf`. Every mechanic draws by that same
 * need, so whatever shape the question takes, it lands on the kana this
 * device knows least.
 */
async function kanaItems(pool: KanaEntry[], mechanic: Mechanic, rules: LevelRules): Promise<Item[]> {
  const cap = CAPS[mechanic] ?? 24;
  const stats = await kanaStats().catch(() => ({}) as Record<string, KanaStat>);
  const weights = new Map(pool.map((entry) => [entry.kana, needOf(stats[entry.kana])]));

  if (mechanic === "learn") {
    // The tutorial: the ones least known, but shown in their natural row
    // order, so it reads as a tour of the syllabary rather than a jumble.
    const chosen = new Set(drawByNeed(pool, weights, cap).map((entry) => entry.kana));
    return pool.filter((entry) => chosen.has(entry.kana)).map((entry) => ({ kana: entry.kana, entry }));
  }
  if (mechanic === "sort") return sortItems(pool, weights, cap, rules.buckets);
  if (mechanic === "simon") return simonItems(pool, weights, rules.seqExtra);
  if (mechanic === "sharpshooter") return sharpshooterItems(pool, weights, cap, rules.crowded);
  if (mechanic === "alien") return alienItems(pool, weights, cap, rules.alienExtra);
  if (mechanic === "onebehind") return onebehindItems(pool, weights, cap);
  if (mechanic === "whichmissing") return whichMissingItems(pool, weights, cap);
  if (mechanic === "fishing") return fishingItems(pool, weights, cap, rules.crowded);
  if (mechanic === "taiko") return taikoItems(pool, weights, cap);

  const target = Math.min(cap, pool.length * 2);
  const distinct = drawByNeed(pool, weights, Math.min(pool.length, target));
  const items = distinct.map((entry) => ({ kana: entry.kana, entry }));
  // Room left over goes round a second time, again by need — so in a small
  // pool, where everything fits twice over, the hard ones are still the ones
  // that come up three times.
  for (const entry of drawByNeed(distinct, weights, target - distinct.length)) {
    items.push({ kana: entry.kana, entry });
  }
  return shuffle(items);
}

/**
 * Sort race: rounds of buckets that hold still, a handful of kana through
 * each round.
 *
 * The bucket labels hold still for their whole round — the race is in
 * recognising the kana, not in hunting a moving label — and each of the
 * round's kana passes twice. A pool with fewer sounds than buckets borrows
 * labels from outside it, which is fair: a borrowed label is never the
 * answer, only a wrong bucket to avoid. The four-bucket bend just deals a
 * wider round.
 */
function sortItems(pool: KanaEntry[], weights: Map<string, number>, cap: number, bucketCount: number): Item[] {
  const items: Item[] = [];
  while (items.length < cap) {
    const round: KanaEntry[] = [];
    const seen = new Set<string>();
    for (const entry of drawByNeed(pool, weights, pool.length)) {
      if (seen.has(entry.romaji[0])) continue;
      seen.add(entry.romaji[0]);
      round.push(entry);
      if (round.length === bucketCount) break;
    }
    if (round.length === 0) break;
    const labels = round.map((entry) => entry.romaji[0]);
    while (labels.length < bucketCount) {
      const extra = shuffle([...ROMAJI_MAP.values()].map((spellings) => spellings[0])).find(
        (romaji) => !labels.includes(romaji),
      );
      if (!extra) break;
      labels.push(extra);
    }
    const order = shuffle(labels);
    for (const entry of shuffle([...round, ...round])) {
      items.push({ kana: entry.kana, entry, buckets: order });
      if (items.length >= cap) break;
    }
  }
  return items;
}

/**
 * Simon: spoken sequences that grow — two sounds, then three, up to five,
 * plus whatever the tier and the tile's bend add on top.
 *
 * The board holds the sequence's kana plus fillers, eight tiles where the
 * pool can fill them. Sequences draw by need without repeats while the pool
 * allows it; a tiny pool repeats rather than stalling.
 */
function simonItems(pool: KanaEntry[], weights: Map<string, number>, extra: number): Item[] {
  const lengths = [2, 2, 3, 3, 4, 4, 5].map((n) => Math.min(9, n + extra));
  return lengths.map((length) => {
    const seq: string[] = [];
    if (pool.length >= length) {
      for (const entry of drawByNeed(pool, weights, length)) seq.push(entry.kana);
    } else {
      while (seq.length < length) {
        const next = drawByNeed(pool, weights, 1)[0].kana;
        // Never the same sound twice in a row; twice in a sequence is fine.
        if (seq[seq.length - 1] === next && pool.length > 1) continue;
        seq.push(next);
      }
    }
    const tiles = new Set(seq);
    for (const entry of shuffle([...pool])) {
      if (tiles.size >= Math.min(8, pool.length)) break;
      tiles.add(entry.kana);
    }
    return { kana: seq.join(""), seq, grid: shuffle([...tiles]) };
  });
}

/**
 * Sharpshooter: one target sound, a wall of tiles, several of them the
 * target. With both scripts in the pool the copies come in both dresses —
 * か and カ are the same sound wearing different clothes, which is exactly
 * the point being drilled.
 */
function sharpshooterItems(pool: KanaEntry[], weights: Map<string, number>, cap: number, crowded: boolean): Item[] {
  return drawByNeed(pool, weights, Math.min(cap, pool.length)).map((target) => {
    const sound = target.romaji[0];
    const variants = pool.filter((entry) => entry.romaji[0] === sound);
    const foils = shuffle(pool.filter((entry) => entry.romaji[0] !== sound));
    // A crowded range hides more targets in a fuller wall.
    const copies = (crowded ? 3 : 2) + Math.floor(Math.random() * 2);
    const cells: string[] = [];
    for (let i = 0; i < copies; i++) cells.push(variants[Math.floor(Math.random() * variants.length)].kana);
    const size = Math.max(crowded ? 9 : 6, Math.min(12, foils.length + copies));
    for (let i = 0; cells.length < size && foils.length > 0; i++) cells.push(foils[i % foils.length].kana);
    const grid = shuffle(cells);
    const hits = grid.flatMap((kana, index) =>
      pool.find((entry) => entry.kana === kana)?.romaji[0] === sound ? [index] : [],
    );
    return { kana: target.kana, entry: target, grid, hits };
  });
}

/**
 * Alien names: made-up words assembled from the pool itself, by need.
 *
 * A real word can be guessed from vocabulary; a made-up one can only be
 * read. Three or four sounds, never the same one twice running, spoken by
 * the synthesiser like any unfamiliar string.
 */
function alienItems(pool: KanaEntry[], weights: Map<string, number>, cap: number, extra = 0): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < cap; i++) {
    const length = 3 + extra + (Math.random() < 0.4 ? 1 : 0);
    const seq: string[] = [];
    let guard = 0;
    while (seq.length < length && guard++ < 40) {
      const next = drawByNeed(pool, weights, 1)[0].kana;
      if (seq[seq.length - 1] === next && pool.length > 1) continue;
      seq.push(next);
    }
    items.push({ kana: seq.join(""), gloss: "an alien's name", ambiguous: true, invented: true });
  }
  return items;
}

/**
 * One behind: every question shows the NEXT kana while asking for the one
 * before it. Each item carries its own shown/asked pair, so a missed one
 * can come round again without breaking anybody's chain.
 */
function onebehindItems(pool: KanaEntry[], weights: Map<string, number>, cap: number): Item[] {
  const drawn: KanaEntry[] = [];
  while (drawn.length < cap) {
    for (const entry of drawByNeed(pool, weights, pool.length)) {
      drawn.push(entry);
      if (drawn.length >= cap) break;
    }
  }
  return drawn.map((entry, i) =>
    i === 0
      ? { kana: entry.kana, entry, show: entry.kana, lead: true }
      : { kana: drawn[i - 1].kana, entry: drawn[i - 1], show: entry.kana },
  );
}

/**
 * The silent one: a few sounds play, one more tile shows than was spoken,
 * and the quiet tile is the answer. Everything distinct by sound, so
 * nothing spoken can masquerade as unspoken.
 */
function whichMissingItems(pool: KanaEntry[], weights: Map<string, number>, cap: number): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < cap; i++) {
    const picks: KanaEntry[] = [];
    const seen = new Set<string>();
    for (const entry of drawByNeed(pool, weights, pool.length)) {
      if (seen.has(entry.romaji[0])) continue;
      seen.add(entry.romaji[0]);
      picks.push(entry);
      if (picks.length === 4) break;
    }
    if (picks.length < 2) break;
    const quiet = picks[0]; // drawn by need: the weakest kana is the answer
    const spoken = picks.slice(1);
    items.push({
      kana: quiet.kana,
      entry: quiet,
      seq: shuffle(spoken.map((entry) => entry.kana)),
      grid: shuffle(picks.map((entry) => entry.kana)),
    });
  }
  return items;
}

/**
 * Taiko: one kana for the eyes, one sound for the ears, half the time the
 * same one. The shown kana draws by need; the impostor sound is any other
 * sound the pool knows.
 */
function taikoItems(pool: KanaEntry[], weights: Map<string, number>, cap: number): Item[] {
  const drawn: KanaEntry[] = [];
  while (drawn.length < cap) {
    for (const entry of drawByNeed(pool, weights, pool.length)) {
      drawn.push(entry);
      if (drawn.length >= cap) break;
    }
  }
  return drawn.map((entry) => {
    const impostors = pool.filter((other) => other.romaji[0] !== entry.romaji[0]);
    const match = impostors.length === 0 || Math.random() < 0.5;
    const spoken = match ? entry : impostors[Math.floor(Math.random() * impostors.length)];
    return { kana: entry.kana, entry, say: spoken.kana, match };
  });
}

/**
 * Dictation: a word game for the ears. Real words where the pool can spell
 * enough of them; made-up ones where it cannot — the listening is the same
 * drill either way.
 */
async function dictationItems(words: Item[] | null, pool: KanaEntry[], rules: LevelRules): Promise<Item[]> {
  const cap = CAPS.dictation;
  const stats = await kanaStats().catch(() => ({}) as Record<string, KanaStat>);
  const weights = new Map(pool.map((entry) => [entry.kana, needOf(stats[entry.kana])]));
  const base: Item[] =
    words && words.length >= 5
      ? words.slice(0, cap)
      : alienItems(pool, weights, cap).map((item) => ({ ...item, gloss: "a made-up word" }));

  return base.map((word) => {
    const seq = kanaSegments(word.kana);
    const tiles = new Set(seq);
    const wanted = tiles.size + 3 + rules.decoys;
    for (const entry of shuffle([...pool])) {
      if (tiles.size >= wanted) break;
      tiles.add(entry.kana);
    }
    return { ...word, seq, grid: shuffle([...tiles]) };
  });
}

/**
 * Fishing: a school of kana, exactly one wearing the called sound. The
 * school is drawn distinct by sound, so no fish can honestly claim to be
 * the catch — and a full pond deals half again as many.
 */
function fishingItems(pool: KanaEntry[], weights: Map<string, number>, cap: number, crowded: boolean): Item[] {
  const school = crowded ? 9 : 6;
  return drawByNeed(pool, weights, Math.min(cap, pool.length)).map((target) => {
    const seen = new Set([target.romaji[0]]);
    const foils: string[] = [];
    for (const entry of shuffle([...pool])) {
      if (foils.length >= school - 1) break;
      if (seen.has(entry.romaji[0])) continue;
      seen.add(entry.romaji[0]);
      foils.push(entry.kana);
    }
    const grid = shuffle([target.kana, ...foils]);
    return { kana: target.kana, entry: target, grid, hits: [grid.indexOf(target.kana)] };
  });
}

/**
 * Echo's options: the answer's glyph and three others from the pool, all
 * with distinct sounds — two glyphs sharing a sound would both be right.
 */
function echoChoicesFor(item: Item, pool: KanaEntry[]): string[] {
  const sound = itemAnswer(item);
  const seen = new Set([sound]);
  const others: string[] = [];
  for (const entry of shuffle([...pool])) {
    if (entry.kana === item.kana || seen.has(entry.romaji[0])) continue;
    seen.add(entry.romaji[0]);
    others.push(entry.kana);
    if (others.length === 3) break;
  }
  return shuffle([item.kana, ...others]);
}

/** Three romaji options: the right one and two lookalikes from the pool. */
function choicesFor(item: Item, pool: KanaEntry[]): string[] {
  const correct = itemAnswer(item);
  const others = shuffle(
    [...new Set(pool.map((entry) => entry.romaji[0]))].filter((romaji) => romaji !== correct),
  );
  // A tiny pool still needs three options; borrow from the whole syllabary.
  while (others.length < 2) {
    const extra = shuffle([...ROMAJI_MAP.values()].map((spellings) => spellings[0])).find(
      (romaji) => romaji !== correct && !others.includes(romaji),
    );
    if (!extra) break;
    others.push(extra);
  }
  return shuffle([correct, ...others.slice(0, 2)]);
}

// ---------------- words from the dictionary ----------------

interface Word {
  /** The commonest way this reading is written, for finding a recording. */
  term: string;
  gloss: string;
  freq: number;
  /** Every distinct written form with this reading — homophones. */
  forms: Set<string>;
}

/**
 * Everything the chosen kana can spell, worked out once per pool.
 *
 * The search walks the dictionary's whole key index, which is fast but not
 * free, and both word levels want the same answer. Level 6 therefore starts
 * on the list level 5 built — and draws a different fourteen words out of it.
 */
let candidateCache: { groups: string; words: [string, Word][] } | null = null;

/**
 * Short common words written only with the chosen kana, with a short
 * English meaning each. Null when the dictionary cannot be loaded.
 *
 * `count` words are drawn at random from the whole candidate list, leaning
 * towards the commoner end of it rather than taking a fixed slice off the
 * top: a beginner reading their first hiragana does not need an obscure
 * botanical term, but neither do they need the same fourteen words every
 * night. Whatever the last few games used is held back on top of that.
 */
async function wordsFor(game: GameState, pool: KanaEntry[], count: number): Promise<Item[] | null> {
  const allowed = new Set(pool.flatMap((entry) => [...entry.kana]));
  const signature = [...game.groups].sort().join(",");
  try {
    const dictionary = await loadDictionary();
    let ranked = candidateCache?.groups === signature ? candidateCache.words : null;
    if (!ranked) {
      const best = new Map<string, Word>();
      for (const entry of dictionary.wordsMadeOf(allowed, 2, 4)) {
        const gloss = entry.glosses[0];
        if (!gloss || gloss.length > 42) continue;
        const freq = entry.freq ?? Number.MAX_SAFE_INTEGER;
        const found = best.get(entry.reading);
        if (!found) {
          best.set(entry.reading, { term: entry.term, gloss, freq, forms: new Set([entry.term]) });
          continue;
        }
        found.forms.add(entry.term);
        if (freq < found.freq) {
          found.freq = freq;
          found.gloss = gloss;
          found.term = entry.term;
        }
      }
      ranked = [...best.entries()]
        .sort((a, b) => a[1].freq - b[1].freq)
        .slice(0, WORD_CANDIDATES);
      candidateCache = { groups: signature, words: ranked };
    }
    if (ranked.length === 0) return [];

    // Held back: the last few games' words, and — because this is called once
    // per word level — the ones the level before it just used.
    const recent = new Set((await getMeta<string[]>(RECENT_WORDS_KEY)) ?? []);
    const fresh = ranked.filter(([kana]) => !recent.has(kana));
    // Once nearly everything has been seen recently, the recent list has
    // stopped being a filter and started being the whole dictionary. Let it
    // go rather than serve the same handful of leftovers.
    const source = fresh.length >= count * 2 ? fresh : ranked;
    // The draw leans common but is otherwise pure chance — deliberately no
    // steering towards struggling kana here, so the words stay a surprise
    // rather than the same weak-spot vocabulary every night.
    const chosen = drawByFrequency(source, count);
    await setMeta(RECENT_WORDS_KEY, [...chosen.map(([kana]) => kana), ...recent].slice(0, RECENT_WORDS));

    return chosen.map(([kana, word]) => ({
      kana,
      gloss: word.gloss,
      term: word.term,
      // Two ways of being unsure, and either one means asking for a recording
      // is a gamble the learner loses.
      //
      // One reading, several spellings: いこう is 意向, 移行 and 以降; はし is
      // chopsticks, a bridge and an edge, each said with its own pitch.
      //
      // One spelling, several readings — the one this missed. 青魚 is あおうお
      // here and あおざかな at least as often, and what came back was a
      // recording of a real speaker saying the other one. A recording is only
      // safe when the writing can be read one way.
      ambiguous:
        [...word.forms].filter((form) => form !== kana).length > 1 ||
        readAnotherWay(dictionary, word.term, kana),
    }));
  } catch {
    // A failed download or an unreadable dictionary both mean no words. The
    // caller says so on screen; what it must never do is wait forever.
    return null;
  }
}

/**
 * Can this spelling be read some other way?
 *
 * The dictionary is keyed by written form as well as by reading, so asking
 * it about the spelling gives back every word written that way — and if any
 * of them is said differently, a recording of "that spelling" may be any of
 * them.
 */
function readAnotherWay(dictionary: { lookupExact(text: string): DictEntry[] }, term: string, reading: string): boolean {
  if (term === reading) return false; // written in kana: it reads as it looks
  return dictionary.lookupExact(term).some((entry) => entry.term === term && entry.reading !== reading);
}

/**
 * Draw `count` distinct words from a list ordered commonest first.
 *
 * Squaring a uniform random number leans the draw towards the front of the
 * list without ever fencing off the back of it: the words that come up are
 * mostly common ones, but which common ones is different every time, and a
 * long tail still turns up often enough to be worth having.
 */
function drawByFrequency<T>(ranked: T[], count: number): T[] {
  const taken = new Set<number>();
  const out: T[] = [];
  const wanted = Math.min(count, ranked.length);
  while (out.length < wanted) {
    let at = Math.min(ranked.length - 1, Math.floor(Math.random() ** 2 * ranked.length));
    // Already drawn: walk on to the next free one rather than re-rolling for
    // ever as the list fills up.
    while (taken.has(at)) at = (at + 1) % ranked.length;
    taken.add(at);
    out.push(ranked[at]);
  }
  return shuffle(out);
}

// ---------------- helpers ----------------

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
