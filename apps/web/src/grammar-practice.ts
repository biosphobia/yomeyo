import { speak } from "./audio.js";
import { cheerBox, preloadReactions, showReaction } from "./feedback.js";
import {
  GRAMMAR_UNITS,
  PARTICLE_JOB,
  SWAP_PAIRS,
  type Chunk,
  type DrillKind,
  type GrammarUnit,
  type Sentence,
  type SwapPair,
} from "./grammar-data.js";
import { generateSentences } from "./grammar-ai.js";
import { PER_CORRECT, earnYennies, formatYennies, yennies } from "./yennies.js";
import { carRow, chunkHtml, romajiOf, spoken, splitChunk, wordBlock } from "./grammar-draw.js";

/**
 * The grammar drill engine: one unit of sentence-dissection tasks.
 *
 * Extracted from the old Practice tab so the Course can call it: a chapter
 * is read, then drilled, then tested, all in one flow. The engine itself
 * is unchanged — a queue of small tasks over the unit's sentences (tap the
 * ending, tap the doer, fill the blanked particle, rebuild the scrambled
 * train), every answer opening the sentence up with each piece coloured
 * and labelled in plain words.
 *
 * Where the run goes when it ends is the caller's business, through
 * `hooks`: the course returns to its chapter page, marking the drill done.
 */

export interface UnitHooks {
  /** Quit, or Back from the clear screen. */
  onExit: () => void;
  /** The unit was cleared (fires once, before the clear screen shows). */
  onCleared: () => void | Promise<void>;
  /** The clear screen's continue button, e.g. "Back to the chapter". */
  continueLabel?: string;
}

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
      // Swap tasks are built below, from their own pool of sentence pairs.
      // Making one per unit sentence produced tasks with no pair to show.
      if (kind === "swap") continue;
      // Three sentences to choose between, or it is not a choice.
      if ((kind === "translate" || kind === "listen") && unit.sentences.length < 3) continue;
      // Moving the ending needs something for it to move past.
      if (kind === "real" && sentence.chunks.filter((c) => c.role !== "ghost").length < 2) continue;
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
  // A few of each, not every sentence through every drill: a unit that runs
  // to forty questions gets abandoned halfway whatever is in it.
  const PER_KIND = 4;
  return unit.drills.flatMap((kind) => shuffle(byKind.get(kind) ?? []).slice(0, PER_KIND));
}

/**
 * The ending's meaning, bent into something a question can be built around.
 *
 * The doer question used to read "Who or what is doing it?", which is a lie
 * about half the sentences in the course: the water is not *doing* being
 * cold. Asking "Who or what is cold?" instead is both true and answerable
 * without knowing a word of grammar.
 */
function endingAsked(sentence: Sentence): string {
  const engine = sentence.chunks.find((c) => c.role === "engine");
  const gloss = (engine?.g ?? "").trim();
  return gloss ? thirdPerson(gloss) : "is doing it";
}

/** Irregulars, and the ones that never take an -s at all. */
const THIRD_PERSON: Record<string, string> = {
  am: "is",
  are: "is",
  were: "was",
  have: "has",
  do: "does",
  is: "is",
  was: "was",
  has: "has",
  does: "does",
  did: "did",
  will: "will",
  can: "can",
  could: "could",
  would: "would",
  should: "should",
  must: "must",
  might: "might",
};

/**
 * A meaning written to read in its own sentence, bent to read in a question.
 *
 * The glosses say what the sentence says — "I buy", "we eat" — so lifting one
 * straight into "Who or what …?" produces "Who or what buy?". Only the first
 * word changes, and only when it plainly needs to.
 */
function thirdPerson(gloss: string): string {
  const parts = gloss.split(" ");
  const word = parts[0];
  const lower = word.toLowerCase();
  if (lower in THIRD_PERSON) {
    parts[0] = THIRD_PERSON[lower];
  } else if (/^[a-z]+$/.test(lower) && !lower.endsWith("s")) {
    parts[0] = /(?:ch|sh|x|z|o)$/.test(lower)
      ? `${word}es`
      : /[^aeiou]y$/.test(lower)
        ? `${word.slice(0, -1)}ies`
        : `${word}s`;
  }
  return parts.join(" ");
}

