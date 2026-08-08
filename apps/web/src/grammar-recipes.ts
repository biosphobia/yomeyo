import { getAllCards, getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { assetUrl } from "./store.js";
import { generationAvailable } from "./grammar-ai.js";
import {
  PIECES,
  guessKind,
  isKana,
  kanaToRomaji,
  startState,
  toHiragana,
  type WordKind,
} from "./grammar-conjugate.js";

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
  hint: string;
  forms: FormChoice[];
  /** The full sentence, spaced for the eye. */
  jp: (s: RecipeState) => string;
  /** The rough English, shown at once; Claude's version replaces it. */
  en: (s: RecipeState) => string;
}

const BE_EN = ["is", "was", "isn't", "wasn't"];

const RECIPES: Recipe[] = [
  {
    id: "be",
    title: "＿は ＿です",
    pattern: "A is B",
    hint: "Tap X and Y to change the words. Tap ＋ to bend です or end the sentence.",
    forms: BE_FORMS,
    jp: (s) => `${s.x.kana}は ${s.y.kana}${BE_FORMS[s.form].make(s)}${s.ender}`,
    en: (s) => {
      const base = `${s.x.gloss} ${BE_EN[s.form]} ${s.y.gloss}`;
      if (s.ender === "か") return `${base}?`;
      if (s.ender === "ね") return `${base}, right?`;
      if (s.ender === "よ") return `${base}, I'm telling you`;
      return base;
    },
  },
  {
    id: "do",
    title: "＿は ＿を ＿",
    pattern: "A does something to B",
    hint: "Tap the slots to change the words. Tap ＋ to bend the action or end the sentence.",
    forms: DO_FORMS,
    jp: (s) => `${s.x.kana}は ${s.y.kana}を ${DO_FORMS[s.form].make(s)}${s.ender}`,
    en: (s) => {
      const v = s.verb!.gloss;
      const forms = [`${v}s`, `${v}s`, `doesn't ${v}`, `${pastOf(v)}`, `wants to ${v}`];
      const base = `${s.x.gloss} ${forms[s.form]} ${s.y.gloss}`;
      if (s.ender === "か") return `${base}?`;
      if (s.ender === "ね") return `${base}, right?`;
      if (s.ender === "よ") return `${base}, I'm telling you`;
      return base;
    },
  },
];

/** Enough English past tense for a template that Claude will overwrite. */
function pastOf(verb: string): string {
  const first = verb.split(" ")[0];
  const rest = verb.slice(first.length);
  const irregular: Record<string, string> = { drink: "drank", eat: "ate", read: "read", buy: "bought", make: "made", sing: "sang" };
  return (irregular[first] ?? (first.endsWith("e") ? `${first}d` : `${first}ed`)) + rest;
}

// ---------------- state ----------------

let states: Record<string, RecipeState> | null = null;
/** What each card's lower panel is showing: nothing, the ＋ options, or a slot picker. */
const panel: Record<string, "plus" | null> = { be: null, do: null };

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

const translations = new Map<string, string>();
let translateSeq = 0;

