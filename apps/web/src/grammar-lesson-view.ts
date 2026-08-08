import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { cheerBox, preloadReactions, showReaction } from "./feedback.js";
import { PER_CORRECT, earnYennies, formatYennies, yennies } from "./yennies.js";
import { LESSONS, type LessonVisual } from "./grammar-lessons.js";
import { GRAMMAR_UNITS } from "./grammar-data.js";
import { runUnit } from "./grammar-practice.js";
import { renderRecipes } from "./grammar-recipes.js";

/**
 * The Course: the grammar curriculum as chapters, each read, drilled and
 * tested in one flow.
 *
 * Reading and drilling used to live in separate tabs teaching overlapping
 * material in different orders. Now every chapter is one thing: a calm
 * page of sections and spoken examples, then — where a drill unit exists
 * for exactly this material — a "drill it" run of the sentence-dissection
 * tasks, then a short test. The drill units attach to the chapters that
 * teach their content: が gets the smallest sentences, は gets the unsaid
 * doer, を gets doing-something-to-something, and so on. Chapters without
 * a matching unit (the sentence-enders, verb conjugation — which the
 * playground drills better) go read → test.
 *
 * Nothing is locked: a reference you cannot open is a reference you stop
 * using. A chapter counts as done when its test is passed AND its drill
 * (if it has one) has been cleared at least once.
 */

const DONE_KEY = "grammarLessonsDone";
const UNITS_DONE_KEY = "grammarUnitsDone";
/** The old Practice tab's save, read once to carry progress across. */
const OLD_GAME_KEY = "grammarGame";
const ROMAJI_KEY = "grammarRomaji";

/** Best test score per chapter index, as a percent. */
type Progress = Record<number, number>;

const PASS = 80;

/**
 * Which drill unit belongs to which chapter (both zero-based). A unit sits
 * with the chapter that finishes teaching its material — the に/で/へ unit
 * waits for で's chapter, the joining unit for the て form.
 */
const UNIT_FOR: Record<number, number> = {
  2: 0, // が — the smallest sentences
  3: 1, // は — when nobody says who
  4: 2, // を — doing something to something
  6: 3, // で (after に/へ) — where and how
  10: 4, // から・まで — from and until
  13: 7, // て form — joining two sentences
  14: 5, // adjectives — describing words
  16: 6, // reading between the lines — describing with a whole sentence
};

let openLesson: number | null = null;

async function unitsDone(): Promise<Set<number>> {
  const stored = await getMeta<number[]>(UNITS_DONE_KEY);
  if (stored) return new Set(stored);
  // First visit since the tabs merged: whatever the old Practice tab had
  // cleared counts as cleared here.
  const old = await getMeta<{ unlocked?: number }>(OLD_GAME_KEY);
  const carried = new Set<number>();
  for (let i = 0; i < (old?.unlocked ?? 0); i++) carried.add(i);
  await setMeta(UNITS_DONE_KEY, [...carried]);
  return carried;
}

export async function renderLessons(body: HTMLDivElement, isCurrent: () => boolean = () => true): Promise<void> {
  const progress = (await getMeta<Progress>(DONE_KEY)) ?? {};
  const drilled = await unitsDone();
  if (!isCurrent() || !body.isConnected) return;
  if (openLesson !== null && LESSONS[openLesson]) {
    await drawLesson(body, openLesson, progress, drilled, isCurrent);
  } else {
    drawList(body, progress, drilled, isCurrent);
  }
}

/** Done = test passed, and the drill (where there is one) cleared. */
function chapterDone(index: number, progress: Progress, drilled: Set<number>): boolean {
  const testPassed = (progress[index] ?? 0) >= PASS;
  const unit = UNIT_FOR[index];
  return testPassed && (unit === undefined || drilled.has(unit));
}

// ---------------- the chapter list ----------------

