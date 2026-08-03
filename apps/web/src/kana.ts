import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { recordQuestEvents } from "./quests.js";
import { assetUrl, loadDictionary } from "./store.js";
import { KANA_GROUPS, isCorrect, type KanaEntry, type KanaGroup } from "./kana-data.js";

/**
 * The kana game.
 *
 * First the learner picks which groups to practice — any mix of rows from
 * either syllabary. Then the game runs through levels of increasing
 * difficulty over exactly that pool:
 *
 *   0  learn      — meet each kana once, with its sound
 *   1  choice     — multiple choice, three options, every kana twice
 *   2  type       — type the romaji
 *   3  lives      — typing, five hearts, a miss costs one
 *   4  timed      — typing, hearts, and a clock
 *   5  words      — short dictionary words spelt only with the chosen kana
 *   6  words+time — the same, on the clock
 *
 * A missed item goes back into the queue, so a level is only done when
 * everything has been answered correctly; the progress bar shows how far
 * that is. Completing a level unlocks the next and restores one heart.
 * Every answer is spoken, and right/wrong pop the reactions from
 * `public/feedback/`, which stay editable on GitHub.
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
const LEVELS = [
  { name: "Learn", detail: "Meet each kana once, with its sound." },
  { name: "Multiple choice", detail: "Three options; every kana at least twice." },
  { name: "Type it", detail: "Type the romaji yourself." },
  { name: "Lives", detail: "Typing, five hearts — a miss costs one." },
  { name: "Timed", detail: "Hearts, and six seconds a question." },
  { name: "Real words", detail: "Short dictionary words from your kana. No clock." },
  { name: "Words, timed", detail: "The words again, ten seconds each." },
] as const;

/**
 * The correct-answer streak: consecutive right answers, across levels,
 * reset by any miss. The running count lives for the session; the best
 * ever is kept on the device.
 */
const BEST_STREAK_KEY = "kanaBestStreak";
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

// ---------------- answer reactions ----------------

interface Reaction {
  image: string;
  text: string;
}

interface Reactions {
  correct: Reaction;
  wrong: Reaction;
}

const DEFAULT_REACTIONS: Reactions = {
  correct: { image: "correct.gif", text: "good job" },
  wrong: { image: "wrong.gif", text: "nice try!" },
};

let reactionsLoaded: Promise<Reactions> | null = null;

/**
 * The reactions live in `apps/web/public/feedback/` — a JSON file for the
 * texts and two images — precisely so they can be edited on GitHub without
 * touching any code: change the file, push, and the next deploy shows it.
 */
function reactions(): Promise<Reactions> {
  reactionsLoaded ??= fetch(assetUrl("feedback/feedback.json"))
    .then((res) => (res.ok ? res.json() : {}))
    .then((parsed: Partial<Reactions>) => ({
      correct: { ...DEFAULT_REACTIONS.correct, ...(parsed?.correct ?? {}) },
      wrong: { ...DEFAULT_REACTIONS.wrong, ...(parsed?.wrong ?? {}) },
    }))
    .catch(() => DEFAULT_REACTIONS);
  return reactionsLoaded;
}

function reactionUrl(image: string): string {
  return /^(https?:|data:)/i.test(image) ? image : assetUrl(`feedback/${image}`);
}

