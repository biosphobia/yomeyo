import { speak } from "./audio.js";
import { cheerBox, preloadReactions, showReaction } from "./feedback.js";
import { PER_CORRECT, earnYennies, formatYennies, yennies } from "./yennies.js";
import { getMeta, setMeta } from "./db.js";
import { GENKI_LESSONS } from "./genki-data.js";

/**
 * The Genki companion's games.
 *
 * Every game is a short round (ten or so items) built fresh each time from
 * a generator, so replaying one drills the idea rather than the answers.
 * They share one engine and four question shapes: pick an answer, type it,
 * put tiles in order, and match pairs. A missed item comes back once at the
 * end of the round, the way the kana game does it; the score is first-try
 * answers only, so the second chance teaches without inflating anything.
 *
 * None of this is mandatory. The lesson never waits on a game; a good score
 * is recorded so the lesson page can show it, and that's all.
 */

export type GameQuestion =
  | {
      kind: "choice";
      prompt: string;
      /** A Japanese line shown large. ＿ marks the gap. */
      jp?: string;
      /** Already-escaped HTML drawn above the choices (a clock, a scene). */
      visual?: string;
      /** Japanese to read aloud as the question appears (listening items). */
      listen?: string;
      choices: string[];
      answer: number;
      why?: string;
      /** Said aloud after answering; defaults to the right choice. */
      sayAfter?: string;
    }
  | {
      kind: "type";
      prompt: string;
      visual?: string;
      listen?: string;
      /** Normalised answers that count (digits only, for numbers). */
      accept: string[];
      /** How the right answer is shown afterwards. */
      show: string;
      numeric?: boolean;
      why?: string;
      sayAfter?: string;
    }
  | {
      kind: "order";
      prompt: string;
      tiles: string[];
      en: string;
      why?: string;
    };

export interface GameDef {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  /** Scenes play in their written order and must be answered to move on. */
  scripted?: boolean;
  build?: () => GameQuestion[];
  /** A pair game instead of questions: [japanese, english]. */
  pairs?: () => [string, string][];
}

// ====================================================================
// numbers
// ====================================================================

const DIGIT = ["", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];
const HUNDRED: Record<number, string> = { 1: "ひゃく", 3: "さんびゃく", 6: "ろっぴゃく", 8: "はっぴゃく" };
const THOUSAND: Record<number, string> = { 1: "せん", 3: "さんぜん", 8: "はっせん" };

/** 0–99,999 as it is said, with every sound change. */
export function numberKana(n: number): string {
  if (n === 0) return "ゼロ";
  const man = Math.floor(n / 10000);
  const sen = Math.floor(n / 1000) % 10;
  const hyaku = Math.floor(n / 100) % 10;
  const juu = Math.floor(n / 10) % 10;
  const ichi = n % 10;
  let out = "";
  if (man) out += (man === 1 ? "いち" : DIGIT[man]) + "まん";
  if (sen) out += THOUSAND[sen] ?? DIGIT[sen] + "せん";
  if (hyaku) out += HUNDRED[hyaku] ?? DIGIT[hyaku] + "ひゃく";
  if (juu) out += (juu === 1 ? "" : DIGIT[juu]) + "じゅう";
  if (ichi) out += DIGIT[ichi];
  return out;
}

/** The same number read with no sound changes: the mistake learners make. */
function naiveKana(n: number): string {
  if (n === 0) return "れい";
  const parts: string[] = [];
  const man = Math.floor(n / 10000);
  const sen = Math.floor(n / 1000) % 10;
  const hyaku = Math.floor(n / 100) % 10;
  const juu = Math.floor(n / 10) % 10;
  const ichi = n % 10;
  if (man) parts.push((man === 1 ? "" : DIGIT[man]) + "まん");
  if (sen) parts.push((sen === 1 ? "" : DIGIT[sen]) + "せん");
  if (hyaku) parts.push((hyaku === 1 ? "" : DIGIT[hyaku]) + "ひゃく");
  if (juu) parts.push((juu === 1 ? "" : DIGIT[juu]) + "じゅう");
  if (ichi) parts.push(DIGIT[ichi]);
  return parts.join("");
}

/** Readings using the other 4/7/9 (し, しち, く): understood, but not how numbers are read. */
function oldReadings(kana: string): string {
  return kana.replace(/よん/g, "し").replace(/なな/g, "しち").replace(/きゅう/g, "く");
}

function digitsOf(text: string): string {
  return text.replace(/[^0-9０-９]/g, "").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

/** Age in years, with the small-っ changes and はたち. */
export function ageKana(n: number): string {
  if (n === 20) return "はたち";
  const juu = Math.floor(n / 10);
  const ichi = n % 10;
  if (ichi === 0) return (juu === 1 ? "" : DIGIT[juu]) + "じゅっさい";
  const tens = juu ? (juu === 1 ? "" : DIGIT[juu]) + "じゅう" : "";
  const one = ichi === 1 ? "いっ" : ichi === 8 ? "はっ" : DIGIT[ichi];
  return tens + one + "さい";
}

const HOURS = ["", "いちじ", "にじ", "さんじ", "よじ", "ごじ", "ろくじ", "しちじ", "はちじ", "くじ", "じゅうじ", "じゅういちじ", "じゅうにじ"];
const HOUR_TRAPS: Record<number, string> = { 4: "よんじ", 7: "ななじ", 9: "きゅうじ" };

/** ぷん after 1, 3, 4, 6, 8 and 10; ふん after the rest. */
const MINUTE_ONES = ["", "いっぷん", "にふん", "さんぷん", "よんぷん", "ごふん", "ろっぷん", "ななふん", "はっぷん", "きゅうふん"];

/** 1–59 minutes as they are said. */
export function minuteKana(m: number): string {
  const tens = Math.floor(m / 10);
  const ones = m % 10;
  const tensPart = tens ? (tens === 1 ? "" : DIGIT[tens]) + "じゅう" : "";
  if (ones === 0) return (tens === 1 ? "" : DIGIT[tens]) + "じゅっぷん";
  return tensPart + MINUTE_ONES[ones];
}

/** The same minutes read with no sound change at all: the usual mistake. */
function naiveMinutes(m: number): string {
  return naiveKana(m) + "ふん";
}

// ====================================================================
// helpers
// ====================================================================

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** A choice question with the right answer shuffled in among unique distractors. */
function choice(
  prompt: string,
  right: string,
  wrong: string[],
  extra: Partial<Extract<GameQuestion, { kind: "choice" }>> = {},
): GameQuestion {
  const others = [...new Set(wrong.filter((w) => w && w !== right))].slice(0, 3);
  const choices = shuffle([right, ...others]);
  return { kind: "choice", prompt, choices, answer: choices.indexOf(right), ...extra };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A short scripted exchange drawn as chat bubbles above a scene question. */
function chat(lines: [who: string, jp: string][]): string {
  return `<div class="gk-chat">${lines
    .map(
      ([who, jp]) => `<div class="gk-bubble${who === "you" ? " me" : ""}"><span class="gk-who">${escapeHtml(
        who === "you" ? "you" : who,
      )}</span><span lang="ja">${escapeHtml(jp)}</span></div>`,
    )
    .join("")}</div>`;
}

// ====================================================================
// pictures
// ====================================================================

/** An analogue clock face at h o'clock, or half past, or h:m. */
function clockSvg(hour: number, half: boolean, minutes = half ? 30 : 0): string {
  const hourAngle = ((hour % 12) + minutes / 60) * 30;
  const minuteAngle = minutes * 6;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const r1 = i % 3 === 0 ? 38 : 41;
    return `<line x1="${50 + r1 * Math.sin(a)}" y1="${50 - r1 * Math.cos(a)}" x2="${50 + 45 * Math.sin(a)}" y2="${
      50 - 45 * Math.cos(a)
    }" />`;
  }).join("");
  return `<svg class="gk-clock" viewBox="0 0 100 100" role="img" aria-label="a clock">
    <circle cx="50" cy="50" r="47" class="gk-clock-face" />
    <g class="gk-clock-ticks">${ticks}</g>
    <line x1="50" y1="50" x2="50" y2="24" class="gk-clock-hour" transform="rotate(${hourAngle} 50 50)" />
    <line x1="50" y1="50" x2="50" y2="12" class="gk-clock-min" transform="rotate(${minuteAngle} 50 50)" />
    <circle cx="50" cy="50" r="3" class="gk-clock-pin" />
  </svg>`;
}

type Spot = "me" | "you" | "far";

/**
 * Two people and a thing: the こそあど picture. The thing sits by "you"
 * (the speaker), by your friend, or far from you both.
 */
function scene(emoji: string, spot: Spot, label: string, speaker: "you" | "friend" = "you"): string {
  const thing = `<span class="gk-thing" title="${escapeHtml(label)}">${emoji}</span>`;
  return `<div class="gk-scene" aria-label="${escapeHtml(label)} ${
    spot === "me" ? "near you" : spot === "you" ? "near your friend" : "far from both of you"
  }">
    <div class="gk-far">${spot === "far" ? thing : ""}</div>
    <div class="gk-row">
      <div class="gk-person${speaker === "you" ? " talking" : ""}"><span>🧑</span><b>you</b></div>
      <div class="gk-near">${spot === "me" ? thing : ""}</div>
      <div class="gk-gap"></div>
      <div class="gk-near">${spot === "you" ? thing : ""}</div>
      <div class="gk-person${speaker === "friend" ? " talking" : ""}"><span>🧑‍🦱</span><b>friend</b></div>
    </div>
  </div>`;
}

const THINGS: [emoji: string, jp: string, en: string][] = [
  ["☂️", "かさ", "umbrella"],
  ["👜", "かばん", "bag"],
  ["👟", "くつ", "shoes"],
  ["⌚", "とけい", "watch"],
  ["📕", "ほん", "book"],
  ["🧢", "ぼうし", "cap"],
  ["📱", "スマホ", "smartphone"],
  ["👕", "Tシャツ", "T-shirt"],
  ["🚲", "じてんしゃ", "bicycle"],
  ["🖊️", "ペン", "pen"],
  ["📰", "しんぶん", "newspaper"],
  ["👖", "ジーンズ", "jeans"],
  ["📓", "ノート", "notebook"],
  ["👛", "さいふ", "wallet"],
];

const PLACES: [emoji: string, jp: string, en: string][] = [
  ["🏦", "ぎんこう", "bank"],
  ["🏪", "コンビニ", "convenience store"],
  ["🚻", "トイレ", "restroom"],
  ["📚", "としょかん", "library"],
  ["🏣", "ゆうびんきょく", "post office"],
];

const KO: Record<Spot, string> = { me: "こ", you: "そ", far: "あ" };

// ====================================================================
// the games
// ====================================================================

