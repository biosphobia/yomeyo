import { KANA_GROUPS, isCorrect, type KanaEntry } from "./kana-data.js";
import { createSfx } from "./gacha-audio.js";
import { mountExamStage, type ExamStage } from "./kana-exam-stage.js";
import { startGameSession } from "./kana-stats.js";
import { recordQuestEvent, recordQuestEvents } from "./quests.js";
import { unlockAchievement } from "./achievements.js";
import { earnYennies } from "./yennies.js";
import { assetUrl } from "./store.js";
import { toast } from "./toast.js";

/**
 * The hiragana exam, in three phases, with a giant Yuuri closing in for
 * all of them.
 *
 * Phase 1 is every single hiragana with a sound of its own, on foot.
 * Phase 2 is whole words — Chito has found the kettenkrad, and typing a
 * word buys the fuel, so to speak. Phase 3 is a short mixed sprint on a
 * slightly meaner clock. Survive all three and the kettenkrad's own gun
 * gets ten seconds and one shot.
 *
 * Four lives across the whole thing. The chase on the stage is the health
 * bar; the stage also keeps itself interesting with procedural events the
 * whole way through, none of which touch the questions.
 */

const LIVES = 4;
/** Seconds on the clock, by what is being asked. */
const CLOCK = {
  kana: 7,
  word: 10,
  finalKana: 6,
  finalWord: 8.5,
};
/** Seconds to fire the mounted gun at the end. */
const FINALE_SECONDS = 10;
const REWARD = 300;

interface ExamItem {
  kind: "kana" | "word";
  kana: string;
  romaji: string[];
  seconds: number;
}

/** Every hiragana with a sound of its own: rows 1-15. The small tsu has no
 * sound to answer with, so it stays in its word drills. */
function kanaPool(): KanaEntry[] {
  return KANA_GROUPS.filter((group) => group.script === "hiragana" && group.id !== "hiragana-16").flatMap(
    (group) => group.entries,
  );
}

/**
 * The words of phase 2, hand-picked from the rows the week taught: short,
 * common, and heavy on the world the two of them live in — snow, night,
 * food. Alternate spellings are written out rather than derived, so し in
 * a word takes shi and si the same as it does alone.
 */
const WORDS: [kana: string, ...romaji: string[]][] = [
  ["ねこ", "neko"],
  ["いぬ", "inu"],
  ["みず", "mizu"],
  ["ゆき", "yuki"],
  ["そら", "sora"],
  ["ほし", "hoshi", "hosi"],
  ["さかな", "sakana"],
  ["たまご", "tamago"],
  ["やま", "yama"],
  ["かわ", "kawa"],
  ["つき", "tsuki", "tuki"],
  ["はな", "hana"],
  ["くも", "kumo"],
  ["あめ", "ame"],
  ["よる", "yoru"],
  ["ふゆ", "fuyu"],
  ["おちゃ", "ocha", "otya", "ocya"],
  ["りんご", "ringo"],
];

/** The final phase's word half: a few more, no repeats from phase 2. */
const FINAL_WORDS: [kana: string, ...romaji: string[]][] = [
  ["ごはん", "gohan"],
  ["へや", "heya"],
  ["ちず", "chizu", "tizu"],
  ["じかん", "jikan", "zikan"],
  ["ぱん", "pan"],
  ["ひる", "hiru"],
];

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The three phases' question lists, built fresh for every run. */
function buildPhases(): ExamItem[][] {
  const kana = shuffled(kanaPool());
  const phase1: ExamItem[] = kana.map((entry) => ({
    kind: "kana",
    kana: entry.kana,
    romaji: entry.romaji,
    seconds: CLOCK.kana,
  }));
  const phase2: ExamItem[] = shuffled(WORDS).map(([kana_, ...romaji]) => ({
    kind: "word",
    kana: kana_,
    romaji,
    seconds: CLOCK.word,
  }));
  const phase3: ExamItem[] = shuffled([
    ...shuffled(kanaPool())
      .slice(0, 6)
      .map(
        (entry): ExamItem => ({
          kind: "kana",
          kana: entry.kana,
          romaji: entry.romaji,
          seconds: CLOCK.finalKana,
        }),
      ),
    ...shuffled(FINAL_WORDS).map(
      ([kana_, ...romaji]): ExamItem => ({ kind: "word", kana: kana_, romaji, seconds: CLOCK.finalWord }),
    ),
  ]);
  return [phase1, phase2, phase3];
}