function drawList(body: HTMLDivElement, progress: Progress, drilled: Set<number>, isCurrent: () => boolean): void {
  const passed = LESSONS.filter((_, i) => chapterDone(i, progress, drilled)).length;
  const firstOpen = LESSONS.findIndex((_, i) => !chapterDone(i, progress, drilled));
  body.innerHTML = `
    <div class="lesson-course-head">
      <div><b>The course</b><span class="glosses"> · read, drill, test — chapter by chapter</span></div>
      <span class="glosses">${passed} / ${LESSONS.length} done</span>
    </div>
    <div class="kana-bar" style="margin-bottom:14px"><div class="kana-bar-fill" style="width:${Math.round(
      (passed / LESSONS.length) * 100,
    )}%"></div></div>
    <div id="lesson-list"></div>
  `;
  const list = body.querySelector<HTMLDivElement>("#lesson-list")!;
  LESSONS.forEach((lesson, index) => {
    const done = chapterDone(index, progress, drilled);
    const best = progress[index] ?? 0;
    const unit = UNIT_FOR[index];
    const marks = [
      best > 0 ? `🏅 ${best}%` : "",
      unit !== undefined ? (drilled.has(unit) ? "🎯 drilled" : "🎯 drill waiting") : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const panel = document.createElement("div");
    panel.className = `card-panel lesson-row${done ? " done" : ""}${index === firstOpen ? " next" : ""}`;
    panel.innerHTML = `
      <div class="lesson-row-main">
        <div class="lesson-row-num">${done ? "✓" : index + 1}</div>
        <div>
          <div class="lesson-row-title">${escapeHtml(lesson.title)}</div>
          <div class="glosses">${escapeHtml(lesson.tagline)}</div>
          ${marks ? `<div class="glosses lesson-row-marks">${marks}</div>` : ""}
        </div>
      </div>
      <button class="${done ? "secondary" : ""}">${done ? "Again" : "Open"}</button>
    `;
    panel.querySelector("button")!.addEventListener("click", () => {
      openLesson = index;
      void drawLesson(body, index, progress, drilled, isCurrent);
    });
    list.appendChild(panel);
  });
}

// ---------------- one chapter ----------------

async function drawLesson(
  body: HTMLDivElement,
  index: number,
  progress: Progress,
  drilled: Set<number>,
  isCurrent: () => boolean,
): Promise<void> {
  const lesson = LESSONS[index];
  const unitIndex = UNIT_FOR[index];
  const unit = unitIndex !== undefined ? GRAMMAR_UNITS[unitIndex] : null;
  const romaji = (await getMeta<boolean>(ROMAJI_KEY)) ?? true;
  window.scrollTo({ top: 0 });
  body.innerHTML = `
    <button class="ghost lesson-back" id="lesson-back">← All chapters</button>
    <div class="lesson-head">
      <div class="glosses">Chapter ${index + 1} of ${LESSONS.length}</div>
      <h2>${escapeHtml(lesson.title)}</h2>
      <div class="glosses">${escapeHtml(lesson.tagline)}</div>
    </div>
    ${lesson.sections
      .map(
        (section) => `
      <div class="card-panel lesson-section">
        <h3>${escapeHtml(section.heading)}</h3>
        ${bodyHtml(section.body)}
        ${section.visual ? visualHtml(section.visual) : ""}
        ${(section.examples ?? [])
          .map(
            (ex) => `
          <div class="lesson-example" data-say="${escapeHtml(spokenOf(ex.jp))}">
            <button class="speaker" title="Say it" aria-label="Say it">🔊</button>
            <div>
              <div class="lesson-example-jp" lang="ja">${escapeHtml(ex.jp)}</div>
              <div class="lesson-example-r">${escapeHtml(ex.r)}</div>
              <div class="glosses">${escapeHtml(ex.en)}</div>
            </div>
          </div>`,
          )
          .join("")}
        ${section.recipes ? `<div class="rc-embed" id="lesson-recipes"></div>` : ""}
      </div>`,
      )
      .join("")}
    <div class="card-panel lesson-test-cta">
      <b>Put it to work</b>
      ${
        unit
          ? `<div class="glosses">First drill it on real sentences — ${escapeHtml(unit.tagline)}</div>
             <label class="unseen-toggle" style="justify-content:center;margin:6px 0">
               <input type="checkbox" id="lesson-romaji" ${romaji ? "checked" : ""} /> Show romaji
             </label>
             <div class="row-actions" style="justify-content:center">
               <button id="lesson-drill">${drilled.has(unitIndex!) ? "🎯 Drill it again" : "🎯 Drill it"}</button>
             </div>
             <div class="glosses" style="margin:4px 0 8px">${drilled.has(unitIndex!) ? "Drilled ✓" : ""}</div>`
          : `<div class="glosses">This chapter drills best in the Playground and the test below.</div>`
      }
      <div class="glosses">${lesson.quiz.length} quick questions on what you just read.
        ${progress[index] !== undefined ? ` Best so far: ${progress[index]}%.` : ""}</div>
      <div class="row-actions" style="justify-content:center;margin-top:6px">
        <button id="lesson-test" class="${unit && !drilled.has(unitIndex!) ? "secondary" : ""}">🏅 Take the test</button>
      </div>
    </div>
  `;

  body.querySelector("#lesson-back")!.addEventListener("click", () => {
    openLesson = null;
    void renderLessons(body, isCurrent);
  });
  const recipesHost = body.querySelector<HTMLDivElement>("#lesson-recipes");
  if (recipesHost) void renderRecipes(recipesHost, { only: ["be"] });
  for (const row of body.querySelectorAll<HTMLElement>(".lesson-example")) {
    row.querySelector(".speaker")!.addEventListener("click", () => {
      void speak(row.dataset.say ?? "", { rate: 0.85 }).catch(() => undefined);
    });
  }
  for (const unit of body.querySelectorAll<HTMLElement>(".lesson-visual [data-say]")) {
    unit.addEventListener("click", () => {
      void speak(unit.dataset.say ?? "", { rate: 0.8 }).catch(() => undefined);
    });
  }
  body.querySelector<HTMLInputElement>("#lesson-romaji")?.addEventListener("change", (ev) => {
    void setMeta(ROMAJI_KEY, (ev.target as HTMLInputElement).checked);
  });
  body.querySelector("#lesson-drill")?.addEventListener("click", async () => {
    void preloadReactions();
    const showRomaji = (await getMeta<boolean>(ROMAJI_KEY)) ?? true;
    void runUnit(body, unitIndex!, showRomaji, isCurrent, {
      continueLabel: "Back to the chapter",
      onCleared: async () => {
        drilled.add(unitIndex!);
        await setMeta(UNITS_DONE_KEY, [...drilled]);
      },
      onExit: () => {
        void drawLesson(body, index, progress, drilled, isCurrent);
      },
    });
  });
  body.querySelector("#lesson-test")!.addEventListener("click", () => {
    void preloadReactions();
    runQuiz(body, index, progress, drilled, isCurrent);
  });
}

/** The bit of an example line worth reading out loud: the Japanese only. */
function spokenOf(jp: string): string {
  return jp.replace(/\s+/g, "");
}

// ---------------- drawn figures ----------------

const STICKER_CLASS: Record<string, string> = {
  は: "stk-wa",
  が: "stk-ga",
  を: "stk-wo",
  に: "stk-ni",
  で: "stk-de",
  へ: "stk-ni",
};

/** Particles beyond the core five still get a stable colour of their own. */
const TAG_FALLBACK = ["stk-wa", "stk-ga", "stk-wo", "stk-ni", "stk-de"];

function tagClass(particle: string): string {
  const hash = [...particle].reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0);
  return STICKER_CLASS[particle] ?? TAG_FALLBACK[hash % TAG_FALLBACK.length];
}

