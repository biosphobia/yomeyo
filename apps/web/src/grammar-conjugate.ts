/**
 * The conjugation engine behind the grammar playground.
 *
 * A word is a starting block; endings are pieces that snap on behind it,
 * and each piece changes both the word and what can snap on next. That
 * chain-of-states view is the whole trick of Japanese conjugation — ない
 * turns any verb into something that behaves like an い-word, ている turns
 * anything back into a る-group verb — so the engine models exactly that:
 * a state (the kana so far, and how its ending behaves) and pieces that
 * carry a `fits` and an `apply`.
 *
 * Everything is kana-only, like the rest of the grammar course. A word
 * typed in kanji is converted to its reading before it gets here.
 */

/** What kind of word the learner started from. */
export type WordKind = "godan" | "ichidan" | "suru" | "kuru" | "i-adj" | "na-adj" | "noun";

/** Kinds shown to the learner, in plain words. */
export const WORD_KIND_INFO: Record<WordKind, { name: string; hint: string }> = {
  godan: { name: "action word · う-group", hint: "the ending sound shifts: かく → かきます" },
  ichidan: { name: "action word · る-group", hint: "the る drops off: たべる → たべます" },
  suru: { name: "action word · する", hint: "the irregular “do”: する → します" },
  kuru: { name: "action word · くる", hint: "the irregular “come”: くる → きます" },
  "i-adj": { name: "describing word · 〜い", hint: "the い bends: あかい → あかくない" },
  "na-adj": { name: "describing word · な", hint: "borrows だ: きれい → きれいだ" },
  noun: { name: "thing word", hint: "takes だ to say “is”: ねこ → ねこだ" },
};

/**
 * How the chain's current ending behaves — this is what decides which
 * pieces fit next, and it changes with every piece added.
 */
export type Form =
  | "verb" // plain verb ending (dictionary form, or something that became one)
  | "masu" // …ます
  | "masen" // …ません
  | "i-adj" // behaves like an い-word: real ones, plus ない and たい
  | "nounish" // a thing or な-word, waiting for だ・です
  | "te" // …て/で, hanging mid-air, ready to connect
  | "done"; // a finished ending: nothing more snaps on

export interface ChainState {
  kana: string;
  form: Form;
  /** Which family the current verb ending follows (form "verb" only). */
  verbKind?: "godan" | "ichidan" | "suru" | "kuru";
}

export function startState(kana: string, kind: WordKind): ChainState {
  switch (kind) {
    case "godan":
    case "ichidan":
    case "suru":
    case "kuru":
      return { kana, form: "verb", verbKind: kind };
    case "i-adj":
      return { kana, form: "i-adj" };
    default:
      return { kana, form: "nounish" };
  }
}

// ---------------- verb machinery ----------------

/** Per final-kana rows for う-group verbs: [あ-row, い-row, え-row, お-row]. */
const GODAN_ROWS: Record<string, [string, string, string, string]> = {
  う: ["わ", "い", "え", "お"],
  く: ["か", "き", "け", "こ"],
  ぐ: ["が", "ぎ", "げ", "ご"],
  す: ["さ", "し", "せ", "そ"],
  つ: ["た", "ち", "て", "と"],
  ぬ: ["な", "に", "ね", "の"],
  ぶ: ["ば", "び", "べ", "ぼ"],
  む: ["ま", "み", "め", "も"],
  る: ["ら", "り", "れ", "ろ"],
};

/** The て-form tail for each う-group final kana. */
const GODAN_TE: Record<string, string> = {
  う: "って",
  つ: "って",
  る: "って",
  む: "んで",
  ぬ: "んで",
  ぶ: "んで",
  く: "いて",
  ぐ: "いで",
  す: "して",
};

const cut = (kana: string, n: number): string => kana.slice(0, kana.length - n);

/** The base of a する-word: べんきょうする → べんきょう. */
const suruBase = (kana: string): string => (kana.endsWith("する") ? cut(kana, 2) : "");

function godanRow(kana: string, row: 0 | 1 | 2 | 3): string {
  const last = kana[kana.length - 1];
  const mapped = GODAN_ROWS[last];
  return mapped ? cut(kana, 1) + mapped[row] : kana;
}

