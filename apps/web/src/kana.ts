import { getMeta, setMeta } from "./db.js";
import { playKana, playWord, prefetchAudio, spokenKana } from "./audio.js";
import { cheerBox, preloadReactions, showReaction } from "./feedback.js";
import { recordQuestEvents } from "./quests.js";
import { unlockAll, unlockAllNow } from "./unlock.js";
import { PER_CORRECT, earnYennies, formatYennies, yennies } from "./yennies.js";
import { kanaStats, startGameSession, type GameSession, type KanaStat } from "./kana-stats.js";
import { renderKanaStats } from "./kana-stats-view.js";
import { assetUrl, loadDictionary } from "./store.js";
import { KANA_GROUPS, isCorrect, type KanaEntry, type KanaGroup } from "./kana-data.js";

/**
 * The kana game.
 *
 * First the learner picks which groups to practice — any mix of rows from
 * either syllabary. Then the game runs through levels of increasing
 * difficulty over exactly that pool:
 *
 *   0  learn      — meet the kana, with their sounds
 *   1  choice     — multiple choice, three options
 *   2  type       — type the romaji
 *   3  lives      — typing, five hearts, a miss costs one
 *   4  timed      — typing, hearts, and a clock
 *   5  words      — short dictionary words spelt only with the chosen kana
 *   6  words+time — different words again, on the clock
 *
 * A missed item goes back into the queue, so a level is only done when
 * everything has been answered correctly; the progress bar shows how far
 * that is. Completing a level unlocks the next and restores one heart.
 * Every answer is spoken, and right/wrong pop the reactions from
 * `public/feedback/`, which stay editable on GitHub.
 *
 * No two runs of a level are the same. Which kana it asks about is drawn
 * from the permanent record, weakest first; which words it asks are drawn
 * fresh from the dictionary every time.
 */

const GAME_KEY = "kanaGame";

interface GameState {
  groups: string[];
  /** The next level to clear; levels below it are done. */
  unlocked: number;
  health: number;
  /** Start at level 1 — for someone who already knows the shapes. */
  skipLearn?: boolean;
}

const MAX_HEALTH = 5;

/**
 * Where the ladder goes back to once it has been cleared.
 *
 * Level 1, not 0: anybody who has just finished all seven does not need the
 * tutorial that only shows each kana with its sound.
 */
const RESTART_AT = 1;
const LEVELS = [
  { name: "Learn", detail: "Meet your kana, the ones you know least first." },
  { name: "Multiple choice", detail: "Three options." },
  { name: "Type it", detail: "Type the romaji yourself." },
  { name: "Lives", detail: "Typing, five hearts. A miss costs one." },
  { name: "Timed", detail: "Hearts, and six seconds a question." },
  { name: "Real words", detail: "Short dictionary words from your kana. No clock." },
  { name: "Words, timed", detail: "Different words, ten seconds each." },
] as const;

/**
 * How many questions a level asks, by level.
 *
 * "Every kana at least twice" is honest for a row or two and punishing for a
 * whole syllabary: all of hiragana and katakana is 92 kana, so 184 questions,
 * four levels running. Nobody finishes that, and a drill nobody finishes
 * teaches nothing.
 *
 * So a level is capped, and the questions inside the cap go to the kana this
 * device knows least — the permanent record already knows which those are.
 * A small pool is unaffected: eight kana still come up twice each. A large
 * one is practised across sittings instead of all in one, which is how
 * practice works anyway. The later levels are shorter than the earlier ones
 * because they ask more of you per question.
 */
const QUESTION_CAP = [36, 30, 28, 24, 20] as const;

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
const WORDS_PER_LEVEL: Record<number, number> = { 5: 14, 6: 12 };
const WORD_CANDIDATES = 1200;
const RECENT_WORDS_KEY = "kanaRecentWords";
const RECENT_WORDS = 240;
let streak = 0;
let bestStreak = 0;

