import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { assetUrl } from "./store.js";
import { KANA_LEVELS, isCorrect, levelById, type KanaEntry, type KanaLevel } from "./kana-data.js";

/**
 * Learning the kana, level by level.
 *
 * Levels run in the order every textbook uses — vowels, then each row, then
 * voiced sounds, then combinations — separately for hiragana and katakana.
 * A level quizzes its own kana plus a sprinkling of everything already
 * learned, so old rows keep coming back.
 *
 * The quiz is keyboard-first: the kana is shown, the romaji is typed, Enter
 * answers. Every answer — right or wrong — is followed by the kana spoken
 * aloud, so the sound and the shape are learned together. Progress (each
 * level's best score) stays on the device.
 */

const PROGRESS_KEY = "kanaProgress";

type Progress = Record<string, number>;

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

async function getProgress(): Promise<Progress> {
  return (await getMeta<Progress>(PROGRESS_KEY)) ?? {};
}

export async function renderKana(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const progress = await getProgress();
  if (!isCurrent()) return;

  main.innerHTML = `
    <h1>Kana</h1>
    <p class="subtitle">The two syllabaries, one level at a time. Type the romaji; hear every answer.</p>
    <div id="kana-body"></div>
  `;
  renderLevels(main.querySelector<HTMLDivElement>("#kana-body")!, progress, main, isCurrent);
}

function renderLevels(
  body: HTMLDivElement,
  progress: Progress,
  main: HTMLElement,
  isCurrent: () => boolean,
): void {
  const section = (script: "hiragana" | "katakana", label: string): string => {
    const levels = KANA_LEVELS.filter((level) => level.script === script);
    const done = levels.filter((level) => (progress[level.id] ?? 0) >= 90).length;
    return `
      <h2 class="kana-script">${label} <span class="glosses">${done}/${levels.length} levels mastered</span></h2>
      <div class="kana-grid">
        ${levels
          .map((level, index) => {
            const best = progress[level.id] ?? 0;
            return `
              <button class="kana-level${best >= 90 ? " done" : ""}" data-level="${level.id}">
                <div class="kana-level-no">Level ${index + 1}</div>
                <div class="kana-level-kana" lang="ja">${level.entries.slice(0, 5).map((e) => e.kana).join(" ")}${
                  level.entries.length > 5 ? " …" : ""
                }</div>
                <div class="kana-level-title">${level.title}</div>
                <div class="kana-level-best">${best > 0 ? `best ${best}%` : "not tried yet"}</div>
              </button>`;
          })
          .join("")}
      </div>`;
  };

  body.innerHTML = section("hiragana", "Hiragana ひらがな") + section("katakana", "Katakana カタカナ");

  for (const button of body.querySelectorAll<HTMLButtonElement>(".kana-level")) {
    button.addEventListener("click", () => {
      const level = levelById(button.dataset.level!);
      if (level) void runQuiz(body, level, main, isCurrent);
    });
  }
}

/** The level's own kana once each, plus a few from the levels before it. */
async function questionsFor(level: KanaLevel): Promise<KanaEntry[]> {
  const progress = await getProgress();
  const earlier = KANA_LEVELS.filter(
    (other) =>
      other.script === level.script &&
      other.id !== level.id &&
      KANA_LEVELS.indexOf(other) < KANA_LEVELS.indexOf(level) &&
      (progress[other.id] ?? 0) > 0,
  ).flatMap((other) => other.entries);

  const review = shuffle(earlier).slice(0, Math.min(5, earlier.length));
  return shuffle([...level.entries, ...review]);
}