/** The stem ます snaps onto: かき, たべ, し, き. */
export function masuStem(s: ChainState): string {
  switch (s.verbKind) {
    case "godan":
      return godanRow(s.kana, 1);
    case "ichidan":
      return cut(s.kana, 1);
    case "suru":
      return suruBase(s.kana) + "し";
    case "kuru":
      return "き";
    default:
      return s.kana;
  }
}

function naiForm(s: ChainState): string {
  switch (s.verbKind) {
    case "godan":
      // ある is the one verb whose ない form is just ない.
      if (s.kana === "ある") return "ない";
      return godanRow(s.kana, 0) + "ない";
    case "ichidan":
      return cut(s.kana, 1) + "ない";
    case "suru":
      return suruBase(s.kana) + "しない";
    case "kuru":
      return "こない";
    default:
      return s.kana + "ない";
  }
}

function teForm(s: ChainState): string {
  switch (s.verbKind) {
    case "godan": {
      // いく breaks the く rule: いって, not いいて.
      if (s.kana.endsWith("いく")) return cut(s.kana, 1) + "って";
      const tail = GODAN_TE[s.kana[s.kana.length - 1]];
      return tail ? cut(s.kana, 1) + tail : s.kana + "て";
    }
    case "ichidan":
      return cut(s.kana, 1) + "て";
    case "suru":
      return suruBase(s.kana) + "して";
    case "kuru":
      return "きて";
    default:
      return s.kana + "て";
  }
}

function taForm(s: ChainState): string {
  const te = teForm(s);
  return te.endsWith("で") ? cut(te, 1) + "だ" : cut(te, 1) + "た";
}

/** An い-word's stem: あかい → あか. いい alone bends to よ. */
function iStem(kana: string): string {
  if (kana === "いい") return "よ";
  return cut(kana, 1);
}

// ---------------- the pieces ----------------

export interface Piece {
  id: string;
  /** What is printed on the block: 〜ます */
  label: string;
  /** Its plain name: "polite" */
  name: string;
  /** What snapping it on does, in a sentence. */
  job: string;
  /** Added to the meaning recipe: "politely". */
  hint: string;
  /** Block colour family. */
  tone: "polite" | "negative" | "past" | "connect" | "extra";
  fits(s: ChainState): boolean;
  apply(s: ChainState): ChainState;
}

