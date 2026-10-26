import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { cheerBox, preloadReactions, showReaction } from "./feedback.js";
import { PER_CORRECT, earnYennies, formatYennies, yennies } from "./yennies.js";
import { screenHeader } from "./screen.js";
import { kanaToRomaji } from "./grammar-conjugate.js";
import { GENKI_LESSONS, GENKI_MAP, type GenkiCheck, type GenkiLesson, type GenkiStep } from "./genki-data.js";
import { GAMES, gameBests, runGame, ageKana } from "./genki-games.js";
import { renderCoach } from "./genki-coach.js";

/**
 * The Genki tab: a companion course for Genki I, taught like a class.
 *
 * Home lists the lessons. A lesson opens on its overview (goals, a plan for
 * the week, a contents list), and from there each part is its own page:
 * vocabulary, one page per grammar step, "put it together", and the test.
 * Every page carries Ask Coach at the bottom, aware of where the learner is.
 *
 * Progress is per device, like the grammar course: a step is ticked when its
 * quick check has been answered right, a lesson when its test is passed.
 * Nothing is locked, warm-ups are optional, and games are always extra.
 */

const PROGRESS_KEY = "genkiProgress";
const ROMAJI_KEY = "genkiRomaji";
const INTRO_KEY = "genkiSelfIntro";
const PASS = 80;

interface LessonProgress {
  /** Step ids whose quick check has been answered fully right. */
  checks: string[];
  /** Best test score, percent. */
  test?: number;
  /** The vocabulary page has been opened. */
  vocab?: boolean;
}

type Progress = Record<string, LessonProgress>;

type Page =
  | { kind: "home" }
  | { kind: "lesson"; lesson: number }
  | { kind: "vocab"; lesson: number }
  | { kind: "step"; lesson: number; step: number }
  | { kind: "together"; lesson: number }
  | { kind: "test"; lesson: number }
  | { kind: "game"; lesson: number; game: string; back: Page };

let page: Page = { kind: "home" };
let romaji = false;

async function progress(): Promise<Progress> {
  return (await getMeta<Progress>(PROGRESS_KEY)) ?? {};
}

async function updateLesson(id: string, change: (p: LessonProgress) => void): Promise<void> {
  const all = await progress();
  const mine = all[id] ?? { checks: [] };
  change(mine);
  all[id] = mine;
  await setMeta(PROGRESS_KEY, all);
}

export async function renderGenki(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  romaji = (await getMeta<boolean>(ROMAJI_KEY)) ?? false;
  // Coming back to the tab reopens the page you were reading, but never a
  // half-played round: a test or game restarts from its lesson.
  if (page.kind === "test" || page.kind === "game") page = { kind: "lesson", lesson: page.lesson };
  const balance = await yennies();
  if (!isCurrent()) return;
  void preloadReactions();
  main.innerHTML = `${screenHeader("Genki", balance)}<div id="genki-body"></div>`;
  const body = main.querySelector<HTMLDivElement>("#genki-body")!;
  const go = (next: Page): void => {
    page = next;
    window.scrollTo({ top: 0 });
    void draw(body, go, isCurrent);
  };
  await draw(body, go, isCurrent);
}

async function draw(body: HTMLDivElement, go: (p: Page) => void, isCurrent: () => boolean): Promise<void> {
  const all = await progress();
  if (!isCurrent() || !body.isConnected) return;
  const lesson = "lesson" in page ? GENKI_LESSONS[page.lesson] : null;
  if (!lesson) return drawHome(body, all, go);
  const mine = all[lesson.id] ?? { checks: [] };
  switch (page.kind) {
    case "lesson":
      return drawLesson(body, lesson, page.lesson, mine, go);
    case "vocab":
      return drawVocab(body, lesson, page.lesson, go);
    case "step":
      return drawStep(body, lesson, page.lesson, page.step, mine, go);
    case "together":
      return drawTogether(body, lesson, page.lesson, go);
    case "test":
      return runTest(body, lesson, page.lesson, mine, go);
    case "game": {
      const back = page.back;
      return runGame(body, page.game, { onExit: () => go(back), isCurrent });
    }
  }
}

// ====================================================================
// small pieces
// ====================================================================

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The teacher's text: blank lines are paragraphs, newlines breaks, **bold** bold. */
function prose(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")}</p>`)
    .join("");
}

/**
 * Romaji for a line, reading particles the way they are said: a word-final
 * は is "wa" (the course writes a space after every particle), を is "o",
 * and a word-final へ is "e".
 */
function romajiOf(jp: string): string {
  const spoken = jp
    .replace(/[。、？！]/g, (m) => (m === "、" ? ", " : m === "。" ? ". " : m === "？" ? "? " : "! "))
    .split(/(\s+)/)
    .map((token) => (token.length > 1 ? token.replace(/は(?=[,.?!]*$)/, "わ").replace(/へ(?=[,.?!]*$)/, "え") : token))
    .join("")
    .replace(/を/g, "お");
  return kanaToRomaji(spoken).trim();
}