function streakHtml(): string {
  if (streak === 0 && bestStreak === 0) return "";
  return `<span class="kana-streak">🔥 ${streak}${bestStreak > 0 ? ` · best ${bestStreak}` : ""}</span>`;
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
  const game = await getGame();
  await unlockAll();
  if (!isCurrent()) return;

  main.innerHTML = `
    <h1>Kana</h1>
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
    ${
      // The admin's key: jump straight to any level, to see one without
      // playing through everything below it first.
      unlockAllNow()
        ? `<div class="gram-levels" id="kana-jump">${LEVELS.map(
            (lv, i) => `<button class="gram-level-chip" data-level="${i}">${i}<span class="gram-level-count">${lv.name}</span></button>`,
          ).join("")}</div>`
        : ""
    }
  `;

  for (const chip of body.querySelectorAll<HTMLButtonElement>("#kana-jump button")) {
    chip.addEventListener("click", async () => {
      if (chosen.size === 0) return;
      const level = Number(chip.dataset.level);
      const next: GameState =
        game && sameGroups(game.groups, chosen)
          ? { ...game, skipLearn }
          : { groups: [...chosen].sort(), unlocked: level, health: MAX_HEALTH, skipLearn };
      next.unlocked = Math.max(next.unlocked, level);
      await saveGame(next);
      void runLevel(body, next, level, main, isCurrent);
    });
  }

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
    // A game whose ladder is already finished starts over. Without this a
    // save written before the rollback existed — or any future way of getting
    // past the end — parks on the last level and never leaves it.
    const startAt = resuming && game
      ? game.unlocked >= LEVELS.length
        ? RESTART_AT
        : game.unlocked
      : skipLearn
        ? 1
        : 0;
    note.textContent =
      chosen.size === 0
        ? "Pick at least one group."
        : `${count} kana · from level ${startAt}: ${LEVELS[startAt].name}`;
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
        : { groups: [...chosen].sort(), unlocked: 0, health: MAX_HEALTH, skipLearn };
    if (skipLearn) next.unlocked = Math.max(next.unlocked, 1);
    // Same guard as the note on the selection screen: a finished ladder
    // starts over rather than clamping onto its last rung.
    if (next.unlocked >= LEVELS.length) next.unlocked = RESTART_AT;
    await saveGame(next);
    void runLevel(body, next, next.unlocked, main, isCurrent);
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

/** One thing to answer: a kana, or a word with its meaning. */
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
 */
function audioFor(item: Item): { term: string; reading: string; mode?: "tts" } {
  // A lone kana is asked for by the spelling that makes an engine say it —
  // handed は on its own, one says "wa". `playKana` does the same, so the
  // clip warmed here is the clip played.
  if (item.entry) {
    const text = spokenKana(item.kana);
    return { term: text, reading: text, mode: "tts" };
  }
  if (item.ambiguous) return { term: item.kana, reading: item.kana, mode: "tts" };
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
  main: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  const pool = poolOf(game);
  void preloadReactions();

  const useLives = level >= 3;
  const timerSec = level === 4 ? 6 : level === 6 ? 10 : 0;
  const useChoices = level === 1;
  const learning = level === 0;

  let items: Item[];
  if (level >= 5) {
    // The dictionary may still have to come down the wire, which on mobile
    // data is long enough that a bare line of text reads as a hung screen.
    // So: say what is happening, and always leave a way out.
    body.innerHTML = `
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
    const words = await wordsFor(game, pool, WORDS_PER_LEVEL[level] ?? 12);
    clearTimeout(slow);
    if (left || !isCurrent() || !body.isConnected) return;
    if (words === null || words.length < 5) {
      // The other way this used to strand somebody: a pool too small for the
      // word levels left the game unlocked at 5 or 6, so Continue landed on
      // this card every single time with nothing here to leave by except
      // changing the pool. There is a way back down the ladder now.
      body.innerHTML = `
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
        void runLevel(body, game, RESTART_AT, main, isCurrent);
      });
      body.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
      return;
    }
    items = words;
  } else {
    items = await kanaItems(pool, level);
  }

  const queue = learning ? [...items] : shuffle([...items]);
  let done = 0;
  let health = game.health;
  let missedAny = false;
  let gotRight = 0;
  let active = true; // cleared on quit, so a pending auto-advance dies quietly

  // Every sound this level will need, fetched now rather than at the moment
  // it is wanted: an answer lands and the clip has to play immediately, and
  // a download started right then always arrives after the moment it was for.
  const warming = { aborted: false };
  void prefetchAudio(items.map(audioFor), warming);
  let timer: ReturnType<typeof setInterval> | null = null;
  bestStreak = (await getMeta<number>(BEST_STREAK_KEY)) ?? bestStreak;

  // The learn level asks nothing, so it records nothing; every other run
  // goes into the permanent per-kana record from its first answer.
  const session: GameSession | null = learning
    ? null
    : startGameSession({
        level,
        groups: game.groups,
        poolSize: level >= 5 ? items.length : new Set(items.map((item) => item.kana)).size,
        words: level >= 5,
      });

  const stopTimer = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  /**
   * Bank what the run earned and describe it, for the screen that ends it.
   *
   * Nothing about yennies appears while playing — a counter climbing beside
   * the questions is a reason to keep tapping, which is not the reason to be
   * here. Once, at the end, with the balance beside it.
   */
  const payout = async (): Promise<string> => {
    const earned = gotRight * PER_CORRECT;
    const balance = earned > 0 ? await earnYennies(earned) : await yennies();
    return `<div class="yen-line">${
      earned > 0 ? `<b>+${earned.toLocaleString()}</b> · ` : ""
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
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">💔</div>
        <div class="kana-score">Out of hearts</div>
        ${purse}
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="kana-retry">Try again</button>
          <button id="kana-back" class="secondary">Change groups</button>
        </div>
      </div>`;
    body.querySelector("#kana-retry")!.addEventListener("click", () => void runLevel(body, game, level, main, isCurrent));
    body.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
  };

  const finish = async (): Promise<void> => {
    stopTimer();
    session?.end("cleared");
    game.unlocked = Math.max(game.unlocked, level + 1);
    // Clearing the last level rolls the ladder back here, not in the button
    // on the trophy screen. Leaving that screen any other way — Change
    // groups, another tab, closing the app — used to save "unlocked: 7",
    // which the selection screen clamped to the top level, so Continue
    // replayed level 6 for ever.
    if (game.unlocked >= LEVELS.length) game.unlocked = RESTART_AT;
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
    const next = level + 1 < LEVELS.length ? LEVELS[level + 1] : null;

    if (!next) {
      // The top of the ladder.
      body.innerHTML = `
        <div class="card-panel kana-quiz">
          <div class="big">🏆</div>
          <div class="kana-score">All seven levels clear</div>
          ${purse}
          <div class="row-actions" style="justify-content:center;margin-top:12px">
            <button id="kana-again">Play again</button>
            <button id="kana-back" class="secondary">Change groups</button>
          </div>
        </div>`;
      body.querySelector("#kana-again")!.addEventListener("click", async () => {
        game.health = MAX_HEALTH;
        await saveGame(game);
        void runLevel(body, game, RESTART_AT, main, isCurrent);
      });
      body.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
      return;
    }

    // The climb continues by itself; the button is for the impatient.
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">🎉</div>
        <div class="kana-score">Level ${level} clear</div>
        <div class="glosses">${useLives ? `One heart restored: ${heartsHtml(game.health)}<br/>` : ""}
          Starting level ${level + 1}: ${next.name}…</div>
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
      void runLevel(body, game, level + 1, main, isCurrent);
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

    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="kana-quiz-top">
          <span class="glosses">Level ${level}: ${LEVELS[level].name}
            <span class="kana-count">${done + 1}/${total}</span></span>
          <span>${streakHtml()} ${useLives ? heartsHtml(health) : ""}</span>
          <button id="kana-quit" class="quiz-stop" title="Stop" aria-label="Stop">✕</button>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${percent}%"></div></div>
        ${timerSec > 0 ? `<div class="kana-timer"><div class="kana-timer-fill" id="kana-timer-fill"></div></div>` : ""}
        <div class="kana-big" lang="ja">${escapeHtml(item.kana)}</div>
        ${item.gloss ? `<div class="kana-gloss">${escapeHtml(item.gloss)}</div>` : ""}
        ${
          learning
            ? `<div class="kana-learn-romaji">${escapeHtml(itemAnswer(item))}</div>
               <div class="row-actions" style="justify-content:center">
                 <button id="kana-next-card">Next (Enter)</button>
               </div>`
            : useChoices
              ? `<div class="kana-choices" id="kana-choices">${choicesFor(item, pool)
                  .map((choice) => `<button data-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`)
                  .join("")}</div>`
              : `<input type="text" id="kana-answer" autocomplete="off" autocapitalize="none"
                   autocorrect="off" spellcheck="false" placeholder="type the romaji…" />`
        }
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
    // has recorded it. Never let a silent device stop the quiz.
    const say = (): void => {
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
      setTimeout(advance, 1100);
    };

    const miss = (label: string, mistake?: string, timeout = false): void => {
      settled = true;
      stopTimer();
      session?.answer(item.kana, { correct: false, mistake, timeout });
      streak = 0;
      missedAny = true;
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

    if (useChoices) {
      for (const button of body.querySelectorAll<HTMLButtonElement>("#kana-choices button")) {
        button.addEventListener("click", () => {
          if (settled) return;
          const choice = button.dataset.choice!;
          if (itemMatches(item, choice)) {
            button.classList.add("right");
            succeed();
          } else {
            button.classList.add("wrong");
            body
              .querySelector<HTMLButtonElement>(`#kana-choices button[data-choice="${cssEscape(itemAnswer(item))}"]`)
              ?.classList.add("right");
            miss(`✗ ${escapeHtml(item.kana)} = <b>${escapeHtml(itemAnswer(item))}</b>`, choice);
          }
        });
      }
    } else {
      const input = body.querySelector<HTMLInputElement>("#kana-answer")!;
      input.focus();
      input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        if (settled) return;
        const answer = input.value;
        if (!answer.trim()) return;
        input.disabled = true;
        if (itemMatches(item, answer)) succeed();
        else miss(`✗ ${escapeHtml(item.kana)} = <b>${escapeHtml(itemAnswer(item))}</b>`, answer);
      });
    }

    if (timerSec > 0) {
      const fill = body.querySelector<HTMLDivElement>("#kana-timer-fill")!;
      const startedAt = Date.now();
      timer = setInterval(() => {
        if (!body.isConnected) return stopTimer();
        const left = 1 - (Date.now() - startedAt) / (timerSec * 1000);
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
 * The questions for one non-word level: which kana, and how many.
 *
 * Two rules, in this order. Anything never answered comes first — there is
 * no point drilling さ for the fifth time while ぬ has never been seen. After
 * that, weakest mastery first, with enough jitter that two runs in a row are
 * not the same list in the same order.
 *
 * Within the cap, kana come up twice where there is room, which is what the
 * old "every kana at least twice" was for; a pool small enough for that to
 * fit is unchanged by any of this.
 */
async function kanaItems(pool: KanaEntry[], level: number): Promise<Item[]> {
  const cap = QUESTION_CAP[level] ?? 24;
  const stats = await kanaStats().catch(() => ({}) as Record<string, KanaStat>);

  // Never answered sorts below zero mastery: unmet kana are the point of the
  // whole exercise. The jitter is smaller than the gap between stars, so it
  // shuffles equals rather than reordering the ranking.
  const need = (entry: KanaEntry): number => {
    const stat = stats[entry.kana];
    return (stat ? stat.mastery : -1) + Math.random() * 0.4;
  };
  const byNeed = [...pool].sort((a, b) => need(a) - need(b));

  if (level === 0) {
    // The tutorial: the ones least known, but shown in their natural row
    // order, so it reads as a tour of the syllabary rather than a jumble.
    const chosen = new Set(byNeed.slice(0, cap).map((entry) => entry.kana));
    return pool.filter((entry) => chosen.has(entry.kana)).map((entry) => ({ kana: entry.kana, entry }));
  }

  const target = Math.min(cap, pool.length * 2);
  const distinct = byNeed.slice(0, Math.min(pool.length, target));
  const items = distinct.map((entry) => ({ kana: entry.kana, entry }));
  // Room left over goes to the weakest of the chosen, a second time each.
  for (const entry of distinct.slice(0, target - distinct.length)) {
    items.push({ kana: entry.kana, entry });
  }
  return shuffle(items);
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
    let ranked = candidateCache?.groups === signature ? candidateCache.words : null;
    if (!ranked) {
      const dictionary = await loadDictionary();
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
    const chosen = drawByFrequency(source, count);
    await setMeta(RECENT_WORDS_KEY, [...chosen.map(([kana]) => kana), ...recent].slice(0, RECENT_WORDS));

    return chosen.map(([kana, word]) => ({
      kana,
      gloss: word.gloss,
      term: word.term,
      // いこう is 意向, 移行 and 以降; はし is chopsticks, a bridge and an
      // edge, each said with its own pitch. No recording of that spelling is
      // reliably the word on screen, so those get read out instead.
      ambiguous: [...word.forms].filter((form) => form !== kana).length > 1,
    }));
  } catch {
    // A failed download or an unreadable dictionary both mean no words. The
    // caller says so on screen; what it must never do is wait forever.
    return null;
  }
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
