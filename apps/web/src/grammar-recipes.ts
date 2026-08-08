import { getAllCards, getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { assetUrl } from "./store.js";
import { generationAvailable } from "./grammar-ai.js";
import { PIECES, guessKind, isKana, startState, toHiragana, type WordKind } from "./grammar-conjugate.js";

/**
 * The sentence recipes: the course's patterns, live.
 *
 * Two cards, one per recipe. Each shows the pattern as blocks — ＿は ＿です —
 * with the slots tappable: tap X or Y and a picker opens with easy common
 * words, a search box, and the learner's own flashcards behind one button.
 * The ＋ on the end bends the ending (です → でした, じゃないです…, a verb
 * through its polite / not / did / want-to forms) and offers the sentence
 * enders か・ね・よ.
 *
 * Every change redraws the whole sentence, its romaji, and its English —
 * templated at once, refined by Claude when the site can ask. The point is
 * to show that one pattern IS many sentences: swap the words, bend the end,
 * and it keeps being true.
 */

interface SlotWord {
  kana: string;
  gloss: string;
  /** Only verbs carry one; picked words get a guess. */
  kind?: WordKind;
}

interface RecipeState {
  x: SlotWord;
  y: SlotWord;
  /** Verb recipe only. */
  verb?: SlotWord;
  /** Index into the recipe's form list. */
  form: number;
  ender: "" | "か" | "ね" | "よ";
}

const STATE_KEY = "recipesState";

// ---------------- the word shelves ----------------

const TOPICS: SlotWord[] = [
  { kana: "わたし", gloss: "I" },
  { kana: "あなた", gloss: "you" },
  { kana: "かれ", gloss: "he" },
  { kana: "かのじょ", gloss: "she" },
  { kana: "ねこ", gloss: "the cat" },
  { kana: "いぬ", gloss: "the dog" },
  { kana: "せんせい", gloss: "the teacher" },
  { kana: "ともだち", gloss: "my friend" },
  { kana: "さくら", gloss: "Sakura" },
  { kana: "これ", gloss: "this" },
  { kana: "それ", gloss: "that" },
  { kana: "きょう", gloss: "today" },
  { kana: "あした", gloss: "tomorrow" },
];

const BE_WORDS: SlotWord[] = [
  { kana: "がくせい", gloss: "a student" },
  { kana: "せんせい", gloss: "a teacher" },
  { kana: "ねこ", gloss: "a cat" },
  { kana: "いぬ", gloss: "a dog" },
  { kana: "ともだち", gloss: "a friend" },
  { kana: "やすみ", gloss: "a day off" },
  { kana: "テスト", gloss: "a test" },
  { kana: "かわいい", gloss: "cute" },
  { kana: "おおきい", gloss: "big" },
  { kana: "ちいさい", gloss: "small" },
  { kana: "あかい", gloss: "red" },
  { kana: "おいしい", gloss: "tasty" },
  { kana: "たのしい", gloss: "fun" },
];

const OBJECTS: SlotWord[] = [
  { kana: "みず", gloss: "water" },
  { kana: "パン", gloss: "bread" },
  { kana: "ほん", gloss: "a book" },
  { kana: "ごはん", gloss: "rice" },
  { kana: "おちゃ", gloss: "tea" },
  { kana: "りんご", gloss: "an apple" },
  { kana: "さかな", gloss: "fish" },
  { kana: "えいが", gloss: "a movie" },
  { kana: "うた", gloss: "a song" },
  { kana: "ケーキ", gloss: "cake" },
];

const VERBS: SlotWord[] = [
  { kana: "のむ", gloss: "drink", kind: "godan" },
  { kana: "たべる", gloss: "eat", kind: "ichidan" },
  { kana: "よむ", gloss: "read", kind: "godan" },
  { kana: "みる", gloss: "watch", kind: "ichidan" },
  { kana: "かう", gloss: "buy", kind: "godan" },
  { kana: "つくる", gloss: "make", kind: "godan" },
  { kana: "きく", gloss: "listen to", kind: "godan" },
  { kana: "うたう", gloss: "sing", kind: "godan" },
];

// ---------------- bending the endings ----------------

/** The polite stem: のむ → のみ, たべる → たべ — every verb form hangs off it. */
function politeStem(verb: SlotWord): string {
  const kind = verb.kind ?? guessKind(verb.kana);
  const masu = PIECES.find((p) => p.id === "masu")!;
  const state = startState(verb.kana, kind);
  if (state.form !== "verb") return verb.kana;
  return masu.apply(state).kana.slice(0, -2);
}

interface FormChoice {
  label: string;
  name: string;
  make: (s: RecipeState) => string;
}

const BE_FORMS: FormChoice[] = [
  { label: "です", name: "is", make: () => "です" },
  { label: "でした", name: "was", make: () => "でした" },
  { label: "じゃないです", name: "isn't", make: () => "じゃないです" },
  { label: "じゃなかったです", name: "wasn't", make: () => "じゃなかったです" },
];

const DO_FORMS: FormChoice[] = [
  { label: "〜る", name: "plain", make: (s) => s.verb!.kana },
  { label: "〜ます", name: "does (polite)", make: (s) => politeStem(s.verb!) + "ます" },
  { label: "〜ません", name: "doesn't", make: (s) => politeStem(s.verb!) + "ません" },
  { label: "〜ました", name: "did", make: (s) => politeStem(s.verb!) + "ました" },
  { label: "〜たい", name: "wants to", make: (s) => politeStem(s.verb!) + "たい" },
];

const ENDERS: { ender: "か" | "ね" | "よ"; name: string }[] = [
  { ender: "か", name: "question" },
  { ender: "ね", name: "…right?" },
  { ender: "よ", name: "I'm telling you" },
];

// ---------------- the two recipes ----------------

interface Recipe {
  id: "be" | "do";
  title: string;
  pattern: string;
  forms: FormChoice[];
  /** The full sentence, spaced for the eye. */
  jp: (s: RecipeState) => string;
}

const RECIPES: Recipe[] = [
  {
    id: "be",
    title: "Xは Yです",
    pattern: "X is Y",
    forms: BE_FORMS,
    jp: (s) => `${s.x.kana}は ${s.y.kana}${BE_FORMS[s.form].make(s)}${s.ender}`,
  },
  {
    id: "do",
    title: "Xは Yを …",
    pattern: "X does something to Y",
    forms: DO_FORMS,
    jp: (s) => `${s.x.kana}は ${s.y.kana}を ${DO_FORMS[s.form].make(s)}${s.ender}`,
  },
];

// ---------------- state ----------------

let states: Record<string, RecipeState> | null = null;

function freshStates(): Record<string, RecipeState> {
  return {
    be: { x: TOPICS[0], y: BE_WORDS[0], form: 0, ender: "" },
    do: { x: TOPICS[0], y: OBJECTS[0], verb: VERBS[0], form: 1, ender: "" },
  };
}

async function loadStates(): Promise<Record<string, RecipeState>> {
  if (states) return states;
  const saved = await getMeta<Record<string, RecipeState>>(STATE_KEY);
  states = saved?.be && saved?.do ? saved : freshStates();
  return states;
}

// ---------------- translation ----------------

interface Translation {
  en: string;
  note?: string;
}

const translations = new Map<string, Translation>();
let translateSeq = 0;

function drawTranslation(box: HTMLElement, t: Translation): void {
  box.innerHTML = `<span class="rc-en-text">“${escapeHtml(t.en)}”</span>${
    t.note ? `<span class="rc-en-note">${escapeHtml(t.note)}</span>` : ""
  }`;
}

/**
 * The meaning, from Claude alone. Nothing but "…" shows until the answer
 * lands: only a translator that knows は marks a topic can say that
 * あなたはテストです is probably about an exam, not an identity crisis, and
 * a templated guess in the meantime reads as broken English.
 */
async function refineTranslation(host: HTMLElement, recipe: Recipe, s: RecipeState): Promise<void> {
  const jp = recipe.jp(s).replace(/\s+/g, "");
  const box = host.querySelector<HTMLElement>(`#rc-en-${recipe.id}`);
  if (!box) return;
  const cached = translations.get(jp);
  if (cached) {
    drawTranslation(box, cached);
    return;
  }
  if (!(await generationAvailable())) {
    box.textContent = "";
    return;
  }
  const seq = ++translateSeq;
  await new Promise((r) => setTimeout(r, 400));
  if (seq !== translateSeq || !box.isConnected) return;

  const words = [
    `${s.x.kana} = ${s.x.gloss}`,
    `${s.y.kana} = ${s.y.gloss}`,
    ...(s.verb ? [`${s.verb.kana} = ${s.verb.gloss}`] : []),
  ].join(", ");
  const prompt = [
    "A beginner built a Japanese sentence in a pattern playground.",
    `Pattern: ${recipe.title} (rough shape: "${recipe.pattern}").`,
    `Sentence: ${jp}`,
    `Words: ${words}.`,
    "",
    "は marks the topic, not the grammatical subject, so the natural meaning can differ from the " +
      'literal shape: あなたはテストです usually means "you have a test", not "you are a test". Judge ' +
      "from these words what a real speaker would most likely mean.",
    'Give "en": that most natural English meaning, short, as real speech.',
    'Give "note": the literal topic reading, in the shape "literally: as for you, it is a test".',
  ].join("\n");
  // On any failure the dots come off: stuck "…" reads as broken.
  const settle = (): void => {
    if (seq === translateSeq && box.isConnected) box.textContent = "";
  };
  try {
    const res = await fetch(assetUrl("grammar.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "translate", prompt }),
    });
    if (!res.ok) return settle();
    const { raw } = (await res.json()) as { raw?: string };
    const parsed = JSON.parse(raw ?? "{}") as { en?: string; note?: string };
    if (typeof parsed.en !== "string" || !parsed.en.trim()) return settle();
    const value: Translation = {
      en: parsed.en.trim(),
      ...(typeof parsed.note === "string" && parsed.note.trim() ? { note: parsed.note.trim() } : {}),
    };
    translations.set(jp, value);
    if (seq === translateSeq && box.isConnected) drawTranslation(box, value);
  } catch {
    settle();
  }
}

// ---------------- the picker ----------------

interface PickerSpot {
  recipe: Recipe;
  slot: "x" | "y" | "verb";
}

/** The learner's own flashcards, once per visit, boiled down to slot words. */
let cardWords: Promise<SlotWord[]> | null = null;

function flashcardWords(): Promise<SlotWord[]> {
  cardWords ??= (async () => {
    try {
      const cards = await getAllCards();
      const seen = new Set<string>();
      const out: SlotWord[] = [];
      for (const card of cards) {
        const kana = toHiragana((card.reading || card.term).trim());
        const gloss = card.glosses[0]?.trim();
        if (!kana || !gloss || kana.length > 8 || !isKana(kana) || seen.has(kana)) continue;
        seen.add(kana);
        out.push({ kana, gloss: gloss.length > 30 ? `${gloss.slice(0, 28)}…` : gloss });
      }
      return out;
    } catch {
      return [];
    }
  })();
  return cardWords;
}

/** A verb slot only wants words that end like a verb. */
const verbShaped = (kana: string): boolean => /[うくぐすつぬぶむる]$/.test(kana) || kana.endsWith("する");

function shelfFor(spot: PickerSpot): SlotWord[] {
  if (spot.slot === "verb") return VERBS;
  if (spot.slot === "x") return TOPICS;
  return spot.recipe.id === "be" ? BE_WORDS : OBJECTS;
}

function openPicker(host: HTMLElement, spot: PickerSpot, onPick: (w: SlotWord) => void): void {
  host.querySelector(".rc-scrim")?.remove();
  const scrim = document.createElement("div");
  scrim.className = "rc-scrim";
  scrim.innerHTML = `
    <div class="rc-pop card-panel" role="dialog" aria-modal="true">
      <div class="rc-pop-head">
        <input class="rc-search" lang="ja" placeholder="Search…" autocomplete="off" autocapitalize="none" />
        <button class="rc-mine secondary">My cards</button>
        <button class="rc-close ghost" aria-label="Close">✕</button>
      </div>
      <div class="rc-pop-list"></div>
    </div>`;
  host.appendChild(scrim);

  const list = scrim.querySelector<HTMLDivElement>(".rc-pop-list")!;
  const search = scrim.querySelector<HTMLInputElement>(".rc-search")!;
  const mineButton = scrim.querySelector<HTMLButtonElement>(".rc-mine")!;
  let shelf = shelfFor(spot);
  let mine = false;

  const fill = (): void => {
    const needle = search.value.trim().toLowerCase();
    const shown = shelf.filter(
      (w) => !needle || w.kana.includes(needle) || w.gloss.toLowerCase().includes(needle),
    );
    list.innerHTML =
      shown
        .map(
          (w, i) => `
        <button class="rc-pick" data-i="${i}">
          <span lang="ja">${escapeHtml(w.kana)}</span>
          <span class="glosses">${escapeHtml(w.gloss)}</span>
        </button>`,
        )
        .join("") ||
      `<div class="glosses" style="padding:12px">${
        mine ? "No cards fit this slot yet. The flashcards you save show up here." : "Nothing matches."
      }</div>`;
    for (const button of list.querySelectorAll<HTMLButtonElement>(".rc-pick")) {
      button.addEventListener("click", () => {
        const w = shown[Number(button.dataset.i)];
        scrim.remove();
        onPick(spot.slot === "verb" ? { ...w, kind: w.kind ?? guessKind(w.kana) } : w);
      });
    }
  };

  mineButton.addEventListener("click", async () => {
    mine = !mine;
    mineButton.textContent = mine ? "Easy words" : "My cards";
    if (mine) {
      list.innerHTML = `<div class="glosses" style="padding:12px">Looking through your cards…</div>`;
      const all = await flashcardWords();
      shelf = spot.slot === "verb" ? all.filter((w) => verbShaped(w.kana)) : all;
    } else {
      shelf = shelfFor(spot);
    }
    fill();
  });
  search.addEventListener("input", fill);
  scrim.addEventListener("click", (ev) => {
    if (ev.target === scrim) scrim.remove();
  });
  scrim.querySelector(".rc-close")!.addEventListener("click", () => scrim.remove());
  fill();
  search.focus();
}

// ---------------- drawing ----------------

export interface RecipeOptions {
  /** Show only these recipes; both when absent. Chapter 1 embeds just "be". */
  only?: ("be" | "do")[];
}

export async function renderRecipes(host: HTMLDivElement, options: RecipeOptions = {}): Promise<void> {
  const state = await loadStates();
  if (!host.isConnected) return;
  const shown = RECIPES.filter((recipe) => !options.only || options.only.includes(recipe.id));

  host.innerHTML = shown.map((recipe) => cardHtml(recipe, state[recipe.id])).join("");

  for (const recipe of shown) wire(host, recipe, options);
  for (const recipe of shown) void refineTranslation(host, recipe, state[recipe.id]);
}

/** The pattern with its slots lit: X one colour, Y the other, everywhere. */
function patternHtml(text: string): string {
  return escapeHtml(text)
    .replace(/X/g, '<span class="rc-x">X</span>')
    .replace(/Y/g, '<span class="rc-y">Y</span>');
}

function cardHtml(recipe: Recipe, s: RecipeState): string {
  const form = recipe.forms[s.form];
  const tail = form.make(s);
  const slots: string[] = [
    slotHtml(recipe.id, "x", s.x),
    `<span class="rc-fixed" lang="ja">は</span>`,
    slotHtml(recipe.id, "y", s.y),
  ];
  if (recipe.id === "do") {
    slots.push(`<span class="rc-fixed" lang="ja">を</span>`);
    slots.push(`
      <button class="pg-block rc-slot" data-recipe="do" data-slot="verb">
        <span class="pg-block-jp" lang="ja">${escapeHtml(tail)}</span>
        <span class="pg-block-sub">${escapeHtml(`${s.verb!.gloss} · ${form.name}`)}</span>
      </button>`);
  } else {
    slots.push(`
      <span class="pg-block rc-tail">
        <span class="pg-block-jp" lang="ja">${escapeHtml(tail)}</span>
        <span class="pg-block-sub">${escapeHtml(form.name)}</span>
      </span>`);
  }
  if (s.ender) {
    slots.push(`
      <span class="pg-block rc-tail rc-ender">
        <span class="pg-block-jp" lang="ja">${s.ender}</span>
        <span class="pg-block-sub">${escapeHtml(ENDERS.find((e) => e.ender === s.ender)!.name)}</span>
      </span>`);
  }
  const jp = recipe.jp(s);
  return `
    <div class="card-panel rc-card" data-card="${recipe.id}">
      <div class="rc-title"><b lang="ja">${patternHtml(recipe.title)}</b>: ${patternHtml(recipe.pattern)}</div>
      <div class="pg-chain rc-chain">
        ${slots.join("")}
        <button class="pg-endcap rc-plus" data-recipe="${recipe.id}" title="Bend the ending">＋</button>
      </div>
      <div class="rc-sentence">
        <button class="speaker rc-say" data-recipe="${recipe.id}" title="Say it" aria-label="Say it">🔊</button>
        <span class="rc-jp" lang="ja">${escapeHtml(jp)}</span>
      </div>
      <div class="rc-en" id="rc-en-${recipe.id}">…</div>
    </div>`;
}

function slotHtml(recipeId: string, slot: "x" | "y", w: SlotWord): string {
  return `
    <button class="pg-block rc-slot rc-slot-${slot}" data-recipe="${recipeId}" data-slot="${slot}">
      <span class="pg-block-jp" lang="ja">${escapeHtml(w.kana)}</span>
      <span class="pg-block-sub">${escapeHtml(w.gloss)}</span>
    </button>`;
}

/** The ＋: the ending options, in the same popup the slots use. */
function openEndings(host: HTMLElement, recipe: Recipe, s: RecipeState, redraw: () => void): void {
  host.querySelector(".rc-scrim")?.remove();
  const scrim = document.createElement("div");
  scrim.className = "rc-scrim";
  scrim.innerHTML = `
    <div class="rc-pop card-panel" role="dialog" aria-modal="true">
      <div class="rc-pop-head">
        <b>${recipe.id === "be" ? "Bend です" : "Bend the action"}</b>
        <button class="rc-close ghost" aria-label="Close">✕</button>
      </div>
      <div class="rc-pop-list">
        ${recipe.forms
          .map(
            (form, i) => `
          <button class="pg-opt${i === s.form ? " on" : ""}" data-form="${i}">
            <span class="pg-opt-jp" lang="ja">${escapeHtml(form.label)}</span>
            <span class="pg-opt-name">${escapeHtml(form.name)}</span>
          </button>`,
          )
          .join("")}
        <div class="pg-panel-title">End the sentence:</div>
        ${ENDERS.map(
          (e) => `
          <button class="pg-opt${s.ender === e.ender ? " on" : ""}" data-ender="${e.ender}">
            <span class="pg-opt-jp" lang="ja">〜${e.ender}</span>
            <span class="pg-opt-name">${escapeHtml(e.name)}</span>
          </button>`,
        ).join("")}
      </div>
    </div>`;
  host.appendChild(scrim);

  for (const option of scrim.querySelectorAll<HTMLButtonElement>("[data-form]")) {
    option.addEventListener("click", () => {
      s.form = Number(option.dataset.form);
      scrim.remove();
      redraw();
    });
  }
  for (const option of scrim.querySelectorAll<HTMLButtonElement>("[data-ender]")) {
    option.addEventListener("click", () => {
      const ender = option.dataset.ender as "か" | "ね" | "よ";
      s.ender = s.ender === ender ? "" : ender;
      scrim.remove();
      redraw();
    });
  }
  scrim.addEventListener("click", (ev) => {
    if (ev.target === scrim) scrim.remove();
  });
  scrim.querySelector(".rc-close")!.addEventListener("click", () => scrim.remove());
}

function wire(host: HTMLDivElement, recipe: Recipe, options: RecipeOptions): void {
  const card = host.querySelector<HTMLDivElement>(`[data-card="${recipe.id}"]`);
  if (!card || !states) return;
  const s = states[recipe.id];

  const redraw = (): void => {
    void setMeta(STATE_KEY, states);
    void renderRecipes(host, options);
  };

  for (const slot of card.querySelectorAll<HTMLButtonElement>(".rc-slot")) {
    slot.addEventListener("click", () => {
      const which = slot.dataset.slot as "x" | "y" | "verb";
      openPicker(host, { recipe, slot: which }, (w) => {
        if (which === "x") s.x = w;
        else if (which === "y") s.y = w;
        else s.verb = w;
        redraw();
      });
    });
  }
  card.querySelector<HTMLButtonElement>(".rc-plus")!.addEventListener("click", () => {
    openEndings(host, recipe, s, redraw);
  });
  card.querySelector<HTMLButtonElement>(".rc-say")!.addEventListener("click", () => {
    void speak(recipe.jp(s).replace(/\s+/g, ""), { rate: 0.85 }).catch(() => undefined);
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