const GREETINGS: { s: string; a: string; avoid?: string[] }[] = [
  { s: "9 a.m. You walk into class and see your professor.", a: "おはようございます", avoid: ["おはよう"] },
  { s: "Morning. Your roommate shuffles into the kitchen.", a: "おはよう", avoid: ["おはようございます"] },
  { s: "2 p.m. A neighbour passes you in the street.", a: "こんにちは" },
  { s: "8 p.m. You run into your teacher at the supermarket.", a: "こんばんは" },
  { s: "You're heading to bed at your homestay.", a: "おやすみなさい" },
  { s: "You're leaving the house for class.", a: "いってきます" },
  { s: "Your host sister is heading out the door.", a: "いってらっしゃい" },
  { s: "You get back home after class.", a: "ただいま" },
  { s: "Your host brother comes home.", a: "おかえりなさい" },
  { s: "Dinner is served. You're about to eat.", a: "いただきます" },
  { s: "You've finished your meal.", a: "ごちそうさまでした" },
  { s: "A stranger picks up the glove you dropped.", a: "ありがとうございます", avoid: ["ありがとう", "どうも"] },
  { s: "A classmate lends you an eraser.", a: "ありがとう", avoid: ["ありがとうございます", "どうも"] },
  { s: "You need to get a waiter's attention.", a: "すみません" },
  { s: "You step on someone's foot on a crowded train.", a: "すみません" },
  { s: "Someone thanks you for holding the door. You reply:", a: "いいえ" },
  { s: "You're meeting someone for the very first time. You start with:", a: "はじめまして" },
  { s: "You finish your self-introduction with:", a: "よろしくおねがいします" },
  { s: "You're leaving your professor's office.", a: "しつれいします", avoid: ["さようなら"] },
  { s: "Bye to a friend you'll see tomorrow.", a: "じゃあ、また", avoid: ["さようなら"] },
];

const GREETING_POOL = [...new Set(GREETINGS.map((g) => g.a))];

const FACTS: { name: string; nat: string; natEn: string; year: number; major: string; age: number }[] = [
  { name: "レナ", nat: "ドイツじん", natEn: "German", year: 1, major: "にほんご", age: 19 },
  { name: "はると", nat: "にほんじん", natEn: "Japanese", year: 3, major: "れきし", age: 21 },
  { name: "ミン", nat: "かんこくじん", natEn: "Korean", year: 2, major: "けいざい", age: 20 },
  { name: "ノア", nat: "カナダじん", natEn: "Canadian", year: 1, major: "コンピューター", age: 18 },
  { name: "ゆい", nat: "にほんじん", natEn: "Japanese", year: 2, major: "ぶんがく", age: 20 },
  { name: "サラ", nat: "アメリカじん", natEn: "American", year: 3, major: "けいざい", age: 22 },
];

/** The cast as a small table, shown above the chart questions. */
function factsChart(): string {
  return `<table class="gk-chart"><tr><th></th><th>from</th><th>year</th><th>major</th><th>age</th></tr>${FACTS.map(
    (f) => `<tr><th lang="ja">${f.name}</th><td>${f.natEn}</td><td>${f.year}</td><td lang="ja">${f.major}</td><td>${f.age}</td></tr>`,
  ).join("")}</table>`;
}

const PROFILE_NAMES = ["エマ", "ルカ", "アンナ", "ダニエル", "ソフィア", "トム", "マリア", "ケン", "リサ", "ジョン"];
const PROFILE_FROM: [string, string][] = [
  ["アメリカ", "the USA"], ["イギリス", "Britain"], ["カナダ", "Canada"], ["オーストラリア", "Australia"],
  ["かんこく", "Korea"], ["ちゅうごく", "China"], ["インド", "India"], ["フィリピン", "the Philippines"],
];
const PROFILE_MAJORS: [string, string][] = [
  ["けいざい", "economics"], ["れきし", "history"], ["ぶんがく", "literature"], ["こうがく", "engineering"],
  ["せいじ", "politics"], ["ビジネス", "business"], ["にほんご", "Japanese"], ["せいぶつがく", "biology"],
];
const YEAR_EN = ["", "first", "second", "third", "fourth"];

/** Questions with their passage shown above: the reading games. */
function readingQuestions(passage: string, items: [q: string, right: string, wrong: string[]][]): GameQuestion[] {
  const visual = `<div class="gk-passage" lang="ja">${escapeHtml(passage)}</div>`;
  return items.map(([q, right, wrong]) => choice(q, right, wrong, { visual, sayAfter: undefined }));
}

const YEARS = ["", "いちねんせい", "にねんせい", "さんねんせい", "よねんせい"];

interface Verb {
  dict: string;
  stem: string;
  en: string;
  group: "u" | "ru" | "irr";
}

const GROUP_LABEL: Record<Verb["group"], string> = { u: "u-verb", ru: "ru-verb", irr: "irregular" };

/** Lessons 3 and 4's verbs with their ます stems. */
const VERBS: Verb[] = [
  { dict: "いく", stem: "いき", en: "to go", group: "u" },
  { dict: "かえる", stem: "かえり", en: "to go back", group: "u" },
  { dict: "きく", stem: "きき", en: "to listen", group: "u" },
  { dict: "のむ", stem: "のみ", en: "to drink", group: "u" },
  { dict: "はなす", stem: "はなし", en: "to speak", group: "u" },
  { dict: "よむ", stem: "よみ", en: "to read", group: "u" },
  { dict: "おきる", stem: "おき", en: "to get up", group: "ru" },
  { dict: "たべる", stem: "たべ", en: "to eat", group: "ru" },
  { dict: "ねる", stem: "ね", en: "to sleep", group: "ru" },
  { dict: "みる", stem: "み", en: "to watch", group: "ru" },
  { dict: "くる", stem: "き", en: "to come", group: "irr" },
  { dict: "する", stem: "し", en: "to do", group: "irr" },
  { dict: "べんきょうする", stem: "べんきょうし", en: "to study", group: "irr" },
  { dict: "あう", stem: "あい", en: "to meet", group: "u" },
  { dict: "ある", stem: "あり", en: "there is (a thing)", group: "u" },
  { dict: "かう", stem: "かい", en: "to buy", group: "u" },
  { dict: "かく", stem: "かき", en: "to write", group: "u" },
  { dict: "とる", stem: "とり", en: "to take (a photo)", group: "u" },
  { dict: "まつ", stem: "まち", en: "to wait", group: "u" },
  { dict: "わかる", stem: "わかり", en: "to understand", group: "u" },
  { dict: "いる", stem: "い", en: "(a person) is", group: "ru" },
];

const PAST_EN: Record<string, string> = {
  いく: "went", かえる: "went back", きく: "listened", のむ: "drank", はなす: "spoke", よむ: "read",
  おきる: "got up", たべる: "ate", ねる: "slept", みる: "watched", くる: "came", する: "did",
  べんきょうする: "studied", あう: "met", かう: "bought", かく: "wrote", とる: "took a photo", まつ: "waited",
};

const LOCATIONS: [rel: string, en: string][] = [
  ["うえ", "on"],
  ["した", "under"],
  ["なか", "in"],
  ["みぎ", "to the right of"],
  ["ひだり", "to the left of"],
  ["あいだ", "between"],
];

const LOC_ITEMS: [emoji: string, jp: string][] = [
  ["🐱", "ねこ"],
  ["🐕", "いぬ"],
  ["📕", "ほん"],
  ["☂️", "かさ"],
  ["👛", "さいふ"],
];

const LOC_EN: Record<string, string> = { ねこ: "cat", いぬ: "dog", ほん: "book", かさ: "umbrella", さいふ: "wallet" };

/** Pairs of buildings for みぎ, ひだり and あいだ: [emoji, name, second emoji, second name]. */
const LOC_BUILDINGS: [string, string, string, string][] = [
  ["🏦", "ぎんこう", "🏨", "ホテル"],
  ["🏪", "コンビニ", "📚", "としょかん"],
  ["🏥", "びょういん", "🏦", "ぎんこう"],
];

/** X placed relative to Y (and Z, for あいだ), drawn with emoji. */
function locationScene(rel: string, x: string, y: string, z: string): string {
  const cell = (e: string, big = false): string => `<span class="gk-loc-cell${big ? " big" : ""}">${e}</span>`;
  switch (rel) {
    case "うえ":
      return `<div class="gk-loc col">${cell(x)}${cell(y, true)}</div>`;
    case "した":
      return `<div class="gk-loc col">${cell(y, true)}${cell(x)}</div>`;
    case "なか":
      return `<div class="gk-loc"><span class="gk-loc-in">${cell(y, true)}<span class="gk-loc-inner">${x}</span></span></div>`;
    case "みぎ":
      return `<div class="gk-loc">${cell(y, true)}${cell(x)}</div>`;
    case "ひだり":
      return `<div class="gk-loc">${cell(x)}${cell(y, true)}</div>`;
    default:
      return `<div class="gk-loc">${cell(y, true)}${cell(x)}${cell(z, true)}</div>`;
  }
}

const DATES: Record<number, string> = {
  1: "ついたち", 2: "ふつか", 3: "みっか", 4: "よっか", 5: "いつか", 6: "むいか", 7: "なのか", 8: "ようか",
  9: "ここのか", 10: "とおか", 11: "じゅういちにち", 14: "じゅうよっか", 17: "じゅうしちにち", 19: "じゅうくにち",
  20: "はつか", 24: "にじゅうよっか",
};

const MONTHS: Record<number, string> = {
  1: "いちがつ", 2: "にがつ", 3: "さんがつ", 4: "しがつ", 5: "ごがつ", 6: "ろくがつ", 7: "しちがつ",
  8: "はちがつ", 9: "くがつ", 10: "じゅうがつ", 11: "じゅういちがつ", 12: "じゅうにがつ",
};

const MONTHS_EN = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const WEEKDAYS: [string, string][] = [
  ["にちようび", "Sunday"], ["げつようび", "Monday"], ["かようび", "Tuesday"], ["すいようび", "Wednesday"],
  ["もくようび", "Thursday"], ["きんようび", "Friday"], ["どようび", "Saturday"],
];