// ---------------- music ----------------

interface Theme {
  duck(): void;
  stop(): void;
}

/**
 * The exam's theme, on loop, for the whole run.
 *
 * A real track this time, streamed when the exam starts (it is ten
 * megabytes, so it is nobody's precache). If it cannot play — offline on a
 * first visit, an autoplay refusal — the exam runs to its own drums: the
 * stage's sound effects carry it.
 */
function startTheme(): Theme {
  const audio = new Audio(assetUrl("audio/exam-theme.mp3"));
  audio.loop = true;
  audio.volume = 0.55;
  void audio.play().catch(() => undefined);
  return {
    duck() {
      // Under the dream, the war music has no business being loud.
      const fade = (): void => {
        if (audio.volume > 0.14) {
          audio.volume = Math.max(0.12, audio.volume - 0.04);
          window.setTimeout(fade, 90);
        }
      };
      fade();
    },
    stop() {
      const fade = (): void => {
        if (audio.volume > 0.05) {
          audio.volume = Math.max(0, audio.volume - 0.08);
          window.setTimeout(fade, 60);
        } else {
          audio.pause();
          audio.src = "";
        }
      };
      fade();
    },
  };
}

// ---------------- the exam ----------------

/**
 * Run the exam inside `main`. Calls `onExit` when the learner leaves the
 * results screen, however it went.
 */
