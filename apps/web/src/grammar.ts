import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import {
  GRAMMAR_POINTS,
  GRAMMAR_UNITS,
  type Chunk,
  type DrillKind,
  type GrammarUnit,
  type JlptPoint,
  type Sentence,
} from "./grammar-data.js";
import { N5_POINTS } from "./grammar-jlpt-n5.js";
import { N4_POINTS } from "./grammar-jlpt-n4.js";
import { N3_POINTS } from "./grammar-jlpt-n3.js";
import { N1_POINTS, N2_POINTS } from "./grammar-jlpt-n2n1.js";

/**
 * The Grammar tab: sentence dissection from zero, plus a plain-words
 * grammar dictionary.
 *
 * Practice runs in units that unlock in order, each a queue of small tasks
 * over the unit's sentences: tap the engine, tap the doer (or call out the
 * hidden one), fill in the blanked particle, rebuild the scrambled train.
 * Every answer opens the sentence up — each car coloured and labelled in
 * plain words, the literal skeleton shown when it differs — so the teaching
 * happens by seeing sentences taken apart, not by reading explanations.
 *
 * Deliberately not wired into quests or XP yet: kana comes first.
 */

const GAME_KEY = "grammarGame";
const ROMAJI_KEY = "grammarRomaji";

interface GrammarProgress {
  /** The next unit to clear; units below it are done. */
  unlocked: number;
}

let view: "practice" | "dictionary" = "practice";