/** What to say for a bare particle: the sound, not the spelling. */
const SPOKEN_TAG: Record<string, string> = { は: "わ", を: "お", へ: "え" };

/** A word tile with its particle stuck on the back. Tap to hear the pair. */
function stickerUnit(word: string, gloss: string, particle: string): string {
  return `
    <button class="stk" type="button" data-say="${escapeHtml(word + particle)}">
      <span class="stk-word" lang="ja">${escapeHtml(word)}<span class="stk-gloss">${escapeHtml(gloss)}</span></span>
      <span class="stk-tag ${tagClass(particle)}" lang="ja">${escapeHtml(particle)}</span>
    </button>`;
}

/**
 * The figures a section can carry, all drawn from data in CSS: word tiles
 * with sticker tags peeling off their back edge, sticker sheets, and words
 * changing shape with arrows between. Everything is tappable to hear.
 */
function visualHtml(visual: LessonVisual): string {
  switch (visual.kind) {
    case "stickers": {
      const units = visual.items.map(([word, gloss, particle]) => stickerUnit(word, gloss, particle));
      if (visual.final) {
        const [word, gloss] = visual.final;
        units.push(`
          <button class="stk stk-final" type="button" data-say="${escapeHtml(word)}">
            <span class="stk-word" lang="ja">${escapeHtml(word)}<span class="stk-gloss">${escapeHtml(gloss)}</span></span>
            ${visual.finalBadge ? `<span class="lv-badge">${escapeHtml(visual.finalBadge)}</span>` : ""}
          </button>`);
      }
      return `
        <div class="lesson-visual">${units.join("")}</div>
        ${visual.caption ? `<div class="lv-caption">${escapeHtml(visual.caption)}</div>` : ""}`;
    }
    case "tags":
      return `
        <div class="lesson-visual lv-five">
          ${visual.items
            .map(
              ([particle, job, said]) => `
            <button class="lv-p" type="button" data-say="${escapeHtml(SPOKEN_TAG[particle] ?? particle)}">
              <span class="stk-tag ${tagClass(particle)}" lang="ja">${escapeHtml(particle)}</span>
              <span class="lv-p-cap">${escapeHtml(job)}</span>
              <span class="lv-p-said">"${escapeHtml(said)}"</span>
            </button>`,
            )
            .join("")}
        </div>`;
    case "morph":
      return `
        <div class="lesson-visual lv-morph">
          ${visual.steps
            .map(
              ([jp, label], i) => `
            ${i > 0 ? `<span class="lv-arrow">→</span>` : ""}
            <button class="stk" type="button" data-say="${escapeHtml(jp)}">
              <span class="stk-word" lang="ja">${escapeHtml(jp)}<span class="stk-gloss">${escapeHtml(label)}</span></span>
            </button>`,
            )
            .join("")}
        </div>
        ${visual.caption ? `<div class="lv-caption">${escapeHtml(visual.caption)}</div>` : ""}`;
  }
}

