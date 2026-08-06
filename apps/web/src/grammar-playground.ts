import { lookup } from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { activeDictionary, assetUrl } from "./store.js";
import { generationAvailable } from "./grammar-ai.js";
import {
  PIECES,
  WORD_KIND_INFO,
  formHint,
  guessKind,
  isKana,
  kanaToRomaji,
  kindFromPos,
  startState,
  toHiragana,
  type ChainState,
  type Piece,
  type WordKind,
} from "./grammar-conjugate.js";

/**
 * The grammar playground: type a word, then snap endings onto it like lego.
 *
 * The point is the feel of it. Conjugation taught as tables is a wall of
 * forms; conjugation felt as pieces is three moves — ない, then た, and
 * たべなかった builds itself in front of you, each step shown. Pieces that
 * don't fit the current ending are right there but dimmed, and tapping one
 * says why, because which pieces fit WHERE is the actual system being
 * learned.
 *
 * The word is looked up in the on-device dictionary for its reading, its
 * meaning and its group; the learner can overrule the group with one tap.
 * When the site can reach Claude (the same grammar.php the practice tab
 * uses), the built form is translated live; without it, the meaning recipe
 * — "eat · not · in the past" — still tells the story.
 */

const LAST_KEY = "playgroundLast";

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

/** Translations already asked for, so replaying a chain is free. */
const translations = new Map<string, { en: string; note?: string }>();
let translateSeq = 0;

