import { lookup } from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { activeDictionary, assetUrl } from "./store.js";
import { generationAvailable } from "./grammar-ai.js";
import { renderRecipes } from "./grammar-recipes.js";
import {
  PIECES,
  WORD_KIND_INFO,
  formHint,
  guessKind,
  isKana,
  kindFitsShape,
  kindFromPos,
  startState,
  toHiragana,
  type ChainState,
  type Piece,
  type WordKind,
} from "./grammar-conjugate.js";

/**
 * The grammar playground: type a word, then bend it by tapping the part
 * that can bend.
 *
 * The word sits on screen as blocks. Its end — the only part of a
 * Japanese word that conjugates — wears a glowing ＋. Tap it and the
 * choices appear, each with what it means and a preview of the word it
 * would make: 〜ます · polite · → たべます. Tap a choice and the word
 * rebuilds. Tap any piece already on the word to break it off there, or
 * swap it for something else that fits that spot. No tray, no dragging,
 * nothing to know in advance: the word itself is the interface, and it
 * only ever offers what is really possible.
 *
 * The word is looked up in the on-device dictionary for its reading, its
 * meaning and its group; the learner can overrule the group with one tap
 * — but only to groups the word's shape can honestly be. When the site
 * can reach Claude (the same grammar.php the course uses), the built form
 * is translated live; without it, the meaning recipe — "eat · not · in
 * the past" — still tells the story.
 */

const LAST_KEY = "playgroundLast";
const MODE_KEY = "playgroundMode";

/** Recipes first: the guided patterns, with free build one tap away. */
let mode: "recipes" | "free" | null = null;

interface PlayWord {
  /** As typed: 食べる or たべる. */
  typed: string;
  /** The kana the engine works on. */
  kana: string;
  /** Plain meaning from the dictionary, when it had one. */
  gloss: string;
  kind: WordKind;
  /** True when the group came from the dictionary, not a guess. */
  sure: boolean;
}

interface Saved {
  typed: string;
  kind: WordKind;
  chain: string[];
}

let word: PlayWord | null = null;
/** Piece ids, in the order they were snapped on. */
let chain: string[] = [];
/** What the panel is talking about: a piece on the word, or the open end. */
let focusAt: number | "end" = "end";

/** Translations already asked for, so replaying a chain is free. */
const translations = new Map<string, { en: string; note?: string }>();
let translateSeq = 0;

export async function renderPlayground(body: HTMLDivElement, isCurrent: () => boolean = () => true): Promise<void> {
  mode ??= ((await getMeta<string>(MODE_KEY)) as "recipes" | "free" | undefined) ?? "recipes";
  if (!word) {
    const saved = await getMeta<Saved>(LAST_KEY);
    if (saved?.typed) {
      word = await resolveWord(saved.typed);
      // A stored kind from before the shape-check existed may be nonsense.
      if (word && saved.kind && kindFitsShape(word.kana, saved.kind)) word = { ...word, kind: saved.kind };
      chain = saved.chain ?? [];
    }
    if (!isCurrent() || !body.isConnected) return;
  }
  draw(body);
}

// ---------------- finding the word ----------------

/** The typed word, resolved: reading, meaning and group, best effort. */
async function resolveWord(typed: string): Promise<PlayWord | null> {
  const text = typed.trim().replace(/[。、\s]+$/gu, "");
  if (!text) return null;

  let match = null;
  try {
    const dict = await activeDictionary();
    match = lookup(dict, text, 0)[0] ?? null;
  } catch {
    // No dictionary on this device yet; the guess below still works.
  }

  const entry = match?.entries[0];
  const kindTagged = entry ? kindFromPos(entry.pos) : null;
  // The dictionary may match a prefix ("たべもの" for "たべ…"); only trust a
  // match that covers what was typed.
  const covers = match && match.matchedText.length === text.length;
  const kana = covers && entry?.reading ? toHiragana(entry.reading) : isKana(text) ? toHiragana(text) : null;
  if (!kana) return null;

  // A tag the word's own shape cannot conjugate as would build nonsense
  // (ねこ bent as a verb gives ねこた); the shape has the final say.
  const tagged = covers ? kindTagged : null;
  const kind = tagged && kindFitsShape(kana, tagged) ? tagged : guessKind(kana);
  return {
    typed: text,
    kana,
    gloss: covers && entry ? entry.glosses[0] ?? "" : "",
    kind,
    sure: Boolean(tagged && tagged === kind),
  };
}

