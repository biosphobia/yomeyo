import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { cheerBox, preloadReactions, showReaction } from "./feedback.js";
import { PER_CORRECT, earnYennies, formatYennies, yennies } from "./yennies.js";
import { LESSONS } from "./grammar-lessons.js";

/**
 * The Learn view: the grammar course read as lessons, each closed by a test.
 *
 * Reading and testing are deliberately separate moods. The lesson is a calm
 * page — sections, examples with a speaker button, no timer, no score — and
 * the test at the bottom is the same quiz machinery the rest of the app
 * uses, one question at a time with a why after every answer. Passing (8 in
 * 10 or better) marks the lesson done on the list; nothing is ever locked,
 * because a reference you cannot open is a reference you stop using.
 */

const DONE_KEY = "grammarLessonsDone";
/** Best score per lesson index, as a percent. */
type Progress = Record<number, number>;

const PASS = 80;

let openLesson: number | null = null;

export async function renderLessons(body: HTMLDivElement, isCurrent: () => boolean = () => true): Promise<void> {
  const progress = (await getMeta<Progress>(DONE_KEY)) ?? {};
  if (!isCurrent() || !body.isConnected) return;
  if (openLesson !== null && LESSONS[openLesson]) {
    drawLesson(body, openLesson, progress, isCurrent);
  } else {
    drawList(body, progress, isCurrent);
  }
}

// ---------------- the lesson list ----------------

function drawList(body: HTMLDivElement, progress: Progress, isCurrent: () => boolean): void {
  const passed = LESSONS.filter((_, i) => (progress[i] ?? 0) >= PASS).length;
  const firstOpen = LESSONS.findIndex((_, i) => (progress[i] ?? 0) < PASS);
  body.innerHTML = `
    <div class="lesson-course-head">
      <div><b>The course</b><span class="glosses"> · read in order, test as you go</span></div>
      <span class="glosses">${passed} / ${LESSONS.length} passed</span>
    </div>
    <div class="kana-bar" style="margin-bottom:14px"><div class="kana-bar-fill" style="width:${Math.round(
      (passed / LESSONS.length) * 100,
    )}%"></div></div>
    <div id="lesson-list"></div>
  `;
  const list = body.querySelector<HTMLDivElement>("#lesson-list")!;
  LESSONS.forEach((lesson, index) => {
    const best = progress[index] ?? 0;
    const done = best >= PASS;
    const panel = document.createElement("div");
    panel.className = `card-panel lesson-row${done ? " done" : ""}${index === firstOpen ? " next" : ""}`;
    panel.innerHTML = `
      <div class="lesson-row-main">
        <div class="lesson-row-num">${done ? "✓" : index + 1}</div>
        <div>
          <div class="lesson-row-title">${escapeHtml(lesson.title)}</div>
          <div class="glosses">${escapeHtml(lesson.tagline)}</div>
        </div>
      </div>
      <button class="${done ? "secondary" : ""}">${done ? "Again" : "Read"}</button>
    `;
    panel.querySelector("button")!.addEventListener("click", () => {
      openLesson = index;
      drawLesson(body, index, progress, isCurrent);
    });
    list.appendChild(panel);
  });
}

// ---------------- one lesson, read ----------------

function drawLesson(body: HTMLDivElement, index: number, progress: Progress, isCurrent: () => boolean): void {
  const lesson = LESSONS[index];
  window.scrollTo({ top: 0 });
  body.innerHTML = `
    <button class="ghost lesson-back" id="lesson-back">← All lessons</button>
    <div class="lesson-head">
      <div class="glosses">Lesson ${index + 1} of ${LESSONS.length}</div>
      <h2>${escapeHtml(lesson.title)}</h2>
      <div class="glosses">${escapeHtml(lesson.tagline)}</div>
    </div>
    ${lesson.sections
      .map(
        (section) => `
      <div class="card-panel lesson-section">
        <h3>${escapeHtml(section.heading)}</h3>
        <p>${escapeHtml(section.body)}</p>
        ${(section.examples ?? [])
          .map(
            (ex, exIndex) => `
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
      </div>`,
      )
      .join("")}
    <div class="card-panel lesson-test-cta">
      <b>Ready?</b>
      <div class="glosses">${lesson.quiz.length} quick questions on what you just read.
        ${progress[index] !== undefined ? ` Best so far: ${progress[index]}%.` : ""}</div>
      <button id="lesson-test">Take the test</button>
    </div>
  `;

  body.querySelector("#lesson-back")!.addEventListener("click", () => {
    openLesson = null;
    void renderLessons(body, isCurrent);
  });
  for (const row of body.querySelectorAll<HTMLElement>(".lesson-example")) {
    row.querySelector(".speaker")!.addEventListener("click", () => {
      void speak(row.dataset.say ?? "", { rate: 0.85 }).catch(() => undefined);
    });
  }
  body.querySelector("#lesson-test")!.addEventListener("click", () => {
    void preloadReactions();
    runQuiz(body, index, progress, isCurrent);
  });
}

/** The bit of an example line worth reading out loud: the Japanese only. */
function spokenOf(jp: string): string {
  return jp.replace(/\s+/g, "");
}

// ---------------- the test ----------------

function runQuiz(body: HTMLDivElement, index: number, progress: Progress, isCurrent: () => boolean): void {
  const lesson = LESSONS[index];
  const queue = shuffle([...lesson.quiz]);
  const total = queue.length;
  let at = 0;
  let right = 0;

  const backToLesson = (): void => drawLesson(body, index, progress, isCurrent);

  const finish = async (): Promise<void> => {
    const score = Math.round((right / total) * 100);
    const passed = score >= PASS;
    const best = Math.max(progress[index] ?? 0, score);
    progress[index] = best;
    await setMeta(DONE_KEY, progress);
    const earned = right * PER_CORRECT;
    const balance = earned > 0 ? await earnYennies(earned) : await yennies();
    if (!isCurrent() || !body.isConnected) return;
    const next = index + 1 < LESSONS.length ? LESSONS[index + 1] : null;
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">${passed ? "🎉" : "📖"}</div>
        <div class="kana-score">${right} / ${total}</div>
        <div class="glosses">${
          passed
            ? `Passed — ${escapeHtml(lesson.title)} is yours.`
            : `Not quite — ${PASS}% passes. The lesson is one tap away.`
        }</div>
        <div class="yen-line">${earned > 0 ? `<b>+${earned.toLocaleString()}</b> · ` : ""}${formatYennies(balance)}</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          ${passed && next ? `<button id="lq-next">Next: ${escapeHtml(next.title)}</button>` : ""}
          ${passed ? "" : `<button id="lq-reread">Read it again</button>`}
          <button id="lq-retry" class="secondary">Retake the test</button>
          <button id="lq-list" class="ghost">All lessons</button>
        </div>
      </div>`;
    body.querySelector("#lq-next")?.addEventListener("click", () => {
      openLesson = index + 1;
      drawLesson(body, index + 1, progress, isCurrent);
    });
    body.querySelector("#lq-reread")?.addEventListener("click", backToLesson);
    body.querySelector("#lq-retry")!.addEventListener("click", () => runQuiz(body, index, progress, isCurrent));
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
          <span class="glosses">${escapeHtml(lesson.title)} — test</span>
          <span class="glosses">${at}/${total}</span>
          <button id="lq-quit" class="quiz-stop" title="Stop" aria-label="Stop">✕</button>
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
        if (question.jp) void speak(spokenOf(question.jp).replace(/＿/g, ""), { rate: 0.85 }).catch(() => undefined);
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