export const PIECES: Piece[] = [
  {
    id: "masu",
    label: "〜ます",
    name: "polite",
    job: "the polite ending — how you'd say it to a stranger",
    hint: "politely",
    tone: "polite",
    fits: (s) => s.form === "verb",
    apply: (s) => ({ kana: masuStem(s) + "ます", form: "masu" }),
  },
  {
    id: "nai",
    label: "〜ない",
    name: "not",
    job: "turns it into “not” — and the result bends like an い-word",
    hint: "not",
    tone: "negative",
    fits: (s) => s.form === "verb" || s.form === "i-adj" || s.form === "nounish" || s.form === "masu",
    apply: (s) => {
      if (s.form === "verb") return { kana: naiForm(s), form: "i-adj" };
      if (s.form === "i-adj") return { kana: iStem(s.kana) + "くない", form: "i-adj" };
      if (s.form === "masu") return { kana: cut(s.kana, 2) + "ません", form: "masen" };
      return { kana: s.kana + "じゃない", form: "i-adj" };
    },
  },
  {
    id: "ta",
    label: "〜た",
    name: "past",
    job: "moves it into the past — it already happened",
    hint: "in the past",
    tone: "past",
    fits: (s) => s.form !== "te" && s.form !== "done",
    apply: (s) => {
      if (s.form === "verb") return { kana: taForm(s), form: "done" };
      if (s.form === "i-adj") return { kana: iStem(s.kana) + "かった", form: "done" };
      if (s.form === "masu") return { kana: cut(s.kana, 2) + "ました", form: "done" };
      if (s.form === "masen") return { kana: s.kana + "でした", form: "done" };
      return { kana: s.kana + "だった", form: "done" };
    },
  },
  {
    id: "te",
    label: "〜て",
    name: "connect",
    job: "leaves it hanging mid-air so the next thing can hook on",
    hint: "and…",
    tone: "connect",
    fits: (s) => s.form === "verb" || s.form === "i-adj" || s.form === "nounish",
    apply: (s) => {
      if (s.form === "verb") return { kana: teForm(s), form: "te" };
      if (s.form === "i-adj") return { kana: iStem(s.kana) + "くて", form: "te" };
      return { kana: s.kana + "で", form: "te" };
    },
  },
  {
    id: "iru",
    label: "〜いる",
    name: "…ing",
    job: "in the middle of it — and the result is a る-group verb again",
    hint: "right now",
    tone: "connect",
    fits: (s) => s.form === "te" && /[てで]$/.test(s.kana),
    apply: (s) => ({ kana: s.kana + "いる", form: "verb", verbKind: "ichidan" }),
  },
  {
    id: "kudasai",
    label: "〜ください",
    name: "please",
    job: "asks for it politely — please do this",
    hint: "please",
    tone: "polite",
    fits: (s) => s.form === "te" && /[てで]$/.test(s.kana),
    apply: (s) => ({ kana: s.kana + "ください", form: "done" }),
  },
  {
    id: "tai",
    label: "〜たい",
    name: "want to",
    job: "says you want to — and the result bends like an い-word",
    hint: "want to",
    tone: "extra",
    fits: (s) => s.form === "verb",
    apply: (s) => ({ kana: masuStem(s) + "たい", form: "i-adj" }),
  },
  {
    id: "potential",
    label: "〜られる",
    name: "can",
    job: "says it's possible — and the result is a る-group verb again",
    hint: "can",
    tone: "extra",
    fits: (s) => s.form === "verb",
    apply: (s) => {
      switch (s.verbKind) {
        case "godan":
          return { kana: godanRow(s.kana, 2) + "る", form: "verb", verbKind: "ichidan" };
        case "suru":
          return { kana: suruBase(s.kana) + "できる", form: "verb", verbKind: "ichidan" };
        case "kuru":
          return { kana: "こられる", form: "verb", verbKind: "ichidan" };
        default:
          return { kana: cut(s.kana, 1) + "られる", form: "verb", verbKind: "ichidan" };
      }
    },
  },
  {
    id: "you",
    label: "〜よう",
    name: "let's",
    job: "offers it — let's do this, or I think I will",
    hint: "let's",
    tone: "extra",
    fits: (s) => s.form === "verb" || s.form === "masu",
    apply: (s) => {
      if (s.form === "masu") return { kana: cut(s.kana, 2) + "ましょう", form: "done" };
      switch (s.verbKind) {
        case "godan":
          return { kana: godanRow(s.kana, 3) + "う", form: "done" };
        case "suru":
          return { kana: suruBase(s.kana) + "しよう", form: "done" };
        case "kuru":
          return { kana: "こよう", form: "done" };
        default:
          return { kana: cut(s.kana, 1) + "よう", form: "done" };
      }
    },
  },
  {
    id: "ba",
    label: "〜ば",
    name: "if",
    job: "makes it a condition — if this, then…",
    hint: "if",
    tone: "extra",
    fits: (s) => s.form === "verb" || s.form === "i-adj" || s.form === "nounish",
    apply: (s) => {
      if (s.form === "i-adj") return { kana: iStem(s.kana) + "ければ", form: "done" };
      if (s.form === "nounish") return { kana: s.kana + "なら", form: "done" };
      switch (s.verbKind) {
        case "godan":
          return { kana: godanRow(s.kana, 2) + "ば", form: "done" };
        case "suru":
          return { kana: suruBase(s.kana) + "すれば", form: "done" };
        case "kuru":
          return { kana: "くれば", form: "done" };
        default:
          return { kana: cut(s.kana, 1) + "れば", form: "done" };
      }
    },
  },
  {
    id: "da",
    label: "〜だ",
    name: "is",
    job: "the plain “is” — it finishes the sentence",
    hint: "it is",
    tone: "polite",
    fits: (s) => s.form === "nounish",
    apply: (s) => ({ kana: s.kana + "だ", form: "done" }),
  },
  {
    id: "desu",
    label: "〜です",
    name: "is, politely",
    job: "the polite “is” — it finishes the sentence",
    hint: "it is (politely)",
    tone: "polite",
    fits: (s) => s.form === "nounish" || s.form === "i-adj",
    apply: (s) => ({ kana: s.kana + "です", form: "done" }),
  },
];