/** A Japanese line with its 🔊, its English, and romaji when switched on. */
function exampleRow(jp: string, en: string, note?: string): string {
  return `
    <div class="lesson-example" data-say="${escapeHtml(jp.replace(/\s+/g, ""))}">
      <button class="speaker" title="Say it" aria-label="Say it">🔊</button>
      <div>
        <div class="lesson-example-jp" lang="ja">${escapeHtml(jp)}</div>
        ${romaji ? `<div class="gk-romaji">${escapeHtml(romajiOf(jp))}</div>` : ""}
        <div class="glosses">${escapeHtml(en)}</div>
        ${note ? `<div class="glosses gk-note">${escapeHtml(note)}</div>` : ""}
      </div>
    </div>`;
}

function wireSpeakers(root: HTMLElement): void {
  for (const row of root.querySelectorAll<HTMLElement>("[data-say]")) {
    const button = row.querySelector<HTMLButtonElement>(".speaker") ?? (row.tagName === "BUTTON" ? (row as HTMLButtonElement) : null);
    if (!button || button.dataset.wired) continue;
    button.dataset.wired = "1";
    button.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void speak(row.dataset.say ?? "", { rate: 0.85 }).catch(() => undefined);
    });
  }
}

function romajiToggle(): string {
  return `<label class="gk-toggle"><input type="checkbox" id="gk-romaji" ${romaji ? "checked" : ""}/> Show romaji</label>`;
}

function wireRomaji(root: HTMLElement, redraw: () => void): void {
  root.querySelector<HTMLInputElement>("#gk-romaji")?.addEventListener("change", (ev) => {
    romaji = (ev.target as HTMLInputElement).checked;
    void setMeta(ROMAJI_KEY, romaji).then(redraw);
  });
}

function backButton(label: string): string {
  return `<button class="ghost lesson-back" id="gk-back">← ${escapeHtml(label)}</button>`;
}

const KIND_LABEL: Record<GenkiStep["kind"], string> = {
  warmup: "Warm-up",
  grammar: "Grammar",
  expressions: "Expressions",
  culture: "Culture",
};

/** The coach panel, mounted at the bottom of whatever page is open. */
function mountCoach(body: HTMLElement, lesson: GenkiLesson, step: GenkiStep | null): void {
  const host = document.createElement("div");
  body.appendChild(host);
  const suggestions = step ? step.ask : lesson.steps.filter((s) => !s.optional).flatMap((s) => s.ask.slice(0, 1));
  void renderCoach(host, lesson, () => step, suggestions);
}

// ====================================================================
// home
// ====================================================================

function drawHome(body: HTMLDivElement, all: Progress, go: (p: Page) => void): void {
  body.innerHTML = `
    <div class="card-panel gk-hero">
      <div class="gk-hero-title">📗 Genki I, with a teacher</div>
      <p>A lesson-by-lesson companion to <b>Genki I (3rd edition)</b>. Each lesson follows the book's order and
        page numbers, explains every point the way a teacher would in class, checks you straight away, and gives
        you short games for anything that needs drilling. Stuck? <b>Ask Coach</b> at the bottom of every page.</p>
      <p class="glosses">Keep the book open beside it: this course explains and drills, the book has the full
        dialogues, audio and workbook. Kana is skipped here; the Kana tab covers it.</p>
    </div>
    <div id="gk-lessons"></div>
    <div class="card-panel gk-map">
      <b>The rest of Genki I</b>
      <div class="glosses" style="margin:4px 0 8px">Lessons 3–12 follow the same shape. They aren't built yet.</div>
      ${GENKI_MAP.filter((m) => m.num > GENKI_LESSONS.length)
        .map(
          (m) => `<div class="gk-map-row"><span class="gk-map-num">${m.num}</span><div><span lang="ja">${escapeHtml(m.jp)}</span>
            <span class="glosses">· ${escapeHtml(m.en)}</span><div class="glosses gk-map-topics">${escapeHtml(m.topics)}</div></div></div>`,
        )
        .join("")}
    </div>`;
  const list = body.querySelector<HTMLDivElement>("#gk-lessons")!;
  GENKI_LESSONS.forEach((lesson, index) => {
    const mine = all[lesson.id] ?? { checks: [] };
    const core = lesson.steps.filter((s) => !s.optional);
    const ticked = core.filter((s) => mine.checks.includes(s.id)).length;
    const done = (mine.test ?? 0) >= PASS;
    const panel = document.createElement("div");
    panel.className = `card-panel lesson-row${done ? " done" : ""}`;
    panel.innerHTML = `
      <div class="lesson-row-main">
        <div class="lesson-row-num">${done ? "✓" : lesson.num}</div>
        <div>
          <div class="lesson-row-title"><span lang="ja">${escapeHtml(lesson.jp)}</span> · ${escapeHtml(lesson.en)}</div>
          <div class="glosses">${escapeHtml(lesson.goals.slice(0, 3).join(" · "))}</div>
          <div class="glosses lesson-row-marks">${ticked}/${core.length} steps checked${
            mine.test !== undefined ? ` · 🏅 test ${mine.test}%` : ""
          }</div>
        </div>
      </div>
      <button class="${done ? "secondary" : ""}">${done ? "Review" : ticked ? "Continue" : "Start"}</button>`;
    panel.querySelector("button")!.addEventListener("click", () => go({ kind: "lesson", lesson: index }));
    list.appendChild(panel);
  });
}