async function runQuiz(
  body: HTMLDivElement,
  level: KanaLevel,
  main: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  const questions = await questionsFor(level);
  const cheer = await reactions();
  // Warm the images so the first reaction pops instead of trickling in.
  for (const reaction of [cheer.correct, cheer.wrong]) {
    new Image().src = reactionUrl(reaction.image);
  }
  let at = 0;
  let firstTryCorrect = 0;

  const draw = (): void => {
    const entry = questions[at];
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="glosses">${level.title} · ${at + 1} / ${questions.length}</div>
        <div class="kana-big" lang="ja">${entry.kana}</div>
        <input type="text" id="kana-answer" autocomplete="off" autocapitalize="none"
          autocorrect="off" spellcheck="false" placeholder="type the romaji…" />
        <div class="kana-feedback" id="kana-feedback"></div>
        <div class="row-actions" style="justify-content:center">
          <button id="kana-quit" class="ghost">Back to levels</button>
        </div>
      </div>
      <div class="kana-cheer" id="kana-cheer"></div>
    `;
    const input = body.querySelector<HTMLInputElement>("#kana-answer")!;
    const feedback = body.querySelector<HTMLDivElement>("#kana-feedback")!;
    input.focus();

    let missed = false;
    let settled = false;

    const advance = (): void => {
      at++;
      if (at < questions.length) draw();
      else void finish();
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      if (settled) return advance(); // Enter again moves on after a miss
      const answer = input.value;
      if (!answer.trim()) return;

      if (isCorrect(entry, answer)) {
        if (!missed) firstTryCorrect++;
        feedback.innerHTML = `<span class="ok-text">✓ ${entry.romaji[0]}</span>`;
        input.disabled = true;
        settled = true;
        showReaction(body, cheer.correct);
        // The sound lands right on the answer, tying it to the shape.
        void speak(entry.kana, { rate: 0.8 }).catch(() => undefined);
        setTimeout(advance, 1100);
      } else {
        missed = true;
        settled = true;
        input.disabled = true;
        feedback.innerHTML = `<span class="err-text">✗ ${entry.kana} = <b>${entry.romaji[0]}</b></span>
          <div class="glosses">Enter (or tap) to continue</div>`;
        showReaction(body, cheer.wrong);
        void speak(entry.kana, { rate: 0.8 }).catch(() => undefined);
        // Keyboard focus must survive the disabled input — and the listeners
        // must attach only after this very keystroke has finished bubbling,
        // or the same Enter would advance right past the correction.
        const quiz = body.querySelector<HTMLDivElement>(".kana-quiz")!;
        quiz.tabIndex = -1;
        quiz.focus();
        setTimeout(() => {
          quiz.addEventListener("keydown", (e2) => {
            if (e2.key === "Enter") advance();
          });
          quiz.addEventListener("click", (e2) => {
            if (!(e2.target as HTMLElement).closest("#kana-quit")) advance();
          });
        }, 0);
      }
    });

    body.querySelector<HTMLButtonElement>("#kana-quit")!.addEventListener("click", async () => {
      renderLevels(body, await getProgress(), main, isCurrent);
    });
  };

  const finish = async (): Promise<void> => {
    const score = Math.round((firstTryCorrect / questions.length) * 100);
    const progress = await getProgress();
    const best = Math.max(progress[level.id] ?? 0, score);
    await setMeta(PROGRESS_KEY, { ...progress, [level.id]: best });
    if (!isCurrent()) return;

    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">${score >= 90 ? "🎉" : score >= 60 ? "💪" : "🌱"}</div>
        <div class="kana-score">${score}%</div>
        <div class="glosses">${firstTryCorrect} of ${questions.length} first try${
          best > score ? ` · best ${best}%` : score >= 90 ? " · mastered" : ""
        }</div>
        <div class="row-actions" style="justify-content:center">
          <button id="kana-retry">Try again</button>
          <button id="kana-back" class="secondary">Back to levels</button>
        </div>
      </div>
    `;
    body.querySelector<HTMLButtonElement>("#kana-retry")!.addEventListener("click", () => {
      void runQuiz(body, level, main, isCurrent);
    });
    body.querySelector<HTMLButtonElement>("#kana-back")!.addEventListener("click", async () => {
      renderLevels(body, await getProgress(), main, isCurrent);
    });
  };

  draw();
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
