import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { generationAvailable } from "./grammar-ai.js";
import { GENKI_MAP, type GenkiLesson, type GenkiStep } from "./genki-data.js";
import { aiUrl } from "./ai-endpoint.js";

/**
 * Ask Coach: a question box on every lesson that goes to Claude.
 *
 * The request carries where the learner is (lesson, step, everything taught
 * up to here) so the answer stays inside Genki's order: a Lesson 1 question
 * is answered with Lesson 1 Japanese, and anything from later is labelled
 * as coming later rather than smuggled in. The system prompt that turns this
 * into a careful teacher lives on the server, in `public/grammar.php`
 * (mode "coach"), next to the key.
 *
 * The last few exchanges for the lesson are kept on the device and sent
 * back with each question, so "what about the other one?" makes sense.
 */

export interface CoachExample {
  jp: string;
  en: string;
}

export interface CoachAnswer {
  answer: string;
  examples: CoachExample[];
  /** Where in Genki to look, when there's a specific place. */
  genki?: string;
}

interface Exchange {
  q: string;
  a: CoachAnswer;
  at: number;
}

const HISTORY_PREFIX = "genkiCoach:";
const KEEP = 12;
const MAX_QUESTION = 600;

async function history(lessonId: string): Promise<Exchange[]> {
  return (await getMeta<Exchange[]>(HISTORY_PREFIX + lessonId)) ?? [];
}

function promptFor(lesson: GenkiLesson, step: GenkiStep | null, question: string, past: Exchange[]): string {
  const covered = GENKI_MAP.filter((l) => l.num <= lesson.num)
    .map((l) => `Lesson ${l.num} (${l.en}): ${l.topics}`)
    .join("\n");
  const later = GENKI_MAP.filter((l) => l.num > lesson.num)
    .map((l) => `Lesson ${l.num}: ${l.topics}`)
    .join("\n");
  const recent = past
    .slice(-3)
    .map((e) => `Learner: ${e.q}\nCoach: ${e.a.answer}`)
    .join("\n\n");
  return [
    `The learner is studying Genki I (3rd edition), Lesson ${lesson.num}: ${lesson.jp} (${lesson.en}). The app calls it Unit ${lesson.num}.`,
    step ? `They are on the step "${step.title}" — ${step.name} (${step.genki}).` : "They are on the lesson overview.",
    "",
    "Taught so far:",
    covered,
    "",
    "Not taught yet (later lessons):",
    later,
    "",
    recent ? `Earlier in this conversation:\n${recent}\n` : "",
    `The learner asks: ${question}`,
  ].join("\n");
}

function validAnswer(raw: unknown): CoachAnswer | null {
  const a = raw as CoachAnswer | null;
  if (!a || typeof a.answer !== "string" || !a.answer.trim()) return null;
  const examples = Array.isArray(a.examples)
    ? a.examples
        .filter((e): e is CoachExample => !!e && typeof e.jp === "string" && typeof e.en === "string" && !!e.jp.trim())
        .slice(0, 4)
    : [];
  return {
    answer: a.answer.trim(),
    examples,
    ...(typeof a.genki === "string" && a.genki.trim() ? { genki: a.genki.trim() } : {}),
  };
}

/** Ask. Resolves to an answer, or throws a sentence fit to show the learner. */
export async function askCoach(lesson: GenkiLesson, step: GenkiStep | null, question: string): Promise<CoachAnswer> {
  const q = question.trim().slice(0, MAX_QUESTION);
  if (!(await generationAvailable())) {
    throw new Error("Claude isn't set up on this copy of Yomeyo.");
  }
  const past = await history(lesson.id);
  let res: Response;
  try {
    res = await fetch(aiUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "coach", prompt: promptFor(lesson, step, q, past) }),
    });
  } catch {
    throw new Error("No connection. Try again.");
  }
  if (res.status === 429) throw new Error("Busy. Try again in a few seconds.");
  if (!res.ok) throw new Error("No answer. Try rephrasing the question.");
  const { raw } = (await res.json()) as { raw?: string };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    throw new Error("The answer didn't come through. Try again.");
  }
  const answer = validAnswer(parsed);
  if (!answer) throw new Error("The answer was empty. Try again.");
  const kept = [...past, { q, a: answer, at: Date.now() }].slice(-KEEP);
  await setMeta(HISTORY_PREFIX + lesson.id, kept);
  return answer;
}