/**
 * A lesson body, laid out: blank lines split paragraphs, single newlines
 * become line breaks, so a body can hold a short list without a wall of
 * text. The {x} and {y} tokens become the coloured slot letters, matching
 * the blocks in the live pattern below.
 */
function bodyHtml(body: string): string {
  return body
    .split(/\n\n+/)
    .map(
      (para) =>
        `<p>${escapeHtml(para)
          .replace(/\n/g, "<br>")
          .replace(/\{x\}/g, '<span class="rc-x">X</span>')
          .replace(/\{y\}/g, '<span class="rc-y">Y</span>')
          .replace(/\{x:([^}]+)\}/g, '<span class="rc-x" lang="ja">$1</span>')
          .replace(/\{y:([^}]+)\}/g, '<span class="rc-y" lang="ja">$1</span>')}</p>`,
    )
    .join("");
}

// ---------------- the test ----------------

function runQuiz(
  body: HTMLDivElement,
  index: number,
  progress: Progress,
  drilled: Set<number>,
  isCurrent: () => boolean,
): void {
  const lesson = LESSONS[index];
  const queue = shuffle([...lesson.quiz]);
  const total = queue.length;
  let at = 0;
  let right = 0;

  const backToLesson = (): void => void drawLesson(body, index, progress, drilled, isCurrent);

  const finish = async (): Promise<void> => {
    const score = Math.round((right / total) * 100);
    const passed = score >= PASS;
    const best = Math.max(progress[index] ?? 0, score);
    progress[index] = best;
    await setMeta(DONE_KEY, progress);
    if (passed) {
      const { unlockAchievement } = await import("./achievements.js");
      void unlockAchievement("first-chapter");
    }
    const earned = right * PER_CORRECT;
    const balance = earned > 0 ? await earnYennies(earned) : await yennies();
    if (!isCurrent() || !body.isConnected) return;
    const next = index + 1 < LESSONS.length ? LESSONS[index + 1] : null;
    const unit = UNIT_FOR[index];
    const drillWaiting = passed && unit !== undefined && !drilled.has(unit);
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">${passed ? "🎉" : "📖"}</div>
        <div class="kana-score">${right} / ${total}</div>
        <div class="glosses">${
          passed
            ? drillWaiting
              ? `Passed — now drill it on real sentences to finish the chapter.`
              : `Passed — ${escapeHtml(lesson.title)} is yours.`
            : `Not quite — ${PASS}% passes. The chapter is one tap away.`
        }</div>
        <div class="yen-line">${earned > 0 ? `<b>+${earned.toLocaleString()}</b> · ` : ""}${formatYennies(balance)}</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          ${drillWaiting ? `<button id="lq-drill">🎯 Drill it now</button>` : ""}
          ${passed && !drillWaiting && next ? `<button id="lq-next">Next: ${escapeHtml(next.title)}</button>` : ""}
          ${passed ? "" : `<button id="lq-reread">Read it again</button>`}
          <button id="lq-retry" class="secondary">Retake the test</button>
          <button id="lq-list" class="ghost">All chapters</button>
        </div>
      </div>`;
    body.querySelector("#lq-drill")?.addEventListener("click", async () => {
      const showRomaji = (await getMeta<boolean>(ROMAJI_KEY)) ?? true;
      void runUnit(body, unit!, showRomaji, isCurrent, {
        continueLabel: "Back to the chapter",
        onCleared: async () => {
          drilled.add(unit!);
          await setMeta(UNITS_DONE_KEY, [...drilled]);
        },
        onExit: backToLesson,
      });
    });
    body.querySelector("#lq-next")?.addEventListener("click", () => {
      openLesson = index + 1;
      void drawLesson(body, index + 1, progress, drilled, isCurrent);
    });
    body.querySelector("#lq-reread")?.addEventListener("click", backToLesson);
    body.querySelector("#lq-retry")!.addEventListener("click", () => runQuiz(body, index, progress, drilled, isCurrent));
    body.querySelector("#lq-list")!.addEventListener("click", () => {
      openLesson = null;
      void renderLessons(body, isCurrent);
    });
  };

  const draw = (): void => {
    const question = queue[at];
    const percent = Math.round((at / total) * 100);
    body.innerHTML = `
      <div class="card-panel kana-quiz gram-quiz">
        <div class="kana-quiz-top">
          <button id="lq-quit" class="quiz-stop" title="Stop" aria-label="Stop">✕</button>
          <span class="glosses">${escapeHtml(lesson.title)} — test</span>
          <span class="glosses">${at}/${total}</span>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${percent}%"></div></div>
        <div class="gram-prompt">${escapeHtml(question.q)}</div>
        ${question.jp ? `<div class="lesson-quiz-jp" lang="ja">${escapeHtml(question.jp)}</div>` : ""}
        <div class="gram-options lesson-quiz-options">
          ${question.choices.map((c, i) => `<button data-i="${i}">${escapeHtml(c)}</button>`).join("")}
        </div>
        <div class="kana-feedback" id="lq-feedback"></div>
      </div>
      ${cheerBox("lq-cheer")}
    `;
    body.querySelector("#lq-quit")!.addEventListener("click", backToLesson);
    const feedback = body.querySelector<HTMLDivElement>("#lq-feedback")!;
    let settled = false;

    for (const button of body.querySelectorAll<HTMLButtonElement>(".lesson-quiz-options button")) {
      button.addEventListener("click", () => {
        if (settled) return;
        settled = true;
        const picked = Number(button.dataset.i);
        const good = picked === question.answer;
        if (good) right++;
        for (const b of body.querySelectorAll<HTMLButtonElement>(".lesson-quiz-options button")) {
          const i = Number(b.dataset.i);
          b.classList.toggle("is-answer", i === question.answer);
          b.classList.toggle("is-wrong", i === picked && !good);
          b.disabled = true;
        }
        feedback.innerHTML = `${
          good ? `<span class="ok-text">✓</span>` : `<span class="err-text">✗</span>`
        } <span class="glosses">${escapeHtml(question.why)}</span>
          <div class="glosses">Enter (or tap) to continue</div>`;
        void showReaction(body.querySelector("#lq-cheer"), good ? "correct" : "wrong");
        // A line with a gap in it would be read out with the answer missing,
        // which sounds like broken Japanese — whole lines only.
        if (question.jp && !question.jp.includes("＿")) {
          void speak(spokenOf(question.jp), { rate: 0.85 }).catch(() => undefined);
        }
        const advance = (): void => {
          if (!body.isConnected) return;
          at++;
          if (at >= total) void finish();
          else draw();
        };
        const panel = body.querySelector<HTMLDivElement>(".gram-quiz")!;
        panel.tabIndex = -1;
        panel.focus();
        setTimeout(() => {
          panel.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") advance();
          });
          panel.addEventListener("click", (ev) => {
            if (!(ev.target as HTMLElement).closest("#lq-quit")) advance();
          });
        }, 0);
      });
    }
  };

  draw();
}

// ---------------- helpers ----------------

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