function ordinal(n: number): string {
  const tail = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${tail}`;
}

export const GAMES: Record<string, GameDef> = {
  "greet-situations": {
    id: "greet-situations",
    title: "Greetings",
    blurb: "Pick the greeting for each situation.",
    icon: "👋",
    build: () =>
      shuffle(GREETINGS)
        .slice(0, 10)
        .map((g) =>
          choice(
            g.s,
            g.a,
            shuffle(GREETING_POOL.filter((x) => x !== g.a && !(g.avoid ?? []).includes(x))),
            { why: `${g.a}` },
          ),
        ),
  },

  "numbers-read": {
    id: "numbers-read",
    title: "Number readings",
    blurb: "Pick the reading of each number.",
    icon: "🔢",
    build: () =>
      Array.from({ length: 10 }, () => {
        // Most items lean on the two-reading digits, as tens or as units.
        const tricky = pick([4, 7, 9]);
        const n = Math.random() < 0.6 ? (Math.random() < 0.5 ? tricky * 10 + randInt(0, 9) : randInt(1, 9) * 10 + tricky) : randInt(0, 100);
        const right = numberKana(n);
        const swapped = n >= 11 && n % 10 && n < 100 ? numberKana((n % 10) * 10 + Math.floor(n / 10)) : numberKana(n + 10);
        return choice(`How do you read ${n}?`, right, [oldReadings(right), swapped, numberKana(Math.max(0, n - 1)), naiveKana(n), numberKana(n + 1), numberKana(n + 11)], {
          why: `${n} → ${right}`,
        });
      }),
  },

  "numbers-listen": {
    id: "numbers-listen",
    title: "Number dictation",
    blurb: "Type the number you hear (0–100).",
    icon: "👂",
    build: () =>
      Array.from({ length: 8 }, () => {
        const n = randInt(0, 100);
        return {
          kind: "type" as const,
          prompt: "Type the number you hear.",
          listen: numberKana(n),
          accept: [String(n)],
          show: `${n} · ${numberKana(n)}`,
          numeric: true,
        };
      }),
  },

  "wa-desu-builder": {
    id: "wa-desu-builder",
    title: "Sentence order",
    blurb: "Put the pieces in order.",
    icon: "🧱",
    build: () =>
      shuffle<[string[], string]>([
        [["わたしは", "レナ", "です。"], "I'm Lena."],
        [["ノアさんは", "カナダじん", "です。"], "Noah is Canadian."],
        [["せんこうは", "れきし", "です。"], "(My) major is history."],
        [["ミンさんは", "なんさい", "ですか。"], "How old is Min?"],
        [["はるとさんは", "さんねんせい", "です。"], "Haruto is a third-year."],
        [["いまは", "ごご", "くじ", "です。"], "It's 9 p.m. now."],
        [["わたしの", "ともだちは", "にほんじん", "です。"], "My friend is Japanese."],
        [["ゆいさんの", "せんこうは", "なん", "ですか。"], "What's Yui's major?"],
        [["やまもとせんせいは", "にほんごの", "せんせい", "です。"], "Prof. Yamamoto is a Japanese teacher."],
        [["サラさんは", "アメリカじん", "ですか。"], "Is Sara American?"],
      ])
        .slice(0, 7)
        .map(([tiles, en]) => ({ kind: "order" as const, prompt: "Build the sentence.", tiles, en })),
  },

  "jin-or-go": {
    id: "jin-or-go",
    title: "〜じん or 〜ご",
    blurb: "Person from a country, or its language.",
    icon: "🌏",
    build: () => {
      const countries: [string, string, string][] = [
        ["にほん", "Japan", "にほんご"],
        ["かんこく", "Korea", "かんこくご"],
        ["ちゅうごく", "China", "ちゅうごくご"],
        ["フランス", "France", "フランスご"],
        ["ドイツ", "Germany", "ドイツご"],
        ["アメリカ", "the USA", "えいご"],
        ["イギリス", "the UK", "えいご"],
        ["ベトナム", "Vietnam", "ベトナムご"],
      ];
      return shuffle(
        countries.flatMap(([c, en, lang]) => [
          choice(`A person from ${en}`, `${c}じん`, [lang, `${c}ご`, `${c}の`]),
          choice(`The language spoken in ${en}`, lang, [`${c}じん`, `${c}ご`, "えいご", `${c}の ご`], {
            why: lang === "えいご" ? "English is えいご wherever it's spoken; there's no アメリカご." : `${lang}`,
          }),
        ]),
      ).slice(0, 10);
    },
  },

  "question-words": {
    id: "question-words",
    title: "Question words",
    blurb: "Pick the question for each answer.",
    icon: "❓",
    build: () =>
      shuffle<[string, string]>([
        ["じゅうきゅうさいです。", "なんさいですか。"],
        ["にねんせいです。", "なんねんせいですか。"],
        ["ごご くじです。", "いま なんじですか。"],
        ["ゼロきゅうゼロの いちにさんよんの ごろくななはちです。", "でんわばんごうは なんばんですか。"],
        ["けいざいです。", "せんこうは なんですか。"],
        ["カナダじんです。", "なにじんですか。"],
        ["レナです。", "おなまえは？"],
        ["はい、そうです。", "りゅうがくせいですか。"],
      ]).map(([ans, q]) =>
        choice("Which question gets this answer?", q, shuffle(["なんさいですか。", "なんねんせいですか。", "いま なんじですか。", "でんわばんごうは なんばんですか。", "せんこうは なんですか。", "なにじんですか。", "りゅうがくせいですか。"]), {
          jp: ans,
        }),
      ),
  },

  "ages-years": {
    id: "ages-years",
    title: "Ages and years",
    blurb: "〜さい and 〜ねんせい, with sound changes.",
    icon: "🎂",
    build: () => {
      const qs: GameQuestion[] = [];
      for (let i = 0; i < 6; i++) {
        const n = pick([1, 8, 10, 11, 18, 19, 20, 21, 22, 23, 28, 30, 31, 40, 48]);
        const right = ageKana(n);
        const naive = n === 20 ? "にさい" : naiveKana(n) + "さい";
        qs.push(choice(`${n} years old`, right, [naive, n === 20 ? "にじゅうさい" : oldReadings(naiveKana(n)) + "さい", ageKana(n + 1), ageKana(n + 2), ageKana(n - 1)], { why: n === 20 ? "20 is はたち (にじゅっさい also works)." : right }));
      }
      for (let y = 1; y <= 4; y++) {
        qs.push(choice(`A year-${y} student`, YEARS[y], [y === 4 ? "よんねんせい" : `${DIGIT[y]}ねん`, YEARS[(y % 4) + 1], `${DIGIT[y]}さい`], { why: y === 4 ? "Fourth year is よねんせい, not よん." : YEARS[y] }));
      }
      return shuffle(qs);
    },
  },

  "no-chain": {
    id: "no-chain",
    title: "の order",
    blurb: "Pick the correct order.",
    icon: "🔗",
    build: () =>
      shuffle<[string, string, string]>([
        ["a Japanese-language teacher", "にほんごの せんせい", "せんせいの にほんご"],
        ["my friend's phone number", "ともだちの でんわばんごう", "でんわばんごうの ともだち"],
        ["a high-school teacher", "こうこうの せんせい", "せんせいの こうこう"],
        ["a university in Japan", "にほんの だいがく", "だいがくの にほん"],
        ["Haruto's major", "はるとさんの せんこう", "せんこうの はるとさん"],
        ["my name", "わたしの なまえ", "なまえの わたし"],
        ["Lena's mother", "レナさんの おかあさん", "おかあさんの レナさん"],
        ["a student at Sakura University", "さくらだいがくの がくせい", "がくせいの さくらだいがく"],
        ["my friend's name", "わたしの ともだちの なまえ", "わたしの なまえの ともだち"],
      ]).map(([en, right, flipped]) => {
        const [a, b] = right.split(" ");
        return choice(`"${en}"`, right, [flipped, `${a.replace(/の$/, "")} ${b}`, `${a.replace(/の$/, "は")} ${b}`]);
      }),
  },

  clock: {
    id: "clock",
    title: "Clock",
    blurb: "Read the time.",
    icon: "🕘",
    build: () =>
      Array.from({ length: 10 }, (_, i) => {
        const h = i < 4 ? pick([4, 7, 9]) : randInt(1, 12);
        const half = Math.random() < 0.4;
        const tail = half ? "はん" : "";
        const right = HOURS[h] + tail;
        const wrong = [
          (HOUR_TRAPS[h] ?? HOURS[(h % 12) + 1]) + tail,
          HOURS[h] + (half ? "" : "はん"),
          HOURS[h === 1 ? 12 : h - 1] + tail,
          HOURS[(h % 12) + 1] + tail,
        ];
        return choice("What time is it?", right, wrong, { visual: clockSvg(h, half) });
      }),
  },

  "phone-listen": {
    id: "phone-listen",
    title: "Phone number dictation",
    blurb: "Type the phone number you hear.",
    icon: "📞",
    build: () =>
      Array.from({ length: 5 }, () => {
        const groups = [`0${pick(["7", "8", "9"])}0`, String(randInt(1000, 9999)), String(randInt(1000, 9999))];
        const said = groups
          .map((g) => [...g].map((d) => (d === "0" ? "ゼロ" : DIGIT[Number(d)])).join(""))
          .join("の ");
        return {
          kind: "type" as const,
          prompt: "Type the phone number you hear (dashes optional).",
          listen: said,
          accept: [groups.join("")],
          show: groups.join("-"),
          numeric: true,
        };
      }),
  },

  "prices-read": {
    id: "prices-read",
    title: "Price readings",
    blurb: "Pick the reading of each price.",
    icon: "🏷️",
    build: () =>
      Array.from({ length: 10 }, () => {
        const n = randomPrice();
        const right = numberKana(n) + "えん";
        return choice("How do you say this price?", right, [naiveKana(n) + "えん", numberKana(nearPrice(n)) + "えん", naiveKana(nearPrice(n)) + "えん", numberKana(nearPrice(n)) + "えん", numberKana(n + 1000 <= 99999 ? n + 1000 : n - 1000) + "えん", numberKana(n + 100) + "えん"], {
          visual: `<div class="gk-price">¥${n.toLocaleString("en-US")}</div>`,
        });
      }),
  },

  "prices-listen": {
    id: "prices-listen",
    title: "Price dictation",
    blurb: "Type the price you hear.",
    icon: "💴",
    build: () =>
      Array.from({ length: 8 }, () => {
        const n = randomPrice();
        return {
          kind: "type" as const,
          prompt: "Type the price you hear, in yen.",
          listen: numberKana(n) + "えん",
          accept: [String(n)],
          show: `¥${n.toLocaleString("en-US")} · ${numberKana(n)}えん`,
          numeric: true,
        };
      }),
  },

  "kosoado-things": {
    id: "kosoado-things",
    title: "これ・それ・あれ・どれ",
    blurb: "Pick the word for each picture.",
    icon: "👉",
    build: () => {
      const qs: GameQuestion[] = [];
      for (let i = 0; i < 9; i++) {
        const [emoji, , en] = pick(THINGS);
        const spot = pick<Spot>(["me", "you", "far"]);
        const flip = i % 3 === 2 && spot !== "far";
        if (flip) {
          // The friend is talking about the same thing: the side flips.
          const said = spot === "me" ? "それ" : "これ";
          qs.push(
            choice(`Your friend asks you about the ${en}. What does your FRIEND say?`, `${said}は なんですか。`, ["これは なんですか。", "それは なんですか。", "あれは なんですか。", "どれは なんですか。"], {
              visual: scene(emoji, spot, en, "friend"),
              why: spot === "me" ? "It's near you, which is the listener's side for your friend: それ." : "It's near your friend, the speaker: これ.",
            }),
          );
        } else {
          const right = KO[spot] + "れ";
          qs.push(
            choice(`You ask about the ${en}. Fill the gap.`, right, ["これ", "それ", "あれ", "どれ"], {
              visual: scene(emoji, spot, en),
              jp: "＿は いくらですか。",
              why: spot === "me" ? "Near you, the speaker: これ." : spot === "you" ? "Near your friend, the listener: それ." : "Far from both: あれ.",
              sayAfter: `${right}は いくらですか`,
            }),
          );
        }
      }
      qs.push(
        choice("Your friend says \"the bag\", but there are three bags. You ask \"which one?\"", "どれですか。", ["これですか。", "それですか。", "あれですか。"], {
          visual: `<div class="gk-scene-mini">👜 👜 👜</div>`,
        }),
      );
      return shuffle(qs);
    },
  },

  "kono-or-kore": {
    id: "kono-or-kore",
    title: "この or これ",
    blurb: "この / その / あの before a noun, これ / それ / あれ alone.",
    icon: "🪧",
    build: () =>
      Array.from({ length: 10 }, () => {
        const [emoji, jp, en] = pick(THINGS);
        const spot = pick<Spot>(["me", "you", "far"]);
        const withNoun = Math.random() < 0.55;
        const ko = KO[spot];
        const right = withNoun ? `${ko}の` : `${ko}れ`;
        const wrong = withNoun ? [`${ko}れ`, `${KO[spot === "me" ? "you" : "me"]}の`, `${ko}こ`] : [`${ko}の`, `${KO[spot === "far" ? "me" : "far"]}れ`, `${ko}こ`];
        return choice(`The ${en} is ${spot === "me" ? "near you" : spot === "you" ? "near your friend" : "far from both of you"}.`, right, wrong, {
          visual: scene(emoji, spot, en),
          jp: withNoun ? `＿${jp}は いくらですか。` : "＿は いくらですか。",
          why: withNoun ? `A noun (${jp}) follows, so it's ${right}.` : `Nothing but は follows, so it's ${right}.`,
          sayAfter: withNoun ? `${right}${jp}は いくらですか` : `${right}は いくらですか`,
        });
      }),
  },

  "kosoado-places": {
    id: "kosoado-places",
    title: "ここ・そこ・あそこ・どこ",
    blurb: "Places, from a picture.",
    icon: "📍",
    build: () => {
      const qs: GameQuestion[] = [];
      for (let i = 0; i < 7; i++) {
        const [emoji, jp, en] = pick(PLACES);
        const spot = pick<Spot>(["me", "you", "far"]);
        const right = spot === "me" ? "ここ" : spot === "you" ? "そこ" : "あそこ";
        qs.push(
          choice(`Someone asks where the ${en} is. Answer:`, `${right}です。`, ["ここです。", "そこです。", "あそこです。", "あれです。"], {
            visual: scene(emoji, spot, en),
            jp: `${jp}は どこですか。`,
          }),
        );
      }
      for (const [, jp, en] of shuffle(PLACES).slice(0, 3)) {
        qs.push(choice(`Ask: "Where's the ${en}?"`, `${jp}は どこですか。`, [`${jp}は どれですか。`, `${jp}は なんですか。`, `${jp}は あそこですか。`]));
      }
      return shuffle(qs);
    },
  },

  whose: {
    id: "whose",
    title: "だれの",
    blurb: "Answer \"whose is this?\"",
    icon: "🧳",
    build: () =>
      Array.from({ length: 8 }, () => {
        const [emoji, jp] = pick(THINGS);
        const owner = pick(FACTS).name;
        return choice("Answer the question.", `${owner}さんの ${jp}です。`, [`${owner}さんは ${jp}です。`, `${jp}の ${owner}さんです。`, `${owner}さん ${jp}ですか。`], {
          visual: `<div class="gk-tag"><span class="gk-thing">${emoji}</span><span class="gk-owner">🏷️ ${escapeHtml(owner)}</span></div>`,
          jp: `これは だれの ${jp}ですか。`,
        });
      }),
  },

  "mo-or-wa": {
    id: "mo-or-wa",
    title: "は or も",
    blurb: "Same fact or a different one.",
    icon: "➕",
    build: () =>
      Array.from({ length: 10 }, () => {
        const [a, b] = shuffle(FACTS);
        const kind = pick(["nat", "year", "major"] as const);
        const valA = kind === "nat" ? a.nat : kind === "year" ? YEARS[a.year] : a.major;
        const valB = kind === "nat" ? b.nat : kind === "year" ? YEARS[b.year] : b.major;
        const same = Math.random() < 0.55;
        const shown = same ? valA : valB === valA ? (kind === "year" ? YEARS[(a.year % 4) + 1] : kind === "nat" ? "イギリスじん" : "ぶんがく") : valB;
        const topic = kind === "major" ? "の せんこう" : "";
        const right = same ? "も" : "は";
        return choice(same ? "The same is true of the second person." : "The second person is different.", right, [same ? "は" : "も", "の", "か"], {
          jp: `${a.name}さん${topic}は ${valA}です。${b.name}さん${topic}＿ ${shown}です。`,
          sayAfter: `${b.name}さん${topic}${right} ${shown}です`,
        });
      }),
  },

  negate: {
    id: "negate",
    title: "じゃないです",
    blurb: "Deny, then give the correct fact.",
    icon: "🙅",
    build: () =>
      Array.from({ length: 8 }, () => {
        const p = pick(FACTS);
        const kind = pick(["nat", "year", "major"] as const);
        const truth = kind === "nat" ? p.nat : kind === "year" ? YEARS[p.year] : p.major;
        const pool = kind === "nat" ? ["にほんじん", "アメリカじん", "かんこくじん", "カナダじん", "ドイツじん"] : kind === "year" ? YEARS.slice(1) : ["れきし", "けいざい", "ぶんがく", "コンピューター", "にほんご"];
        const wrongGuess = pick(pool.filter((x) => x !== truth));
        const topic = kind === "major" ? `${p.name}さんの せんこうは` : `${p.name}さんは`;
        return choice(`The truth: ${p.name} → ${truth}. Answer the question.`, `いいえ、${wrongGuess}じゃないです。${truth}です。`, [
          `いいえ、じゃないです。${truth}です。`,
          `はい、${wrongGuess}じゃないです。`,
          `いいえ、${truth}じゃないです。${wrongGuess}です。`,
        ], { jp: `${topic} ${wrongGuess}ですか。` });
      }),
  },

  "ne-or-yo": {
    id: "ne-or-yo",
    title: "ね or よ",
    blurb: "Shared, or new to the listener.",
    icon: "💬",
    build: () =>
      shuffle<[string, string, "ね" | "よ"]>([
        ["You and a friend both taste the ramen. It's great.", "おいしいです＿。", "ね"],
        ["Your friend thinks tonkatsu is fish. You set them straight.", "とんかつは にくです＿。", "よ"],
        ["You read back the number you just wrote down, to check.", "ゼロはちゼロの いちにさんよん… です＿。", "ね"],
        ["A tourist is looking for the bank. You know where it is.", "ぎんこうは あそこです＿。", "よ"],
        ["You and your friend look at a price tag. Wow.", "たかいです＿。", "ね"],
        ["Your friend thinks you're Canadian. You're not.", "わたしは カナダじんじゃないです＿。", "よ"],
        ["You both know Min is a second-year; you mention it.", "ミンさんは にねんせいです＿。", "ね"],
        ["Your friend doesn't know the teacher is Japanese. You tell them.", "やまもとせんせいは にほんじんです＿。", "よ"],
      ]).map(([s, jp, right]) =>
        choice(s, right, [right === "ね" ? "よ" : "ね", "か", "も"], {
          jp,
          why: right === "ね" ? "The listener already knows or feels it: ね." : "News for the listener: よ.",
          sayAfter: jp.replace("＿", right),
        }),
      ),
  },

  "flea-market": {
    id: "flea-market",
    title: "Flea market",
    blurb: "Buy something, one line at a time.",
    icon: "🛍️",
    scripted: true,
    build: () => [
      choice("The stallholder greets you. The watch you like is next to THEM.", "そのとけいは いくらですか。", ["このとけいは いくらですか。", "あのとけいは いくらですか。", "そのとけいは なんですか。"], {
        visual: chat([["stallholder", "いらっしゃいませ。"]]) + scene("⌚", "you", "watch", "you"),
        why: "It's near the listener, and a noun follows: その とけい.",
      }),
      choice("It's more than you hoped. React, inviting them to agree.", "たかいですね。", ["たかいですよ。", "たかいじゃないです。", "たかいですか。"], {
        visual: chat([["stallholder", "ななせんえんです。"]]),
        why: "A shared reaction: ね. (And たかい can't take じゃないです.)",
      }),
      choice("Ask about the cap far away from both of you.", "あのぼうしは いくらですか。", ["そのぼうしは いくらですか。", "あれぼうしは いくらですか。", "あそこぼうしは いくらですか。"], {
        visual: scene("🧢", "far", "cap"),
        why: "Far from both, with a noun: あの.",
      }),
      choice("That's a good price. Buy the cap.", "じゃあ、あのぼうしを ください。", ["じゃあ、あのぼうしは ください。", "じゃあ、あのぼうしです。", "じゃあ、ぼうしを いくらですか。"], {
        visual: chat([["stallholder", "あれは はっぴゃくえんです。"]]),
        why: "Thing you want + を ください.",
      }),
      choice("How much did they say it was?", "¥800", ["¥8,000", "¥80", "¥600"], {
        listen: "はっぴゃくえんです",
        why: "はっぴゃく = 800.",
      }),
      choice("Someone holds up a wallet: これは だれの さいふですか. It's yours.", "わたしの さいふです。", ["わたしは さいふです。", "さいふの わたしです。", "わたしの ですか。"], {
        why: "わたしの さいふ = my wallet.",
      }),
      choice("Thank the stranger politely.", "ありがとうございます。", ["ありがとう。", "いただきます。", "いいえ。"], {
        why: "A stranger gets the polite form.",
      }),
    ],
  },

  restaurant: {
    id: "restaurant",
    title: "Restaurant",
    blurb: "Order lunch, one line at a time.",
    icon: "🍜",
    scripted: true,
    build: () => [
      choice("You walk in and the staff greet you. You…", "(just nod and walk in)", ["いらっしゃいませ。", "ただいま。", "いってきます。"], {
        visual: chat([["staff", "いらっしゃいませ。"]]),
        why: "Customers don't say いらっしゃいませ back.",
      }),
      choice("They hand you the menu. A short thanks:", "どうも。", ["どうぞ。", "いただきます。", "いらっしゃいませ。"], {
        visual: chat([["staff", "メニューを どうぞ。"]]),
      }),
      choice("Point at a dish on the menu in YOUR hands. Ask what it is.", "これは なんですか。", ["それは なんですか。", "あれは なんですか。", "どれは なんですか。"], {
        visual: scene("📖", "me", "menu"),
        why: "It's in your hands: これ.",
      }),
      choice("The staff answer. Are they right to say それ?", "Yes: it's near you, the listener.", ["No: it should be これ.", "No: it should be あれ.", "No: it should be どれ."], {
        visual: chat([["staff", "それは とんかつです。おいしいですよ。"]]),
      }),
      choice("You ask if it's fish.", "さかなですか。", ["さかなじゃないです。", "さかなですよ。", "さかなを ください。"], {}),
      choice("What did the staff say?", "No, it's meat.", ["Yes, it's fish.", "No, it's vegetables.", "It's not on the menu."], {
        listen: "いいえ、さかなじゃないです。にくです",
      }),
      choice("Order it, politely.", "じゃあ、これを おねがいします。", ["じゃあ、これは おねがいします。", "じゃあ、これです。", "じゃあ、これを どうぞ。"], {}),
      choice("Before the food comes, ask where the toilet is.", "すみません。トイレは どこですか。", ["すみません。トイレは なんですか。", "すみません。トイレは どれですか。", "すみません。トイレを ください。"], {}),
      choice("It's far from both of you. The staff point and say:", "あそこです。", ["そこです。", "ここです。", "あれです。"], {
        visual: scene("🚻", "far", "restroom", "friend"),
      }),
    ],
  },

  "minutes-clock": {
    id: "minutes-clock",
    title: "Clock: minutes",
    blurb: "Hours and minutes, with ふん and ぷん.",
    icon: "⏱️",
    build: () =>
      Array.from({ length: 10 }, () => {
        const h = randInt(1, 12);
        const m = pick([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 3, 8, 18, 46]);
        const right = `${HOURS[h]} ${minuteKana(m)}`;
        const other = m === 30 ? 20 : m + (m % 10 === 0 ? 5 : 1);
        return choice("What time is it?", right, [
          `${HOURS[h]} ${naiveMinutes(m)}`,
          `${HOUR_TRAPS[h] ?? HOURS[(h % 12) + 1]} ${minuteKana(m)}`,
          `${HOURS[h]} ${minuteKana(other)}`,
        ], { visual: clockSvg(h, false, m), why: `${h}:${String(m).padStart(2, "0")} → ${right}` });
      }),
  },

  "chart-questions": {
    id: "chart-questions",
    title: "Questions about people",
    blurb: "Answer questions from a chart.",
    icon: "📋",
    build: () =>
      Array.from({ length: 10 }, () => {
        const p = pick(FACTS);
        const kind = pick(["age", "year", "major", "natYes", "natNo"] as const);
        const visual = factsChart();
        if (kind === "age") {
          return choice("Answer from the chart.", `${ageKana(p.age)}です。`, [`${ageKana(p.age + 1)}です。`, `${YEARS[p.year]}です。`, `${naiveKana(p.age)}さいです。`], { jp: `${p.name}さんは なんさいですか。`, visual });
        }
        if (kind === "year") {
          return choice("Answer from the chart.", `${YEARS[p.year]}です。`, [`${YEARS[(p.year % 4) + 1]}です。`, `${ageKana(p.age)}です。`, p.year === 4 ? "よんねんせいです。" : `${YEARS[p.year === 1 ? 2 : p.year - 1]}です。`], { jp: `${p.name}さんは なんねんせいですか。`, visual });
        }
        if (kind === "major") {
          return choice("Answer from the chart.", `${p.major}です。`, ["れきしです。", "けいざいです。", "ぶんがくです。", "にほんごです。", "コンピューターです。"].filter((x) => x !== `${p.major}です。`), { jp: `${p.name}さんの せんこうは なんですか。`, visual });
        }
        if (kind === "natYes") {
          return choice("Answer from the chart.", "はい、そうです。", [`いいえ、${p.nat}です。`, "いいえ、そうです。", `はい、${p.nat}じゃないです。`], { jp: `${p.name}さんは ${p.nat}ですか。`, visual });
        }
        const wrongNat = pick(["アメリカじん", "イギリスじん", "ちゅうごくじん", "カナダじん", "にほんじん"].filter((x) => x !== p.nat));
        return choice("Answer from the chart.", `いいえ、${p.nat}です。`, ["はい、そうです。", `いいえ、${wrongNat}です。`, "いいえ、そうです。"], { jp: `${p.name}さんは ${wrongNat}ですか。`, visual });
      }),
  },

  "intro-listen": {
    id: "intro-listen",
    title: "Listening: self-introductions",
    blurb: "Hear someone introduce themselves, then answer.",
    icon: "🎧",
    build: () => {
      const qs: GameQuestion[] = [];
      for (const name of shuffle(PROFILE_NAMES).slice(0, 4)) {
        const [from, fromEn] = pick(PROFILE_FROM);
        const [major, majorEn] = pick(PROFILE_MAJORS);
        const year = randInt(1, 4);
        const age = randInt(18, 24);
        const said = `はじめまして。${name}です。${from}じんです。${YEARS[year]}です。せんこうは ${major}です。${ageKana(age)}です。よろしく おねがいします。`;
        const asks: GameQuestion[] = [
          choice(`Where is ${name} from?`, fromEn, shuffle(PROFILE_FROM.map(([, en]) => en).filter((en) => en !== fromEn)), { listen: said, sayAfter: undefined }),
          choice(`What year is ${name} in?`, `${YEAR_EN[year]} year`, YEAR_EN.slice(1).filter((y) => y !== YEAR_EN[year]).map((y) => `${y} year`), { listen: said, sayAfter: undefined }),
          choice(`What does ${name} study?`, majorEn, shuffle(PROFILE_MAJORS.map(([, en]) => en).filter((en) => en !== majorEn)), { listen: said, sayAfter: undefined }),
          choice(`How old is ${name}?`, String(age), [String(age + 1), String(age - 1), String(age + 2)], { listen: said, sayAfter: undefined }),
        ];
        qs.push(...shuffle(asks).slice(0, 2));
      }
      return qs;
    },
  },

  "shop-listen": {
    id: "shop-listen",
    title: "Listening: at the shop",
    blurb: "Hear a customer ask a price, then answer.",
    icon: "🎧",
    scripted: true,
    build: () => {
      const qs: GameQuestion[] = [];
      for (const [, jp, en] of shuffle(THINGS).slice(0, 4)) {
        const price = randomPrice();
        const near = pick(["この", "その", "あの"]);
        const said = `すみません。${near}${jp}は いくらですか。${numberKana(price)}えんです。`;
        qs.push(
          choice("What is the customer asking about?", en, shuffle(THINGS.map(([, , e]) => e).filter((e) => e !== en)), { listen: said, sayAfter: undefined }),
          choice("How much is it?", `¥${price.toLocaleString("en-US")}`, [nearPrice(price), nearPrice(price), price * 10 <= 99999 ? price * 10 : Math.round(price / 10)].map((n) => `¥${n.toLocaleString("en-US")}`), { listen: said, sayAfter: undefined }),
        );
      }
      return qs;
    },
  },

  "reading-u1": {
    id: "reading-u1",
    title: "Reading",
    blurb: "Two short passages in kana, with questions.",
    icon: "📖",
    scripted: true,
    build: () => [
      ...readingQuestions(
        "はじめまして。わたしは エマです。イギリスじんです。さくらだいがくの りゅうがくせいです。にねんせいです。せんこうは れきしです。にじゅういっさいです。よろしく おねがいします。",
        [
          ["Where is Emma from?", "Britain", ["the USA", "Australia", "Canada"]],
          ["What year is she in?", "second year", ["first year", "third year", "fourth year"]],
          ["What is her major?", "history", ["economics", "literature", "Japanese"]],
          ["How old is she?", "21", ["20", "12", "22"]],
        ],
      ),
      ...readingQuestions(
        "わたしの ともだちは けんさんです。けんさんは にほんじんです。とうきょうだいがくの よねんせいです。せんこうは けいざいです。けんさんの でんわばんごうは ゼロきゅうゼロの はちななろくごの よんさんにいちです。",
        [
          ["Ken is…", "Japanese", ["an exchange student", "Korean", "a teacher"]],
          ["Ken is a…", "fourth-year student", ["first-year student", "high school student", "graduate student"]],
          ["Ken's major:", "economics", ["engineering", "history", "business"]],
          ["Ken's phone number:", "090-8765-4321", ["090-8765-1234", "080-8765-4321", "090-5678-4321"]],
        ],
      ),
    ],
  },

  "reading-u2": {
    id: "reading-u2",
    title: "Reading",
    blurb: "Two short passages in kana, with questions.",
    icon: "📖",
    scripted: true,
    build: () => [
      ...readingQuestions(
        "ここは コンビニです。これは ペンです。ひゃくはちじゅうえんです。それは ノートです。にひゃくえんです。あれは かさです。はっぴゃくえんです。かさは たかいですね。",
        [
          ["How much is the pen?", "¥180", ["¥108", "¥800", "¥200"]],
          ["How much is the notebook?", "¥200", ["¥180", "¥2,000", "¥800"]],
          ["What costs ¥800?", "the umbrella", ["the pen", "the notebook", "nothing"]],
          ["Where is the umbrella?", "far from both people", ["near the speaker", "near the listener", "it's not said"]],
        ],
      ),
      ...readingQuestions(
        "A：すみません。これは だれの さいふですか。\nB：ノアさんの さいふです。\nA：あの かさも ノアさんのですか。\nB：いいえ、ノアさんのじゃないです。ミンさんのです。",
        [
          ["Whose is the wallet?", "Noah's", ["Min's", "B's", "A's"]],
          ["Whose is the umbrella?", "Min's", ["Noah's", "B's", "A's"]],
          ["Where is the umbrella?", "far from both people", ["near A", "near B", "it's not said"]],
        ],
      ),
    ],
  },

  // ================================================================ unit 3

  "verb-class": {
    id: "verb-class",
    title: "Verb groups",
    blurb: "ru-verb, u-verb or irregular.",
    icon: "🗂️",
    build: () =>
      shuffle(VERBS).slice(0, 10).map((v) =>
        choice(`${v.en}`, GROUP_LABEL[v.group], ["u-verb", "ru-verb", "irregular"], {
          jp: v.dict,
          why: v.dict === "かえる" ? "かえる ends in -eru but is a u-verb: かえります." : `${v.dict} → ${v.stem}ます`,
          sayAfter: v.dict,
        }),
      ),
  },

  "masu-form": {
    id: "masu-form",
    title: "ます and ません",
    blurb: "From the dictionary form to the polite form.",
    icon: "🔁",
    build: () =>
      shuffle(VERBS).slice(0, 10).map((v) => {
        const negative = Math.random() < 0.4;
        const end = negative ? "ません" : "ます";
        const right = v.stem + end;
        const base = v.dict.slice(0, -1);
        const wrong = [v.dict + end, base + end, base + "り" + end, v.dict === "くる" ? "くり" + end : v.dict.endsWith("する") ? v.dict.slice(0, -2) + "す" + end : base + "え" + end];
        return choice(negative ? `${v.en} (negative)` : v.en, right, wrong, { jp: v.dict, why: `${GROUP_LABEL[v.group]}: ${v.dict} → ${right}` });
      }),
  },

  "particles-u3": {
    id: "particles-u3",
    title: "を・で・に",
    blurb: "Pick the particle.",
    icon: "🧩",
    build: () =>
      shuffle<[string, string, string]>([
        ["まいにち コーヒー＿ のみます。", "を", "I drink coffee every day."],
        ["としょかん＿ ほんを よみます。", "で", "I read books at the library."],
        ["あした きょうと＿ いきます。", "に", "I'll go to Kyoto tomorrow."],
        ["うち＿ ばんごはんを たべます。", "で", "I eat dinner at home."],
        ["じゅういちじ＿ ねます。", "に", "I go to bed at eleven."],
        ["おんがく＿ ききます。", "を", "I listen to music."],
        ["にちようび＿ テニスを します。", "に", "I play tennis on Sunday."],
        ["カフェ＿ べんきょうします。", "で", "I study at a café."],
        ["がっこう＿ きます。", "に", "I come to school."],
        ["テレビ＿ みます。", "を", "I watch TV."],
        ["にほんご＿ はなします。", "を", "I speak Japanese."],
      ])
        .slice(0, 10)
        .map(([jp, right, en]) =>
          choice(en, right, ["を", "で", "に"], { jp, sayAfter: jp.replace("＿", right) }),
        ),
  },

  "time-ni": {
    id: "time-ni",
    title: "Time words and に",
    blurb: "Does the time word take に?",
    icon: "🕑",
    build: () =>
      shuffle<[string, string, "に" | "no に" | "optional"]>([
        ["どようび", "Saturday", "に"],
        ["にちようび", "Sunday", "に"],
        ["くじ", "nine o'clock", "に"],
        ["じゅうじはん", "10:30", "に"],
        ["しちじ", "seven o'clock", "に"],
        ["あした", "tomorrow", "no に"],
        ["きょう", "today", "no に"],
        ["こんばん", "tonight", "no に"],
        ["まいにち", "every day", "no に"],
        ["まいばん", "every night", "no に"],
        ["いつ", "when", "no に"],
        ["あさ", "in the morning", "optional"],
        ["しゅうまつ", "on the weekend", "optional"],
      ])
        .slice(0, 10)
        .map(([jp, en, right]) =>
          choice(`"${en}": does it take に?`, right === "に" ? "takes に" : right === "no に" ? "no に" : "に is optional", ["takes に", "no に", "に is optional"], {
            jp,
            why: right === "に" ? "Days of the week and clock times take に." : right === "no に" ? "Words measured from now, regular intervals and いつ take no に." : "Parts of the day and the weekend can go either way.",
            sayAfter: jp,
          }),
        ),
  },

  frequency: {
    id: "frequency",
    title: "How often",
    blurb: "まいにち, よく, ときどき, あまり, ぜんぜん.",
    icon: "📆",
    build: () => {
      const acts: [string, string, string][] = [
        ["テレビを み", "watch TV", "テレビを"],
        ["コーヒーを のみ", "drink coffee", "コーヒーを"],
        ["ざっしを よみ", "read magazines", "ざっしを"],
        ["テニスを し", "play tennis", "テニスを"],
        ["カフェに いき", "go to cafés", "カフェに"],
        ["おさけを のみ", "drink alcohol", "おさけを"],
      ];
      const adverbs: [string, string, boolean][] = [
        ["まいにち", "every day", true],
        ["よく", "often", true],
        ["ときどき", "sometimes", true],
        ["あまり", "not much", false],
        ["ぜんぜん", "never", false],
      ];
      return Array.from({ length: 10 }, (_, i) => {
        const [stem, en] = pick(acts);
        const [adv, advEn, positive] = pick(adverbs);
        if (i % 2 === 0) {
          const right = stem + (positive ? "ます" : "ません");
          const wrong = stem + (positive ? "ません" : "ます");
          return choice(`Finish the sentence.`, `${adv} ${right}。`, [`${adv} ${wrong}。`, `${adv} ${stem}ませんか。`], {
            jp: `${adv} ${stem.split(" ")[0]} ＿。`,
            why: positive ? `${adv} goes with a positive verb.` : `${adv} needs a negative verb.`,
          });
        }
        const english = positive ? `I ${advEn === "every day" ? "" : advEn + " "}${en}${advEn === "every day" ? " every day" : ""}.` : advEn === "never" ? `I never ${en}.` : `I don't ${en} much.`;
        return choice(english, adv, adverbs.map(([a]) => a).filter((a) => a !== adv), {
          jp: `＿ ${stem}${positive ? "ます" : "ません"}。`,
          sayAfter: `${adv} ${stem}${positive ? "ます" : "ません"}`,
        });
      });
    },
  },

  "u3-builder": {
    id: "u3-builder",
    title: "Sentence order",
    blurb: "Topic, time, place, thing, verb.",
    icon: "🧱",
    build: () =>
      shuffle<[string[], string]>([
        [["わたしは", "きょう", "としょかんで", "にほんごを", "べんきょうします。"], "I'll study Japanese at the library today."],
        [["ミンさんは", "まいにち", "コーヒーを", "のみます。"], "Min drinks coffee every day."],
        [["わたしは", "よく", "しちじごろ", "うちに", "かえります。"], "I often go home at around seven."],
        [["あした", "カフェで", "ひるごはんを", "たべます。"], "I'll eat lunch at a café tomorrow."],
        [["はるとさんは", "あまり", "テレビを", "みません。"], "Haruto doesn't watch TV much."],
        [["どようびに", "えいがを", "みませんか。"], "Would you like to see a movie on Saturday?"],
        [["しゅうまつは", "たいてい", "なにを", "しますか。"], "What do you usually do on weekends?"],
      ]).map(([tiles, en]) => ({ kind: "order" as const, prompt: "Build the sentence.", tiles, en })),
  },

  "schedule-listen": {
    id: "schedule-listen",
    title: "Listening: daily schedules",
    blurb: "Hear someone's day, then answer.",
    icon: "🎧",
    build: () => {
      const acts: [string, string][] = [
        ["おきます", "get up"],
        ["がっこうに いきます", "go to school"],
        ["ひるごはんを たべます", "eat lunch"],
        ["としょかんで べんきょうします", "study at the library"],
        ["うちに かえります", "go home"],
        ["ばんごはんを たべます", "eat dinner"],
        ["テレビを みます", "watch TV"],
        ["ねます", "go to bed"],
      ];
      const qs: GameQuestion[] = [];
      for (const p of shuffle(FACTS).slice(0, 4)) {
        const [a, b] = shuffle(acts).slice(0, 2);
        const [h1, h2] = shuffle([6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5]).slice(0, 2);
        const said = `${p.name}さんは まいにち ${HOURS[h1]}に ${a[0]}。${HOURS[h2]}に ${b[0]}。`;
        const clock = (h: number): string => `${h}:00`;
        qs.push(
          choice(`What time does ${p.name} ${a[1]}?`, clock(h1), [clock(h2), clock((h1 % 12) + 1), clock(h1 === 1 ? 12 : h1 - 1)], { listen: said, sayAfter: undefined }),
          choice(`What does ${p.name} do at ${clock(h2)}?`, b[1], shuffle(acts.map(([, en]) => en).filter((en) => en !== b[1])), { listen: said, sayAfter: undefined }),
        );
      }
      return qs;
    },
  },

  "reading-u3": {
    id: "reading-u3",
    title: "Reading: my day",
    blurb: "A short passage in kana, with questions.",
    icon: "📖",
    scripted: true,
    build: () =>
      readingQuestions(
        "わたしは まいにち しちじに おきます。あさごはんは たべません。コーヒーを のみます。はちじはんに がっこうに いきます。じゅうにじに がっこうで ひるごはんを たべます。ごご よじごろ としょかんで べんきょうします。しちじごろ うちに かえります。ときどき テレビを みます。じゅうにじごろ ねます。",
        [
          ["What time does the writer get up?", "7:00", ["8:30", "4:00", "12:00"]],
          ["What do they have in the morning?", "only coffee", ["breakfast and coffee", "tea", "nothing at all"]],
          ["Where do they study?", "at the library", ["at home", "at a café", "at school"]],
          ["What time do they go home?", "about 7", ["about 4", "8:30", "about 12"]],
          ["How often do they watch TV?", "sometimes", ["every day", "never", "often"]],
        ],
      ),
  },

  invite: {
    id: "invite",
    title: "Making plans",
    blurb: "Invite someone, then agree on a day.",
    icon: "🎬",
    scripted: true,
    build: () => [
      choice("Ask Min what she usually does on weekends.", "しゅうまつは たいてい なにを しますか。", ["しゅうまつに たいてい なにを しましたか。", "しゅうまつは なにですか。", "しゅうまつを なにを しますか。"], {
        why: "Weekend as the topic (は), a habit (ます).",
      }),
      choice("Invite her to play tennis on Saturday.", "どようびに テニスを しませんか。", ["どようびに テニスを しますか。", "どようびは テニスを します。", "どようびで テニスを しませんか。"], {
        visual: chat([["ミン", "そうですね。ときどき テニスを します。"]]),
        why: "Invitation: ませんか; days take に.",
      }),
      choice("What does Min mean?", "Saturday doesn't work for her.", ["She'll come on Saturday.", "She doesn't play tennis.", "She asks what time."], {
        visual: chat([["ミン", "どようびは ちょっと…。"]]),
      }),
      choice("Suggest Sunday instead.", "じゃあ、にちようびは どうですか。", ["じゃあ、にちようびに しますか。", "にちようびは ちょっと…。", "にちようびに いきました。"], {}),
      choice("She agrees. What does she say?", "いいですね。", ["ちょっと…。", "いいえ。", "どうも。"], {
        visual: chat([["ミン", "＿"]]),
      }),
      choice("Ask what time.", "なんじに しますか。", ["なんじですか テニス。", "いつに しますか。", "なんじで しますか。"], {
        why: "Clock time + に; いつ never takes に.",
      }),
      choice("Suggest about ten o'clock.", "じゅうじごろ どうですか。", ["じゅうじかん どうですか。", "じゅうじで どうですか。", "じゅうじへ どうですか。"], {}),
    ],
  },

  // ================================================================ unit 4

  "aru-iru": {
    id: "aru-iru",
    title: "あります or います",
    blurb: "Things, people and animals.",
    icon: "📍",
    build: () =>
      shuffle<[string, string, string, boolean]>([
        ["🐱", "ねこ", "a cat", true],
        ["🐕", "いぬ", "a dog", true],
        ["🧒", "こども", "a child", true],
        ["🧑‍🏫", "せんせい", "a teacher", true],
        ["🧑", "ともだち", "a friend", true],
        ["🧑‍🎓", "りゅうがくせい", "an exchange student", true],
        ["📕", "ほん", "a book", false],
        ["☂️", "かさ", "an umbrella", false],
        ["🌸", "はな", "flowers", false],
        ["🏦", "ぎんこう", "a bank", false],
        ["🚏", "バスてい", "a bus stop", false],
        ["🪑", "いす", "a chair", false],
        ["📷", "しゃしん", "a photo", false],
      ])
        .slice(0, 10)
        .map(([emoji, jp, en, alive]) => {
          const [place, placeEn] = pick<[string, string]>([["あそこ", "over there"], ["こうえん", "in the park"], ["ここ", "here"]]);
          const right = alive ? "います" : "あります";
          return choice(`There is ${en} ${placeEn}.`, right, ["います", "あります", "です"], {
            visual: `<div class="gk-tag"><span class="gk-thing">${emoji}</span></div>`,
            jp: `${place}に ${jp}が ＿。`,
            why: alive ? "People and animals: います." : "Things and plants: あります.",
            sayAfter: `${place}に ${jp}が ${right}`,
          });
        }),
  },

  location: {
    id: "location",
    title: "Where is it?",
    blurb: "うえ, した, なか, みぎ, ひだり, あいだ.",
    icon: "🧭",
    build: () =>
      Array.from({ length: 10 }, () => {
        const [rel, en] = pick(LOCATIONS);
        const [xEmoji, xJp] = pick(LOC_ITEMS);
        const [yEmoji, yJp, zEmoji, zJp] = rel === "なか" ? ["👜", "かばん", "", ""] : rel === "あいだ" || rel === "みぎ" || rel === "ひだり" ? pick(LOC_BUILDINGS) : ["🪑", "いす", "", ""];
        const phrase = rel === "あいだ" ? `${yJp}と ${zJp}の あいだです。` : `${yJp}の ${rel}です。`;
        const others = LOCATIONS.map(([r]) => r).filter((r) => r !== rel && r !== "あいだ").map((r) => `${yJp}の ${r}です。`);
        return choice(`Where is the ${LOC_EN[xJp] ?? xJp}?`, phrase, shuffle(others), {
          visual: locationScene(rel, xEmoji, yEmoji, zEmoji),
          jp: `${xJp}は どこですか。`,
          why: `${en}: ${rel}`,
          sayAfter: `${xJp}は ${phrase}`,
        });
      }),
  },

  "location-listen": {
    id: "location-listen",
    title: "Listening: where is it?",
    blurb: "Hear where something is, then pick the picture's description.",
    icon: "🎧",
    build: () =>
      Array.from({ length: 8 }, () => {
        const [rel, en] = pick(LOCATIONS.filter(([r]) => r !== "あいだ"));
        const [, xJp] = pick(LOC_ITEMS);
        const alive = xJp === "ねこ" || xJp === "いぬ";
        const said = `${xJp}は いすの ${rel}に ${alive ? "います" : "あります"}。`;
        const xEn = LOC_EN[xJp] ?? xJp;
        const options = LOCATIONS.filter(([r]) => r !== "あいだ").map(([, e]) => `The ${xEn} is ${e} the chair.`);
        return choice("Where is it?", `The ${xEn} is ${en} the chair.`, shuffle(options), { listen: said, sayAfter: undefined });
      }),
  },

  "past-forms": {
    id: "past-forms",
    title: "Past tense",
    blurb: "ました, ませんでした, でした.",
    icon: "⏪",
    build: () => {
      const qs: GameQuestion[] = [];
      for (const v of shuffle(VERBS.filter((x) => x.dict !== "ある" && x.dict !== "いる" && x.dict !== "わかる")).slice(0, 7)) {
        const tense = pick(["did", "didn't", "do", "don't"] as const);
        const forms = { did: v.stem + "ました", "didn't": v.stem + "ませんでした", do: v.stem + "ます", "don't": v.stem + "ません" };
        const verbEn = v.en.replace(/^to /, "");
        const english = tense === "did" ? `I ${PAST_EN[v.dict] ?? verbEn}.` : tense === "didn't" ? `I didn't ${verbEn}.` : tense === "do" ? `I ${verbEn}.` : `I don't ${verbEn}.`;
        qs.push(choice(english, forms[tense], Object.values(forms), { jp: v.dict }));
      }
      for (const [noun, en] of shuffle<[string, string]>([["げつようび", "Monday"], ["がくせい", "a student"], ["いい てんき", "nice weather"], ["にほんじん", "Japanese"], ["テスト", "a test"]]).slice(0, 3)) {
        if (noun === "いい てんき") continue;
        const past = Math.random() < 0.5;
        const negative = Math.random() < 0.5;
        const forms = [noun + "です", noun + "じゃないです", noun + "でした", noun + "じゃなかったです"];
        const right = forms[(past ? 2 : 0) + (negative ? 1 : 0)];
        qs.push(choice(`It ${past ? (negative ? "wasn't" : "was") : negative ? "isn't" : "is"} ${en}.`, right, forms, {}));
      }
      return qs;
    },
  },

  "mo-particles": {
    id: "mo-particles",
    title: "も, にも, でも",
    blurb: "Replace は, が, を; keep に and で.",
    icon: "➕",
    build: () =>
      shuffle<[string, string]>([
        ["パンを かいました。ノート＿ かいました。", "も"],
        ["きょうとに いきました。おおさか＿ いきました。", "にも"],
        ["うちで べんきょうしました。カフェ＿ べんきょうしました。", "でも"],
        ["レナさんは こうえんに いきました。ミンさん＿ いきました。", "も"],
        ["どようびに がっこうに きました。にちようび＿ きました。", "にも"],
        ["こうえんに いぬが います。ねこ＿ います。", "も"],
        ["えきで しゃしんを とりました。おてら＿ とりました。", "でも"],
        ["コーヒーを のみました。おちゃ＿ のみました。", "も"],
        ["はるとさんに あいました。ノアさん＿ あいました。", "にも"],
        ["としょかんで ほんを よみました。うち＿ よみました。", "でも"],
      ]).map(([jp, right]) =>
        choice("Fill the gap.", right, ["も", "にも", "でも", "をも"], {
          jp,
          why: right === "も" ? "は, が and を are replaced by も." : `${right[0]} stays: ${right}.`,
          sayAfter: jp.replace("＿", right),
        }),
      ),
  },

  "goro-gurai": {
    id: "goro-gurai",
    title: "ごろ or ぐらい",
    blurb: "About a time, or about an amount.",
    icon: "⏳",
    build: () =>
      shuffle<[string, string]>([
        ["しちじ＿ おきました。", "ごろ"],
        ["さんじかん＿ べんきょうしました。", "ぐらい"],
        ["じゅうにじ＿ ねました。", "ごろ"],
        ["いちじかん＿ まちました。", "ぐらい"],
        ["くじ＿ うちに かえりました。", "ごろ"],
        ["にじかんはん＿ テレビを みました。", "ぐらい"],
        ["ごご よじ＿ こうえんに いきました。", "ごろ"],
        ["はちじかん＿ ねました。", "ぐらい"],
      ]).map(([jp, right]) =>
        choice("Fill the gap.", right, ["ごろ", "ぐらい", "に"], {
          jp,
          why: right === "ごろ" ? "A point in time: ごろ." : "An amount of time: ぐらい.",
          sayAfter: jp.replace("＿", right),
        }),
      ),
  },

  dates: {
    id: "dates",
    title: "Dates and days",
    blurb: "Days of the week, months and dates.",
    icon: "🗓️",
    build: () => {
      const qs: GameQuestion[] = [];
      for (let i = 0; i < 4; i++) {
        const d = pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24, 11, 17, 19]);
        qs.push(
          choice(`The ${ordinal(d)} of the month`, DATES[d], [
            naiveKana(d) + "にち",
            d === 20 ? "はたち" : oldReadings(naiveKana(d)) + "にち",
            DATES[d === 10 ? 9 : d + 1] ?? naiveKana(d + 1) + "にち",
            naiveKana(d + 1) + "にち",
            naiveKana(d + 2) + "にち",
          ], {}),
        );
      }
      for (let i = 0; i < 3; i++) {
        const m = pick([4, 7, 9, 1, 6, 10, 12]);
        qs.push(choice(MONTHS_EN[m], MONTHS[m], [naiveKana(m) + "がつ", MONTHS[(m % 12) + 1], m === 4 ? "よんがつ" : m === 7 ? "なながつ" : m === 9 ? "きゅうがつ" : naiveKana(m) + "つき"], {}));
      }
      for (const [jp, en] of shuffle(WEEKDAYS).slice(0, 3)) {
        qs.push(choice(en, jp, WEEKDAYS.map(([j]) => j).filter((j) => j !== jp), {}));
      }
      return shuffle(qs);
    },
  },

  "reading-u4": {
    id: "reading-u4",
    title: "Reading: the weekend",
    blurb: "A short passage in the past tense.",
    icon: "📖",
    scripted: true,
    build: () =>
      readingQuestions(
        "どようびに ともだちと まちに いきました。デパートで かいものを しました。わたしは くつを かいました。ともだちは かばんを かいました。それから、レストランで ひるごはんを たべました。にちようびは うちに いました。ひとりで レポートを かきました。さんじかんぐらい かきました。それから、いぬと こうえんに いきました。",
        [
          ["Who did the writer go to town with?", "a friend", ["alone", "their dog", "their teacher"]],
          ["What did the writer buy?", "shoes", ["a bag", "a book", "nothing"]],
          ["Where did they eat lunch?", "at a restaurant", ["at the department store", "at home", "in the park"]],
          ["What did they do on Sunday?", "wrote a paper at home", ["went shopping", "went to a temple", "met a friend"]],
          ["How long did they write?", "about 3 hours", ["about 1 hour", "until 3 o'clock", "all day"]],
        ],
      ),
  },

  weekend: {
    id: "weekend",
    title: "Talking about the weekend",
    blurb: "Ask and answer about what you did.",
    icon: "🗣️",
    scripted: true,
    build: () => [
      choice("Ask Noah what he did on the weekend.", "しゅうまつは なにを しましたか。", ["しゅうまつは なにを しますか。", "しゅうまつに なにが ありましたか。", "しゅうまつは なにでしたか。"], {
        why: "Past: しましたか.",
      }),
      choice("What did Noah do?", "He went to Kyoto with Haruto.", ["He went to Kyoto alone.", "He'll go to Kyoto with Haruto.", "Haruto went to Kyoto."], {
        visual: chat([["ノア", "はるとさんと きょうとに いきました。"]]),
      }),
      choice("Ask what he did there.", "きょうとで なにを しましたか。", ["きょうとに なにを しましたか。", "きょうとは なにを しますか。", "きょうとを なにを しましたか。"], {
        why: "Where the action happened: で.",
      }),
      choice("He says he took lots of photos at a temple. Which sentence says that?", "おてらで しゃしんを たくさん とりました。", ["おてらに しゃしんを たくさん とりました。", "おてらで しゃしんが たくさん ありました。", "おてらで たくさん しゃしんを とります。"], {}),
      choice("Now Noah asks you. Say you studied for about two hours.", "にじかんぐらい べんきょうしました。", ["にじごろ べんきょうしました。", "にじかんに べんきょうしました。", "にじかんぐらい べんきょうします。"], {
        visual: chat([["ノア", "しゅうまつは なにを しましたか。"]]),
      }),
      choice("Then add that you saw a movie too.", "えいがも みました。", ["えいがを も みました。", "えいがにも みました。", "えいがも みます。"], {
        why: "を is replaced by も.",
      }),
    ],
  },

  "classroom-match": {
    id: "classroom-match",
    title: "Classroom phrases",
    blurb: "Match each phrase to its meaning.",
    icon: "🏫",
    pairs: () => [
      ["わかりましたか。", "Do you understand?"],
      ["わかりました。", "I understand."],
      ["わかりません。", "I don't understand."],
      ["ゆっくり いってください。", "Please say it slowly."],
      ["もういちど いってください。", "Please say it again."],
      ["ちょっと まってください。", "Please wait a moment."],
      ["きいてください。", "Please listen."],
      ["じゅっページを みてください。", "Please look at page 10."],
    ],
  },
};