export async function runHiraganaExam(main: HTMLElement, onExit: () => void): Promise<void> {
  const phases = buildPhases();
  const total = phases.reduce((sum, phase) => sum + phase.length, 0);
  const sfx = createSfx();
  const theme = startTheme();
  const session = startGameSession({
    level: 100, // the exam's own number, past every playable level
    groups: KANA_GROUPS.filter((g) => g.script === "hiragana").map((g) => g.id),
    poolSize: total,
    words: false,
  });

  main.innerHTML = `
    <div class="kana-exam">
      <div class="exam-chase" id="exam-chase"></div>
      <div class="exam-hud">
        <span id="exam-lives" class="exam-lives"></span>
        <div class="exam-phases" id="exam-phases" aria-label="Progress through the three phases">
          ${[0, 1, 2].map((n) => `<div class="exam-phase-bar" data-phase="${n}"><i></i></div>`).join("")}
        </div>
        <span id="exam-count" class="glosses"></span>
      </div>
      <div class="exam-timer"><div class="exam-timer-fill" id="exam-fuse"></div></div>
      <div class="card-panel exam-card" id="exam-card">
        <div class="exam-kana" id="exam-kana" lang="ja"></div>
        <input id="exam-input" type="text" autocomplete="off" autocapitalize="none"
          spellcheck="false" enterkeyhint="go" placeholder="romaji" aria-label="Type the romaji" />
        <div class="glosses" id="exam-note"></div>
      </div>
      <div class="row-actions" style="justify-content:center">
        <button id="exam-flee" class="ghost">Give up</button>
      </div>
    </div>
  `;

  const stage: ExamStage = await mountExamStage(main.querySelector<HTMLElement>("#exam-chase")!);
  const card = main.querySelector<HTMLDivElement>("#exam-card")!;
  const kanaEl = main.querySelector<HTMLDivElement>("#exam-kana")!;
  const input = main.querySelector<HTMLInputElement>("#exam-input")!;
  const fuse = main.querySelector<HTMLDivElement>("#exam-fuse")!;
  const livesEl = main.querySelector<HTMLElement>("#exam-lives")!;
  const phaseBars = [...main.querySelectorAll<HTMLElement>(".exam-phase-bar")];
  const countEl = main.querySelector<HTMLElement>("#exam-count")!;
  // Each bar's width says how much of the run that phase is.
  phaseBars.forEach((bar, n) => bar.style.setProperty("--w", String(phases[n].length)));
  const note = main.querySelector<HTMLDivElement>("#exam-note")!;

  let phaseAt = 0;
  let at = 0; // within the current phase
  let answered = 0;
  let lives = LIVES;
  let correct = 0;
  let over = false;
  let fuseTimer = 0;
  const startedAt = Date.now();

  const cleanup = (): void => {
    over = true;
    clearTimeout(fuseTimer);
    theme.stop();
    sfx.stop();
    stage.stop();
  };

  const current = (): ExamItem => phases[phaseAt][at];

  const drawHud = (): void => {
    livesEl.textContent = "❤️".repeat(lives) + "🖤".repeat(LIVES - lives);
    // One bar per phase: the ones behind you full, the one you are in
    // filling, the ones ahead empty.
    phaseBars.forEach((bar, n) => {
      const fill = bar.querySelector<HTMLElement>("i")!;
      const fraction = n < phaseAt ? 1 : n > phaseAt ? 0 : at / phases[n].length;
      fill.style.width = `${Math.round(fraction * 100)}%`;
      bar.classList.toggle("live", n === phaseAt);
    });
    countEl.textContent = `${answered} / ${total}`;
    stage.gap(lives / LIVES);
  };

  /** One item on the card, and the clock lit under it. */
  const ask = (): void => {
    if (over) return;
    const item = current();
    kanaEl.textContent = item.kana;
    kanaEl.classList.toggle("word", item.kind === "word");
    input.value = "";
    input.focus();
    fuse.style.transition = "none";
    fuse.style.width = "100%";
    requestAnimationFrame(() => {
      fuse.style.transition = `width ${item.seconds}s linear`;
      fuse.style.width = "0%";
    });
    clearTimeout(fuseTimer);
    fuseTimer = window.setTimeout(() => miss(true), item.seconds * 1000);
  };

  const advance = async (): Promise<void> => {
    at++;
    answered = phases.slice(0, phaseAt).reduce((sum, phase) => sum + phase.length, 0) + at;
    if (at >= phases[phaseAt].length) {
      if (phaseAt === 2) {
        void finale();
        return;
      }
      // Phase change: the stage plays its film (the kettenkrad, or the
      // last stretch) and the questions wait for it.
      phaseAt++;
      at = 0;
      drawHud();
      clearTimeout(fuseTimer);
      fuse.style.transition = "none";
      fuse.style.width = "100%";
      input.value = "";
      note.textContent = "";
      await stage.phase((phaseAt + 1) as 2 | 3);
      if (over) return;
      ask();
      return;
    }
    drawHud();
    ask();
  };

  const hit = (): void => {
    if (over) return;
    clearTimeout(fuseTimer);
    const item = current();
    correct++;
    if (item.kind === "kana") session.answer(item.kana, { correct: true });
    void recordQuestEvent("kana-correct");
    sfx.ping();
    stage.burst();
    void advance();
  };

  const miss = (timeout: boolean): void => {
    if (over) return;
    clearTimeout(fuseTimer);
    const item = current();
    if (item.kind === "kana") {
      session.answer(item.kana, { correct: false, timeout, mistake: timeout ? undefined : input.value.trim() });
    }
    lives--;
    sfx.thud();
    sfx.growl();
    stage.lunge();
    note.textContent = `${item.kana} is “${item.romaji[0]}”.`;
    if (lives <= 0) {
      void lose(`${answered} of ${total} answered before she got you.`);
      return;
    }
    void advance();
  };

  input.addEventListener("input", () => {
    if (over) return;
    if (isCorrect({ kana: current().kana, romaji: current().romaji }, input.value)) hit();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || over) return;
    if (!isCorrect({ kana: current().kana, romaji: current().romaji }, input.value)) miss(false);
  });

  main.querySelector<HTMLButtonElement>("#exam-flee")!.addEventListener("click", () => {
    session.end("quit");
    cleanup();
    onExit();
  });

  // ---------------- the gun, and the endings ----------------

  /**
   * All questions survived: Yuuri makes her final approach, and the only
   * control left is the trigger. Ten seconds, one button.
   */
  const finale = async (): Promise<void> => {
    clearTimeout(fuseTimer);
    drawHud();
    stage.finale(FINALE_SECONDS);
    card.innerHTML = `
      <div class="exam-kana" style="font-size:1.6rem;min-height:48px">She's coming.</div>
      <button id="exam-fire" class="exam-fire">🔥 FIRE — <span id="exam-fire-count">${FINALE_SECONDS}</span></button>
    `;
    let left = FINALE_SECONDS;
    const counter = card.querySelector<HTMLElement>("#exam-fire-count")!;
    const countdown = window.setInterval(() => {
      if (over) {
        clearInterval(countdown);
        return;
      }
      left--;
      counter.textContent = String(Math.max(0, left));
      sfx.ping();
      if (left <= 0) {
        clearInterval(countdown);
        void lose("The tank was right there. She was faster.");
      }
    }, 1000);
    card.querySelector<HTMLButtonElement>("#exam-fire")!.addEventListener("click", async () => {
      if (over) return;
      clearInterval(countdown);
      over = true; // no more inputs count; the film has the stage
      session.end("cleared");
      theme.duck();
      await recordQuestEvents(["hiragana-exam"]);
      void unlockAchievement("hiragana-exam");
      await earnYennies(REWARD);
      toast(`Hiragana exam passed! +${REWARD} ¥`);
      card.innerHTML = `<div class="glosses" style="min-height:120px;padding-top:40px">— watch —</div>`;
      await stage.fire();
      if (!main.isConnected) return;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      card.innerHTML = `
        <div class="exam-verdict">🎓 PASSED</div>
        <div class="glosses">Every hiragana, whole words, and one shell. ${correct} of ${total} first
          time, ${Math.floor(seconds / 60)}m ${seconds % 60}s, ${lives} ${lives === 1 ? "life" : "lives"} to spare.</div>
        <div class="glosses" style="margin-top:6px">+${REWARD} ¥. Something small and metal is in your pocket now.</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="exam-done">Done</button>
        </div>`;
      card.querySelector<HTMLButtonElement>("#exam-done")!.addEventListener("click", () => {
        cleanup();
        onExit();
      });
    });
  };

  /** Caught — by running out of lives, or by hesitating at the trigger. */
  const lose = async (line: string): Promise<void> => {
    over = true;
    clearTimeout(fuseTimer);
    input.disabled = true;
    session.end("failed");
    await stage.caught();
    if (!main.isConnected) return;
    card.innerHTML = `
      <div class="exam-verdict caught">CAUGHT</div>
      <div class="glosses">${line} The exam is here whenever you want another run.</div>
      <div class="row-actions" style="justify-content:center;margin-top:12px">
        <button id="exam-retry">Run again</button>
        <button id="exam-done" class="secondary">Done</button>
      </div>`;
    card.querySelector<HTMLButtonElement>("#exam-retry")!.addEventListener("click", () => {
      cleanup();
      void runHiraganaExam(main, onExit);
    });
    card.querySelector<HTMLButtonElement>("#exam-done")!.addEventListener("click", () => {
      cleanup();
      onExit();
    });
  };

  drawHud();
  sfx.menace(1.2);
  window.setTimeout(() => {
    if (!over) ask();
  }, 1300);
}
