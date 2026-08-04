import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import {
  GRAMMAR_POINTS,
  GRAMMAR_UNITS,
  PARTICLE_JOB,
  SWAP_PAIRS,
  type SwapPair,
  type Chunk,
  type DrillKind,
  type GrammarUnit,
  type JlptPoint,
  type Sentence,
} from "./grammar-data.js";
import { generateSentences } from "./grammar-ai.js";
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
  /** For swap tasks: the pair of same-words-different-meaning sentences. */
  pair?: SwapPair;
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
      if (kind === "who" && !sentence.chunks.some((c) => c.role === "ghost")) continue;
      if (kind === "build") {
        // Particles count as pieces of their own, so even さくら｜が｜あるく
        // is a three-piece build.
        const pieceCount = sentence.chunks
          .filter((c) => c.role !== "ghost")
          .reduce((n, c) => n + (splitChunk(c).particle !== undefined ? 2 : 1), 0);
        if (pieceCount < 3) continue;
      }
      tasks.push({ kind, sentence });
    }
  }
  // Swap tasks come from their own pool, not from the unit's sentences.
  if (unit.drills.includes("swap")) {
    for (const pair of shuffle(SWAP_PAIRS).slice(0, 3)) {
      tasks.push({ kind: "swap", sentence: unit.sentences[0], pair });
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

/**
 * What the learner is asked, in ordinary words. The find-the-last-word
 * prompt borrows the wording of that sentence's own label ("what happens",
 * "what it is", "what it's like") so the question and the answer agree.
 */
function promptFor(task: Task): string {
  switch (task.kind) {
    case "find-engine": {
      const last = task.sentence.chunks.find((c) => c.role === "engine");
      return `Which word tells you ${last?.label ?? "what happens"}?`;
    }
    case "find-doer":
      return "Who or what is doing it?";
    case "particle":
      return "Which little word belongs here?";
    case "meaning":
      return "What does this say?";
    case "who":
      return "Nobody said who. Who does it mean here?";
    case "swap":
      return "Same words, different little words. Which one means this?";
    default:
      return "Put the sentence back together. The word that finishes it goes last.";
  }
}

async function runUnit(
  body: HTMLDivElement,
  unitIndex: number,
  progress: GrammarProgress,
  romaji: boolean,
  main: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  const base = GRAMMAR_UNITS[unitIndex];
  // Fresh sentences when the site can write them, so a unit replayed is a
  // new set of sentences rather than the same eight learned by heart. The
  // built-in ones stand in whenever that is not possible.
  body.innerHTML = `<div class="card-panel kana-quiz"><div class="glosses">Getting your sentences ready…</div></div>`;
  const fresh = await generateSentences(base, unitIndex).catch(() => null);
  if (!isCurrent() || !body.isConnected) return;
  const unit: GrammarUnit = fresh ? { ...base, sentences: fresh } : base;
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
        <div class="gram-prompt">${promptFor(task)}</div>
        ${
          // A swap task carries its own target sentence, shown with the
          // choices; the placeholder sentence must not appear above them.
          task.kind === "swap" || task.kind === "meaning"
            ? ""
            : `<div class="gram-en glosses">“${escapeHtml(task.sentence.en)}”</div>`
        }
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

    /**
     * Open the sentence up: each piece with its meaning and job, plus a tick
     * on the piece that was being asked for and a cross on the one tapped by
     * mistake. Colour alone never says right or wrong — every job has its own
     * colour, so the marks have to be explicit.
     */
    const reveal = (missed: boolean, note: string, marks?: { answer?: Chunk; mistake?: Chunk }): void => {
      settled = true;
      train.innerHTML = task.sentence.chunks
        .map((chunk) => {
          const mark =
            marks?.mistake === chunk ? " is-wrong" : marks?.answer === chunk ? " is-answer" : "";
          return chunkHtml(chunk, showRomaji, true, mark);
        })
        .join("");
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

    const right = (marks?: { answer?: Chunk }): void =>
      reveal(false, `<span class="ok-text">✓</span>`, marks);
    const wrong = (answerNote: string, marks?: { answer?: Chunk; mistake?: Chunk }): void =>
      reveal(true, `<span class="err-text">✗ ${answerNote}</span>`, marks);
    /** Name a piece the way a person would: 「ねる」(sleeps). */
    const name = (chunk: Chunk): string =>
      `<b lang="ja">${escapeHtml(chunk.t || "—")}</b>${chunk.g ? ` (${escapeHtml(chunk.g)})` : ""}`;

    if (task.kind === "find-engine" || task.kind === "find-doer") {
      const wantGhost = task.kind === "find-doer" && task.sentence.chunks.some((c) => c.role === "ghost");
      const wanted = task.kind === "find-engine" ? "engine" : "doer";
      train.innerHTML = task.sentence.chunks
        .filter((c) => c.role !== "ghost")
        .map((chunk, i) => `<button class="gram-car" data-i="${i}">${carRow(chunk, showRomaji)}</button>`)
        .join("");
      if (task.kind === "find-doer") {
        // The hidden-doer button appears once hiding is on the table at all,
        // so its presence never gives the answer away.
        if (unitIndex >= 1) {
          extra.innerHTML = `<button class="secondary gram-ghost-btn" id="gram-ghost">It's hidden (∅)</button>`;
          body.querySelector("#gram-ghost")!.addEventListener("click", () => {
            if (settled) return;
            const ghostChunk = task.sentence.chunks.find((c) => c.role === "ghost");
            const namedDoer = task.sentence.chunks.find((c) => c.role === "doer");
            if (wantGhost) right({ answer: ghostChunk });
            else wrong("someone <i>is</i> named here — look again", { answer: namedDoer });
          });
        }
      }
      const visible = task.sentence.chunks.filter((c) => c.role !== "ghost");
      for (const button of train.querySelectorAll<HTMLButtonElement>("button.gram-car")) {
        button.addEventListener("click", () => {
          if (settled) return;
          const chunk = visible[Number(button.dataset.i)];
          const hit = task.kind === "find-doer" ? chunk.role === "doer" && !wantGhost : chunk.role === wanted;
          const answer = task.sentence.chunks.find((c) =>
            wantGhost ? c.role === "ghost" : c.role === wanted,
          );
          if (hit) {
            right({ answer: chunk });
          } else if (task.kind === "find-doer" && wantGhost) {
            wrong("nobody is named in this one — it's left unsaid", { answer, mistake: chunk });
          } else {
            wrong(
              `${name(chunk)} is ${escapeHtml(chunk.label)}.` +
                (answer ? ` It's ${name(answer)}.` : ""),
              { answer, mistake: chunk },
            );
          }
        });
      }
      return;
    }

    // Read the whole sentence and pick what it says. Tests understanding
    // rather than labelling — the point of taking sentences apart at all.
    if (task.kind === "meaning") {
      train.innerHTML = task.sentence.chunks
        .filter((c) => c.role !== "ghost")
        .map((chunk) => carRow(chunk, showRomaji))
        .join("");
      const others = unit.sentences.filter((sn) => sn !== task.sentence).map((sn) => sn.en);
      const options = shuffle([task.sentence.en, ...shuffle(others).slice(0, 2)]);
      extra.innerHTML = `<div class="gram-options">${options
        .map((en) => `<button data-en="${escapeHtml(en)}">${escapeHtml(en)}</button>`)
        .join("")}</div>`;
      for (const button of extra.querySelectorAll<HTMLButtonElement>("button")) {
        button.addEventListener("click", () => {
          if (settled) return;
          if (button.dataset.en === task.sentence.en) right();
          else wrong(`it says “${escapeHtml(task.sentence.en)}”`);
        });
      }
      return;
    }

    // Nobody said who — so work it out. This is the habit that makes
    // Japanese readable, practised on purpose.
    if (task.kind === "who") {
      const hidden = task.sentence.chunks.find((c) => c.role === "ghost")!;
      train.innerHTML = task.sentence.chunks
        .map((chunk) => carRow(chunk, showRomaji, chunk.role, chunk.role === "ghost"))
        .join("");
      const pool = ["I", "you", "she", "he", "it", "they"];
      const options = shuffle([hidden.g, ...shuffle(pool.filter((w) => w !== hidden.g)).slice(0, 2)]);
      extra.innerHTML = `<div class="gram-options">${options
        .map((w) => `<button data-w="${escapeHtml(w)}">${escapeHtml(w)}</button>`)
        .join("")}</div>`;
      for (const button of extra.querySelectorAll<HTMLButtonElement>("button")) {
        button.addEventListener("click", () => {
          if (settled) return;
          if (button.dataset.w === hidden.g) right({ answer: hidden });
          else {
            wrong(`here it means “${escapeHtml(hidden.g)}” — ${escapeHtml(task.sentence.en)}`, {
              answer: hidden,
            });
          }
        });
      }
      return;
    }

    // The same words with the little words moved mean something else
    // entirely. Seeing that is the whole argument for paying attention to
    // them, so it gets a question of its own.
    if (task.kind === "swap") {
      const pair = task.pair!;
      const askA = Math.random() < 0.5;
      const want = askA ? pair.a : pair.b;
      const other = askA ? pair.b : pair.a;
      train.innerHTML = `<div class="gram-swap">${[want, other]
        .sort(() => (Math.random() < 0.5 ? 1 : -1))
        .map(
          (side) =>
            `<button class="gram-swap-line" data-en="${escapeHtml(side.en)}">
               <span lang="ja">${escapeHtml(side.jp)}</span>
               ${showRomaji ? `<span class="gram-romaji">${escapeHtml(side.r)}</span>` : ""}
             </button>`,
        )
        .join("")}</div>`;
      extra.innerHTML = `<div class="gram-swap-target">“${escapeHtml(want.en)}”</div>`;
      for (const button of train.querySelectorAll<HTMLButtonElement>(".gram-swap-line")) {
        button.addEventListener("click", () => {
          if (settled) return;
          settled = true;
          const got = button.dataset.en === want.en;
          train.innerHTML = `<div class="gram-swap">${[pair.a, pair.b]
            .map(
              (side) =>
                `<div class="gram-swap-line ${side.en === want.en ? "is-answer" : ""}">
                   <span lang="ja">${escapeHtml(side.jp)}</span>
                   <span class="gram-mean">${escapeHtml(side.en)}</span>
                 </div>`,
            )
            .join("")}</div>`;
          extra.innerHTML = `<div class="gram-lit">${escapeHtml(pair.note)}</div>`;
          feedback.innerHTML = got
            ? `<span class="ok-text">✓</span><div class="glosses">Enter (or tap) to continue</div>`
            : `<span class="err-text">✗ it's the other one</span><div class="glosses">Enter (or tap) to continue</div>`;
          void speak(want.jp.replace(/\s/g, ""), { rate: 0.85 }).catch(() => undefined);
          const panel = body.querySelector<HTMLDivElement>(".gram-quiz")!;
          panel.tabIndex = -1;
          panel.focus();
          setTimeout(() => {
            panel.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter") advance(!got);
            });
            panel.addEventListener("click", (ev) => {
              if (!(ev.target as HTMLElement).closest("#gram-quit")) advance(!got);
            });
          }, 0);
        });
      }
      return;
    }

    if (task.kind === "particle") {
      const at = task.chunkAt!;
      const target = task.sentence.chunks[at];
      const stem = splitChunk(target);
      train.innerHTML = task.sentence.chunks
        .filter((c) => c.role !== "ghost")
        .map((chunk) =>
          chunk === target
            ? `<span class="gram-car-row">${wordBlock(stem.word, stem.wordR, showRomaji)}<span class="gram-particle hole"><b class="gram-hole">?</b></span></span>`
            : carRow(chunk, showRomaji),
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
          if (button.dataset.p === target.p) {
            right();
          } else {
            const job = PARTICLE_JOB[target.p!];
            wrong(
              `it's <b lang="ja">${escapeHtml(target.p!)}</b>${job ? ` — ${escapeHtml(job)}` : ""}`,
            );
          }
        });
      }
      return;
    }

    // build: tap the scrambled pieces into a working sentence. The logical
    // particles carry the meaning, not the order — so ANY arrangement of
    // cars is right, as long as each word keeps its own coupling behind it,
    // a glued describing word stays just before its car, and the engine
    // comes last. That freedom is the lesson.
    interface BuildPiece {
      text: string;
      r: string;
      particle: boolean;
    }
    interface BuildCar {
      pieces: BuildPiece[];
      engine: boolean;
    }
    const cars: BuildCar[] = [];
    let carry: BuildPiece[] = [];
    for (const chunk of task.sentence.chunks.filter((c) => c.role !== "ghost")) {
      const s = splitChunk(chunk);
      const own: BuildPiece[] =
        s.particle !== undefined
          ? [
              { text: s.word, r: s.wordR, particle: false },
              { text: s.particle, r: s.particleR ?? "", particle: true },
            ]
          : [{ text: chunk.t, r: chunk.r, particle: false }];
      if (chunk.glue) {
        carry.push(...own); // rides with the car it describes
        continue;
      }
      cars.push({ pieces: [...carry, ...own], engine: chunk.role === "engine" });
      carry = [];
    }
    const allPieces = cars.flatMap((c) => c.pieces);

    let carAt: BuildCar | null = null; // the car being assembled
    let offset = 0;
    let placedCount = 0;
    let missed = false;
    const remaining = new Set(cars);

    const pieceHtml = (piece: BuildPiece): string =>
      `<span lang="ja">${escapeHtml(piece.text)}</span>${
        showRomaji ? `<span class="gram-romaji">${escapeHtml(piece.r)}</span>` : ""
      }`;

    train.innerHTML = `<div class="gram-slots" id="gram-answer"><span class="glosses" id="gram-answer-hint">Your sentence builds here.</span></div>`;
    const answer = train.querySelector<HTMLDivElement>("#gram-answer")!;
    extra.innerHTML = `<div class="gram-pieces">${shuffle(allPieces.map((c, i) => ({ c, i })))
      .map(
        ({ c, i }) =>
          `<button class="${c.particle ? "gram-particle" : "gram-chunk"}" data-i="${i}">${pieceHtml(c)}</button>`,
      )
      .join("")}</div>`;

    /** Which car would this text start, among those allowed to come next? */
    const carStarting = (text: string): BuildCar | null => {
      const open = [...remaining].filter((c) => !c.engine || remaining.size === 1);
      return open.find((c) => c.pieces[0].text === text) ?? null;
    };

    for (const button of extra.querySelectorAll<HTMLButtonElement>("[data-i]")) {
      button.addEventListener("click", () => {
        if (settled) return;
        const piece = allPieces[Number(button.dataset.i)];
        let target: { car: BuildCar; piece: BuildPiece } | null = null;
        if (carAt) {
          if (carAt.pieces[offset].text === piece.text) target = { car: carAt, piece: carAt.pieces[offset] };
        } else {
          const starts = carStarting(piece.text);
          if (starts) target = { car: starts, piece: starts.pieces[0] };
        }
        if (!target) {
          missed = true;
          button.classList.add("wrong");
          setTimeout(() => button.classList.remove("wrong"), 500);
          return;
        }

        if (!carAt) {
          carAt = target.car;
          offset = 0;
          remaining.delete(carAt);
        }
        answer.querySelector("#gram-answer-hint")?.remove();
        const placed = document.createElement("span");
        placed.className = `gram-slot filled${target.piece.particle ? " particle" : ""}`;
        placed.innerHTML = pieceHtml(target.piece);
        answer.appendChild(placed);
        button.disabled = true;
        button.style.visibility = "hidden";
        offset++;
        placedCount++;
        if (offset >= carAt.pieces.length) {
          carAt = null;
          offset = 0;
        }
        if (placedCount === allPieces.length) {
          if (missed) wrong("rebuilt, with wrong turns");
          else right();
        }
      });
    }
  };

  draw();
}