function showReaction(body: HTMLElement, reaction: Reaction): void {
  const box = body.querySelector<HTMLDivElement>("#kana-cheer");
  if (!box) return;
  box.innerHTML = `
    <img src="${reactionUrl(reaction.image).replace(/"/g, "&quot;")}" alt="" />
    <div class="kana-cheer-text">${escapeHtml(reaction.text)}</div>
  `;
  box.classList.add("show");
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

export async function renderKana(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const game = await getGame();
  if (!isCurrent()) return;

  main.innerHTML = `
    <h1>Kana</h1>
    <div id="kana-body"></div>
  `;
  renderSelection(main.querySelector<HTMLDivElement>("#kana-body")!, game, main, isCurrent);
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
      Skip level 0 — I already know these shapes
    </label>
    <div class="kana-start-row">
      <button id="kana-start" disabled>Start</button>
      <span class="glosses" id="kana-start-note"></span>
    </div>
  `;

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
    const startAt = resuming && game ? Math.min(game.unlocked, LEVELS.length - 1) : skipLearn ? 1 : 0;
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
    // A different pool is a different game: the levels start over.
    const next: GameState =
      game && sameGroups(game.groups, chosen)
        ? { ...game, skipLearn }
        : { groups: [...chosen].sort(), unlocked: 0, health: MAX_HEALTH, skipLearn };
    if (skipLearn) next.unlocked = Math.max(next.unlocked, 1);
    await saveGame(next);
    void runLevel(body, next, Math.min(next.unlocked, LEVELS.length - 1), main, isCurrent);
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
  const cheer = await reactions();
  for (const reaction of [cheer.correct, cheer.wrong]) {
    new Image().src = reactionUrl(reaction.image);
  }

  const useLives = level >= 3;
  const timerSec = level === 4 ? 6 : level === 6 ? 10 : 0;
  const useChoices = level === 1;
  const learning = level === 0;

  let items: Item[];
  if (level >= 5) {
    body.innerHTML = `<div class="card-panel kana-quiz"><div class="glosses">Finding words made only of your kana…</div></div>`;
    const words = await wordsFor(pool);
    if (!isCurrent()) return;
    if (words === null || words.length < 5) {
      body.innerHTML = `
        <div class="card-panel kana-quiz">
          <div class="big">🔍</div>
          <div>Not enough short words can be written with only these kana.</div>
          <div class="glosses" style="margin-top:8px">Add more groups — the k, s and vowel rows open up the most words.</div>
          <div class="row-actions" style="justify-content:center;margin-top:12px">
            <button id="kana-back" class="secondary">Change groups</button>
          </div>
        </div>`;
      body.querySelector("#kana-back")!.addEventListener("click", () => renderSelection(body, game, main, isCurrent));
      return;
    }
    items = words;
  } else if (learning) {
    items = pool.map((entry) => ({ kana: entry.kana, entry }));
  } else {
    // Every kana at least twice, in random order.
    items = shuffle(pool.flatMap((entry) => [{ kana: entry.kana, entry }, { kana: entry.kana, entry }]));
  }

  const queue = learning ? [...items] : shuffle([...items]);
  let done = 0;
  let health = game.health;
  let missedAny = false;
  let active = true; // cleared on quit, so a pending auto-advance dies quietly
  let timer: ReturnType<typeof setInterval> | null = null;
  bestStreak = (await getMeta<number>(BEST_STREAK_KEY)) ?? bestStreak;

  const stopTimer = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const fail = async (): Promise<void> => {
    stopTimer();
    game.health = MAX_HEALTH; // a fresh attempt starts with fresh hearts
    await saveGame(game);
    if (!isCurrent()) return;
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">💔</div>
        <div class="kana-score">Out of hearts</div>
        <div class="glosses">Try level ${level} again with ${MAX_HEALTH} fresh hearts.</div>
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
    game.unlocked = Math.max(game.unlocked, level + 1);
    if (useLives) game.health = Math.min(MAX_HEALTH, health + 1);
    // Levels count towards the day's quests; the learn level is a stroll,
    // not a clear. The groups in play are reported too, so a quest can ask
    // for particular kana to have been practised.
    if (!learning) {
      void recordQuestEvents([
        "kana-level",
        ...(missedAny ? [] : ["kana-level-perfect"]),
        ...game.groups.map((id) => `group-cleared:${id}`),
      ]);
    }
    await saveGame(game);
    if (!isCurrent()) return;
    const next = level + 1 < LEVELS.length ? LEVELS[level + 1] : null;

    if (!next) {
      // The top of the ladder.
      body.innerHTML = `
        <div class="card-panel kana-quiz">
          <div class="big">🏆</div>
          <div class="kana-score">All seven levels clear</div>
          <div class="row-actions" style="justify-content:center;margin-top:12px">
            <button id="kana-again">Play again</button>
            <button id="kana-back" class="secondary">Change groups</button>
          </div>
        </div>`;
      body.querySelector("#kana-again")!.addEventListener("click", async () => {
        game.unlocked = game.skipLearn ? 1 : 0;
        game.health = MAX_HEALTH;
        await saveGame(game);
        void runLevel(body, game, game.unlocked, main, isCurrent);
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
          Next up — level ${level + 1}: ${next.name}…</div>
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
          <span class="glosses">Level ${level}: ${LEVELS[level].name}</span>
          <span>${streakHtml()} ${useLives ? heartsHtml(health) : ""}</span>
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
        <div class="row-actions" style="justify-content:center">
          <button id="kana-quit" class="ghost">Stop</button>
        </div>
      </div>
      <div class="kana-cheer" id="kana-cheer"></div>
    `;

    body.querySelector<HTMLButtonElement>("#kana-quit")!.addEventListener("click", () => {
      active = false;
      stopTimer();
      renderSelection(body, game, main, isCurrent);
    });

    const feedback = body.querySelector<HTMLDivElement>("#kana-feedback")!;
    let settled = false;

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
      streak++;
      if (streak > bestStreak) {
        bestStreak = streak;
        void setMeta(BEST_STREAK_KEY, bestStreak);
      }
      // Crossing 20 in a row is a quest-worthy moment, counted once per run.
      void recordQuestEvents(["kana-correct", ...(streak === 20 ? ["kana-streak-20"] : [])]);
      feedback.innerHTML = `<span class="ok-text">✓ ${escapeHtml(itemAnswer(item))}</span>
        <span class="kana-streak">🔥 ${streak}</span>`;
      showReaction(body, cheer.correct);
      void speak(item.kana, { rate: 0.8 }).catch(() => undefined);
      setTimeout(advance, 1100);
    };

    const miss = (label: string): void => {
      settled = true;
      stopTimer();
      streak = 0;
      missedAny = true;
      // Back into the deck: the level ends only when everything is right.
      queue.push(queue[0]);
      if (useLives) {
        health--;
        if (health <= 0) {
          feedback.innerHTML = `<span class="err-text">${label}</span>`;
          showReaction(body, cheer.wrong);
          void speak(item.kana, { rate: 0.8 }).catch(() => undefined);
          setTimeout(() => void fail(), 900);
          return;
        }
      }
      feedback.innerHTML = `<span class="err-text">${label}</span>
        <div class="glosses">Enter (or tap) to continue${useLives ? ` · ${"❤️".repeat(health)}` : ""}</div>`;
      showReaction(body, cheer.wrong);
      void speak(item.kana, { rate: 0.8 }).catch(() => undefined);
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
      void speak(item.kana, { rate: 0.8 }).catch(() => undefined);
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
            miss(`✗ ${escapeHtml(item.kana)} = <b>${escapeHtml(itemAnswer(item))}</b>`);
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
        else miss(`✗ ${escapeHtml(item.kana)} = <b>${escapeHtml(itemAnswer(item))}</b>`);
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
          miss(`⏰ Time! ${escapeHtml(item.kana)} = <b>${escapeHtml(itemAnswer(item))}</b>`);
        }
      }, 100);
    }
  };

  draw();
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

/**
 * Short common words written only with the chosen kana, with a short
 * English meaning each. Null when the dictionary cannot be loaded.
 */
async function wordsFor(pool: KanaEntry[]): Promise<Item[] | null> {
  const allowed = new Set(pool.flatMap((entry) => [...entry.kana]));
  let dictionary;
  try {
    dictionary = await loadDictionary();
  } catch {
    return null;
  }

  const best = new Map<string, { gloss: string; freq: number }>();
  for (const entry of dictionary.entries()) {
    const reading = entry.reading;
    if (reading.length < 2 || reading.length > 4) continue;
    if (![...reading].every((ch) => allowed.has(ch))) continue;
    const gloss = entry.glosses[0];
    if (!gloss || gloss.length > 42) continue;
    const freq = entry.freq ?? Number.MAX_SAFE_INTEGER;
    const existing = best.get(reading);
    if (!existing || freq < existing.freq) best.set(reading, { gloss, freq });
  }

  return [...best.entries()]
    .sort((a, b) => a[1].freq - b[1].freq)
    .slice(0, 14)
    .map(([kana, { gloss }]) => ({ kana, gloss }));
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