// ---------------- the chain ----------------

interface Step {
  piece: Piece;
  state: ChainState;
}

/** Every state the chain passes through, dropping pieces that stopped fitting. */
function walkChain(): { start: ChainState; steps: Step[]; state: ChainState } {
  const start = startState(word!.kana, word!.kind);
  const steps: Step[] = [];
  let state = start;
  const kept: string[] = [];
  for (const id of chain) {
    const piece = PIECES.find((p) => p.id === id);
    if (!piece || !piece.fits(state)) continue; // e.g. after the group was switched
    state = piece.apply(state);
    steps.push({ piece, state });
    kept.push(id);
  }
  chain = kept;
  return { start, steps, state };
}

// ---------------- drawing ----------------

function draw(body: HTMLDivElement): void {
  body.innerHTML = `
    <div class="segmented pg-mode">
      <button data-m="recipes" class="${mode === "recipes" ? "on" : ""}">Recipes</button>
      <button data-m="free" class="${mode === "free" ? "on" : ""}">Free build</button>
    </div>
    <div id="pg-mode-view"></div>
  `;
  for (const button of body.querySelectorAll<HTMLButtonElement>(".pg-mode button")) {
    button.addEventListener("click", () => {
      if (button.dataset.m === mode) return;
      mode = button.dataset.m as "recipes" | "free";
      void setMeta(MODE_KEY, mode);
      draw(body);
    });
  }
  const view = body.querySelector<HTMLDivElement>("#pg-mode-view")!;
  if (mode === "recipes") {
    void renderRecipes(view);
    return;
  }
  drawFree(view, body);
}

function drawFree(root: HTMLDivElement, body: HTMLDivElement): void {
  const suggestions = ["たべる", "のむ", "いく", "あかい", "べんきょうする", "がくせい"];
  root.innerHTML = `
    <div class="card-panel">
      <label for="pg-in">A word to play with</label>
      <div class="pg-input-row">
        <input id="pg-in" lang="ja" placeholder="たべる、あかい、ねこ…" autocomplete="off"
          autocapitalize="none" spellcheck="false" value="${escapeHtml(word?.typed ?? "")}" />
        <button id="pg-go">Build</button>
      </div>
      <div class="pg-suggest">${suggestions
        .map((s) => `<button class="pg-chip" data-w="${s}">${s}</button>`)
        .join("")}</div>
      <div class="msg" id="pg-msg"></div>
    </div>
    <div id="pg-out"></div>
  `;

  const input = root.querySelector<HTMLInputElement>("#pg-in")!;
  const msg = root.querySelector<HTMLDivElement>("#pg-msg")!;
  const out = root.querySelector<HTMLDivElement>("#pg-out")!;

  const build = async (text: string): Promise<void> => {
    const found = await resolveWord(text);
    if (!body.isConnected) return;
    if (!found) {
      msg.textContent = text.trim()
        ? "Couldn't read that one — try it in kana (たべる, not tab eru)."
        : "";
      return;
    }
    word = found;
    chain = [];
    focusAt = "end";
    msg.textContent = "";
    void setMeta(LAST_KEY, { typed: word.typed, kind: word.kind, chain } satisfies Saved);
    draw(body);
  };

  root.querySelector("#pg-go")!.addEventListener("click", () => void build(input.value));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") void build(input.value);
  });
  for (const chip of root.querySelectorAll<HTMLButtonElement>(".pg-chip")) {
    chip.addEventListener("click", () => {
      input.value = chip.dataset.w!;
      void build(chip.dataset.w!);
    });
  }

  if (!word) {
    out.innerHTML = `
      <div class="card-panel pg-empty">
        <div class="big">🧱</div>
        <p>Type any word — an action word, a describing word, a thing — then
        tap the glowing ＋ on its end to see everything it can become. Every
        choice shows the word it would make before you commit.</p>
      </div>`;
    return;
  }

  drawBoard(out, body);
}