async function refineTranslation(host: HTMLElement, recipe: Recipe, s: RecipeState): Promise<void> {
  const jp = recipe.jp(s).replace(/\s+/g, "");
  const box = host.querySelector<HTMLElement>(`#rc-en-${recipe.id}`);
  if (!box) return;
  const cached = translations.get(jp);
  if (cached) {
    box.textContent = `“${cached}”`;
    return;
  }
  if (!(await generationAvailable())) return;
  const seq = ++translateSeq;
  await new Promise((r) => setTimeout(r, 700));
  if (seq !== translateSeq || !box.isConnected) return;

  const words = [
    `${s.x.kana} = ${s.x.gloss}`,
    `${s.y.kana} = ${s.y.gloss}`,
    ...(s.verb ? [`${s.verb.kana} = ${s.verb.gloss}`] : []),
  ].join(", ");
  const prompt = [
    `A beginner built this sentence from the pattern ${recipe.title} (“${recipe.pattern}”):`,
    "",
    jp,
    `Words used: ${words}.`,
    "",
    'Give "en": the natural English of the whole sentence, as short as real speech.',
    "Do not give a note.",
  ].join("\n");
  try {
    const res = await fetch(assetUrl("grammar.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "translate", prompt }),
    });
    if (!res.ok) return;
    const { raw } = (await res.json()) as { raw?: string };
    const parsed = JSON.parse(raw ?? "{}") as { en?: string };
    if (typeof parsed.en !== "string" || !parsed.en.trim()) return;
    translations.set(jp, parsed.en.trim());
    if (seq === translateSeq && box.isConnected) box.textContent = `“${parsed.en.trim()}”`;
  } catch {
    // The template already on screen is the answer then.
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
        mine ? "No cards fit this slot yet — the flashcards you save show up here." : "Nothing matches."
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

export async function renderRecipes(host: HTMLDivElement): Promise<void> {
  const state = await loadStates();
  if (!host.isConnected) return;

  host.innerHTML = `
    <div class="glosses rc-intro">One pattern is many sentences. Change the words, bend the ending,
      and watch the English follow.</div>
    ${RECIPES.map((recipe) => cardHtml(recipe, state[recipe.id])).join("")}
  `;

  for (const recipe of RECIPES) wire(host, recipe);
  for (const recipe of RECIPES) void refineTranslation(host, recipe, state[recipe.id]);
}

function cardHtml(recipe: Recipe, s: RecipeState): string {
  const form = recipe.forms[s.form];
  const tail = recipe.id === "be" ? form.make(s) : DO_FORMS[s.form].make(s);
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
      <div class="rc-title"><b lang="ja">${escapeHtml(recipe.title)}</b> — ${escapeHtml(recipe.pattern)}</div>
      <div class="pg-chain rc-chain">
        ${slots.join("")}
        <button class="pg-endcap rc-plus${panel[recipe.id] === "plus" ? " on" : ""}" data-recipe="${recipe.id}">＋</button>
      </div>
      <div class="rc-sentence">
        <button class="speaker rc-say" data-recipe="${recipe.id}" title="Say it" aria-label="Say it">🔊</button>
        <span class="rc-jp" lang="ja">${escapeHtml(jp)}</span>
      </div>
      <div class="rc-romaji">${escapeHtml(romajiOf(jp))}</div>
      <div class="rc-en" id="rc-en-${recipe.id}">“${escapeHtml(recipe.en(s))}”</div>
      ${panel[recipe.id] === "plus" ? plusPanelHtml(recipe, s) : `<div class="glosses rc-hint">${escapeHtml(recipe.hint)}</div>`}
    </div>`;
}

function slotHtml(recipeId: string, slot: "x" | "y", w: SlotWord): string {
  return `
    <button class="pg-block rc-slot" data-recipe="${recipeId}" data-slot="${slot}">
      <span class="pg-block-jp" lang="ja">${escapeHtml(w.kana)}</span>
      <span class="pg-block-sub">${escapeHtml(w.gloss)}</span>
    </button>`;
}

function plusPanelHtml(recipe: Recipe, s: RecipeState): string {
  return `
    <div class="rc-panel">
      <div class="pg-panel-title">${recipe.id === "be" ? "Bend です:" : "Bend the action:"}</div>
      ${recipe.forms
        .map((form, i) => {
          const preview = recipe.jp({ ...s, form: i });
          return `
          <button class="pg-opt${i === s.form ? " on" : ""}" data-form="${i}">
            <span class="pg-opt-jp" lang="ja">${escapeHtml(form.label)}</span>
            <span class="pg-opt-name">${escapeHtml(form.name)}</span>
            <span class="pg-opt-preview" lang="ja">→ ${escapeHtml(preview)}</span>
          </button>`;
        })
        .join("")}
      <div class="pg-panel-title">End the sentence:</div>
      ${ENDERS.map(
        (e) => `
        <button class="pg-opt${s.ender === e.ender ? " on" : ""}" data-ender="${e.ender}">
          <span class="pg-opt-jp" lang="ja">〜${e.ender}</span>
          <span class="pg-opt-name">${escapeHtml(e.name)}</span>
          <span class="pg-opt-preview" lang="ja">→ ${escapeHtml(recipe.jp({ ...s, ender: s.ender === e.ender ? "" : e.ender }))}</span>
        </button>`,
      ).join("")}
    </div>`;
}

function wire(host: HTMLDivElement, recipe: Recipe): void {
  const card = host.querySelector<HTMLDivElement>(`[data-card="${recipe.id}"]`);
  if (!card || !states) return;
  const s = states[recipe.id];

  const redraw = (): void => {
    void setMeta(STATE_KEY, states);
    void renderRecipes(host);
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
    panel[recipe.id] = panel[recipe.id] === "plus" ? null : "plus";
    void renderRecipes(host);
  });
  card.querySelector<HTMLButtonElement>(".rc-say")!.addEventListener("click", () => {
    void speak(recipe.jp(s).replace(/\s+/g, ""), { rate: 0.85 }).catch(() => undefined);
  });
  for (const option of card.querySelectorAll<HTMLButtonElement>("[data-form]")) {
    option.addEventListener("click", () => {
      s.form = Number(option.dataset.form);
      redraw();
    });
  }
  for (const option of card.querySelectorAll<HTMLButtonElement>("[data-ender]")) {
    option.addEventListener("click", () => {
      const ender = option.dataset.ender as "か" | "ね" | "よ";
      s.ender = s.ender === ender ? "" : ender;
      redraw();
    });
  }
}

/**
 * Romaji for a recipe sentence, with the particles read the way they're
 * said: the は and を hanging off a word come out "wa" and "o", set apart
 * with a space — exactly what chapter 1 teaches.
 */
function romajiOf(jp: string): string {
  return jp
    .split(/\s+/)
    .map((part) => {
      const particle = part.endsWith("は") ? "wa" : part.endsWith("を") ? "o" : null;
      if (particle && part.length > 1) return `${kanaToRomaji(toHiragana(part.slice(0, -1)))} ${particle}`;
      return kanaToRomaji(toHiragana(part));
    })
    .join(" ");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