// ---------------- drawing the sentence ----------------

/**
 * A word and its little connecting word. The particle is not part of the
 * word: it is a small block of its own, tucked close behind the word it
 * belongs to — ペン ｜ が ｜ あかい — so the sentence reads as pieces
 * joined by connectors, which is what it is.
 */
function splitChunk(chunk: Chunk): { word: string; wordR: string; particle?: string; particleR?: string } {
  if (!chunk.p || !chunk.t.endsWith(chunk.p)) return { word: chunk.t, wordR: chunk.r };
  const word = chunk.t.slice(0, chunk.t.length - chunk.p.length);
  const space = chunk.r.lastIndexOf(" ");
  return {
    word,
    wordR: space > 0 ? chunk.r.slice(0, space) : chunk.r,
    particle: chunk.p,
    particleR: space > 0 ? chunk.r.slice(space + 1) : "",
  };
}

/**
 * One word block: the Japanese, its romaji, and — once the answer is shown
 * — what it means in English. The meaning is the whole point, so it sits
 * right under the word rather than off in a translation somewhere.
 */
function wordBlock(
  text: string,
  romaji: string,
  showRomaji: boolean,
  role?: string,
  meaning?: string,
): string {
  return `<span class="gram-chunk${role ? ` role-${role}` : ""}"><span lang="ja">${escapeHtml(text)}</span>${
    showRomaji ? `<span class="gram-romaji">${escapeHtml(romaji)}</span>` : ""
  }${meaning ? `<span class="gram-mean">${escapeHtml(meaning)}</span>` : ""}</span>`;
}