// ====================================================================
// a lesson's overview
// ====================================================================

function drawLesson(body: HTMLDivElement, lesson: GenkiLesson, index: number, mine: LessonProgress, go: (p: Page) => void): void {
  const tick = (on: boolean): string => `<span class="gk-tick${on ? " on" : ""}">${on ? "✓" : ""}</span>`;
  body.innerHTML = `
    ${backButton("All lessons")}
    <div class="lesson-head">
      <div class="glosses">Lesson ${lesson.num} · ${escapeHtml(lesson.pages)}</div>
      <h2><span lang="ja">${escapeHtml(lesson.jp)}</span> · ${escapeHtml(lesson.en)}</h2>
    </div>
    <div class="card-panel lesson-section">
      <h3>By the end of this lesson you can…</h3>
      <ul class="gk-goals">${lesson.goals.map((g) => `<li>${escapeHtml(g)}</li>`).join("")}</ul>
      ${prose(lesson.intro)}
      <details class="gk-plan"><summary>A plan for the week</summary>
        <ul>${lesson.plan.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
      </details>
    </div>
    <div class="card-panel gk-contents">
      <button class="gk-entry" data-go="vocab">${tick(!!mine.vocab)}<span><b>Vocabulary</b><span class="glosses"> · learn the ★ words first</span></span><span class="gk-arrow">›</span></button>
      ${lesson.steps
        .map(
          (s, i) => `<button class="gk-entry" data-step="${i}">${tick(mine.checks.includes(s.id))}<span>
            <span class="gk-kind gk-kind-${s.kind}">${KIND_LABEL[s.kind]}${s.optional ? " · optional" : ""}</span>
            <b lang="ja">${escapeHtml(s.title)}</b><span class="glosses"> · ${escapeHtml(s.name)}</span></span><span class="gk-arrow">›</span></button>`,
        )
        .join("")}
      <button class="gk-entry" data-go="together">${tick(false)}<span><b>Put it together</b><span class="glosses"> · the conversation${
        lesson.together.includes("self-intro") ? ", your self-introduction" : ", role-plays"
      }</span></span><span class="gk-arrow">›</span></button>
      <button class="gk-entry" data-go="test">${tick((mine.test ?? 0) >= PASS)}<span><b>Lesson test</b><span class="glosses"> · ${
        lesson.test.length
      } questions, ${PASS}% passes${mine.test !== undefined ? ` · best ${mine.test}%` : ""}</span></span><span class="gk-arrow">›</span></button>
    </div>`;
  body.querySelector("#gk-back")!.addEventListener("click", () => go({ kind: "home" }));
  for (const entry of body.querySelectorAll<HTMLButtonElement>(".gk-entry")) {
    entry.addEventListener("click", () => {
      const target = entry.dataset.go;
      if (entry.dataset.step !== undefined) go({ kind: "step", lesson: index, step: Number(entry.dataset.step) });
      else if (target === "vocab") go({ kind: "vocab", lesson: index });
      else if (target === "together") go({ kind: "together", lesson: index });
      else if (target === "test") go({ kind: "test", lesson: index });
    });
  }
  mountCoach(body, lesson, null);
}

// ====================================================================
// vocabulary
// ====================================================================

function drawVocab(body: HTMLDivElement, lesson: GenkiLesson, index: number, go: (p: Page) => void): void {
  void updateLesson(lesson.id, (p) => (p.vocab = true));
  const group = (g: GenkiLesson["vocab"][number]): string => `
    <div class="card-panel gk-vocab-group">
      <h3>${escapeHtml(g.title)}${g.extra ? ` <span class="glosses">· make it yours</span>` : ""}</h3>
      ${g.extra ? `<div class="glosses" style="margin-bottom:6px">Learn the ones that describe you; skip the rest.</div>` : ""}
      ${g.words
        .map(
          (w) => `<div class="gk-word" data-say="${escapeHtml(w.jp.replace(/[〜／].*$/, (m) => (m.startsWith("〜") ? m.slice(1) : "")))}">
            <button class="speaker" title="Say it" aria-label="Say it">🔊</button>
            <span class="gk-word-jp" lang="ja">${w.star ? "<i>★</i>" : ""}${escapeHtml(w.jp)}</span>
            ${romaji ? `<span class="gk-romaji">${escapeHtml(romajiOf(w.jp.replace(/[〜／]/g, " ")))}</span>` : ""}
            <span class="gk-word-en">${escapeHtml(w.en)}</span>
          </div>`,
        )
        .join("")}
    </div>`;
  body.innerHTML = `
    ${backButton(`Lesson ${lesson.num}`)}
    <div class="lesson-head">
      <div class="glosses">Lesson ${lesson.num} · vocabulary</div>
      <h2>Words for this lesson</h2>
      <div class="glosses">★ = used in the lesson's main conversation; learn those first. Tap 🔊 to hear any word.</div>
    </div>
    <div class="row-actions gk-vocab-actions">
      <button id="gk-vocab-game">🃏 Match game</button>
      ${romajiToggle()}
    </div>
    ${lesson.vocab.filter((g) => !g.extra).map(group).join("")}
    ${lesson.vocab.filter((g) => g.extra).map(group).join("")}
    <div class="card-panel glosses">How to learn these: five or six at a time, out loud, a few times a day. Say the
      Japanese, then cover it and say it from the English. Words stick when you use them, so try to put each one
      into a sentence about yourself.</div>`;
  wireSpeakers(body);
  body.querySelector("#gk-back")!.addEventListener("click", () => go({ kind: "lesson", lesson: index }));
  body.querySelector("#gk-vocab-game")!.addEventListener("click", () =>
    go({ kind: "game", lesson: index, game: `vocab-${lesson.id}`, back: { kind: "vocab", lesson: index } }),
  );
  wireRomaji(body, () => go({ kind: "vocab", lesson: index }));
  mountCoach(body, lesson, null);
}