/** What the current ending is waiting for, said to the learner. */
export function formHint(form: Form): string {
  switch (form) {
    case "verb":
      return "a plain action word — most pieces fit here";
    case "masu":
      return "polite — ない, た and よう still fit";
    case "masen":
      return "polite and negative — only た (→ でした) fits";
    case "i-adj":
      return "bends like an い-word now";
    case "nounish":
      return "a thing — it wants だ or です, or a piece that replaces them";
    case "te":
      return "hanging mid-air — いる or ください finish it";
    case "done":
      return "a finished ending — break a piece off to keep building";
  }
}

// ---------------- word-kind detection ----------------

/** From JMdict-style part-of-speech tags. */
export function kindFromPos(pos: string[]): WordKind | null {
  for (const p of pos) {
    if (p === "v1") return "ichidan";
    if (p.startsWith("v5")) return "godan";
    if (p === "vk") return "kuru";
    if (p === "vs" || p === "vs-i" || p === "vs-s") return "suru";
    if (p === "adj-i") return "i-adj";
    if (p === "adj-na") return "na-adj";
  }
  for (const p of pos) {
    if (p === "n" || p === "pn" || p === "n-adv" || p === "n-t") return "noun";
  }
  return null;
}

/**
 * Can this word's shape honestly conjugate as this kind? ねこ ends in こ,
 * which no verb family can bend — treating it as a verb would produce
 * nonsense like ねこた, shown to a learner as if it were real. Thing-words
 * and な-words accept anything; the conjugating kinds have to fit.
 */
export function kindFitsShape(kana: string, kind: WordKind): boolean {
  switch (kind) {
    case "godan":
      return kana.length >= 2 && GODAN_ROWS[kana[kana.length - 1]] !== undefined;
    case "ichidan":
      return kana.length >= 2 && kana.endsWith("る");
    case "suru":
      return kana.endsWith("する");
    case "kuru":
      return kana === "くる";
    case "i-adj":
      return kana.length >= 2 && kana.endsWith("い");
    default:
      return true;
  }
}

const IE_ROW = new Set("いきぎしじちにひびみりえけげせぜてでねへべめれ");

/** A guess from the shape alone, for words the dictionary doesn't know. */
export function guessKind(kana: string): WordKind {
  if (kana === "くる") return "kuru";
  if (kana.endsWith("する")) return "suru";
  if (kana.endsWith("る") && kana.length >= 2 && IE_ROW.has(kana[kana.length - 2])) return "ichidan";
  if (GODAN_ROWS[kana[kana.length - 1]]) return "godan";
  if (kana.endsWith("い") && kana.length >= 2) return "i-adj";
  return "noun";
}

// ---------------- kana → romaji ----------------

const DIGRAPHS: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo", びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
};

const MONOGRAPHS: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "wo", ん: "n", ゔ: "vu",
};

/** Katakana folded to hiragana so one table serves both. */
export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function kanaToRomaji(kana: string): string {
  const text = toHiragana(kana);
  let out = "";
  let doubled = false;
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    const one = text[i];
    if (one === "っ") {
      doubled = true;
      continue;
    }
    if (one === "ー") {
      const prev = out[out.length - 1];
      if (prev && "aiueo".includes(prev)) out += prev;
      continue;
    }
    let piece = "";
    if (DIGRAPHS[two]) {
      piece = DIGRAPHS[two];
      i++;
    } else if (MONOGRAPHS[one]) {
      piece = MONOGRAPHS[one];
    } else {
      piece = one;
    }
    if (doubled && piece.length > 0) {
      out += piece.startsWith("ch") ? "t" : piece[0];
      doubled = false;
    }
    // ん before a vowel or y reads as its own syllable: きんえん → kin'en.
    if (out.endsWith("n") && /^[aiueoy]/.test(piece)) out += "'";
    out += piece;
  }
  return out;
}

/** Is this all kana (no kanji, no latin)? */
export function isKana(text: string): boolean {
  return /^[ぁ-ゟーァ-ヶ]+$/.test(text);
}