/**
 * What a piece ACTUALLY adds to this word, read off the word itself.
 *
 * The dictionary name of an ending is not always the sound that lands on a
 * given word: のむ + 〜て is のんで, so a block labelled 〜て over a word
 * that now ends んで asks a beginner to already know the te-form's sound
 * changes — the exact thing being learned. The label is therefore the diff:
 * everything after the longest shared prefix of before and after.
 */
function addedLabel(beforeKana: string, afterKana: string, fallback: string): string {
  let shared = 0;
  while (
    shared < beforeKana.length &&
    shared < afterKana.length &&
    beforeKana[shared] === afterKana[shared]
  ) {
    shared++;
  }
  const suffix = afterKana.slice(shared);
  return suffix ? `〜${suffix}` : fallback;
}

/** One tappable choice: the piece, its name, and the word it would make. */
function optionRow(piece: Piece, from: ChainState, action: "add" | "swap"): string {
  const preview = piece.apply(from).kana;
  return `
    <button class="pg-opt tone-${piece.tone}" data-${action}="${piece.id}">
      <span class="pg-opt-jp" lang="ja">${escapeHtml(addedLabel(from.kana, preview, piece.label))}</span>
      <span class="pg-opt-name">${escapeHtml(piece.name)}</span>
      <span class="pg-opt-preview" lang="ja">→ ${escapeHtml(preview)}</span>
      <span class="pg-opt-job">${escapeHtml(piece.job)}</span>
    </button>`;
}