// ====================================================================
// one step
// ====================================================================

function drawStep(
  body: HTMLDivElement,
  lesson: GenkiLesson,
  index: number,
  stepIndex: number,
  mine: LessonProgress,
  go: (p: Page) => void,
): void {
  const step = lesson.steps[stepIndex];
  const prev = stepIndex > 0 ? lesson.steps[stepIndex - 1] : null;
  const next = stepIndex + 1 < lesson.steps.length ? lesson.steps[stepIndex + 1] : null;
  const passed = mine.checks.includes(step.id);
  body.innerHTML = `
    ${backButton(`Lesson ${lesson.num}`)}
    <div class="lesson-head">
      <div class="glosses"><span class="gk-kind gk-kind-${step.kind}">${KIND_LABEL[step.kind]}${
        step.optional ? " · optional" : ""
      }</span> ${escapeHtml(step.genki)}</div>
      <h2 lang="ja">${escapeHtml(step.title)}</h2>
      <div class="glosses">${escapeHtml(step.name)}</div>
    </div>
    <div class="card-panel lesson-section gk-teach">
      ${prose(step.teach)}
      ${
        step.pattern
          ? `<div class="gk-pattern">${step.pattern
              .map(([jp, en]) => `<div class="gk-pattern-row"><span lang="ja">${escapeHtml(jp)}</span><span class="glosses">${escapeHtml(en)}</span></div>`)
              .join("")}</div>`
          : ""
      }
    </div>
    ${
      step.table
        ? `<div class="card-panel lesson-section">
            ${step.table.caption ? `<h3>${escapeHtml(step.table.caption)}</h3>` : ""}
            <div class="gk-table">${step.table.rows
              .map(
                ([left, jp, note]) => `<button class="gk-table-row" type="button" data-say="${escapeHtml(jp)}">
                  <span class="gk-table-left">${escapeHtml(left)}</span>
                  <span lang="ja">${escapeHtml(jp)}${romaji ? ` <span class="gk-romaji">${escapeHtml(romajiOf(jp))}</span>` : ""}</span>
                  <span class="glosses">${note ? escapeHtml(note) : ""}</span></button>`,
              )
              .join("")}</div>
          </div>`
        : ""
    }
    ${
      step.examples?.length
        ? `<div class="card-panel lesson-section"><div class="gk-section-head"><h3>Examples</h3>${romajiToggle()}</div>
            ${step.examples.map((e) => exampleRow(e.jp, e.en, e.note)).join("")}</div>`
        : ""
    }
    ${
      step.watch?.length
        ? `<div class="card-panel lesson-section gk-watch"><h3>⚠️ Watch out</h3><ul>${step.watch
            .map((w) => `<li>${escapeHtml(w)}</li>`)
            .join("")}</ul></div>`
        : ""
    }
    ${
      step.uni || step.life
        ? `<div class="card-panel lesson-section gk-tips">
            ${step.uni ? `<div><b>🎓 In class</b><p>${escapeHtml(step.uni)}</p></div>` : ""}
            ${step.life ? `<div><b>🗾 In real life</b><p>${escapeHtml(step.life)}</p></div>` : ""}
          </div>`
        : ""
    }
    <div class="card-panel lesson-section gk-check" id="gk-check">
      <h3>Quick check ${passed ? `<span class="ok-text">✓</span>` : ""}</h3>
      <div id="gk-check-body"></div>
    </div>
    ${
      step.games.length
        ? `<div class="card-panel lesson-section"><h3>Play it ${step.optional ? "" : "<span class=\"glosses\">· optional, for extra practice</span>"}</h3>
            <div class="gk-games" id="gk-games"></div></div>`
        : ""
    }
    <div class="row-actions gk-step-nav">
      ${prev ? `<button class="secondary" id="gk-prev">‹ ${escapeHtml(prev.title)}</button>` : ""}
      ${
        next
          ? `<button id="gk-next">${escapeHtml(next.title)} ›</button>`
          : `<button id="gk-next">Put it together ›</button>`
      }
    </div>`;
  wireSpeakers(body);
  wireRomaji(body, () => go({ kind: "step", lesson: index, step: stepIndex }));
  body.querySelector("#gk-back")!.addEventListener("click", () => go({ kind: "lesson", lesson: index }));
  body.querySelector("#gk-prev")?.addEventListener("click", () => go({ kind: "step", lesson: index, step: stepIndex - 1 }));
  body.querySelector("#gk-next")!.addEventListener("click", () =>
    go(next ? { kind: "step", lesson: index, step: stepIndex + 1 } : { kind: "together", lesson: index }),
  );
  drawChecks(body.querySelector<HTMLDivElement>("#gk-check-body")!, step.checks, async () => {
    await updateLesson(lesson.id, (p) => {
      if (!p.checks.includes(step.id)) p.checks.push(step.id);
    });
  });
  const gamesHost = body.querySelector<HTMLDivElement>("#gk-games");
  if (gamesHost) void drawGameButtons(gamesHost, step.games, (game) => go({ kind: "game", lesson: index, game, back: page }));
  mountCoach(body, lesson, step);
}