/** One vocabulary match game per lesson, from its core (non-extra) words. */
for (const lesson of GENKI_LESSONS) {
  GAMES[`vocab-${lesson.id}`] = {
    id: `vocab-${lesson.id}`,
    title: `Unit ${lesson.num} vocabulary`,
    blurb: "Match each word to its meaning.",
    icon: "🃏",
    pairs: () =>
      lesson.vocab
        .filter((g) => !g.extra)
        .flatMap((g) => g.words)
        .filter((w) => !w.jp.startsWith("〜"))
        .map((w): [string, string] => [w.jp, w.en]),
  };
}

function randomPrice(): number {
  // Bias towards the hundreds and thousands that change sound.
  const hot = [3, 6, 8];
  const man = Math.random() < 0.3 ? randInt(1, 9) : 0;
  const sen = Math.random() < 0.6 ? (Math.random() < 0.5 ? pick(hot) : randInt(1, 9)) : 0;
  const hyaku = Math.random() < 0.7 ? (Math.random() < 0.6 ? pick(hot) : randInt(1, 9)) : 0;
  const juu = Math.random() < 0.3 ? randInt(1, 9) : 0;
  const n = man * 10000 + sen * 1000 + hyaku * 100 + juu * 10;
  return n >= 100 ? n : 300;
}

