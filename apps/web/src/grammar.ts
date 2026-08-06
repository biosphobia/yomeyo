import { screenHeader } from "./screen.js";
import { preloadReactions } from "./feedback.js";
import { GRAMMAR_POINTS, type JlptPoint } from "./grammar-data.js";
import { renderLessons } from "./grammar-lesson-view.js";
import { renderPlayground } from "./grammar-playground.js";
import { unlockAll } from "./unlock.js";
import { yennies } from "./yennies.js";
import { renderParse } from "./parse.js";
import { N5_POINTS } from "./grammar-jlpt-n5.js";
import { N4_POINTS } from "./grammar-jlpt-n4.js";
import { N3_POINTS } from "./grammar-jlpt-n3.js";
import { N1_POINTS, N2_POINTS } from "./grammar-jlpt-n2n1.js";

/**
 * The Grammar tab, in four rooms.
 *
 * Course is the way in: chapters read, drilled and tested in one flow —
 * the reading and the sentence-dissection drills used to be separate tabs
 * teaching overlapping things in different orders, and are now one
 * curriculum (see grammar-lesson-view.ts, with the drill engine in
 * grammar-practice.ts). Playground bends single words like lego. Parse
 * takes apart any real sentence pasted in. The Dictionary holds every
 * pattern through JLPT N1 for the day it turns up in the wild.
 */

let view: "course" | "playground" | "dictionary" | "parse" = "course";

export async function renderGrammar(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  // Warmed as the screen opens: the reactions have to be in hand the
  // instant a drill answer lands, and reading a chapter head is exactly
  // the free half-second in which to fetch them.
  void preloadReactions();
  await unlockAll();
  if (!isCurrent()) return;

  main.innerHTML = `
    ${screenHeader("Grammar", await yennies())}
    <div class="segmented gram-segmented">
      <button data-view="course" class="${view === "course" ? "on" : ""}">Course</button>
      <button data-view="playground" class="${view === "playground" ? "on" : ""}">Playground</button>
      <button data-view="parse" class="${view === "parse" ? "on" : ""}">Parse</button>
      <button data-view="dictionary" class="${view === "dictionary" ? "on" : ""}">Dictionary</button>
    </div>
    <div id="grammar-body"></div>
  `;

  for (const button of main.querySelectorAll<HTMLButtonElement>(".segmented button")) {
    button.addEventListener("click", () => {
      view = button.dataset.view as typeof view;
      void renderGrammar(main, isCurrent);
    });
  }

  const body = main.querySelector<HTMLDivElement>("#grammar-body")!;
  if (view === "dictionary") renderDictionary(body);
  else if (view === "parse") void renderParse(body);
  else if (view === "playground") void renderPlayground(body, isCurrent);
  else void renderLessons(body, isCurrent);
}

// ---------------- the dictionary ----------------

const JLPT_LEVELS: { key: string; points: JlptPoint[] }[] = [
  { key: "N5", points: N5_POINTS },
  { key: "N4", points: N4_POINTS },
  { key: "N3", points: N3_POINTS },
  { key: "N2", points: N2_POINTS },
  { key: "N1", points: N1_POINTS },
];

let dictLevel = "Basics";

function renderDictionary(body: HTMLDivElement): void {
  body.innerHTML = `
    <input type="search" id="gram-search" placeholder="Search everything: は, until, hidden…"
      autocomplete="off" autocapitalize="none" style="margin-bottom:10px" />
    <div class="gram-levels" id="gram-levels">
      ${["Basics", ...JLPT_LEVELS.map((l) => l.key)]
        .map(
          (key) => `<button class="gram-level-chip${key === dictLevel ? " on" : ""}" data-level="${key}">
            ${key}<span class="gram-level-count">${
              key === "Basics" ? GRAMMAR_POINTS.length : JLPT_LEVELS.find((l) => l.key === key)!.points.length
            }</span></button>`,
        )
        .join("")}
    </div>
    <div id="gram-dict"></div>
  `;
  const list = body.querySelector<HTMLDivElement>("#gram-dict")!;
  const search = body.querySelector<HTMLInputElement>("#gram-search")!;

  const basicsCard = (point: (typeof GRAMMAR_POINTS)[number]): string => `
      <details class="card-panel gram-point">
        <summary>
          <span class="gram-point-title" lang="ja">${escapeHtml(point.title)}</span>
          <span class="gram-point-name">${escapeHtml(point.name)}</span>
          <span class="gram-point-unit">unit ${point.unit}</span>
        </summary>
        <p class="gram-point-body">${escapeHtml(point.explanation)}</p>
        ${point.examples
          .map(
            (ex) => `<div class="gram-example"><span lang="ja">${escapeHtml(ex.jp)}</span>
              <span class="glosses">${escapeHtml(ex.en)}</span></div>`,
          )
          .join("")}
      </details>`;

  const jlptCard = (point: JlptPoint, level: string): string => `
      <details class="card-panel gram-point">
        <summary>
          <span class="gram-point-title" lang="ja">${escapeHtml(point.t)}</span>
          <span class="gram-point-name">${escapeHtml(point.n)}</span>
          <span class="gram-point-unit">${level}</span>
        </summary>
        <p class="gram-point-body">${escapeHtml(point.e)}</p>
        <div class="gram-example"><span lang="ja">${escapeHtml(point.ex)}</span>
          <span class="glosses">${escapeHtml(point.en)}</span></div>
      </details>`;

  const draw = (): void => {
    const needle = search.value.trim().toLowerCase();

    // A search reaches across every level; the chips browse one at a time.
    if (needle) {
      const basics = GRAMMAR_POINTS.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.name.toLowerCase().includes(needle) ||
          p.explanation.toLowerCase().includes(needle) ||
          p.examples.some((ex) => ex.jp.includes(needle) || ex.en.toLowerCase().includes(needle)),
      ).map(basicsCard);
      const jlpt = JLPT_LEVELS.flatMap(({ key, points }) =>
        points
          .filter(
            (p) =>
              p.t.toLowerCase().includes(needle) ||
              p.n.toLowerCase().includes(needle) ||
              p.e.toLowerCase().includes(needle) ||
              p.ex.includes(needle) ||
              p.en.toLowerCase().includes(needle),
          )
          .map((p) => jlptCard(p, key)),
      );
      const cards = [...basics, ...jlpt];
      list.innerHTML = cards.length
        ? cards.join("")
        : `<div class="empty-state"><div class="big">🔍</div>Nothing matches.</div>`;
      return;
    }

    list.innerHTML =
      dictLevel === "Basics"
        ? GRAMMAR_POINTS.map(basicsCard).join("")
        : JLPT_LEVELS.find((l) => l.key === dictLevel)!
            .points.map((p) => jlptCard(p, dictLevel))
            .join("");
  };

  for (const chip of body.querySelectorAll<HTMLButtonElement>(".gram-level-chip")) {
    chip.addEventListener("click", () => {
      dictLevel = chip.dataset.level!;
      search.value = "";
      body.querySelectorAll(".gram-level-chip").forEach((c) => c.classList.toggle("on", c === chip));
      draw();
    });
  }
  search.addEventListener("input", draw);
  draw();
}

// ---------------- helpers ----------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