/** Questions answered in place, each revealing its why. All right → onPass. */
function drawChecks(host: HTMLDivElement, checks: GenkiCheck[], onPass: () => Promise<void>): void {
  const results: (boolean | null)[] = checks.map(() => null);
  host.innerHTML = checks
    .map(
      (c, qi) => `<div class="gk-q" data-q="${qi}">
        <div class="gk-q-text">${qi + 1}. ${escapeHtml(c.q)}</div>
        ${c.jp ? `<div class="lesson-quiz-jp" lang="ja">${escapeHtml(c.jp)}</div>` : ""}
        <div class="gram-options">${shuffledIndexes(c.choices.length)
          .map((i) => `<button data-i="${i}" lang="ja">${escapeHtml(c.choices[i])}</button>`)
          .join("")}</div>
        <div class="gk-q-why glosses"></div>
      </div>`,
    )
    .join("") + `<div class="gk-check-result" id="gk-check-result"></div>`;
  const result = host.querySelector<HTMLDivElement>("#gk-check-result")!;
  for (const block of host.querySelectorAll<HTMLDivElement>(".gk-q")) {
    const qi = Number(block.dataset.q);
    const c = checks[qi];
    const buttons = [...block.querySelectorAll<HTMLButtonElement>("button")];
    for (const b of buttons) {
      b.addEventListener("click", () => {
        const picked = Number(b.dataset.i);
        const good = picked === c.answer;
        for (const other of buttons) {
          const i = Number(other.dataset.i);
          other.classList.toggle("is-answer", i === c.answer);
          other.classList.toggle("is-wrong", i === picked && !good);
          other.disabled = true;
        }
        results[qi] = good;
        block.querySelector(".gk-q-why")!.innerHTML = `${good ? `<span class="ok-text">✓</span>` : `<span class="err-text">✗</span>`} ${escapeHtml(c.why)}`;
        const said = c.jp && !c.jp.includes("＿") ? c.jp : c.jp ? c.jp.replace("＿", c.choices[c.answer]) : /[ぁ-ゟァ-ヿ]/.test(c.choices[c.answer]) ? c.choices[c.answer] : "";
        if (said) void speak(said.replace(/\s+/g, ""), { rate: 0.85 }).catch(() => undefined);
        if (results.every((r) => r !== null)) {
          const right = results.filter(Boolean).length;
          if (right === checks.length) {
            result.innerHTML = `<div class="ok-text">All right — this step is ticked off.</div>`;
            void onPass();
          } else {
            result.innerHTML = `<div class="glosses">${right}/${checks.length}. Read the why under each miss, then</div>
              <button class="secondary" id="gk-check-retry">Try the check again</button>`;
            result.querySelector("#gk-check-retry")!.addEventListener("click", () => drawChecks(host, checks, onPass));
          }
        }
      });
    }
  }
}