function nearPrice(n: number): number {
  const steps = [100, 1000, 10];
  const step = pick(steps.filter((s) => n >= s));
  const out = Math.random() < 0.5 ? n + step : n - step;
  return out > 0 ? out : n + step;
}

// ====================================================================
// scores
// ====================================================================

const BEST_KEY = "genkiGameBest";

export async function gameBests(): Promise<Record<string, number>> {
  return (await getMeta<Record<string, number>>(BEST_KEY)) ?? {};
}

async function recordBest(id: string, score: number): Promise<void> {
  const bests = await gameBests();
  if ((bests[id] ?? -1) < score) {
    bests[id] = score;
    await setMeta(BEST_KEY, bests);
  }
}

// ====================================================================
// the engine
// ====================================================================

export interface RunOptions {
  onExit: () => void;
  isCurrent?: () => boolean;
}

/** What a learner's typed answer is compared on. */
function normalise(text: string, numeric: boolean): string {
  if (numeric) return digitsOf(text);
  return text.replace(/[\s、。,.!?！？]/g, "").toLowerCase();
}

export function runGame(host: HTMLElement, id: string, options: RunOptions): void {
  const game = GAMES[id];
  if (!game) return options.onExit();
  void preloadReactions();
  window.scrollTo({ top: 0 });
  if (game.pairs) return runMatch(host, game, options);

  const queue = game.scripted ? game.build!() : shuffle(game.build!());
  const total = queue.length;
  const missedOnce = new Set<GameQuestion>();
  let firstTry = 0;
  let answered = 0;
  let earned = 0;
  const alive = (): boolean => host.isConnected && (options.isCurrent?.() ?? true);

  const finish = async (): Promise<void> => {
    const score = Math.round((firstTry / total) * 100);
    await recordBest(game.id, score);
    const balance = earned > 0 ? await earnYennies(earned) : await yennies();
    if (!alive()) return;
    host.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">${score >= 80 ? "🎉" : score >= 50 ? "👍" : "🌱"}</div>
        <div class="kana-score">${firstTry} / ${total}</div>
        <div class="glosses">${
          `${score}% first try`
        }</div>
        <div class="yen-line">${earned > 0 ? `<b>+${earned}</b> · ` : ""}${formatYennies(balance)}</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="gk-again">Play again</button>
          <button id="gk-back" class="secondary">Back</button>
        </div>
      </div>`;
    host.querySelector("#gk-again")!.addEventListener("click", () => runGame(host, id, options));
    host.querySelector("#gk-back")!.addEventListener("click", options.onExit);
  };

  const draw = (): void => {
    if (!alive()) return;
    const q = queue[0];
    if (!q) return void finish();
    const percent = Math.round((answered / (answered + queue.length)) * 100);
    host.innerHTML = `
      <div class="card-panel kana-quiz gram-quiz gk-game">
        <div class="kana-quiz-top">
          <button id="gk-quit" class="quiz-stop" title="Stop" aria-label="Stop">✕</button>
          <span class="glosses">${escapeHtml(game.icon)} ${escapeHtml(game.title)}</span>
          <span class="glosses">${answered}/${total}</span>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${percent}%"></div></div>
        <div class="gram-prompt">${escapeHtml(q.prompt)}</div>
        ${"visual" in q && q.visual ? `<div class="gk-visual">${q.visual}</div>` : ""}
        ${"listen" in q && q.listen ? `<button class="secondary gk-listen" id="gk-listen">🔊 Play again</button>` : ""}
        ${q.kind === "choice" && q.jp ? `<div class="lesson-quiz-jp" lang="ja">${escapeHtml(q.jp)}</div>` : ""}
        <div id="gk-answer"></div>
        <div class="kana-feedback" id="gk-feedback"></div>
      </div>
      ${cheerBox("gk-cheer")}`;
    host.querySelector("#gk-quit")!.addEventListener("click", options.onExit);
    if ("listen" in q && q.listen) {
      const say = (): void => void speak(q.listen!, { rate: 0.85 }).catch(() => undefined);
      host.querySelector("#gk-listen")!.addEventListener("click", say);
      say();
    }
    const answerBox = host.querySelector<HTMLDivElement>("#gk-answer")!;
    const feedback = host.querySelector<HTMLDivElement>("#gk-feedback")!;

    const settle = (good: boolean, shown: string, say?: string): void => {
      answered++;
      queue.shift();
      if (good && !missedOnce.has(q)) {
        firstTry++;
        earned += PER_CORRECT;
      }
      if (!good) {
        if (game.scripted) queue.unshift(q);
        else if (!missedOnce.has(q)) queue.push(q);
        missedOnce.add(q);
        if (game.scripted) answered--;
      }
      const why = "why" in q && q.why ? q.why : "";
      feedback.innerHTML = `${good ? `<span class="ok-text">✓</span>` : `<span class="err-text">✗</span>`}
        <span lang="ja">${escapeHtml(shown)}</span>
        ${why && why !== shown ? `<div class="glosses">${escapeHtml(why)}</div>` : ""}
        <div class="glosses">${game.scripted && !good ? "Try again: Enter or tap" : "Enter or tap to continue"}</div>`;
      void showReaction(host.querySelector("#gk-cheer"), good ? "correct" : "wrong");
      if (say && /[ぁ-ゟァ-ヿ]/.test(say)) void speak(say.replace(/＿/g, ""), { rate: 0.85 }).catch(() => undefined);
      const panel = host.querySelector<HTMLDivElement>(".gk-game")!;
      panel.tabIndex = -1;
      panel.focus();
      let gone = false;
      const advance = (): void => {
        if (gone) return;
        gone = true;
        draw();
      };
      setTimeout(() => {
        panel.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") advance();
        });
        panel.addEventListener("click", (ev) => {
          if (!(ev.target as HTMLElement).closest("#gk-quit, #gk-listen")) advance();
        });
      }, 0);
    };

    if (q.kind === "choice") {
      answerBox.innerHTML = `<div class="gram-options lesson-quiz-options">${q.choices
        .map((c, i) => `<button data-i="${i}" lang="ja">${escapeHtml(c)}</button>`)
        .join("")}</div>`;
      const buttons = [...answerBox.querySelectorAll<HTMLButtonElement>("button")];
      for (const button of buttons) {
        button.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const picked = Number(button.dataset.i);
          const good = picked === q.answer;
          for (const b of buttons) {
            const i = Number(b.dataset.i);
            b.classList.toggle("is-answer", i === q.answer);
            b.classList.toggle("is-wrong", i === picked && !good);
            b.disabled = true;
          }
          const right = q.choices[q.answer];
          settle(good, right, q.sayAfter ?? (right.startsWith("(") ? undefined : right));
        });
      }
    } else if (q.kind === "type") {
      answerBox.innerHTML = `<form class="gk-type"><input type="text" id="gk-input" ${
        q.numeric ? 'inputmode="numeric"' : ""
      } autocomplete="off" autocapitalize="none" placeholder="${q.numeric ? "digits" : "type here"}" />
        <button type="submit">Check</button></form>`;
      const input = answerBox.querySelector<HTMLInputElement>("#gk-input")!;
      input.focus();
      answerBox.querySelector("form")!.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (!input.value.trim()) return;
        const good = q.accept.includes(normalise(input.value, !!q.numeric));
        input.disabled = true;
        answerBox.querySelector<HTMLButtonElement>("button")!.disabled = true;
        settle(good, q.show, q.sayAfter ?? q.listen);
      });
    } else {
      const placed: number[] = [];
      const order = shuffle(q.tiles.map((_, i) => i));
      const paint = (): void => {
        answerBox.innerHTML = `
          <div class="glosses gk-order-en">${escapeHtml(q.en)}</div>
          <div class="gk-order-line">${placed.length ? placed.map((i) => `<button class="gk-tile on" data-i="${i}" lang="ja">${escapeHtml(q.tiles[i])}</button>`).join("") : '<span class="glosses">tap the pieces below</span>'}</div>
          <div class="gk-order-pool">${order
            .filter((i) => !placed.includes(i))
            .map((i) => `<button class="gk-tile" data-i="${i}" lang="ja">${escapeHtml(q.tiles[i])}</button>`)
            .join("")}</div>
          ${placed.length === q.tiles.length ? `<button id="gk-check">Check</button>` : ""}`;
        for (const b of answerBox.querySelectorAll<HTMLButtonElement>(".gk-tile")) {
          b.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const i = Number(b.dataset.i);
            if (b.classList.contains("on")) placed.splice(placed.indexOf(i), 1);
            else placed.push(i);
            paint();
          });
        }
        answerBox.querySelector("#gk-check")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const built = placed.map((i) => q.tiles[i]).join("");
          const good = built === q.tiles.join("");
          for (const b of answerBox.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
          settle(good, q.tiles.join(" "), q.tiles.join(""));
        });
      };
      paint();
    }
  };

  draw();
}

/** Two columns, tap a Japanese card then its meaning. Six pairs a board. */
function runMatch(host: HTMLElement, game: GameDef, options: RunOptions): void {
  const all = shuffle(game.pairs!());
  const boards: [string, string][][] = [];
  for (let i = 0; i < Math.min(all.length, 18); i += 6) boards.push(all.slice(i, i + 6));
  let boardIndex = 0;
  let misses = 0;
  let matched = 0;
  const total = boards.reduce((n, b) => n + b.length, 0);

  const finish = async (): Promise<void> => {
    const score = Math.round((matched / (matched + misses)) * 100);
    await recordBest(game.id, score);
    const balance = await earnYennies(matched * PER_CORRECT);
    if (!host.isConnected) return;
    host.innerHTML = `
      <div class="card-panel kana-quiz">
        <div class="big">${misses === 0 ? "🎉" : "👍"}</div>
        <div class="kana-score">${matched} pairs</div>
        <div class="glosses">${misses === 0 ? "No misses." : `${misses} miss${misses === 1 ? "" : "es"}.`}</div>
        <div class="yen-line"><b>+${matched}</b> · ${formatYennies(balance)}</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="gk-again">Play again</button>
          <button id="gk-back" class="secondary">Back</button>
        </div>
      </div>`;
    host.querySelector("#gk-again")!.addEventListener("click", () => runMatch(host, game, options));
    host.querySelector("#gk-back")!.addEventListener("click", options.onExit);
  };

  const drawBoard = (): void => {
    const board = boards[boardIndex];
    if (!board) return void finish();
    const left = shuffle(board.map((_, i) => i));
    const right = shuffle(board.map((_, i) => i));
    host.innerHTML = `
      <div class="card-panel kana-quiz gk-match">
        <div class="kana-quiz-top">
          <button id="gk-quit" class="quiz-stop" title="Stop" aria-label="Stop">✕</button>
          <span class="glosses">${escapeHtml(game.icon)} ${escapeHtml(game.title)}</span>
          <span class="glosses">${matched}/${total}</span>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${Math.round((matched / total) * 100)}%"></div></div>
        <div class="gram-prompt">Tap a word, then its meaning.</div>
        <div class="gk-match-cols">
          <div>${left.map((i) => `<button class="gk-card" data-side="jp" data-i="${i}" lang="ja">${escapeHtml(board[i][0])}</button>`).join("")}</div>
          <div>${right.map((i) => `<button class="gk-card" data-side="en" data-i="${i}">${escapeHtml(board[i][1])}</button>`).join("")}</div>
        </div>
      </div>`;
    host.querySelector("#gk-quit")!.addEventListener("click", options.onExit);
    let held: HTMLButtonElement | null = null;
    let left_ = board.length;
    for (const card of host.querySelectorAll<HTMLButtonElement>(".gk-card")) {
      card.addEventListener("click", () => {
        if (card.disabled) return;
        if (card.dataset.side === "jp") void speak(board[Number(card.dataset.i)][0], { rate: 0.85 }).catch(() => undefined);
        if (!held || held.dataset.side === card.dataset.side) {
          held?.classList.remove("held");
          held = card;
          card.classList.add("held");
          return;
        }
        if (held.dataset.i === card.dataset.i) {
          for (const c of [held, card]) {
            c.classList.remove("held");
            c.classList.add("done");
            c.disabled = true;
          }
          matched++;
          left_--;
          held = null;
          host.querySelector<HTMLElement>(".kana-bar-fill")!.style.width = `${Math.round((matched / total) * 100)}%`;
          if (left_ === 0) {
            boardIndex++;
            setTimeout(drawBoard, 450);
          }
        } else {
          misses++;
          const pair = [held, card];
          held = null;
          for (const c of pair) {
            c.classList.remove("held");
            c.classList.add("miss");
            setTimeout(() => c.classList.remove("miss"), 450);
          }
        }
      });
    }
  };

  drawBoard();
}