/** A connecting word, with its job shown underneath once the answer is up. */
function particleBlock(
  text: string,
  romaji: string,
  showRomaji: boolean,
  ghost = false,
  flag = false,
  job?: string,
): string {
  return `<span class="gram-particle${ghost ? " role-ghost" : ""}${flag ? " flag" : ""}"><span lang="ja">${escapeHtml(
    text,
  )}</span>${showRomaji ? `<span class="gram-romaji">${escapeHtml(romaji)}</span>` : ""}${
    job ? `<span class="gram-job">${escapeHtml(job)}</span>` : ""
  }</span>`;
}

/**
 * The word with its connector beside it. An unsaid doer is drawn as a
 * dashed block holding the English it stands for — (I), (it) — because
 * that is the only thing a beginner can actually see about it.
 */
function carRow(chunk: Chunk, showRomaji: boolean, role?: string, open = false): string {
  if (chunk.role === "ghost") {
    return `<span class="gram-car-row">${wordBlock(
      `(${chunk.g})`,
      "",
      false,
      "ghost",
      open ? "nobody said it" : undefined,
    )}</span>`;
  }
  const { word, wordR, particle, particleR } = splitChunk(chunk);
  return `<span class="gram-car-row">${wordBlock(word, wordR, showRomaji, role, open ? chunk.g : undefined)}${
    particle !== undefined
      ? particleBlock(
          particle,
          particleR ?? "",
          showRomaji,
          false,
          particle === "は",
          open ? PARTICLE_JOB[particle] : undefined,
        )
      : ""
  }</span>`;
}

/** A piece in the opened-up sentence: meaning under the word, job under that. */
function chunkHtml(chunk: Chunk, romaji: boolean, labelled: boolean, mark = ""): string {
  return `<span class="gram-car${mark}">
    ${carRow(chunk, romaji, chunk.role, true)}
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