function shuffledIndexes(n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function drawGameButtons(host: HTMLDivElement, ids: string[], open: (id: string) => void): Promise<void> {
  const bests = await gameBests();
  if (!host.isConnected) return;
  host.innerHTML = ids
    .filter((id) => GAMES[id])
    .map((id) => {
      const g = GAMES[id];
      const best = bests[id];
      return `<button class="gk-game-card" data-game="${id}">
        <span class="gk-game-icon">${g.icon}</span>
        <span><b>${escapeHtml(g.title)}</b><span class="glosses">${escapeHtml(g.blurb)}</span>
        ${best !== undefined ? `<span class="glosses gk-best">best ${best}%</span>` : ""}</span></button>`;
    })
    .join("");
  for (const b of host.querySelectorAll<HTMLButtonElement>(".gk-game-card")) {
    b.addEventListener("click", () => open(b.dataset.game!));
  }
}

// ====================================================================
// put it together
// ====================================================================

interface SelfIntro {
  name: string;
  from: string;
  school: string;
  year: string;
  major: string;
  age: number;
}

/** Kana as written, and the English for the translation line. */
const FROM_EN: Record<string, string> = {
  アメリカ: "the USA", イギリス: "the UK", カナダ: "Canada", オーストラリア: "Australia", ドイツ: "Germany",
  フランス: "France", かんこく: "Korea", ちゅうごく: "China", ベトナム: "Vietnam", インド: "India",
  ブラジル: "Brazil", トルコ: "Türkiye", にほん: "Japan",
};
const YEAR_EN: Record<string, string> = {
  いちねんせい: "first-year", にねんせい: "second-year", さんねんせい: "third-year", よねんせい: "fourth-year",
  だいがくいんせい: "graduate",
};
const MAJOR_EN: Record<string, string> = {
  にほんご: "Japanese", けいざい: "economics", れきし: "history", ぶんがく: "literature", こうがく: "engineering",
  せいじ: "politics", コンピューター: "computer science", ビジネス: "business", いがく: "medicine", ほうがく: "law",
  しんりがく: "psychology", すうがく: "mathematics", えいご: "English",
};
const FROM = Object.keys(FROM_EN);
const YEAR_OPTIONS = Object.keys(YEAR_EN);
const MAJORS = Object.keys(MAJOR_EN);

function introLines(f: SelfIntro): [string, string][] {
  const name = f.name.trim() || "〔なまえ〕";
  const school = f.school.trim() || "〔だいがく〕";
  return [
    ["はじめまして。", "Nice to meet you."],
    [`${name}です。`, "I'm (your name)."],
    [`${f.from}じんです。`, `I'm from ${FROM_EN[f.from] ?? f.from}.`],
    [`${school}の ${f.year}です。`, `I'm a ${YEAR_EN[f.year] ?? f.year} student at (your university).`],
    [`せんこうは ${f.major}です。`, `My major is ${MAJOR_EN[f.major] ?? f.major}.`],
    [`${ageKana(f.age)}です。`, `I'm ${f.age}.`],
    ["よろしくおねがいします。", "Nice to meet you / I look forward to getting to know you."],
  ];
}

async function drawTogether(body: HTMLDivElement, lesson: GenkiLesson, index: number, go: (p: Page) => void): Promise<void> {
  const d = lesson.dialogue;
  const hasIntro = lesson.together.includes("self-intro");
  const games = lesson.together.filter((g) => GAMES[g]);
  body.innerHTML = `
    ${backButton(`Lesson ${lesson.num}`)}
    <div class="lesson-head">
      <div class="glosses">Lesson ${lesson.num} · put it together</div>
      <h2>${escapeHtml(d.title)}</h2>
      <div class="glosses">${escapeHtml(d.setting)}</div>
    </div>
    <div class="card-panel lesson-section">
      <div class="gk-section-head"><h3>The conversation</h3>${romajiToggle()}</div>
      <div class="glosses" style="margin-bottom:8px">Read each line, guess the meaning, then tap it to check. Then play it and
        repeat out loud right after each line (shadowing): it's the closest thing to a speaking partner.</div>
      <div class="row-actions"><button class="secondary" id="gk-play-all">▶ Play the whole thing</button>
        <button class="ghost" id="gk-show-all">Show all English</button></div>
      <div class="gk-dialogue">${d.lines
        .map(
          (l, i) => `<div class="gk-line" data-i="${i}" data-say="${escapeHtml(l.jp.replace(/\s+/g, ""))}">
            <span class="gk-who">${escapeHtml(l.who)}</span>
            <div><div lang="ja" class="gk-line-jp">${escapeHtml(l.jp)}</div>
            ${romaji ? `<div class="gk-romaji">${escapeHtml(romajiOf(l.jp))}</div>` : ""}
            <div class="glosses gk-line-en" hidden>${escapeHtml(l.en)}</div></div>
            <button class="speaker" title="Say it" aria-label="Say it">🔊</button>
          </div>`,
        )
        .join("")}</div>
    </div>
    ${
      hasIntro
        ? `<div class="card-panel lesson-section" id="gk-intro">
            <h3>Your self-introduction</h3>
            <div class="glosses" style="margin-bottom:8px">Fill in your details and you'll have the intro you'll give on the first day of class.
              Write your name in katakana if you can (ask the coach if you're unsure how).</div>
            <div class="gk-intro-form"></div>
            <div class="gk-intro-out"></div>
          </div>`
        : ""
    }
    ${games.length ? `<div class="card-panel lesson-section"><h3>Role-play it</h3><div class="gk-games" id="gk-games"></div></div>` : ""}
    <div class="card-panel lesson-test-cta">
      <b>Ready?</b><div class="glosses">${lesson.test.length} questions across the whole lesson. ${PASS}% passes.</div>
      <div class="row-actions" style="justify-content:center;margin-top:6px"><button id="gk-to-test">🏅 Take the lesson test</button></div>
    </div>`;
  wireSpeakers(body);
  wireRomaji(body, () => go({ kind: "together", lesson: index }));
  body.querySelector("#gk-back")!.addEventListener("click", () => go({ kind: "lesson", lesson: index }));
  body.querySelector("#gk-to-test")!.addEventListener("click", () => go({ kind: "test", lesson: index }));
  for (const line of body.querySelectorAll<HTMLElement>(".gk-line")) {
    line.addEventListener("click", () => {
      const en = line.querySelector<HTMLElement>(".gk-line-en")!;
      en.hidden = !en.hidden;
    });
  }
  body.querySelector("#gk-show-all")!.addEventListener("click", () => {
    for (const en of body.querySelectorAll<HTMLElement>(".gk-line-en")) en.hidden = false;
  });
  let playing = false;
  body.querySelector("#gk-play-all")!.addEventListener("click", async () => {
    if (playing) return;
    playing = true;
    for (const line of body.querySelectorAll<HTMLElement>(".gk-line")) {
      if (!line.isConnected) break;
      line.classList.add("now");
      await speak(line.dataset.say ?? "", { rate: 0.85 }).catch(() => undefined);
      // A beat after each line: the gap you repeat it in.
      await new Promise((r) => setTimeout(r, 1400));
      line.classList.remove("now");
    }
    playing = false;
  });
  const gamesHost = body.querySelector<HTMLDivElement>("#gk-games");
  if (gamesHost) void drawGameButtons(gamesHost, games, (game) => go({ kind: "game", lesson: index, game, back: page }));
  if (hasIntro) await drawIntroBuilder(body.querySelector<HTMLDivElement>("#gk-intro")!);
  mountCoach(body, lesson, null);
}

async function drawIntroBuilder(host: HTMLDivElement): Promise<void> {
  const saved = (await getMeta<SelfIntro>(INTRO_KEY)) ?? {
    name: "",
    from: "アメリカ",
    school: "",
    year: "いちねんせい",
    major: "にほんご",
    age: 19,
  };
  const form = host.querySelector<HTMLDivElement>(".gk-intro-form")!;
  const out = host.querySelector<HTMLDivElement>(".gk-intro-out")!;
  const select = (id: string, options: string[], value: string): string =>
    `<select id="${id}">${options.map((o) => `<option ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`;
  form.innerHTML = `
    <label>Name <input type="text" id="gi-name" value="${escapeHtml(saved.name)}" placeholder="e.g. レナ" /></label>
    <label>From ${select("gi-from", FROM, saved.from)}</label>
    <label>University <input type="text" id="gi-school" value="${escapeHtml(saved.school)}" placeholder="e.g. さくらだいがく" /></label>
    <label>Year ${select("gi-year", YEAR_OPTIONS, saved.year)}</label>
    <label>Major ${select("gi-major", MAJORS, saved.major)}</label>
    <label>Age <input type="number" id="gi-age" min="1" max="99" value="${saved.age}" /></label>`;
  const read = (): SelfIntro => ({
    name: form.querySelector<HTMLInputElement>("#gi-name")!.value,
    from: form.querySelector<HTMLSelectElement>("#gi-from")!.value,
    school: form.querySelector<HTMLInputElement>("#gi-school")!.value,
    year: form.querySelector<HTMLSelectElement>("#gi-year")!.value,
    major: form.querySelector<HTMLSelectElement>("#gi-major")!.value,
    age: Math.max(1, Math.min(99, Number(form.querySelector<HTMLInputElement>("#gi-age")!.value) || 19)),
  });
  const paint = (): void => {
    const f = read();
    const lines = introLines(f);
    const latin = /[a-z]/i.test(f.name + f.school);
    out.innerHTML = `
      <div class="gk-intro-script">${lines.map(([jp, en]) => exampleRow(jp, en)).join("")}</div>
      ${latin ? `<div class="glosses gk-note">Tip: names and schools are written in kana in Japanese. Try katakana for your name.</div>` : ""}
      <div class="row-actions"><button id="gi-play">▶ Hear it all</button></div>`;
    wireSpeakers(out);
    out.querySelector("#gi-play")!.addEventListener("click", () =>
      void speak(lines.map(([jp]) => jp).join(""), { rate: 0.85 }).catch(() => undefined),
    );
  };
  form.addEventListener("input", () => {
    paint();
    void setMeta(INTRO_KEY, read());
  });
  paint();
}

// ====================================================================
// the lesson test
// ====================================================================

function runTest(body: HTMLDivElement, lesson: GenkiLesson, index: number, mine: LessonProgress, go: (p: Page) => void): void {
  const queue = lesson.test.map((q) => ({ q, order: shuffledIndexes(q.choices.length) }));
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  const total = queue.length;
  let at = 0;
  let right = 0;
  const missed: GenkiCheck[] = [];

  const finish = async (): Promise<void> => {
    const score = Math.round((right / total) * 100);
    const passed = score >= PASS;
    await updateLesson(lesson.id, (p) => (p.test = Math.max(p.test ?? 0, score)));
    const earned = right * PER_CORRECT;
    const balance = earned > 0 ? await earnYennies(earned) : await yennies();
    if (!body.isConnected) return;
    const next = GENKI_LESSONS[index + 1];
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">${passed ? "🎉" : "📖"}</div>
        <div class="kana-score">${right} / ${total}</div>
        <div class="glosses">${
          passed ? `Passed. Lesson ${lesson.num} is yours.` : `Not quite: ${PASS}% passes. Look over what you missed, then try again.`
        }</div>
        <div class="yen-line">${earned > 0 ? `<b>+${earned}</b> · ` : ""}${formatYennies(balance)}</div>
        ${
          missed.length
            ? `<div class="gk-missed"><b>To look at again</b>${missed
                .map((q) => `<div class="gk-missed-row"><span>${escapeHtml(q.q)}</span><span lang="ja" class="ok-text">${escapeHtml(q.choices[q.answer])}</span><span class="glosses">${escapeHtml(q.why)}</span></div>`)
                .join("")}</div>`
            : ""
        }
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          ${passed && next ? `<button id="gt-next">Next: Lesson ${next.num}</button>` : ""}
          <button id="gt-retry" class="secondary">Retake</button>
          <button id="gt-lesson" class="ghost">Back to the lesson</button>
        </div>
      </div>`;
    body.querySelector("#gt-next")?.addEventListener("click", () => go({ kind: "lesson", lesson: index + 1 }));
    body.querySelector("#gt-retry")!.addEventListener("click", () => runTest(body, lesson, index, mine, go));
    body.querySelector("#gt-lesson")!.addEventListener("click", () => go({ kind: "lesson", lesson: index }));
  };

  const draw = (): void => {
    const { q, order } = queue[at];
    body.innerHTML = `
      <div class="card-panel kana-quiz gram-quiz">
        <div class="kana-quiz-top">
          <button id="gt-quit" class="quiz-stop" title="Stop" aria-label="Stop">✕</button>
          <span class="glosses">Lesson ${lesson.num} — test</span>
          <span class="glosses">${at}/${total}</span>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${Math.round((at / total) * 100)}%"></div></div>
        <div class="gram-prompt">${escapeHtml(q.q)}</div>
        ${q.jp ? `<div class="lesson-quiz-jp" lang="ja">${escapeHtml(q.jp)}</div>` : ""}
        <div class="gram-options lesson-quiz-options">${order
          .map((i) => `<button data-i="${i}" lang="ja">${escapeHtml(q.choices[i])}</button>`)
          .join("")}</div>
        <div class="kana-feedback" id="gt-feedback"></div>
      </div>
      ${cheerBox("gt-cheer")}`;
    body.querySelector("#gt-quit")!.addEventListener("click", () => go({ kind: "lesson", lesson: index }));
    const feedback = body.querySelector<HTMLDivElement>("#gt-feedback")!;
    let settled = false;
    for (const button of body.querySelectorAll<HTMLButtonElement>(".lesson-quiz-options button")) {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (settled) return;
        settled = true;
        const picked = Number(button.dataset.i);
        const good = picked === q.answer;
        if (good) right++;
        else missed.push(q);
        for (const b of body.querySelectorAll<HTMLButtonElement>(".lesson-quiz-options button")) {
          const i = Number(b.dataset.i);
          b.classList.toggle("is-answer", i === q.answer);
          b.classList.toggle("is-wrong", i === picked && !good);
          b.disabled = true;
        }
        feedback.innerHTML = `${good ? `<span class="ok-text">✓</span>` : `<span class="err-text">✗</span>`}
          <span class="glosses">${escapeHtml(q.why)}</span>
          <div class="ai-why" id="gt-why">…</div>
          <div class="glosses">Enter (or tap) to continue</div>`;
        const whyBox = feedback.querySelector<HTMLDivElement>("#gt-why");
        void import("./grammar-ai.js")
          .then((ai) =>
            ai.explainAnswer({ question: q.q, sentence: q.jp, picked: q.choices[picked], correct: q.choices[q.answer], wasRight: good }),
          )
          .then((why) => {
            if (!whyBox?.isConnected) return;
            if (why) whyBox.textContent = why;
            else whyBox.remove();
          })
          .catch(() => whyBox?.remove());
        void showReaction(body.querySelector("#gt-cheer"), good ? "correct" : "wrong");
        const said = q.jp ? q.jp.replace("＿", q.choices[q.answer]) : /[ぁ-ゟァ-ヿ]/.test(q.choices[q.answer]) ? q.choices[q.answer] : "";
        if (said) void speak(said.replace(/\s+/g, ""), { rate: 0.85 }).catch(() => undefined);
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
          panel.addEventListener("keydown", (e) => {
            if (e.key === "Enter") advance();
          });
          panel.addEventListener("click", (e) => {
            if (!(e.target as HTMLElement).closest("#gt-quit")) advance();
          });
        }, 0);
      });
    }
  };

  draw();
}