// ---------------- the panel ----------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text with paragraphs and **bold**, nothing else trusted. */
function prose(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")}</p>`)
    .join("");
}

function answerHtml(e: Exchange): string {
  return `
    <div class="gk-coach-q">${escapeHtml(e.q)}</div>
    <div class="gk-coach-a">
      ${prose(e.a.answer)}
      ${e.a.examples
        .map(
          (ex) => `<div class="lesson-example" data-say="${escapeHtml(ex.jp)}">
            <button class="speaker" title="Say it" aria-label="Say it">🔊</button>
            <div><div class="lesson-example-jp" lang="ja">${escapeHtml(ex.jp)}</div><div class="glosses">${escapeHtml(ex.en)}</div></div>
          </div>`,
        )
        .join("")}
      ${e.a.genki ? `<div class="glosses gk-coach-ref">📖 ${escapeHtml(e.a.genki)}</div>` : ""}
    </div>`;
}

function wireSpeakers(root: HTMLElement): void {
  for (const row of root.querySelectorAll<HTMLElement>(".lesson-example[data-say]")) {
    const button = row.querySelector<HTMLButtonElement>(".speaker");
    if (!button || button.dataset.wired) continue;
    button.dataset.wired = "1";
    button.addEventListener("click", () => void speak(row.dataset.say ?? "", { rate: 0.85 }).catch(() => undefined));
  }
}

/**
 * Draw the coach into `host` for this lesson. `stepOf` is read at ask time,
 * so the panel always knows which step the learner last opened.
 */
export async function renderCoach(
  host: HTMLElement,
  lesson: GenkiLesson,
  stepOf: () => GenkiStep | null,
  suggestions: string[],
): Promise<void> {
  const past = await history(lesson.id);
  const ready = await generationAvailable();
  if (!host.isConnected) return;
  host.innerHTML = `
    <div class="card-panel gk-coach">
      <div class="gk-coach-head"><b>🧑‍🏫 Ask Coach</b>
        <span class="glosses">Questions about Unit ${lesson.num}, in English or Japanese.</span></div>
      <div class="gk-coach-log" id="gk-coach-log">${past.slice(-4).map(answerHtml).join("")}</div>
      ${
        ready
          ? `<div class="gk-coach-chips" id="gk-coach-chips">${suggestions
              .slice(0, 4)
              .map((s) => `<button class="gk-chip" type="button">${escapeHtml(s)}</button>`)
              .join("")}</div>
             <form class="gk-coach-form" id="gk-coach-form">
               <textarea id="gk-coach-q" maxlength="${MAX_QUESTION}" rows="2" placeholder="e.g. Why is it よじ and not よんじ?"></textarea>
               <button type="submit">Ask</button>
             </form>
             <div class="glosses gk-coach-note">Answers come from Claude. Check anything surprising against the book.</div>`
          : `<div class="glosses">Not available: Claude isn't set up on this copy of Yomeyo.</div>`
      }
    </div>`;
  const log = host.querySelector<HTMLDivElement>("#gk-coach-log")!;
  wireSpeakers(log);
  if (!ready) return;
  const form = host.querySelector<HTMLFormElement>("#gk-coach-form")!;
  const box = host.querySelector<HTMLTextAreaElement>("#gk-coach-q")!;
  for (const chip of host.querySelectorAll<HTMLButtonElement>(".gk-chip")) {
    chip.addEventListener("click", () => {
      box.value = chip.textContent ?? "";
      form.requestSubmit();
    });
  }
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  let busy = false;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = box.value.trim();
    if (!q || busy) return;
    busy = true;
    const submit = form.querySelector<HTMLButtonElement>("button")!;
    submit.disabled = true;
    const pending = document.createElement("div");
    pending.innerHTML = `<div class="gk-coach-q">${escapeHtml(q)}</div><div class="gk-coach-a glosses">…</div>`;
    log.appendChild(pending);
    pending.scrollIntoView({ block: "nearest", behavior: "smooth" });
    void askCoach(lesson, stepOf(), q)
      .then((a) => {
        pending.innerHTML = answerHtml({ q, a, at: Date.now() });
        wireSpeakers(pending);
        box.value = "";
      })
      .catch((err: Error) => {
        pending.querySelector(".gk-coach-a")!.textContent = err.message;
      })
      .finally(() => {
        busy = false;
        submit.disabled = false;
      });
  });
}