export async function renderPlayground(body: HTMLDivElement, isCurrent: () => boolean = () => true): Promise<void> {
  if (!word) {
    const saved = await getMeta<Saved>(LAST_KEY);
    if (saved?.typed) {
      word = await resolveWord(saved.typed);
      if (word && saved.kind) word = { ...word, kind: saved.kind };
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

  return {
    typed: text,
    kana,
    gloss: covers && entry ? entry.glosses[0] ?? "" : "",
    kind: (covers ? kindTagged : null) ?? guessKind(kana),
    sure: Boolean(covers && kindTagged),
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
  const suggestions = ["たべる", "のむ", "いく", "あかい", "べんきょうする", "がくせい"];
  body.innerHTML = `
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

  const input = body.querySelector<HTMLInputElement>("#pg-in")!;
  const msg = body.querySelector<HTMLDivElement>("#pg-msg")!;
  const out = body.querySelector<HTMLDivElement>("#pg-out")!;

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
    msg.textContent = "";
    void setMeta(LAST_KEY, { typed: word.typed, kind: word.kind, chain } satisfies Saved);
    draw(body);
  };

  body.querySelector("#pg-go")!.addEventListener("click", () => void build(input.value));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") void build(input.value);
  });
  for (const chip of body.querySelectorAll<HTMLButtonElement>(".pg-chip")) {
    chip.addEventListener("click", () => {
      input.value = chip.dataset.w!;
      void build(chip.dataset.w!);
    });
  }

  if (!word) {
    out.innerHTML = `
      <div class="card-panel pg-empty">
        <div class="big">🧱</div>
        <p>Type any word — an action word, a describing word, a thing — and
        snap endings onto it like lego. Every piece shows what it does, and
        the word rebuilds itself in front of you.</p>
      </div>`;
    return;
  }

  drawBoard(out, body);
}

/** Undoes the previous board's window-level drag listeners before redrawing. */
let undoDrag: (() => void) | null = null;

function drawBoard(out: HTMLDivElement, body: HTMLDivElement): void {
  undoDrag?.();
  undoDrag = null;
  const w = word!;
  const { steps, state } = walkChain();
  void setMeta(LAST_KEY, { typed: w.typed, kind: w.kind, chain } satisfies Saved);

  const kindChips = (Object.keys(WORD_KIND_INFO) as WordKind[])
    .map(
      (k) => `<button class="pg-kind${k === w.kind ? " on" : ""}" data-kind="${k}"
        title="${escapeHtml(WORD_KIND_INFO[k].hint)}">${escapeHtml(WORD_KIND_INFO[k].name)}</button>`,
    )
    .join("");

  const blockHtml = (label: string, sub: string, cls: string, at?: number): string => `
    <div class="pg-block ${cls}" ${at !== undefined ? `data-at="${at}"` : ""} ${
      at !== undefined ? `title="Tap to break the chain here"` : ""
    }>
      <span class="pg-block-jp" lang="ja">${escapeHtml(label)}</span>
      <span class="pg-block-sub">${escapeHtml(sub)}</span>
    </div>`;

  const trail =
    steps.length === 0
      ? ""
      : `<div class="pg-trail">${[w.kana, ...steps.map((s) => s.state.kana)]
          .map((kana, i) => (i === 0 ? `<span lang="ja">${escapeHtml(kana)}</span>` : `<span class="pg-arrow">→</span><span lang="ja">${escapeHtml(kana)}</span>`))
          .join("")}</div>`;

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

    <div class="card-panel pg-board" id="pg-board">
      <div class="pg-result">
        <button class="speaker" id="pg-say" title="Say it" aria-label="Say it">🔊</button>
        <div class="pg-result-jp" lang="ja">${escapeHtml(state.kana)}</div>
        <div class="pg-result-romaji">${escapeHtml(kanaToRomaji(state.kana))}</div>
        <div class="pg-result-en" id="pg-en">${recipeHtml(w, steps)}</div>
      </div>
      <div class="pg-chain">
        ${blockHtml(w.kana, w.gloss || WORD_KIND_INFO[w.kind].name, "pg-base")}
        ${steps.map((s, i) => blockHtml(s.piece.label, s.piece.name, `tone-${s.piece.tone} pg-added`, i)).join("")}
        <div class="pg-socket${steps.length === 0 ? " pulse" : ""}" id="pg-socket">＋</div>
      </div>
      ${trail}
      <div class="glosses pg-form-hint">${escapeHtml(formHint(state.form))}</div>
      <div class="row-actions">
        <button id="pg-undo" class="secondary" ${steps.length === 0 ? "disabled" : ""}>Break off the last piece</button>
        <button id="pg-clear" class="ghost" ${steps.length === 0 ? "disabled" : ""}>Start over</button>
      </div>
    </div>

    <div class="card-panel">
      <b>The pieces</b>
      <div class="glosses" style="margin:4px 0 10px">Drag one onto the word — or just tap it. Dim pieces don't fit the current ending.</div>
      <div class="pg-tray" id="pg-tray">
        ${PIECES.map((p) => {
          const ok = p.fits(state);
          return `<div class="pg-piece tone-${p.tone}${ok ? "" : " dim"}" data-id="${p.id}">
            <span class="pg-block-jp" lang="ja">${escapeHtml(p.label)}</span>
            <span class="pg-block-sub">${escapeHtml(p.name)}</span>
          </div>`;
        }).join("")}
      </div>
      <div class="pg-nudge" id="pg-nudge"></div>
    </div>
  `;

  out.querySelector("#pg-say")!.addEventListener("click", () => {
    void speak(state.kana, { rate: 0.85 }).catch(() => undefined);
  });
  out.querySelector("#pg-undo")!.addEventListener("click", () => {
    chain.pop();
    drawBoard(out, body);
  });
  out.querySelector("#pg-clear")!.addEventListener("click", () => {
    chain = [];
    drawBoard(out, body);
  });
  for (const chip of out.querySelectorAll<HTMLButtonElement>(".pg-kind")) {
    chip.addEventListener("click", () => {
      word = { ...w, kind: chip.dataset.kind as WordKind, sure: true };
      drawBoard(out, body);
    });
  }
  // Tapping a snapped-on piece breaks the chain there: that piece and
  // everything after it come off, like pulling a lego tower apart.
  for (const block of out.querySelectorAll<HTMLElement>(".pg-added")) {
    block.addEventListener("click", () => {
      chain = chain.slice(0, Number(block.dataset.at));
      drawBoard(out, body);
    });
  }

  const nudge = out.querySelector<HTMLDivElement>("#pg-nudge")!;
  const board = out.querySelector<HTMLDivElement>("#pg-board")!;
  const tray = out.querySelector<HTMLDivElement>("#pg-tray")!;

  const attach = (piece: Piece): void => {
    if (!piece.fits(state)) {
      nudge.innerHTML = `<b lang="ja">${escapeHtml(piece.label)}</b> doesn't fit here — ${escapeHtml(
        wontFitWhy(piece, state),
      )}`;
      return;
    }
    chain.push(piece.id);
    drawBoard(out, body);
  };

  // ---- dragging, on pointer events so it works on a touchscreen ----
  // A press that never moves is a tap and attaches directly; a drag has to
  // land on the board. Same pattern as the sentence-building drill.
  let drag: { el: HTMLElement; float: HTMLElement; piece: Piece; moved: boolean; dx: number; dy: number } | null = null;

  tray.addEventListener("pointerdown", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".pg-piece");
    if (!el) return;
    ev.preventDefault();
    const piece = PIECES.find((p) => p.id === el.dataset.id)!;
    const box = el.getBoundingClientRect();
    const float = el.cloneNode(true) as HTMLElement;
    float.className = `${el.className} pg-piece-float`;
    float.style.width = `${box.width}px`;
    float.style.left = `${box.left}px`;
    float.style.top = `${box.top}px`;
    document.body.appendChild(float);
    drag = { el, float, piece, moved: false, dx: ev.clientX - box.left, dy: ev.clientY - box.top };
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  });

  const onMove = (ev: PointerEvent): void => {
    if (!drag) return;
    ev.preventDefault();
    drag.moved = true;
    drag.float.style.left = `${ev.clientX - drag.dx}px`;
    drag.float.style.top = `${ev.clientY - drag.dy}px`;
    const box = board.getBoundingClientRect();
    board.classList.toggle(
      "is-target",
      ev.clientY > box.top - 20 && ev.clientY < box.bottom + 20 && drag.piece.fits(state),
    );
  };
  const onUp = (ev: PointerEvent): void => {
    if (!drag) return;
    const { float, piece, moved } = drag;
    drag = null;
    float.remove();
    board.classList.remove("is-target");
    if (!moved) {
      attach(piece);
      return;
    }
    const box = board.getBoundingClientRect();
    if (ev.clientY > box.top - 20 && ev.clientY < box.bottom + 20) attach(piece);
  };
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  undoDrag = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    drag?.float.remove();
  };

  void translate(out, w, steps, state);
}

/** Why a dim piece is dim, in the terms the playground teaches. */
function wontFitWhy(piece: Piece, state: ChainState): string {
  if (state.form === "done") return "this ending is finished. Break a piece off first.";
  switch (piece.id) {
    case "masu":
    case "tai":
    case "potential":
      return "it needs a plain action word before it.";
    case "you":
      return "it needs a plain action word, or ます.";
    case "iru":
    case "kudasai":
      return "it snaps onto a て piece. Add 〜て first.";
    case "da":
      return "only a plain thing takes だ.";
    case "desu":
      return "it needs a thing or an い-word before it.";
    case "te":
    case "ba":
      return "the current ending can't take it.";
    default:
      return "the current ending can't take it.";
  }
}

/** The meaning built by hand, shown when there is no translator to ask. */
function recipeHtml(w: PlayWord, steps: Step[]): string {
  const parts = [w.gloss || w.kana, ...steps.map((s) => s.piece.hint)];
  return `<span class="pg-recipe">${parts.map((p) => escapeHtml(p)).join(" · ")}</span>`;
}

// ---------------- the translator ----------------

/**
 * The built form, translated by Claude when the site can ask. Debounced a
 * moment so snapping three pieces in a row costs one request, not three,
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