export async function renderGrammar(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const progress = (await getMeta<GrammarProgress>(GAME_KEY)) ?? { unlocked: 0 };
  const romaji = (await getMeta<boolean>(ROMAJI_KEY)) ?? true;
  if (!isCurrent()) return;

  main.innerHTML = `
    <h1>Grammar</h1>
    <div class="segmented">
      <button data-view="practice" class="${view === "practice" ? "on" : ""}">Practice</button>
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
  else renderUnits(body, progress, romaji, main, isCurrent);
}

// ---------------- the unit list ----------------

function renderUnits(
  body: HTMLDivElement,
  progress: GrammarProgress,
  romaji: boolean,
  main: HTMLElement,
  isCurrent: () => boolean,
): void {
  body.innerHTML = `
    <label class="unseen-toggle" style="margin-bottom:12px">
      <input type="checkbox" id="gram-romaji" ${romaji ? "checked" : ""} />
      Show romaji
    </label>
    <div id="gram-units"></div>
  `;

  body.querySelector<HTMLInputElement>("#gram-romaji")!.addEventListener("change", async (ev) => {
    await setMeta(ROMAJI_KEY, (ev.target as HTMLInputElement).checked);
    void renderGrammar(main, isCurrent);
  });

  const list = body.querySelector<HTMLDivElement>("#gram-units")!;
  GRAMMAR_UNITS.forEach((unit, index) => {
    const state = index < progress.unlocked ? "done" : index === progress.unlocked ? "next" : "locked";
    const panel = document.createElement("div");
    panel.className = `card-panel gram-unit ${state}`;
    panel.innerHTML = `
      <div class="gram-unit-head">
        <div>
          <div class="gram-unit-title">${index + 1}. ${escapeHtml(unit.title)}
            ${state === "done" ? " ✓" : state === "locked" ? " 🔒" : ""}</div>
          <div class="glosses">${escapeHtml(unit.tagline)}</div>
        </div>
        ${
          state === "locked"
            ? ""
            : `<button class="gram-go ${state === "done" ? "secondary" : ""}">${state === "done" ? "Again" : "Start"}</button>`
        }
      </div>
    `;
    panel.querySelector<HTMLButtonElement>(".gram-go")?.addEventListener("click", () => {
      void runUnit(body, index, progress, romaji, main, isCurrent);
    });
    list.appendChild(panel);
  });
}

// ---------------- the practice engine ----------------

interface Task {
  kind: DrillKind;
  sentence: Sentence;
  /** For particle tasks: which chunk is blanked. */
  chunkAt?: number;
}

function tasksFor(unit: GrammarUnit): Task[] {
  const tasks: Task[] = [];
  for (const kind of unit.drills) {
    for (const sentence of unit.sentences) {
      if (kind === "find-doer" && !sentence.chunks.some((c) => c.role === "doer" || c.role === "ghost")) continue;
      if (kind === "particle") {
        const spots = sentence.chunks.map((c, i) => (c.q && c.p ? i : -1)).filter((i) => i >= 0);
        if (spots.length === 0) continue;
        tasks.push({ kind, sentence, chunkAt: spots[Math.floor(Math.random() * spots.length)] });
        continue;
      }
      if (kind === "build" && sentence.chunks.filter((c) => c.role !== "ghost").length < 3) continue;
      tasks.push({ kind, sentence });
    }
  }
  // Drills stay in teaching order (easy first); sentences shuffle within each.
  const byKind = new Map<DrillKind, Task[]>();
  for (const task of tasks) {
    if (!byKind.has(task.kind)) byKind.set(task.kind, []);
    byKind.get(task.kind)!.push(task);
  }
  return unit.drills.flatMap((kind) => shuffle(byKind.get(kind) ?? []));
}

const PROMPTS: Record<DrillKind, string> = {
  "find-engine": "Tap the engine — the part that says what happens, or what something is.",
  "find-doer": "Tap who or what this sentence is really about.",
  particle: "Which little word goes in the blank?",
  build: "Rebuild the sentence: tap the cars in order. The engine goes last.",
};

async function runUnit(
  body: HTMLDivElement,
  unitIndex: number,
  progress: GrammarProgress,
  romaji: boolean,
  main: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  const unit = GRAMMAR_UNITS[unitIndex];
  const queue = tasksFor(unit);
  const total = queue.length;
  let done = 0;
  let active = true;

  const backToUnits = (): void => {
    active = false;
    void renderGrammar(main, isCurrent);
  };

  const finish = async (): Promise<void> => {
    progress.unlocked = Math.max(progress.unlocked, unitIndex + 1);
    await setMeta(GAME_KEY, progress);
    if (!isCurrent()) return;
    const next = unitIndex + 1 < GRAMMAR_UNITS.length ? GRAMMAR_UNITS[unitIndex + 1] : null;
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">🎉</div>
        <div class="kana-score">${escapeHtml(unit.title)} clear</div>
        ${next ? `<div class="glosses">Next: ${escapeHtml(next.title)}</div>` : `<div class="glosses">That's every unit so far.</div>`}
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          ${next ? `<button id="gram-next">Continue</button>` : ""}
          <button id="gram-back" class="secondary">Back to units</button>
        </div>
      </div>`;
    body.querySelector("#gram-next")?.addEventListener("click", () => {
      void runUnit(body, unitIndex + 1, progress, romaji, main, isCurrent);
    });
    body.querySelector("#gram-back")!.addEventListener("click", backToUnits);
  };

  const draw = (): void => {
    const task = queue[0];
    const percent = Math.round((done / total) * 100);
    const showRomaji = romaji;

    body.innerHTML = `
      <div class="card-panel kana-quiz gram-quiz">
        <div class="kana-quiz-top">
          <span class="glosses">${unitIndex + 1}. ${escapeHtml(unit.title)}</span>
          <span class="glosses">${done}/${total}</span>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${percent}%"></div></div>
        <div class="gram-prompt">${PROMPTS[task.kind]}</div>
        <div class="gram-en glosses">“${escapeHtml(task.sentence.en)}”</div>
        <div class="gram-train" id="gram-train"></div>
        <div id="gram-extra"></div>
        <div class="kana-feedback" id="gram-feedback"></div>
        <div class="row-actions" style="justify-content:center">
          <button id="gram-quit" class="ghost">Stop</button>
        </div>
      </div>
    `;
    body.querySelector("#gram-quit")!.addEventListener("click", backToUnits);

    const train = body.querySelector<HTMLDivElement>("#gram-train")!;
    const extra = body.querySelector<HTMLDivElement>("#gram-extra")!;
    const feedback = body.querySelector<HTMLDivElement>("#gram-feedback")!;
    let settled = false;

    const advance = (missed: boolean): void => {
      if (!active || !body.isConnected) return;
      queue.shift();
      if (missed) queue.push(task); // it comes round again
      else done++;
      if (queue.length === 0) void finish();
      else draw();
    };

    /** Open the sentence up: every car coloured and labelled, then continue. */
    const reveal = (missed: boolean, note: string): void => {
      settled = true;
      train.innerHTML = task.sentence.chunks.map((chunk) => chunkHtml(chunk, showRomaji, true)).join("");
      extra.innerHTML = task.sentence.lit
        ? `<div class="gram-lit">literally: ${escapeHtml(task.sentence.lit)}</div>`
        : "";
      feedback.innerHTML = `${note}<div class="glosses">Enter (or tap) to continue</div>`;
      void speak(spoken(task.sentence), { rate: 0.85 }).catch(() => undefined);
      const panel = body.querySelector<HTMLDivElement>(".gram-quiz")!;
      panel.tabIndex = -1;
      panel.focus();
      setTimeout(() => {
        panel.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") advance(missed);
        });
        panel.addEventListener("click", (ev) => {
          if (!(ev.target as HTMLElement).closest("#gram-quit")) advance(missed);
        });
      }, 0);
    };

    const right = (): void => reveal(false, `<span class="ok-text">✓</span>`);
    const wrong = (answerNote: string): void => reveal(true, `<span class="err-text">✗ ${answerNote}</span>`);

    if (task.kind === "find-engine" || task.kind === "find-doer") {
      const wantGhost = task.kind === "find-doer" && task.sentence.chunks.some((c) => c.role === "ghost");
      const wanted = task.kind === "find-engine" ? "engine" : "doer";
      train.innerHTML = task.sentence.chunks
        .filter((c) => c.role !== "ghost")
        .map((chunk, i) => `<button class="gram-chunk" data-i="${i}">${chunkInner(chunk, showRomaji)}</button>`)
        .join("");
      if (task.kind === "find-doer") {
        // The hidden-doer button appears once hiding is on the table at all,
        // so its presence never gives the answer away.
        if (unitIndex >= 1) {
          extra.innerHTML = `<button class="secondary gram-ghost-btn" id="gram-ghost">It's hidden (∅)</button>`;
          body.querySelector("#gram-ghost")!.addEventListener("click", () => {
            if (settled) return;
            if (wantGhost) right();
            else wrong("it's right there in the sentence");
          });
        }
      }
      const visible = task.sentence.chunks.filter((c) => c.role !== "ghost");
      for (const button of train.querySelectorAll<HTMLButtonElement>(".gram-chunk")) {
        button.addEventListener("click", () => {
          if (settled) return;
          const chunk = visible[Number(button.dataset.i)];
          const hit = task.kind === "find-doer" ? chunk.role === "doer" && !wantGhost : chunk.role === wanted;
          if (hit) right();
          else if (task.kind === "find-doer" && wantGhost) wrong("the doer is hiding in this one");
          else wrong(`that car is ${escapeHtml(chunk.label)}`);
        });
      }
      return;
    }

    if (task.kind === "particle") {
      const at = task.chunkAt!;
      const target = task.sentence.chunks[at];
      const stem = target.t.slice(0, target.t.length - target.p!.length);
      train.innerHTML = task.sentence.chunks
        .filter((c) => c.role !== "ghost")
        .map((chunk) =>
          chunk === target
            ? `<span class="gram-chunk hole">${escapeHtml(stem)}<b class="gram-hole">?</b>${
                showRomaji ? `<span class="gram-romaji">${escapeHtml(chunk.r)}</span>` : ""
              }</span>`
            : `<span class="gram-chunk">${chunkInner(chunk, showRomaji)}</span>`,
        )
        .join("");
      const options = shuffle([...new Set([target.p!, ...unit.particles])]).slice(0, 4);
      if (!options.includes(target.p!)) options[0] = target.p!;
      extra.innerHTML = `<div class="kana-choices">${shuffle(options)
        .map((p) => `<button data-p="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
        .join("")}</div>`;
      for (const button of extra.querySelectorAll<HTMLButtonElement>("button")) {
        button.addEventListener("click", () => {
          if (settled) return;
          if (button.dataset.p === target.p) right();
          else wrong(`${escapeHtml(stem)}<b>${escapeHtml(target.p!)}</b>`);
        });
      }
      return;
    }

    // build: tap the scrambled cars back into order.
    const pieces = task.sentence.chunks.filter((c) => c.role !== "ghost");
    let at = 0;
    let missed = false;
    train.innerHTML = `<div class="gram-slots" id="gram-slots">${pieces.map(() => `<span class="gram-slot"></span>`).join("")}</div>`;
    const slots = train.querySelectorAll<HTMLSpanElement>(".gram-slot");
    extra.innerHTML = `<div class="gram-pieces">${shuffle(pieces.map((c, i) => ({ c, i })))
      .map(({ c, i }) => `<button class="gram-chunk" data-i="${i}">${chunkInner(c, showRomaji)}</button>`)
      .join("")}</div>`;
    for (const button of extra.querySelectorAll<HTMLButtonElement>(".gram-chunk")) {
      button.addEventListener("click", () => {
        if (settled) return;
        const index = Number(button.dataset.i);
        if (index === at) {
          slots[at].innerHTML = chunkInner(pieces[at], showRomaji);
          slots[at].classList.add("filled");
          button.disabled = true;
          button.style.visibility = "hidden";
          at++;
          if (at === pieces.length) {
            if (missed) wrong("rebuilt, with wrong turns");
            else right();
          }
        } else {
          missed = true;
          button.classList.add("wrong");
          setTimeout(() => button.classList.remove("wrong"), 500);
        }
      });
    }
  };

  draw();
}

// ---------------- rendering the train ----------------

function chunkInner(chunk: Chunk, romaji: boolean): string {
  return `<span lang="ja">${escapeHtml(chunk.t)}</span>${
    romaji ? `<span class="gram-romaji">${escapeHtml(chunk.r)}</span>` : ""
  }`;
}

/** A car in the opened-up sentence: coloured by role, labelled in plain words. */
function chunkHtml(chunk: Chunk, romaji: boolean, labelled: boolean): string {
  return `<span class="gram-chunk role-${chunk.role}">
    ${chunkInner(chunk, romaji)}
    ${labelled ? `<span class="gram-label">${escapeHtml(chunk.label)}</span>` : ""}
  </span>`;
}

function spoken(sentence: Sentence): string {
  return sentence.chunks
    .filter((c) => c.role !== "ghost")
    .map((c) => c.t)
    .join("");
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

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