function drawBoard(out: HTMLDivElement, body: HTMLDivElement): void {
  const w = word!;
  const { start, steps, state } = walkChain();
  if (focusAt !== "end" && (typeof focusAt !== "number" || focusAt >= steps.length)) focusAt = "end";
  void setMeta(LAST_KEY, { typed: w.typed, kind: w.kind, chain } satisfies Saved);

  // Only the kinds this word's shape can honestly be: ねこ is never a verb,
  // however curious the finger. What cannot fit is shown but says why not.
  const kindChips = (Object.keys(WORD_KIND_INFO) as WordKind[])
    .map((k) => {
      const fits = kindFitsShape(w.kana, k);
      return `<button class="pg-kind${k === w.kind ? " on" : ""}${fits ? "" : " off"}" data-kind="${k}"
        ${fits ? "" : "disabled"}
        title="${escapeHtml(fits ? WORD_KIND_INFO[k].hint : `${w.kana} doesn't have the shape for this`)}">${escapeHtml(
          WORD_KIND_INFO[k].name,
        )}</button>`;
    })
    .join("");

  const trail =
    steps.length === 0
      ? ""
      : `<div class="pg-trail">${[w.kana, ...steps.map((s) => s.state.kana)]
          .map((kana, i) => (i === 0 ? `<span lang="ja">${escapeHtml(kana)}</span>` : `<span class="pg-arrow">→</span><span lang="ja">${escapeHtml(kana)}</span>`))
          .join("")}</div>`;

  // The panel under the word: choices for the open end, or the story of a
  // tapped piece — what it does, how to take it off, what could stand there
  // instead.
  const fitsNow = PIECES.filter((piece) => piece.fits(state));
  const panelHtml = ((): string => {
    if (focusAt === "end") {
      if (fitsNow.length === 0) {
        return `<div class="glosses">${escapeHtml(formHint(state.form))}. Tap a coloured piece on the word to break it off and keep building.</div>`;
      }
      return `
        <div class="pg-panel-title">Tap what the word should become:</div>
        ${fitsNow.map((piece) => optionRow(piece, state, "add")).join("")}`;
    }
    const at = focusAt;
    const step = steps[at];
    const before = at === 0 ? start : steps[at - 1].state;
    const alternatives = PIECES.filter((piece) => piece.id !== step.piece.id && piece.fits(before));
    return `
      <div class="pg-panel-title"><span lang="ja">${escapeHtml(
        addedLabel(before.kana, step.state.kana, step.piece.label),
      )}</span> — ${escapeHtml(step.piece.name)}</div>
      <div class="glosses">${escapeHtml(step.piece.job)}</div>
      <div class="row-actions" style="margin:8px 0">
        <button id="pg-break" class="secondary">Take it off (and everything after)</button>
      </div>
      ${alternatives.length > 0 ? `<div class="pg-panel-title">…or swap it for:</div>${alternatives.map((piece) => optionRow(piece, before, "swap")).join("")}` : ""}`;
  })();

  out.innerHTML = `
    <div class="card-panel">
      <div class="pg-word-head">
        <div>
          <div class="pg-word-jp" lang="ja">${escapeHtml(w.typed)}${
            w.typed !== w.kana ? `<span class="pg-word-kana" lang="ja">${escapeHtml(w.kana)}</span>` : ""
          }</div>
          ${w.gloss ? `<div class="glosses">${escapeHtml(w.gloss)}</div>` : ""}
        </div>
      </div>
      <div class="pg-kinds">${kindChips}</div>
      ${w.sure ? "" : `<div class="glosses pg-unsure">The dictionary wasn't sure of the group — tap the right one if this looks off.</div>`}
    </div>

    <div class="card-panel pg-board">
      <div class="pg-result">
        <button class="speaker" id="pg-say" title="Say it" aria-label="Say it">🔊</button>
        <div class="pg-result-jp" lang="ja">${escapeHtml(state.kana)}</div>
        <div class="pg-result-en" id="pg-en">${recipeHtml(w, steps)}</div>
      </div>
      <div class="pg-chain">
        <div class="pg-block pg-base">
          <span class="pg-block-jp" lang="ja">${escapeHtml(w.kana)}</span>
          <span class="pg-block-sub">${escapeHtml(w.gloss || WORD_KIND_INFO[w.kind].name)}</span>
        </div>
        ${steps
          .map(
            (step, i) => `
          <button class="pg-block tone-${step.piece.tone} pg-added${focusAt === i ? " on" : ""}" data-at="${i}"
            title="Tap to change or remove this piece">
            <span class="pg-block-jp" lang="ja">${escapeHtml(
              addedLabel((i === 0 ? start : steps[i - 1].state).kana, step.state.kana, step.piece.label),
            )}</span>
            <span class="pg-block-sub">${escapeHtml(step.piece.name)}</span>
          </button>`,
          )
          .join("")}
        <button class="pg-endcap${focusAt === "end" ? " on" : ""}${steps.length === 0 && fitsNow.length > 0 ? " pulse" : ""}"
          id="pg-endcap" title="Tap to conjugate" ${fitsNow.length === 0 && focusAt === "end" ? "" : ""}>＋</button>
      </div>
      ${trail}
      <div class="pg-panel" id="pg-panel">${panelHtml}</div>
      <div class="row-actions">
        <button id="pg-clear" class="ghost" ${steps.length === 0 ? "disabled" : ""}>Start over</button>
      </div>
    </div>
  `;

  out.querySelector("#pg-say")!.addEventListener("click", () => {
    void speak(state.kana, { rate: 0.85 }).catch(() => undefined);
  });
  out.querySelector("#pg-clear")!.addEventListener("click", () => {
    chain = [];
    focusAt = "end";
    drawBoard(out, body);
  });
  for (const chip of out.querySelectorAll<HTMLButtonElement>(".pg-kind")) {
    chip.addEventListener("click", () => {
      word = { ...w, kind: chip.dataset.kind as WordKind, sure: true };
      focusAt = "end";
      drawBoard(out, body);
    });
  }
  out.querySelector("#pg-endcap")!.addEventListener("click", () => {
    focusAt = "end";
    drawBoard(out, body);
  });
  for (const block of out.querySelectorAll<HTMLButtonElement>(".pg-added")) {
    block.addEventListener("click", () => {
      focusAt = Number(block.dataset.at);
      drawBoard(out, body);
    });
  }
  const panel = out.querySelector<HTMLDivElement>("#pg-panel")!;
  for (const option of panel.querySelectorAll<HTMLButtonElement>("[data-add]")) {
    option.addEventListener("click", () => {
      chain.push(option.dataset.add!);
      focusAt = "end";
      drawBoard(out, body);
    });
  }
  for (const option of panel.querySelectorAll<HTMLButtonElement>("[data-swap]")) {
    option.addEventListener("click", () => {
      chain = [...chain.slice(0, focusAt as number), option.dataset.swap!];
      focusAt = "end";
      drawBoard(out, body);
    });
  }
  panel.querySelector("#pg-break")?.addEventListener("click", () => {
    chain = chain.slice(0, focusAt as number);
    focusAt = "end";
    drawBoard(out, body);
  });

  void translate(out, w, steps, state);
}

/** The meaning built by hand, shown when there is no translator to ask. */
function recipeHtml(w: PlayWord, steps: Step[]): string {
  const parts = [w.gloss || w.kana, ...steps.map((s) => s.piece.hint)];
  return `<span class="pg-recipe">${parts.map((p) => escapeHtml(p)).join(" · ")}</span>`;
}

// ---------------- the translator ----------------

/**
 * The built form, translated by Claude when the site can ask. Debounced a
 * moment so tapping three pieces in a row costs one request, not three,
 * and sequence-checked so a slow answer never overwrites a newer one.
 */
async function translate(out: HTMLDivElement, w: PlayWord, steps: Step[], state: ChainState): Promise<void> {
  if (steps.length === 0 && w.gloss) return; // the dictionary already said it
  const box = out.querySelector<HTMLDivElement>("#pg-en");
  if (!box) return;

  const key = `${w.kana}:${state.kana}`;
  const cached = translations.get(key);
  if (cached) {
    drawTranslation(box, cached);
    return;
  }
  if (!(await generationAvailable())) return;

  const seq = ++translateSeq;
  await new Promise((r) => setTimeout(r, 700));
  if (seq !== translateSeq || !box.isConnected) return;

  const prompt = [
    "A learner in a Japanese conjugation playground built this word:",
    "",
    `Base word: ${w.kana}${w.gloss ? ` (${w.gloss})` : ""} — a ${WORD_KIND_INFO[w.kind].name}.`,
    steps.length > 0
      ? `Endings snapped on, in order: ${steps.map((s) => `${s.piece.label} (${s.piece.name})`).join(", ")}.`
      : "No endings yet.",
    `The result: ${state.kana}`,
    "",
    'Give "en": the natural English of the result, as short as real speech ("didn\'t eat", "I want to drink", "it was red").',
    'Give "note" only if there is one genuinely useful plain-words thing to say about this form — one short sentence, no grammar jargon. Otherwise omit it.',
  ].join("\n");

  try {
    const res = await fetch(assetUrl("grammar.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "translate", prompt }),
    });
    if (!res.ok) return;
    const { raw } = (await res.json()) as { raw?: string };
    if (!raw) return;
    const parsed = JSON.parse(raw) as { en?: string; note?: string };
    if (typeof parsed.en !== "string" || !parsed.en.trim()) return;
    const value = {
      en: parsed.en.trim(),
      ...(typeof parsed.note === "string" && parsed.note.trim() ? { note: parsed.note.trim() } : {}),
    };
    translations.set(key, value);
    if (seq === translateSeq && box.isConnected) drawTranslation(box, value);
  } catch {
    // The recipe already on screen is the graceful answer.
  }
}

function drawTranslation(box: HTMLDivElement, t: { en: string; note?: string }): void {
  box.innerHTML = `<span class="pg-en-text">“${escapeHtml(t.en)}”</span>${
    t.note ? `<span class="pg-en-note">${escapeHtml(t.note)}</span>` : ""
  }`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