/** What the learner is asked, in ordinary words — never grammar words. */
function promptFor(task: Task): string {
  switch (task.kind) {
    case "find-engine":
      return "These are jumbled. Which one has to come last?";
    case "find-doer":
      return `Who or what ${endingAsked(task.sentence)}?`;
    case "particle":
      return "Which little word belongs here?";
    case "meaning":
      return "What does this say?";
    case "translate":
      return "Which one says this?";
    case "real":
      return "One of these is a real sentence. Which?";
    case "listen":
      return "Listen. Which one was it?";
    case "who":
      return "Nobody said who. Who does it mean here?";
    case "swap":
      return "Same words, different little words. Which one means this?";
    default:
      return "Build this sentence.";
  }
}

export async function runUnit(
  body: HTMLDivElement,
  unitIndex: number,
  romaji: boolean,
  isCurrent: () => boolean,
  hooks: UnitHooks,
): Promise<void> {
  const base = GRAMMAR_UNITS[unitIndex];
  // Fresh sentences when the site can write them, so a unit replayed is a
  // new set of sentences rather than the same eight learned by heart. The
  // built-in ones stand in whenever that is not possible.
  body.innerHTML = `<div class="card-panel kana-quiz"><div class="glosses">Getting your sentences ready…</div></div>`;
  void preloadReactions();
  const fresh = await generateSentences(base, unitIndex).catch(() => null);
  if (!isCurrent() || !body.isConnected) return;
  const unit: GrammarUnit = fresh ? { ...base, sentences: fresh } : base;
  const queue = tasksFor(unit);
  const total = queue.length;
  let done = 0;
  let active = true;

  const leave = (): void => {
    active = false;
    for (const undo of cleanups) undo();
    cleanups = [];
    hooks.onExit();
  };

  const finish = async (): Promise<void> => {
    await hooks.onCleared();
    // Banked and shown once, here, and nowhere during the drills.
    const earned = gotRight * PER_CORRECT;
    const balance = earned > 0 ? await earnYennies(earned) : await yennies();
    const purse = `<div class="yen-line">${
      earned > 0 ? `<b>+${earned.toLocaleString()}</b> · ` : ""
    }${formatYennies(balance)}</div>`;
    if (!isCurrent() || !body.isConnected) return;
    body.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">🎉</div>
        <div class="kana-score">${escapeHtml(unit.title)} clear</div>
        ${purse}
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="gram-next">${escapeHtml(hooks.continueLabel ?? "Continue")}</button>
        </div>
      </div>`;
    body.querySelector("#gram-next")!.addEventListener("click", leave);
  };

  // A drill that reaches outside its own markup — the build drill listens on
  // the window so a finger leaving the tray is still heard — leaves its
  // undo here, and the next question runs it before drawing.
  let cleanups: (() => void)[] = [];
  /** Right answers this run, which is what the run pays out on. */
  let gotRight = 0;

  const draw = (): void => {
    for (const undo of cleanups) undo();
    cleanups = [];
    const task = queue[0];
    const percent = Math.round((done / total) * 100);
    const showRomaji = romaji;

    body.innerHTML = `
      <div class="card-panel kana-quiz gram-quiz">
        <div class="kana-quiz-top">
          <button id="gram-quit" class="quiz-stop" title="Stop" aria-label="Stop">✕</button>
          <span class="glosses">${escapeHtml(unit.title)}</span>
          <span class="glosses">${done}/${total}</span>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${percent}%"></div></div>
        <div class="gram-prompt">${promptFor(task)}</div>
        ${
          // A swap task carries its own target sentence, shown with the
          // choices; the placeholder sentence must not appear above them.
          // The others are questions the English would answer outright.
          task.kind === "swap" || task.kind === "meaning" || task.kind === "listen"
            ? ""
            : `<div class="gram-en glosses">“${escapeHtml(task.sentence.en)}”</div>`
        }
        <div class="gram-train" id="gram-train"></div>
        <div id="gram-extra"></div>
        <div class="kana-feedback" id="gram-feedback"></div>
      </div>
      ${cheerBox("gram-cheer")}
    `;
    body.querySelector("#gram-quit")!.addEventListener("click", leave);

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
      if (!missed) gotRight++;
      feedback.innerHTML = `${note}<div class="ai-why" id="gram-why">…</div><div class="glosses">Enter (or tap) to continue</div>`;
      // Claude's line or two on why, while the sentence is still open on
      // screen. Never waited on: the dots resolve or quietly go.
      {
        const whyBox = feedback.querySelector<HTMLDivElement>("#gram-why");
        const plain = (html: string): string => html.replace(/<[^>]+>/g, "").trim();
        const nameOf = (chunk?: Chunk): string | null =>
          chunk ? `${chunk.t || "(nothing said)"}${chunk.g ? ` (${chunk.g})` : ""}` : null;
        const jp = task.sentence.chunks
          .filter((c) => c.role !== "ghost")
          .map((c) => c.t)
          .join("");
        void import("./grammar-ai.js")
          .then((ai) =>
            ai.explainAnswer({
              question: plain(promptFor(task)),
              sentence: `${jp} = "${task.sentence.en}"`,
              picked:
                nameOf(marks?.mistake) ??
                (missed ? plain(note) || "a different piece" : (nameOf(marks?.answer) ?? "the correct piece")),
              correct: nameOf(marks?.answer) ?? (plain(note) || "the shown answer"),
              wasRight: !missed,
            }),
          )
          .then((why) => {
            if (!whyBox?.isConnected) return;
            if (why) whyBox.textContent = why;
            else whyBox.remove();
          })
          .catch(() => whyBox?.remove());
      }
      void showReaction(body.querySelector("#gram-cheer"), missed ? "wrong" : "correct");
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

    /**
     * Which word has to come last?
     *
     * Shown in the sentence's own order this was no question at all: the
     * ending is always last, so tapping the last card won every time without
     * reading anything. Jumbled, the same question is the rule itself —
     * find the word that says what happens, because that is the one Japanese
     * puts at the end.
     */
    if (task.kind === "find-engine") {
      const visible = task.sentence.chunks.filter((c) => c.role !== "ghost");
      const shown = shuffle(visible.map((chunk, i) => ({ chunk, i })));
      train.innerHTML = shown
        .map(({ i }) => `<button class="gram-car" data-i="${i}">${carRow(visible[i], showRomaji)}</button>`)
        .join("");
      const answer = visible.find((c) => c.role === "engine");
      for (const button of train.querySelectorAll<HTMLButtonElement>("button.gram-car")) {
        button.addEventListener("click", () => {
          if (settled) return;
          const chunk = visible[Number(button.dataset.i)];
          if (chunk.role === "engine") right({ answer: chunk });
          else {
            wrong(
              `${name(chunk)} is ${escapeHtml(chunk.label)}. The last word is ${name(answer!)}.`,
              { answer, mistake: chunk },
            );
          }
        });
      }
      return;
    }

    /**
     * Who or what is the ending about?
     *
     * When nobody says who, the answer is an extra card reading "not said" —
     * a card you can actually tap. It is offered from the chapter where
     * leaving the doer out is first taught onwards, so its presence gives
     * nothing away.
     */
    if (task.kind === "find-doer") {
      const ghostChunk = task.sentence.chunks.find((c) => c.role === "ghost");
      const visible = task.sentence.chunks.filter((c) => c.role !== "ghost");
      train.innerHTML = visible
        .map((chunk, i) => `<button class="gram-car" data-i="${i}">${carRow(chunk, showRomaji)}</button>`)
        .join("");
      if (unitIndex >= 1) {
        extra.innerHTML = `
          <button class="gram-car gram-unsaid" id="gram-ghost">
            <span class="gram-car-row"><span class="gram-chunk role-ghost">
              <span>not said</span><span class="gram-mean">it isn't in the sentence</span>
            </span></span>
          </button>`;
        body.querySelector("#gram-ghost")!.addEventListener("click", () => {
          if (settled) return;
          if (ghostChunk) {
            reveal(
              false,
              `<span class="ok-text">✓ nobody says who — here it means “${escapeHtml(ghostChunk.g)}”.</span>`,
              { answer: ghostChunk },
            );
          } else {
            const named = task.sentence.chunks.find((c) => c.role === "doer");
            wrong(`it is said here — it's ${name(named!)}.`, { answer: named });
          }
        });
      }
      for (const button of train.querySelectorAll<HTMLButtonElement>("button.gram-car")) {
        button.addEventListener("click", () => {
          if (settled) return;
          const chunk = visible[Number(button.dataset.i)];
          if (!ghostChunk && chunk.role === "doer") {
            right({ answer: chunk });
          } else if (ghostChunk) {
            wrong(
              `${name(chunk)} is ${escapeHtml(chunk.label)}. Nobody says who at all here — ` +
                `Japanese leaves it out when it's obvious, and this one means “${escapeHtml(ghostChunk.g)}”.`,
              { answer: ghostChunk, mistake: chunk },
            );
          } else {
            const named = task.sentence.chunks.find((c) => c.role === "doer");
            wrong(
              `${name(chunk)} is ${escapeHtml(chunk.label)}.` + (named ? ` It's ${name(named)}.` : ""),
              { answer: named, mistake: chunk },
            );
          }
        });
      }
      return;
    }

    /**
     * One of these is a real sentence — the other has its ending somewhere
     * else. Nothing else changes, so the only way to tell them apart is the
     * rule the whole course rests on.
     */
    if (task.kind === "real") {
      const visible = task.sentence.chunks.filter((c) => c.role !== "ghost");
      const real = visible.map((c) => c.t).join(" ");
      // Move the ending out of last place; where it lands does not matter,
      // only that it no longer ends the sentence.
      const ending = visible[visible.length - 1];
      const rest = visible.slice(0, -1).map((c) => c.t);
      const broken = [ending.t, ...rest].join(" ");
      const lines = shuffle([
        { text: real, ok: true },
        { text: broken, ok: false },
      ]);
      train.innerHTML = `<div class="gram-swap">${lines
        .map(
          (line) =>
            `<button class="gram-swap-line" data-ok="${line.ok}">
               <span lang="ja">${escapeHtml(line.text)}</span>
             </button>`,
        )
        .join("")}</div>`;
      for (const button of train.querySelectorAll<HTMLButtonElement>(".gram-swap-line")) {
        button.addEventListener("click", () => {
          if (settled) return;
          if (button.dataset.ok === "true") {
            right({ answer: ending });
          } else {
            wrong(
              `${name(ending)} says ${escapeHtml(ending.label)}, so it has to come last.`,
              { answer: ending },
            );
          }
        });
      }
      return;
    }

    /**
     * English first, Japanese second: the direction you need to speak in,
     * and the one a course of tap-the-right-word never practises.
     */
    if (task.kind === "translate") {
      const others = unit.sentences.filter((sn) => sn !== task.sentence);
      const options = shuffle([task.sentence, ...shuffle(others).slice(0, 2)]);
      train.innerHTML = `<div class="gram-swap">${options
        .map(
          (sn) =>
            `<button class="gram-swap-line" data-en="${escapeHtml(sn.en)}">
               <span lang="ja">${escapeHtml(spoken(sn))}</span>
               ${showRomaji ? `<span class="gram-romaji">${escapeHtml(romajiOf(sn))}</span>` : ""}
             </button>`,
        )
        .join("")}</div>`;
      for (const button of train.querySelectorAll<HTMLButtonElement>(".gram-swap-line")) {
        button.addEventListener("click", () => {
          if (settled) return;
          if (button.dataset.en === task.sentence.en) right();
          else wrong(`“${escapeHtml(task.sentence.en)}” is the one below.`);
        });
      }
      return;
    }

    /** Hear it, then pick it out. Reading is not the only way in. */
    if (task.kind === "listen") {
      const others = unit.sentences.filter((sn) => sn !== task.sentence);
      const options = shuffle([task.sentence, ...shuffle(others).slice(0, 2)]);
      const say = (): void => void speak(spoken(task.sentence), { rate: 0.8 }).catch(() => undefined);
      extra.innerHTML = `<div class="row-actions" style="justify-content:center"><button id="gram-hear">🔊 Play again</button></div>`;
      extra.querySelector("#gram-hear")!.addEventListener("click", (ev) => {
        ev.stopPropagation();
        say();
      });
      train.innerHTML = `<div class="gram-swap">${options
        .map(
          (sn) =>
            `<button class="gram-swap-line" data-en="${escapeHtml(sn.en)}">
               <span lang="ja">${escapeHtml(spoken(sn))}</span>
               <span class="gram-mean">${escapeHtml(sn.en)}</span>
             </button>`,
        )
        .join("")}</div>`;
      say();
      for (const button of train.querySelectorAll<HTMLButtonElement>(".gram-swap-line")) {
        button.addEventListener("click", () => {
          if (settled) return;
          if (button.dataset.en === task.sentence.en) right();
          else wrong(`it was <b lang="ja">${escapeHtml(spoken(task.sentence))}</b>.`);
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
      // The gap is drawn as a gap. Showing (it) here printed the answer on
      // the card above the question, on a card that could not be tapped
      // either — so it read as a dead choice giving the game away.
      train.innerHTML = task.sentence.chunks
        .map((chunk) =>
          chunk.role === "ghost"
            ? carRow({ ...chunk, g: "?" }, showRomaji, chunk.role, true)
            : carRow(chunk, showRomaji, chunk.role),
        )
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
          if (got) gotRight++;
          void showReaction(body.querySelector("#gram-cheer"), got ? "correct" : "wrong");
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

    /**
     * Build the sentence by dragging its pieces into place.
     *
     * The little connecting words carry the roles, not the positions, so any
     * order of the noun pieces is right — as long as each word keeps its own
     * connector directly behind it, a describing word stays immediately
     * before what it describes, and the ending comes last. That freedom is
     * the lesson, so the arrangement is judged when it is finished rather
     * than one tap at a time.
     */
    interface BuildPiece {
      text: string;
      r: string;
      kind: "word" | "particle" | "tail";
    }
    interface BuildCar {
      pieces: BuildPiece[];
      engine: boolean;
    }
    const cars: BuildCar[] = [];
    let carry: BuildPiece[] = [];
    for (const chunk of task.sentence.chunks.filter((c) => c.role !== "ghost")) {
      const s = splitChunk(chunk);
      const own: BuildPiece[] = [{ text: s.word, r: s.wordR, kind: "word" }];
      if (s.particle !== undefined) own.push({ text: s.particle, r: s.particleR ?? "", kind: "particle" });
      // だ is a piece of its own here too, so the learner puts "is" in place
      // themselves rather than finding it pre-attached to a noun.
      if (s.tail !== undefined) own.push({ text: s.tail, r: s.tailR ?? "", kind: "tail" });
      if (chunk.glue) {
        carry.push(...own); // rides with the car it describes
        continue;
      }
      cars.push({ pieces: [...carry, ...own], engine: chunk.role === "engine" });
      carry = [];
    }
    const allPieces = cars.flatMap((c) => c.pieces);

    const pieceHtml = (piece: BuildPiece): string =>
      `<span lang="ja">${escapeHtml(piece.text)}</span>${
        showRomaji ? `<span class="gram-romaji">${escapeHtml(piece.r)}</span>` : ""
      }`;

    train.innerHTML = `<div class="gram-slots" id="gram-answer"><span class="glosses" id="gram-answer-hint">Drag the pieces up here.</span></div>`;
    const answer = train.querySelector<HTMLDivElement>("#gram-answer")!;
    extra.innerHTML = `<div class="gram-pieces" id="gram-tray"></div><div class="gram-nudge" id="gram-nudge"></div>`;
    const tray = extra.querySelector<HTMLDivElement>("#gram-tray")!;
    const nudge = extra.querySelector<HTMLDivElement>("#gram-nudge")!;

    const chipFor = (piece: BuildPiece): HTMLElement => {
      const chip = document.createElement("div");
      chip.className = `gram-piece kind-${piece.kind}`;
      chip.innerHTML = pieceHtml(piece);
      chip.dataset.i = String(allPieces.indexOf(piece));
      return chip;
    };
    for (const piece of shuffle([...allPieces])) tray.appendChild(chipFor(piece));

    /** The pieces currently in the answer row, in the order they sit. */
    const built = (): BuildPiece[] =>
      [...answer.querySelectorAll<HTMLElement>(".gram-piece")].map((el) => allPieces[Number(el.dataset.i)]);

    /**
     * Is this arrangement a real sentence? Each car has to appear whole and
     * in its own order, and the ending's car has to be the last one.
     */
    const check = (order: BuildPiece[]): string | null => {
      let at = 0;
      const used = new Set<BuildCar>();
      const seen: BuildCar[] = [];
      while (at < order.length) {
        const car = cars.find((c) => !used.has(c) && c.pieces.every((p, k) => order[at + k] === p));
        if (!car) {
          const piece = order[at];
          if (piece.kind === "particle") return `<b lang="ja">${escapeHtml(piece.text)}</b> goes straight after the word it belongs to.`;
          if (piece.kind === "tail") return `<b lang="ja">${escapeHtml(piece.text)}</b> goes straight after the thing it says you are.`;
          return "Something is in the wrong place — a word and its little word travel together.";
        }
        used.add(car);
        seen.push(car);
        at += car.pieces.length;
      }
      if (!seen[seen.length - 1].engine) return "The ending has to come last.";
      return null;
    };

    let missed = false;
    const finishIfDone = (): void => {
      if (answer.querySelectorAll(".gram-piece").length !== allPieces.length) return;
      const problem = check(built());
      if (!problem) {
        if (missed) wrong("rebuilt, after a wrong turn");
        else right();
        return;
      }
      // Not settled: the pieces are all there, so say what is off and let
      // them move one. Fixing your own sentence teaches more than being told.
      missed = true;
      nudge.innerHTML = `<span class="err-text">${problem}</span>`;
    };

    // ---- dragging ----
    //
    // Written on pointer events rather than HTML drag-and-drop, which does
    // not exist on a touchscreen. A press that never moves counts as a tap
    // and sends the piece to the end of the row, so the drill still works
    // one-handed, with a keyboard, or for anyone who would rather not drag.

    let drag: {
      chip: HTMLElement;
      float: HTMLElement;
      from: HTMLElement;
      moved: boolean;
      dx: number;
      dy: number;
    } | null = null;

    /** Where in the row a drop at this x belongs. */
    const dropIndex = (x: number): number => {
      const chips = [...answer.querySelectorAll<HTMLElement>(".gram-piece")].filter((c) => c !== drag?.chip);
      for (let i = 0; i < chips.length; i++) {
        const box = chips[i].getBoundingClientRect();
        if (x < box.left + box.width / 2) return i;
      }
      return chips.length;
    };

    const showGap = (index: number | null): void => {
      answer.querySelectorAll(".gram-piece").forEach((c) => c.classList.remove("gap-before", "gap-after"));
      if (index === null) return;
      const chips = [...answer.querySelectorAll<HTMLElement>(".gram-piece")].filter((c) => c !== drag?.chip);
      if (chips.length === 0) return;
      if (index >= chips.length) chips[chips.length - 1].classList.add("gap-after");
      else chips[index].classList.add("gap-before");
    };

    const place = (chip: HTMLElement, index: number): void => {
      const chips = [...answer.querySelectorAll<HTMLElement>(".gram-piece")].filter((c) => c !== chip);
      answer.querySelector("#gram-answer-hint")?.remove();
      if (index >= chips.length) answer.appendChild(chip);
      else answer.insertBefore(chip, chips[index]);
      nudge.textContent = "";
      finishIfDone();
    };

    const onDown = (ev: PointerEvent): void => {
      if (settled) return;
      const chip = (ev.target as HTMLElement).closest<HTMLElement>(".gram-piece");
      if (!chip) return;
      ev.preventDefault();
      const box = chip.getBoundingClientRect();
      const float = chip.cloneNode(true) as HTMLElement;
      float.className = `${chip.className} gram-piece-float`;
      float.style.width = `${box.width}px`;
      float.style.left = `${box.left}px`;
      float.style.top = `${box.top}px`;
      document.body.appendChild(float);
      chip.classList.add("is-dragging");
      drag = {
        chip,
        float,
        from: chip.parentElement as HTMLElement,
        moved: false,
        dx: ev.clientX - box.left,
        dy: ev.clientY - box.top,
      };
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    };

    const onMove = (ev: PointerEvent): void => {
      if (!drag) return;
      ev.preventDefault();
      drag.moved ||= true;
      drag.float.style.left = `${ev.clientX - drag.dx}px`;
      drag.float.style.top = `${ev.clientY - drag.dy}px`;
      const box = answer.getBoundingClientRect();
      const over = ev.clientY > box.top - 40 && ev.clientY < box.bottom + 40;
      answer.classList.toggle("is-target", over);
      showGap(over ? dropIndex(ev.clientX) : null);
    };

    const onUp = (ev: PointerEvent): void => {
      if (!drag) return;
      const { chip, float, from, moved } = drag;
      const box = answer.getBoundingClientRect();
      const over = ev.clientY > box.top - 40 && ev.clientY < box.bottom + 40;
      const index = dropIndex(ev.clientX);
      drag = null;
      float.remove();
      chip.classList.remove("is-dragging");
      answer.classList.remove("is-target");
      showGap(null);
      if (!moved) {
        // A tap: into the row if it came from the tray, back out if not.
        if (from === tray) place(chip, answer.querySelectorAll(".gram-piece").length);
        else tray.appendChild(chip);
        return;
      }
      if (over) place(chip, index);
      else if (from === answer) tray.appendChild(chip);
    };

    for (const box of [tray, answer]) {
      box.addEventListener("pointerdown", onDown);
    }
    // On the window, so a finger that leaves the tray mid-drag is still heard.
    const moveHandler = onMove as EventListener;
    const upHandler = onUp as EventListener;
    window.addEventListener("pointermove", moveHandler, { passive: false });
    window.addEventListener("pointerup", upHandler);
    window.addEventListener("pointercancel", upHandler);
    cleanups.push(() => {
      window.removeEventListener("pointermove", moveHandler);
      window.removeEventListener("pointerup", upHandler);
      window.removeEventListener("pointercancel", upHandler);
      drag?.float.remove();
    });
  };

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
