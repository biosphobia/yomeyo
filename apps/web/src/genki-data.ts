/**
 * The Genki companion: Genki I (3rd edition), unit by unit.
 *
 * Each unit covers one Genki lesson completely, so the book isn't needed
 * alongside it: the lesson's vocabulary lists, its grammar points in the
 * book's order and numbering, the reference material (numbers, time,
 * greetings, classroom phrases), two conversations, and in-app practice
 * for every kind of exercise the lesson has, including listening and
 * reading. Page references are kept for anyone using the book in class.
 * The explanations, sentences, conversations and drills are written for
 * the app; the book's own text is not reproduced.
 *
 * Example sentences use a small cast of our own: レナ (Lena, a first-year
 * from Germany), はると (Haruto, a Japanese third-year), ミン (Min, a Korean
 * second-year), ノア (Noah, a Canadian), and やまもとせんせい.
 *
 * Everything is kana, as in Genki lessons 1 and 2. Romaji is a toggle on
 * screen, computed, never stored. Steps marked `optional` never count
 * against finishing a unit; a unit is done when its test is passed.
 */

import { L3, L4 } from "./genki-units-3-4.js";

export interface GenkiExample {
  jp: string;
  en: string;
  /** A short aside under the translation. */
  note?: string;
}

export interface GenkiCheck {
  q: string;
  /** A Japanese line the question is about, shown large. ＿ marks a gap. */
  jp?: string;
  choices: string[];
  answer: number;
  why: string;
}

export interface VocabWord {
  jp: string;
  /** The usual kanji spelling, from Unit 3 on. */
  kanji?: string;
  en: string;
  /** Marked in the book as appearing in the dialogue. */
  star?: boolean;
}

export interface VocabGroup {
  title: string;
  /** The book's "additional vocabulary": learn the ones that apply to you. */
  extra?: boolean;
  words: VocabWord[];
}

/** A small reference table drawn inside a step (numbers, times, prices). */
export interface GenkiTable {
  caption?: string;
  rows: [left: string, jp: string, note?: string][];
}

export type StepKind = "warmup" | "grammar" | "expressions" | "culture";

export interface GenkiStep {
  id: string;
  kind: StepKind;
  /** Warm-ups never count against finishing a unit. */
  optional?: boolean;
  /** The pattern as the book heads it: "X は Y です". */
  title: string;
  /** What it does, in plain words. */
  name: string;
  /** Where it is in the book. */
  genki: string;
  /** The explanation. Blank lines split paragraphs; **bold** works. */
  teach: string;
  /** The pattern box: a template and what it means. */
  pattern?: [jp: string, en: string][];
  examples?: GenkiExample[];
  tables?: GenkiTable[];
  /** Common mistakes. */
  watch?: string[];
  /** What class quizzes tend to check. */
  uni?: string;
  /** How it's used outside class. */
  life?: string;
  /** Three or four questions straight after reading. */
  checks: GenkiCheck[];
  /** Game ids from genki-games.ts. */
  games: string[];
  /** Starter questions for Ask Coach. */
  ask: string[];
}

export interface DialogueLine {
  who: string;
  jp: string;
  en: string;
}

export interface GenkiDialogue {
  title: string;
  setting: string;
  lines: DialogueLine[];
}

export interface GenkiLesson {
  id: string;
  /** Unit number, the same as the Genki lesson number. */
  num: number;
  jp: string;
  en: string;
  /** Book pages the unit covers. */
  pages: string;
  goals: string[];
  /** A suggested order over five study sessions. */
  plan: string[];
  /** Every practice game for the unit, grouped, for the unit page. */
  practice: { title: string; games: string[] }[];
  vocab: VocabGroup[];
  steps: GenkiStep[];
  /** Two conversations using the unit's grammar. */
  dialogues: GenkiDialogue[];
  /** Games for the "put it together" page. */
  together: string[];
  test: GenkiCheck[];
}

// ====================================================================
// Unit 1 · Genki Lesson 1 · あたらしいともだち (New Friends)
// ====================================================================

const L1: GenkiLesson = {
  id: "l1",
  num: 1,
  jp: "あたらしいともだち",
  en: "New Friends",
  pages: "Genki I pp. 30–55",
  goals: [
    "Use the everyday greetings",
    "Count from 0 to 100",
    "Introduce yourself: name, nationality, school, year, major, age",
    "Ask other people the same questions",
    "Tell the time and give a phone number",
  ],
  plan: [
    "1 · Greetings and numbers (pp. 30–35), start the vocabulary",
    "2 · Vocabulary, Grammar 1: X は Y です",
    "3 · Grammar 2: questions, Grammar 3: の",
    "4 · Time and phone numbers, names and titles",
    "5 · Practice conversation, self-introduction, unit test",
  ],
  practice: [
    { title: "Listening", games: ["intro-listen", "numbers-listen", "phone-listen"] },
    { title: "Reading", games: ["reading-u1"] },
    { title: "Sentences", games: ["wa-desu-builder", "chart-questions", "question-words", "no-chain", "jin-or-go"] },
    { title: "Numbers and time", games: ["numbers-read", "ages-years", "clock", "minutes-clock"] },
    { title: "Words and phrases", games: ["vocab-l1", "greet-situations"] },
  ],
  vocab: [
    {
      title: "School",
      words: [
        { jp: "だいがく", en: "college, university", star: true },
        { jp: "こうこう", en: "high school" },
        { jp: "がくせい", en: "student", star: true },
        { jp: "だいがくせい", en: "college student" },
        { jp: "りゅうがくせい", en: "international student", star: true },
        { jp: "せんせい", en: "teacher, professor" },
        { jp: "〜ねんせい", en: "…-year student", star: true },
        { jp: "いちねんせい", en: "first-year student" },
        { jp: "せんこう", en: "major", star: true },
      ],
    },
    {
      title: "Person",
      words: [
        { jp: "わたし", en: "I" },
        { jp: "ともだち", en: "friend" },
        { jp: "〜さん", en: "Mr./Ms. …" },
        { jp: "〜じん", en: "… people", star: true },
        { jp: "にほんじん", en: "Japanese people" },
      ],
    },
    {
      title: "Time",
      words: [
        { jp: "いま", en: "now" },
        { jp: "ごぜん", en: "a.m." },
        { jp: "ごご", en: "p.m." },
        { jp: "〜じ", en: "… o'clock" },
        { jp: "いちじ", en: "one o'clock" },
        { jp: "はん", en: "half" },
        { jp: "にじはん", en: "half past two" },
      ],
    },
    {
      title: "Others",
      words: [
        { jp: "にほん", en: "Japan", star: true },
        { jp: "アメリカ", en: "USA" },
        { jp: "〜ご", en: "… language", star: true },
        { jp: "にほんご", en: "Japanese language" },
        { jp: "〜さい", en: "… years old", star: true },
        { jp: "でんわ", en: "telephone" },
        { jp: "〜ばん", en: "number …" },
        { jp: "ばんごう", en: "number" },
        { jp: "なまえ", en: "name" },
        { jp: "なん／なに", en: "what", star: true },
      ],
    },
    {
      title: "Expressions",
      words: [
        { jp: "あのう", en: "um…", star: true },
        { jp: "はい", en: "yes" },
        { jp: "そうです", en: "that's right" },
        { jp: "そうですか", en: "I see. / Is that so?", star: true },
      ],
    },
    {
      title: "Countries",
      extra: true,
      words: [
        { jp: "イギリス", en: "Britain" },
        { jp: "オーストラリア", en: "Australia" },
        { jp: "かんこく", en: "Korea" },
        { jp: "カナダ", en: "Canada" },
        { jp: "ちゅうごく", en: "China" },
        { jp: "インド", en: "India" },
        { jp: "エジプト", en: "Egypt" },
        { jp: "フィリピン", en: "Philippines" },
      ],
    },
    {
      title: "Majors",
      extra: true,
      words: [
        { jp: "アジアけんきゅう", en: "Asian studies" },
        { jp: "けいざい", en: "economics" },
        { jp: "こうがく", en: "engineering" },
        { jp: "こくさいかんけい", en: "international relations" },
        { jp: "コンピューター", en: "computer" },
        { jp: "せいじ", en: "politics" },
        { jp: "せいぶつがく", en: "biology" },
        { jp: "ビジネス", en: "business" },
        { jp: "ぶんがく", en: "literature" },
        { jp: "れきし", en: "history" },
      ],
    },
    {
      title: "Occupations",
      extra: true,
      words: [
        { jp: "いしゃ", en: "doctor" },
        { jp: "かいしゃいん", en: "office worker" },
        { jp: "かんごし", en: "nurse" },
        { jp: "こうこうせい", en: "high school student" },
        { jp: "しゅふ", en: "housewife / homemaker" },
        { jp: "だいがくいんせい", en: "graduate student" },
        { jp: "べんごし", en: "lawyer" },
      ],
    },
    {
      title: "Family",
      extra: true,
      words: [
        { jp: "おかあさん", en: "mother" },
        { jp: "おとうさん", en: "father" },
        { jp: "おねえさん", en: "older sister" },
        { jp: "おにいさん", en: "older brother" },
        { jp: "いもうと", en: "younger sister" },
        { jp: "おとうと", en: "younger brother" },
      ],
    },
  ],
  steps: [
    // ------------------------------------------------ warm-up: greetings
    {
      id: "greetings",
      kind: "warmup",
      optional: true,
      title: "あいさつ",
      name: "Greetings",
      genki: "Genki pp. 30–34",
      teach:
        "Which greeting to use depends on the time of day, who you're talking to, and whether someone is leaving or arriving.\n\n" +
        "**Short and long forms.** おはよう / おはようございます and ありがとう / ありがとうございます. Use the short form with friends and family, the long form with teachers, staff, strangers and anyone older.\n\n" +
        "**Leaving and coming home.** The person leaving says いってきます; the people staying answer いってらっしゃい. Coming back: ただいま, answered with おかえりなさい.\n\n" +
        "**Meals.** いただきます before eating, ごちそうさまでした after.\n\n" +
        "**Goodbye.** さようなら sounds final. Between friends who'll meet again soon, use じゃあ、また. Leaving a teacher's office, use しつれいします.\n\n" +
        "**Bowing.** Greetings usually come with a bow, from a small nod between friends to a deeper bow from the waist for teachers, customers or an apology. The deeper and longer the bow, the more formal. Handshakes are mostly for business, and business cards (めいし) are offered and received with both hands and a small bow.",
      examples: [
        { jp: "おはようございます。", en: "Good morning. (polite)" },
        { jp: "こんにちは。", en: "Good afternoon. / Hello.", note: "The last kana is は, read \"wa\"." },
        { jp: "こんばんは。", en: "Good evening." },
        { jp: "すみません。", en: "Excuse me. / I'm sorry." },
        { jp: "いいえ。", en: "No. / Not at all." },
        { jp: "はじめまして。レナです。よろしくおねがいします。", en: "How do you do? I'm Lena. Nice to meet you." },
      ],
      tables: [{
        caption: "Pairs",
        rows: [
          ["Leaving home", "いってきます"],
          ["…the reply", "いってらっしゃい"],
          ["Coming home", "ただいま"],
          ["…the reply", "おかえりなさい"],
          ["Before eating", "いただきます"],
          ["After eating", "ごちそうさまでした"],
          ["Going to bed", "おやすみなさい"],
        ],
      }],
      watch: [
        "こんにちは and こんばんは are written with は, not わ.",
        "こんにちは is not used with your own family.",
        "すみません is also how you call a waiter or get past someone.",
      ],
      uni: "Oral checks often give a situation in English and ask for the greeting. Spelling こんにちは / こんばんは with は is a common written item.",
      checks: [
        {
          q: "You're leaving the house for class. What do you say?",
          choices: ["いってきます", "いってらっしゃい", "ただいま", "おかえりなさい"],
          answer: 0,
          why: "The person leaving says いってきます.",
        },
        {
          q: "9 a.m., you meet your professor.",
          choices: ["おはようございます", "おはよう", "こんばんは", "おやすみなさい"],
          answer: 0,
          why: "Morning, and a teacher: the long form.",
        },
        {
          q: "Someone thanks you for holding the door. You reply:",
          choices: ["いいえ。", "すみません。", "いただきます。", "ただいま。"],
          answer: 0,
          why: "いいえ here means \"not at all\".",
        },
      ],
      games: ["greet-situations"],
      ask: ["When is さようなら appropriate?", "すみません or ごめんなさい?"],
    },
    // ------------------------------------------------ warm-up: numbers
    {
      id: "numbers",
      kind: "warmup",
      optional: true,
      title: "すうじ",
      name: "Numbers 0–100",
      genki: "Genki p. 35; Expression Notes 2, p. 44",
      teach:
        "Above ten the numbers are built from 1–10: 11 is じゅういち (10 + 1), 20 is にじゅう (2 × 10), 45 is よんじゅうご (4 × 10 + 5).\n\n" +
        "4, 7 and 9 have two readings. In counting and in most numbers use **よん, なな, きゅう**. The other readings (し, しち, く) appear in set words, most often in times: 4 o'clock is よじ, 7 o'clock is しちじ, 9 o'clock is くじ.\n\n" +
        "Zero is ゼロ or れい.",
      tables: [{
        caption: "0–10 and how bigger numbers are built",
        rows: [
          ["0", "ゼロ／れい"],
          ["1", "いち"],
          ["2", "に"],
          ["3", "さん"],
          ["4", "よん／し", "usually よん"],
          ["5", "ご"],
          ["6", "ろく"],
          ["7", "なな／しち", "usually なな"],
          ["8", "はち"],
          ["9", "きゅう／く", "usually きゅう"],
          ["10", "じゅう"],
          ["11", "じゅういち"],
          ["20", "にじゅう"],
          ["45", "よんじゅうご"],
          ["100", "ひゃく"],
        ],
      }],
      watch: [
        "10 is じゅう and 100 is ひゃく, not いちじゅう or いちひゃく.",
        "40, 70, 90: よんじゅう, ななじゅう, きゅうじゅう.",
      ],
      checks: [
        {
          q: "47",
          choices: ["よんじゅうなな", "しじゅうしち", "よんななじゅう", "しちじゅうよん"],
          answer: 0,
          why: "4 × 10 + 7.",
        },
        {
          q: "90",
          choices: ["きゅうじゅう", "くじゅう", "じゅうきゅう", "きゅうひゃく"],
          answer: 0,
          why: "9 × 10. じゅうきゅう is 19.",
        },
        {
          q: "100",
          choices: ["ひゃく", "いちひゃく", "じゅうじゅう", "せん"],
          answer: 0,
          why: "ひゃく on its own. せん is 1,000.",
        },
      ],
      games: ["numbers-read", "numbers-listen"],
      ask: ["Why does 4 have two readings?", "When is れい used instead of ゼロ?"],
    },
    // ------------------------------------------------ grammar 1
    {
      id: "wa-desu",
      kind: "grammar",
      title: "X は Y です",
      name: "Grammar 1 · X is Y",
      genki: "Genki p. 41",
      teach:
        "**です** after a noun means \"is / am / are\". がくせいです is a complete sentence: \"(I) am a student.\"\n\n" +
        "There is no \"I\" in it. Japanese leaves out whatever the listener already knows, which is often the subject.\n\n" +
        "When the topic needs saying, put it first and mark it with **は**: わたしは がくせいです. は means roughly \"as for…\". It is written は but pronounced **wa**.\n\n" +
        "Japanese has no \"a\" or \"the\" and usually no plural: がくせい can mean \"a student\", \"the student\" or \"students\".",
      pattern: [
        ["〔X〕は 〔Y〕です。", "X is Y."],
        ["〔Y〕です。", "(It) is Y. (X understood)"],
      ],
      examples: [
        { jp: "わたしは レナです。", en: "I'm Lena." },
        { jp: "レナさんは ドイツじんです。", en: "Lena is German." },
        { jp: "はるとさんは さんねんせいです。", en: "Haruto is a third-year student." },
        { jp: "せんこうは れきしです。", en: "(My) major is history." },
        { jp: "いちねんせいです。", en: "(I'm) a first-year." },
      ],
      watch: [
        "No さん after your own name.",
        "Say わたしは once to set the topic, then leave it out.",
        "Use the person's name + さん instead of あなた.",
        "Nationality is 〜じん, language is 〜ご.",
        "Don't call yourself せんせい; it's a title for others.",
      ],
      uni: "The first oral exam is usually a self-introduction built from this pattern. Teachers listen for は read as \"wa\", no さん on yourself, and not repeating わたしは.",
      checks: [
        {
          q: "\"I'm Noah.\"",
          choices: ["ノアです。", "ノアさんです。", "あなたは ノアです。", "ノアは です。"],
          answer: 0,
          why: "No さん for yourself; わたしは can be left out.",
        },
        {
          q: "How is the は in わたしは pronounced?",
          choices: ["wa", "ha", "ba", "a"],
          answer: 0,
          why: "As a particle, は is read \"wa\".",
        },
        {
          q: "\"Min is Korean.\"",
          jp: "ミンさんは かんこく＿です。",
          choices: ["じん", "ご", "さん", "の"],
          answer: 0,
          why: "A person from a country: 〜じん.",
        },
      ],
      games: ["wa-desu-builder", "jin-or-go"],
      ask: ["Why is 'I' left out so often?", "Is は the same as 'is'?", "When is あなた used?"],
    },
    // ------------------------------------------------ grammar 2
    {
      id: "questions",
      kind: "grammar",
      title: "〜か",
      name: "Grammar 2 · Question sentences",
      genki: "Genki p. 42",
      teach:
        "Add **か** to the end of a statement to make it a question. Word order doesn't change.\n" +
        "りゅうがくせいです → りゅうがくせいですか\n\n" +
        "**Yes:** はい、そうです. **No:** いいえ, followed by what is true: いいえ、にほんじんです.\n\n" +
        "**Question words** go where the answer goes. To answer, replace the question word:\n" +
        "せんこうは なんですか。→ せんこうは けいざいです。\n\n" +
        "This lesson's question words: なん (what), なんさい (how old), なんねんせい (what year), なんじ (what time), なんばん (what number), なにじん (what nationality). なん is used before です and counters; なに before particles and in なにじん.",
      pattern: [
        ["〔statement〕か。", "yes/no question"],
        ["〔X〕は なん〜ですか。", "What … is X?"],
      ],
      examples: [
        { jp: "はるとさんは にほんじんですか。", en: "Is Haruto Japanese?" },
        { jp: "はい、そうです。", en: "Yes, he is." },
        { jp: "ノアさんは なんねんせいですか。", en: "What year is Noah in?" },
        { jp: "にねんせいです。", en: "He's a second-year." },
        { jp: "いま なんじですか。", en: "What time is it now?" },
        { jp: "ミンさんは なんさいですか。", en: "How old is Min?" },
        { jp: "でんわばんごうは なんばんですか。", en: "What's your phone number?" },
      ],
      watch: [
        "Japanese questions don't normally take a question mark.",
        "Questions with question words aren't answered with はい / いいえ.",
        "\"No, that's not right\" (〜じゃないです) is Lesson 2. Here: いいえ + the correct answer.",
      ],
      uni: "Listening quizzes use these question words a lot. Catch the question word first: なんさい means the answer ends in 〜さい.",
      checks: [
        {
          q: "\"Is Lena a first-year?\"",
          jp: "レナさんは いちねんせいです＿。",
          choices: ["か", "は", "の", "ね"],
          answer: 0,
          why: "か at the end makes a question.",
        },
        {
          q: "Reply to なんさいですか.",
          choices: ["にじゅういっさいです。", "はい、そうです。", "さんねんせいです。", "ごご にじです。"],
          answer: 0,
          why: "なんさい asks age: 〜さい.",
        },
        {
          q: "\"Is Haruto an international student?\" He's Japanese.",
          choices: ["いいえ、にほんじんです。", "はい、にほんじんです。", "いいえ、そうです。", "にほんじんですか。"],
          answer: 0,
          why: "いいえ, then the fact.",
        },
      ],
      games: ["question-words", "ages-years"],
      ask: ["なん or なに?", "How do I say 'no, that's not right'?"],
    },
    // ------------------------------------------------ grammar 3
    {
      id: "no",
      kind: "grammar",
      title: "Noun₁ の Noun₂",
      name: "Grammar 3 · Linking two nouns",
      genki: "Genki p. 43",
      teach:
        "**の** joins two nouns. The second noun is the main one; the first narrows it down.\n\n" +
        "はるとさんの でんわばんごう: a phone number, Haruto's. にほんごの せんせい: a teacher, of Japanese. The order is the reverse of English \"of\".\n\n" +
        "の covers possession and also \"at\", \"from\" or \"of\": さくらだいがくの がくせい is a student at Sakura University.\n\n" +
        "A noun-の-noun phrase works as one noun, so it can sit on either side of は … です, and phrases can be chained: わたしの ともだちの なまえ (my friend's name).",
      pattern: [["〔Noun₁〕の 〔Noun₂〕", "Noun₂, narrowed by Noun₁"]],
      examples: [
        { jp: "わたしの なまえ", en: "my name" },
        { jp: "にほんごの せんせい", en: "a Japanese-language teacher" },
        { jp: "とうきょうだいがくの がくせい", en: "a student at the University of Tokyo" },
        { jp: "ミンさんの せんこうは けいざいです。", en: "Min's major is economics." },
        { jp: "はるとさんの おかあさんは いしゃです。", en: "Haruto's mother is a doctor." },
      ],
      watch: [
        "\"Teacher of Japanese\" is にほんごの せんせい, not せんせいの にほんご.",
        "\"My\" is わたしの.",
      ],
      uni: "Translation items like \"my friend's phone number\" are common. Find the main noun first; it goes last.",
      checks: [
        {
          q: "\"a high school teacher\"",
          choices: ["こうこうの せんせい", "せんせいの こうこう", "こうこうせんせいの", "せんせい こうこう"],
          answer: 0,
          why: "Main noun (teacher) last.",
        },
        {
          q: "\"Noah's major is history.\"",
          jp: "ノアさん＿ せんこうは れきしです。",
          choices: ["の", "は", "か", "です"],
          answer: 0,
          why: "Noah's major: ノアさんの せんこう.",
        },
        {
          q: "わたしの ともだちの でんわばんごう",
          choices: ["my friend's phone number", "my phone's friend number", "the friend of my phone", "my number is a friend"],
          answer: 0,
          why: "Read from the back: phone number ← friend's ← my.",
        },
      ],
      games: ["no-chain"],
      ask: ["Is の always possession?", "How long can an の chain get?"],
    },
    // ------------------------------------------------ time & phone numbers
    {
      id: "time",
      kind: "expressions",
      title: "じかん・でんわばんごう",
      name: "Time and phone numbers",
      genki: "Genki pp. 51–53, 55 · Practice IV–V, Useful Expressions",
      teach:
        "Hours are number + **じ**. Half past is + **はん**. a.m. and p.m. go in front: ごぜん くじ (9 a.m.), ごご にじはん (2:30 p.m.).\n\n" +
        "Three hours are irregular: **よじ** (4), **しちじ** (7), **くじ** (9).\n\n" +
        "Minutes use ふん or ぷん: ぷん after 1, 3, 4, 6, 8 and 10 (いっぷん, さんぷん, よんぷん, ろっぷん, はっぷん, じゅっぷん), ふん after 2, 5, 7 and 9. Bigger minutes are built the same way: 18 = じゅう + はっぷん. Hour first, then minutes: くじ じゅうはっぷん (9:18).\n\n" +
        "Phone numbers are read one digit at a time, and the dash is read **の**: 090-1234-5678 → ゼロきゅうゼロの いちにさんよんの ごろくななはち. When reading digits, 2 and 5 are often lengthened to にい and ごお.",
      tables: [{
        caption: "Hours",
        rows: [
          ["1:00", "いちじ"],
          ["2:00", "にじ"],
          ["3:00", "さんじ"],
          ["4:00", "よじ", "irregular"],
          ["5:00", "ごじ"],
          ["6:00", "ろくじ"],
          ["7:00", "しちじ", "irregular"],
          ["8:00", "はちじ"],
          ["9:00", "くじ", "irregular"],
          ["10:00", "じゅうじ"],
          ["11:00", "じゅういちじ"],
          ["12:00", "じゅうにじ"],
          ["1:30", "いちじはん"],
        ],
      }, {
        caption: "Minutes",
        rows: [
          ["1 min", "いっぷん"],
          ["2 min", "にふん"],
          ["3 min", "さんぷん"],
          ["4 min", "よんぷん"],
          ["5 min", "ごふん"],
          ["6 min", "ろっぷん"],
          ["7 min", "ななふん"],
          ["8 min", "はっぷん", "or はちふん"],
          ["9 min", "きゅうふん"],
          ["10 min", "じゅっぷん", "or じっぷん"],
          ["15 min", "じゅうごふん"],
          ["20 min", "にじゅっぷん"],
          ["30 min", "さんじゅっぷん", "or はん"],
          ["9:18", "くじ じゅうはっぷん"],
          ["1:55", "いちじ ごじゅうごふん"],
        ],
      }],
      examples: [
        { jp: "いま なんじですか。", en: "What time is it now?" },
        { jp: "ごご よじはんです。", en: "It's 4:30 p.m." },
        { jp: "ソウルは いま ごぜん しちじです。", en: "It's 7 a.m. in Seoul now." },
        { jp: "でんわばんごうは ゼロはちゼロの にいさんよんの ごおろくななはちです。", en: "My number is 080-234-5678." },
      ],
      watch: ["ごぜん / ごご come before the time.", "よじ, しちじ, くじ, not よんじ, ななじ, きゅうじ."],
      life: "Timetables use the 24-hour clock (じゅうよじ = 14:00); in conversation people usually say ごご にじ.",
      checks: [
        {
          q: "9:00",
          choices: ["くじ", "きゅうじ", "きゅうじはん", "じゅうくじ"],
          answer: 0,
          why: "9 o'clock is くじ.",
        },
        {
          q: "3:30 p.m.",
          choices: ["ごご さんじはん", "さんじはん ごご", "ごぜん さんじはん", "ごご はんさんじ"],
          answer: 0,
          why: "p.m., hour, はん.",
        },
        {
          q: "How is the dash in a phone number read?",
          choices: ["の", "は", "と", "ばん"],
          answer: 0,
          why: "The dash is read の.",
        },
      ],
      games: ["clock", "minutes-clock", "phone-listen"],
      ask: ["How do I say 4:45?", "Is the 24-hour clock used in speech?"],
    },
    // ------------------------------------------------ names and titles
    {
      id: "names",
      kind: "culture",
      title: "なまえ・さん",
      name: "Names and titles",
      genki: "Genki pp. 44–45 · Expression Notes 2, Culture Notes",
      teach:
        "**Name order.** Family name first, then given name: やまもと はると. There are no middle names.\n\n" +
        "**さん** goes after a family or given name, for anyone except yourself. Children are usually ちゃん, boys often くん. Teachers, doctors and lawyers are addressed with **せんせい**: やまもとせんせい.\n\n" +
        "**あなた** is rarely used for someone whose name you know. Use name + さん, even when talking to them: ノアさんは カナダじんですか = \"Are you Canadian, Noah?\"\n\n" +
        "**あのう** before a question softens it, like \"um, excuse me…\".",
      examples: [
        { jp: "あのう、りゅうがくせいですか。", en: "Um, are you an international student?" },
        { jp: "やまもとせんせいは にほんじんです。", en: "Professor Yamamoto is Japanese." },
      ],
      watch: ["Calling your teacher あなた can sound rude. Use せんせい."],
      checks: [
        {
          q: "Asking Prof. Yamamoto if she's from Tokyo, you address her as:",
          choices: ["やまもとせんせいは…", "あなたは…", "やまもとさんは…", "やまもとちゃんは…"],
          answer: 0,
          why: "Name + せんせい.",
        },
        {
          q: "Japanese name order:",
          choices: ["family name, given name", "given name, family name", "given, middle, family", "any order"],
          answer: 0,
          why: "やまもと (family) はると (given).",
        },
      ],
      games: [],
      ask: ["How do I write my name in Japanese?", "When are ちゃん and くん used?"],
    },
  ],
  dialogues: [{
    title: "Conversation 1: orientation",
    setting: "Lena, an exchange student, meets Haruto at a welcome event. Min joins them.",
    lines: [
      { who: "はると", jp: "こんにちは。やまもと はるとです。", en: "Hi. I'm Haruto Yamamoto." },
      { who: "レナ", jp: "はじめまして。レナ・ミュラーです。", en: "How do you do? I'm Lena Müller." },
      { who: "はると", jp: "レナさんは りゅうがくせいですか。", en: "Are you an exchange student, Lena?" },
      { who: "レナ", jp: "はい、そうです。ドイツじんです。はるとさんは？", en: "Yes. I'm German. And you?" },
      { who: "はると", jp: "にほんじんです。さくらだいがくの さんねんせいです。", en: "I'm Japanese. A third-year at Sakura University." },
      { who: "レナ", jp: "そうですか。せんこうは なんですか。", en: "I see. What's your major?" },
      { who: "はると", jp: "れきしです。レナさんの せんこうは？", en: "History. And yours?" },
      { who: "レナ", jp: "にほんごです。いちねんせいです。", en: "Japanese. I'm a first-year." },
      { who: "ミン", jp: "あのう、すみません。いま なんじですか。", en: "Um, excuse me. What time is it?" },
      { who: "はると", jp: "ごご よじはんです。", en: "It's 4:30 p.m." },
      { who: "ミン", jp: "ありがとうございます。", en: "Thank you." },
    ],
  }, {
    title: "Conversation 2: introductions in class",
    setting: "On the first day of class, Professor Yamamoto asks the new students to introduce themselves.",
    lines: [
      { who: "せんせい", jp: "はじめまして。やまもとです。にほんごの せんせいです。", en: "How do you do? I'm Yamamoto. I teach Japanese." },
      { who: "せんせい", jp: "じゃあ、ノアさん、どうぞ。", en: "Noah, please go ahead." },
      { who: "ノア", jp: "はじめまして。ノア・ベルです。カナダじんです。", en: "How do you do? I'm Noah Bell. I'm Canadian." },
      { who: "ノア", jp: "トロントだいがくの いちねんせいです。せんこうは コンピューターです。", en: "I'm a first-year at the University of Toronto. My major is computer science." },
      { who: "ノア", jp: "じゅうはっさいです。よろしく おねがいします。", en: "I'm 18. Nice to meet you." },
      { who: "せんせい", jp: "ノアさんは いちねんせいですか。", en: "You're a first-year, Noah?" },
      { who: "ノア", jp: "はい、そうです。", en: "Yes, that's right." },
      { who: "せんせい", jp: "でんわばんごうは なんばんですか。", en: "What's your phone number?" },
      { who: "ノア", jp: "ゼロはちゼロの ごろくななはちの いちにさんよんです。", en: "080-5678-1234." },
      { who: "せんせい", jp: "ありがとう。じゃあ、ミンさん、どうぞ。", en: "Thanks. Min, go ahead." },
    ],
  }],
  together: ["self-intro"],
  test: [
    {
      q: "Someone says いってらっしゃい to you. What did you say first?",
      choices: ["いってきます", "ただいま", "おやすみなさい", "いただきます"],
      answer: 0,
      why: "いってらっしゃい answers いってきます.",
    },
    {
      q: "74",
      choices: ["ななじゅうよん", "しちじゅうし", "よんじゅうなな", "ななよんじゅう"],
      answer: 0,
      why: "7 × 10 + 4, with なな and よん.",
    },
    {
      q: "\"I'm a second-year student.\"",
      choices: ["にねんせいです。", "わたしは にねんせいさんです。", "にねんせいですか。", "わたしの にねんせいです。"],
      answer: 0,
      why: "No さん on yourself; わたしは optional.",
    },
    {
      q: "\"Min is a student at Seoul University.\"",
      jp: "ミンさんは ソウルだいがく＿ がくせいです。",
      choices: ["の", "は", "か", "じん"],
      answer: 0,
      why: "ソウルだいがくの がくせい.",
    },
    {
      q: "Which asks someone's year in school?",
      choices: ["なんねんせいですか。", "なんさいですか。", "なんじですか。", "なんばんですか。"],
      answer: 0,
      why: "〜ねんせい = …-year student.",
    },
    {
      q: "7:30",
      choices: ["しちじはん", "ななじはん", "しちじさんじゅう", "はんしちじ"],
      answer: 0,
      why: "しちじ + はん.",
    },
    {
      q: "\"a Japanese person\"",
      choices: ["にほんじん", "にほんご", "にほんの", "じんにほん"],
      answer: 0,
      why: "〜じん = person from.",
    },
    {
      q: "Which is pronounced differently from its spelling?",
      choices: ["the は in わたしは", "the か in ですか", "the の in わたしの", "the じ in いちじ"],
      answer: 0,
      why: "Particle は is read \"wa\".",
    },
    {
      q: "Reply to ありがとうございます:",
      choices: ["いいえ。", "はい、そうです。", "すみません。", "おかえりなさい。"],
      answer: 0,
      why: "いいえ = not at all.",
    },
    {
      q: "\"Haruto's mother\"",
      choices: ["はるとさんの おかあさん", "おかあさんの はるとさん", "はるとさんは おかあさん", "はるとの さん おかあさん"],
      answer: 0,
      why: "Main noun last.",
    },
    {
      q: "Where does ごご (p.m.) go?",
      choices: ["before the time", "after the time", "after です", "anywhere"],
      answer: 0,
      why: "ごご さんじ.",
    },
    {
      q: "\"She's 20.\" Most common form:",
      choices: ["はたちです。", "にじゅうさいです。", "にさいです。", "にじゅっさいです。"],
      answer: 0,
      why: "20 years old is はたち (にじゅっさい is also understood).",
    },
  ],
};

// ====================================================================
// Unit 2 · Genki Lesson 2 · かいもの (Shopping)
// ====================================================================

const L2: GenkiLesson = {
  id: "l2",
  num: 2,
  jp: "かいもの",
  en: "Shopping",
  pages: "Genki I pp. 56–81",
  goals: [
    "Ask and understand prices up to ¥99,999",
    "Point to things and places: これ・それ・あれ・どれ and the related words",
    "Buy things and order food",
    "Ask whose something is",
    "Say \"too\" (も) and \"is not\" (じゃないです)",
    "Use ね and よ",
  ],
  plan: [
    "1 · Big numbers and prices, vocabulary",
    "2 · Grammar 1–2: これ・それ・あれ・どれ, この・その・あの・どの",
    "3 · Grammar 3–4: ここ・そこ・あそこ・どこ, だれの",
    "4 · Grammar 5–7: も, じゃないです, ね / よ",
    "5 · Shopping and restaurant role plays, practice conversation, unit test",
  ],
  practice: [
    { title: "Listening", games: ["shop-listen", "prices-listen"] },
    { title: "Reading", games: ["reading-u2"] },
    { title: "Pointing words", games: ["kosoado-things", "kono-or-kore", "kosoado-places"] },
    { title: "Grammar", games: ["whose", "mo-or-wa", "negate", "ne-or-yo"] },
    { title: "Role plays", games: ["flea-market", "restaurant"] },
    { title: "Numbers, words and phrases", games: ["prices-read", "vocab-l2", "classroom-match"] },
  ],
  vocab: [
    {
      title: "Words that point",
      words: [
        { jp: "これ", en: "this one", star: true },
        { jp: "それ", en: "that one", star: true },
        { jp: "あれ", en: "that one (over there)", star: true },
        { jp: "どれ", en: "which one", star: true },
        { jp: "この", en: "this …" },
        { jp: "その", en: "that …", star: true },
        { jp: "あの", en: "that … (over there)", star: true },
        { jp: "どの", en: "which …" },
        { jp: "ここ", en: "here" },
        { jp: "そこ", en: "there" },
        { jp: "あそこ", en: "over there", star: true },
        { jp: "どこ", en: "where", star: true },
        { jp: "だれ", en: "who", star: true },
      ],
    },
    {
      title: "Food",
      words: [
        { jp: "おいしい", en: "delicious", star: true },
        { jp: "さかな", en: "fish", star: true },
        { jp: "とんかつ", en: "pork cutlet", star: true },
        { jp: "にく", en: "meat", star: true },
        { jp: "メニュー", en: "menu", star: true },
        { jp: "やさい", en: "vegetable" },
      ],
    },
    {
      title: "Things",
      words: [
        { jp: "かさ", en: "umbrella" },
        { jp: "かばん", en: "bag" },
        { jp: "くつ", en: "shoes" },
        { jp: "さいふ", en: "wallet", star: true },
        { jp: "ジーンズ", en: "jeans" },
        { jp: "じてんしゃ", en: "bicycle" },
        { jp: "しんぶん", en: "newspaper" },
        { jp: "スマホ", en: "smartphone" },
        { jp: "Tシャツ", en: "T-shirt" },
        { jp: "とけい", en: "watch, clock", star: true },
        { jp: "ノート", en: "notebook" },
        { jp: "ペン", en: "pen" },
        { jp: "ぼうし", en: "hat, cap" },
        { jp: "ほん", en: "book" },
      ],
    },
    {
      title: "Places",
      words: [
        { jp: "ぎんこう", en: "bank" },
        { jp: "コンビニ", en: "convenience store" },
        { jp: "トイレ", en: "toilet, restroom", star: true },
        { jp: "としょかん", en: "library" },
        { jp: "ゆうびんきょく", en: "post office" },
      ],
    },
    {
      title: "Countries",
      words: [
        { jp: "イギリス", en: "Britain" },
        { jp: "かんこく", en: "Korea" },
        { jp: "ちゅうごく", en: "China" },
      ],
    },
    {
      title: "Majors",
      words: [
        { jp: "えいご", en: "English (language)" },
        { jp: "けいざい", en: "economics" },
        { jp: "コンピューター", en: "computer" },
        { jp: "ビジネス", en: "business" },
        { jp: "れきし", en: "history" },
      ],
    },
    {
      title: "Family",
      words: [
        { jp: "おかあさん", en: "mother" },
        { jp: "おとうさん", en: "father" },
      ],
    },
    {
      title: "Money matters",
      words: [
        { jp: "いくら", en: "how much", star: true },
        { jp: "〜えん", en: "… yen", star: true },
        { jp: "たかい", en: "expensive; high", star: true },
      ],
    },
    {
      title: "In the classroom",
      extra: true,
      words: [
        { jp: "こくばん", en: "blackboard" },
        { jp: "つくえ", en: "desk" },
        { jp: "いす", en: "chair" },
        { jp: "ドア", en: "door" },
        { jp: "まど", en: "window" },
        { jp: "でんき", en: "light" },
        { jp: "じしょ", en: "dictionary" },
        { jp: "えんぴつ", en: "pencil" },
        { jp: "けしゴム", en: "eraser" },
      ],
    },
    {
      title: "Expressions",
      words: [
        { jp: "いらっしゃいませ", en: "Welcome (to our store)", star: true },
        { jp: "（〜を）おねがいします", en: "…, please", star: true },
        { jp: "（〜を）ください", en: "Please give me …", star: true },
        { jp: "じゃあ", en: "then…; if that is the case", star: true },
        { jp: "どうぞ", en: "Please. / Here it is.", star: true },
        { jp: "どうも", en: "Thank you.", star: true },
      ],
    },
  ],
  steps: [
    // ------------------------------------------------ warm-up: big numbers
    {
      id: "big-numbers",
      kind: "warmup",
      optional: true,
      title: "ひゃく・せん・まん",
      name: "Big numbers and prices",
      genki: "Genki pp. 65, 67 · Expression Notes 3, Practice I",
      teach:
        "Three more units: **ひゃく** (100), **せん** (1,000), **まん** (10,000). They combine like じゅう: さんびゃく = 3 × 100, ごせん = 5 × 1,000.\n\n" +
        "**Sound changes** to learn: 300 さんびゃく, 600 ろっぴゃく, 800 はっぴゃく, 3,000 さんぜん, 8,000 はっせん.\n\n" +
        "**10,000 is いちまん.** Unlike ひゃく and せん, まん keeps the いち. Large numbers are counted in units of 10,000: 20,000 is にまん (2 × 10,000), and 35,000 is さんまんごせん.\n\n" +
        "Yen is えん: ¥1,800 = せんはっぴゃくえん.",
      tables: [{
        caption: "Sound changes",
        rows: [
          ["300", "さんびゃく"],
          ["600", "ろっぴゃく"],
          ["800", "はっぴゃく"],
          ["3,000", "さんぜん"],
          ["8,000", "はっせん"],
          ["10,000", "いちまん"],
          ["20,000", "にまん"],
        ],
      }],
      examples: [
        { jp: "さんびゃくえん", en: "¥300" },
        { jp: "せんはっぴゃくえん", en: "¥1,800" },
        { jp: "いちまんにせんえん", en: "¥12,000" },
        { jp: "さんまんごせんえん", en: "¥35,000" },
      ],
      watch: ["Not さんひゃく, ろくひゃく, はちひゃく, さんせん, はちせん.", "100,000 is じゅうまん (10 × 10,000)."],
      uni: "Price listening is a typical Lesson 2 quiz item, and the sound changes are what it tests.",
      life: "Shop prices usually include tax. Small shops and restaurants are sometimes cash only.",
      checks: [
        {
          q: "¥600",
          choices: ["ろっぴゃくえん", "ろくひゃくえん", "ろっひゃくえん", "ろくびゃくえん"],
          answer: 0,
          why: "6 + ひゃく → ろっぴゃく.",
        },
        {
          q: "¥10,000",
          choices: ["いちまんえん", "まんえん", "じゅうせんえん", "いちせんえん"],
          answer: 0,
          why: "いちまん keeps the いち.",
        },
        {
          q: "¥3,800",
          choices: ["さんぜんはっぴゃくえん", "さんせんはちひゃくえん", "さんぜんはちひゃくえん", "さんせんはっぴゃくえん"],
          answer: 0,
          why: "さんぜん + はっぴゃく.",
        },
      ],
      games: ["prices-read", "prices-listen"],
      ask: ["Why is 300 さんびゃく?", "How do I read ¥150,000?"],
    },
    // ------------------------------------------------ grammar 1
    {
      id: "kore",
      kind: "grammar",
      title: "これ・それ・あれ・どれ",
      name: "Grammar 1 · this, that, which",
      genki: "Genki p. 60",
      teach:
        "**これ**: the thing near the speaker\n" +
        "**それ**: the thing near the listener\n" +
        "**あれ**: the thing far from both\n" +
        "**どれ**: which one?\n\n" +
        "The choice between それ and あれ depends on whose side the thing is on, not only on distance.\n\n" +
        "Because of this, a question and its answer often use different words. If someone points at the bag you're holding and asks **それは なんですか**, you answer **これは かばんです**.\n\n" +
        "These words stand alone, followed by は, が and so on: これは いくらですか.",
      pattern: [
        ["これは 〔X〕です。", "This (near me) is X."],
        ["それは 〔X〕ですか。", "Is that (near you) X?"],
        ["どれですか。", "Which one?"],
      ],
      examples: [
        { jp: "これは いくらですか。", en: "How much is this?" },
        { jp: "それは さんぜんえんです。", en: "That (by you) is 3,000 yen." },
        { jp: "あれは なんですか。", en: "What's that over there?" },
        { jp: "あれは としょかんです。", en: "That's the library." },
        { jp: "どれですか。", en: "Which one?" },
      ],
      watch: [
        "それ in a question often becomes これ in the answer, and the reverse.",
        "Don't use これ / それ / あれ for people who are present.",
        "Question words like どれ take が, not は: どれが ミンさんの かさですか. (Explained in Lesson 8.)",
      ],
      uni: "Quizzes use pictures with a speaker, a listener and an object. Decide whose side the object is on.",
      checks: [
        {
          q: "The umbrella is in your hand.",
          jp: "＿は いくらですか。",
          choices: ["これ", "それ", "あれ", "どれ"],
          answer: 0,
          why: "Near the speaker: これ.",
        },
        {
          q: "Your friend asks それは なんですか about the book you're holding. You answer:",
          choices: ["これは ほんです。", "それは ほんです。", "あれは ほんです。", "どれは ほんです。"],
          answer: 0,
          why: "From your side it's near you: これ.",
        },
        {
          q: "A building far from both of you:",
          choices: ["あれ", "それ", "これ", "どれ"],
          answer: 0,
          why: "Far from both: あれ.",
        },
      ],
      games: ["kosoado-things"],
      ask: ["それ or あれ: how do I decide?", "Why not これ for people?"],
    },
    // ------------------------------------------------ grammar 2
    {
      id: "kono",
      kind: "grammar",
      title: "この・その・あの・どの + Noun",
      name: "Grammar 2 · this watch, that bag",
      genki: "Genki p. 61",
      teach:
        "The の forms use the same map but must be followed by a noun: **この** とけい, **その** かばん, **あの** ひと, **どの** ほん.\n\n" +
        "Followed by は (or another particle): the れ word. Followed by a noun: the の word.\n" +
        "これは たかいです。 This is expensive.\n" +
        "このとけいは たかいです。 This watch is expensive.\n\n" +
        "The の forms can be used for people: あのひとは だれですか.",
      pattern: [
        ["この／その／あの 〔Noun〕", "this / that / that … over there"],
        ["どの 〔Noun〕が 〜ですか。", "Which … is …?"],
      ],
      examples: [
        { jp: "このとけいは いくらですか。", en: "How much is this watch?" },
        { jp: "そのかばんは ミンさんのです。", en: "That bag (by you) is Min's." },
        { jp: "あのひとは せんせいです。", en: "That person over there is a teacher." },
        { jp: "どのほんが いいですか。", en: "Which book is good?" },
      ],
      watch: ["このは and これの are both wrong."],
      checks: [
        {
          q: "Fill the gap.",
          jp: "＿とけいは いくらですか。",
          choices: ["この", "これ", "ここ", "これの"],
          answer: 0,
          why: "A noun follows: この.",
        },
        {
          q: "Fill the gap.",
          jp: "＿は いくらですか。",
          choices: ["これ", "この", "このの", "こ"],
          answer: 0,
          why: "は follows: これ.",
        },
        {
          q: "\"Who is that person over there?\"",
          choices: ["あのひとは だれですか。", "あれは だれですか。", "あのは だれですか。", "あそこは だれですか。"],
          answer: 0,
          why: "あの ひと for people.",
        },
      ],
      games: ["kono-or-kore"],
      ask: ["Can この be used for people?", "それ vs その?"],
    },
    // ------------------------------------------------ grammar 3
    {
      id: "koko",
      kind: "grammar",
      title: "ここ・そこ・あそこ・どこ",
      name: "Grammar 3 · here, there, where",
      genki: "Genki p. 62",
      teach:
        "The same map for places: **ここ** here (near me), **そこ** there (near you), **あそこ** over there, **どこ** where.\n\n" +
        "To ask where something is: **〔X〕は どこですか**. Answer by pointing: あそこです.\n\n" +
        "Together with Grammar 1 and 2 this is the こそあど system: こ near me, そ near you, あ far from both, ど which. It comes back in later lessons.",
      pattern: [
        ["〔X〕は どこですか。", "Where is X?"],
        ["〔X〕は あそこです。", "X is over there."],
      ],
      examples: [
        { jp: "すみません。トイレは どこですか。", en: "Excuse me, where's the restroom?" },
        { jp: "あそこです。", en: "Over there." },
        { jp: "ゆうびんきょくは どこですか。", en: "Where's the post office?" },
        { jp: "ここは としょかんです。", en: "This is the library." },
      ],
      watch: ["Places take ここ / そこ / あそこ, not これ / それ / あれ.", "Directions (left, right, in front of) are Lesson 4."],
      life: "The same question works in shops: くつは どこですか.",
      checks: [
        {
          q: "\"Where is the bank?\"",
          choices: ["ぎんこうは どこですか。", "ぎんこうは どれですか。", "ぎんこうは だれですか。", "ぎんこうは なんですか。"],
          answer: 0,
          why: "Places: どこ.",
        },
        {
          q: "The post office is far from both of you.",
          choices: ["あそこです。", "そこです。", "ここです。", "あれです。"],
          answer: 0,
          why: "A place far from both: あそこ.",
        },
      ],
      games: ["kosoado-places"],
      ask: ["Why あそこ and not あこ?", "How do I ask where something is in a shop?"],
    },
    // ------------------------------------------------ grammar 4
    {
      id: "dare-no",
      kind: "grammar",
      title: "だれの Noun",
      name: "Grammar 4 · whose",
      genki: "Genki p. 62",
      teach:
        "**だれ** is \"who\"; **だれの** is \"whose\": だれの かさですか.\n\n" +
        "Answer with the owner in the same place: ミンさんの かさです.\n\n" +
        "If the noun is clear, it can be dropped after の: これは わたしのです (\"This is mine\").",
      pattern: [
        ["これは だれの 〔Noun〕ですか。", "Whose … is this?"],
        ["〔Person〕の 〔Noun〕です。", "It's (person)'s …"],
      ],
      examples: [
        { jp: "これは だれの かさですか。", en: "Whose umbrella is this?" },
        { jp: "ノアさんの かさです。", en: "It's Noah's umbrella." },
        { jp: "そのペンは わたしのです。", en: "That pen is mine." },
      ],
      watch: ["だれ alone is \"who\": あのひとは だれですか."],
      checks: [
        {
          q: "\"Whose bag is this?\"",
          choices: ["これは だれの かばんですか。", "これは だれ かばんですか。", "これの だれは かばんですか。", "だれは これの かばんですか。"],
          answer: 0,
          why: "だれの + noun.",
        },
        {
          q: "\"That's mine.\" (by the listener)",
          choices: ["それは わたしのです。", "それは わたしです。", "それの わたしです。", "わたしは それのです。"],
          answer: 0,
          why: "わたしの = mine.",
        },
      ],
      games: ["whose"],
      ask: ["Can the noun always be dropped after の?"],
    },
    // ------------------------------------------------ grammar 5
    {
      id: "mo",
      kind: "grammar",
      title: "Noun も",
      name: "Grammar 5 · too, also",
      genki: "Genki pp. 62–63",
      teach:
        "**も** means \"too\" and **replaces は**. It goes right after the item that shares the fact.\n\n" +
        "ミンさんは にねんせいです。ノアさん**も** にねんせいです。\n" +
        "Min is a second-year. Noah is a second-year too.\n\n" +
        "If the second fact is different, keep は.\n\n" +
        "\"Me too\" is **わたしもです**.",
      pattern: [["A は X です。B も X です。", "A is X. B is X too."]],
      examples: [
        { jp: "このかさは たかいです。あのかさも たかいです。", en: "This umbrella is expensive. That one is expensive too." },
        { jp: "はるとさんは にほんじんです。おかあさんも にほんじんです。", en: "Haruto is Japanese. His mother is Japanese too." },
        { jp: "A: しゅっしんは ソウルです。 B: わたしもです。", en: "A: I'm from Seoul. B: Me too." },
      ],
      watch: ["も replaces は: never はも or もは.", "も goes after the shared item, not at the end of the sentence."],
      checks: [
        {
          q: "Lena is a first-year. Noah is a first-year too.",
          jp: "レナさんは いちねんせいです。ノアさん＿ いちねんせいです。",
          choices: ["も", "は", "の", "か"],
          answer: 0,
          why: "Same fact: も.",
        },
        {
          q: "Lena is a first-year. Min is a second-year.",
          jp: "レナさんは いちねんせいです。ミンさん＿ にねんせいです。",
          choices: ["は", "も", "の", "か"],
          answer: 0,
          why: "Different fact: は.",
        },
      ],
      games: ["mo-or-wa"],
      ask: ["Can も go after things other than people?", "How do I say 'me neither'?"],
    },
    // ------------------------------------------------ grammar 6
    {
      id: "janai",
      kind: "grammar",
      title: "Noun じゃないです",
      name: "Grammar 6 · is not",
      genki: "Genki pp. 63–64",
      teach:
        "To negate X は Y です when Y is a noun, replace です with **じゃないです**: がくせい**じゃないです** (I'm not a student).\n\n" +
        "Two other forms mean the same, in more formal styles:\n" +
        "**じゃありません**: polite, more conservative\n" +
        "**ではありません**: formal, used in writing\n\n" +
        "Answering no: いいえ、にほんじんじゃないです。カナダじんです。\n\n" +
        "This only works after nouns. たかい and おいしい are adjectives; their negative is in Lesson 5.",
      pattern: [
        ["〔X〕は 〔Y〕じゃないです。", "X is not Y. (spoken)"],
        ["〔X〕は 〔Y〕ではありません。", "X is not Y. (written)"],
      ],
      examples: [
        { jp: "はるとさんは りゅうがくせいじゃないです。", en: "Haruto isn't an international student." },
        { jp: "いいえ、さかなじゃないです。にくです。", en: "No, it's not fish. It's meat." },
        { jp: "わたしは せんせいではありません。", en: "I am not a teacher. (formal)" },
      ],
      watch: ["じゃないです needs its noun: not いいえ、じゃないです.", "たかいじゃないです is wrong (Lesson 5)."],
      uni: "Written homework often expects ではありません, speaking じゃないです. Check what your course uses.",
      checks: [
        {
          q: "\"Ms. Yamamoto isn't a student.\"",
          choices: ["やまもとさんは がくせいじゃないです。", "やまもとさんは がくせいないです。", "やまもとさんは じゃないです がくせい。", "やまもとさんは がくせいですじゃない。"],
          answer: 0,
          why: "Noun + じゃないです.",
        },
        {
          q: "The formal, written form:",
          choices: ["ではありません", "じゃないです", "じゃありません", "ないです"],
          answer: 0,
          why: "ではありません.",
        },
        {
          q: "\"Is that fish?\" It's meat.",
          choices: ["いいえ、さかなじゃないです。にくです。", "いいえ、じゃないです。", "はい、さかなじゃないです。", "いいえ、にくじゃないです。"],
          answer: 0,
          why: "Deny, then correct.",
        },
      ],
      games: ["negate"],
      ask: ["Why not たかいじゃないです?", "Which negative do I use with my teacher?"],
    },
    // ------------------------------------------------ grammar 7
    {
      id: "ne-yo",
      kind: "grammar",
      title: "〜ね・〜よ",
      name: "Grammar 7 · ね and よ",
      genki: "Genki p. 64",
      teach:
        "**ね** asks for agreement or confirmation, like \"…, right?\": おいしいですね.\n\n" +
        "**よ** tells the listener something they don't know, like \"you know\": とんかつは にくですよ.\n\n" +
        "If the listener already knows or shares it, use ね. If it's new to them, use よ.",
      pattern: [
        ["〜ですね。", "…, isn't it?"],
        ["〜ですよ。", "…, you know."],
      ],
      examples: [
        { jp: "このラーメン、おいしいですね。", en: "This ramen is good, isn't it?" },
        { jp: "あれは ぎんこうじゃないですよ。ゆうびんきょくですよ。", en: "That's not a bank. It's the post office." },
        { jp: "ミンさんの せんこうは けいざいですね。", en: "Your major is economics, right, Min?" },
      ],
      watch: ["Using よ a lot can sound pushy."],
      checks: [
        {
          q: "You and a friend are both eating; it's good.",
          jp: "おいしいです＿。",
          choices: ["ね", "よ", "か", "の"],
          answer: 0,
          why: "Shared: ね.",
        },
        {
          q: "Your friend thinks the shop is closed. It's open today.",
          jp: "きょうは だいじょうぶです＿。",
          choices: ["よ", "ね", "か", "も"],
          answer: 0,
          why: "New to them: よ.",
        },
      ],
      games: ["ne-or-yo"],
      ask: ["Is よ rude?", "ですね vs そうですね?"],
    },
    // ------------------------------------------------ shopping phrases
    {
      id: "shopping",
      kind: "expressions",
      title: "かいもの・レストラン",
      name: "Shops and restaurants",
      genki: "Genki pp. 56–57, 65–66 · Dialogues, Expression Notes 3, Culture Notes",
      teach:
        "**いくらですか**: How much is it?\n" +
        "**〔X〕を ください**: Please give me X. Used for things in a shop.\n" +
        "**〔X〕を おねがいします**: X, please. Slightly more polite; the usual way to order food.\n" +
        "**じゃあ**: Well then. Said when you decide.\n\n" +
        "Staff say **いらっしゃいませ** when you enter and **どうぞ** when they hand you something. Customers don't answer いらっしゃいませ; a short **どうも** is enough for どうぞ.\n\n" +
        "Coins: ¥1, 5, 10, 50, 100, 500. Notes: ¥1,000, 5,000, 10,000 (¥2,000 exists but is rare).",
      examples: [
        { jp: "すみません。このTシャツは いくらですか。", en: "Excuse me, how much is this T-shirt?" },
        { jp: "にせんえんです。", en: "It's 2,000 yen." },
        { jp: "じゃあ、これを ください。", en: "Then I'll take this one." },
        { jp: "コーヒーを おねがいします。", en: "A coffee, please." },
      ],
      watch: ["を after the item: ペンを ください. を is read \"o\"."],
      checks: [
        {
          q: "Ordering in a restaurant:",
          choices: ["カレーを おねがいします。", "カレーです。", "カレーは どこですか。", "カレーの ください。"],
          answer: 0,
          why: "〜を おねがいします.",
        },
        {
          q: "The waiter hands you the menu with どうぞ. You say:",
          choices: ["どうも。", "いらっしゃいませ。", "いってきます。", "ただいま。"],
          answer: 0,
          why: "どうも = thanks.",
        },
      ],
      games: ["flea-market", "restaurant"],
      ask: ["Is ください rude in a shop?", "How do I ask for the bill?"],
    },
    // ------------------------------------------------ warm-up: classroom
    {
      id: "classroom",
      kind: "warmup",
      optional: true,
      title: "きょうしつ",
      name: "Classroom phrases",
      genki: "Genki p. 81 · Useful Expressions",
      teach:
        "Learn these as set phrases; the 〜てください form inside them is Lesson 6.\n\n" +
        "The ones you'll need most as a student: **わかりません**, **もういちど いってください**, **ゆっくり いってください**.",
      tables: [{
        caption: "Phrases",
        rows: [
          ["Do you understand?", "わかりましたか。"],
          ["I understand.", "わかりました。"],
          ["I don't understand.", "わかりません。"],
          ["Please say it slowly.", "ゆっくり いってください。"],
          ["Please say it again.", "もういちど いってください。"],
          ["Please wait a moment.", "ちょっと まってください。"],
          ["Please listen.", "きいてください。"],
          ["Please look at page 10.", "じゅっページを みてください。"],
        ],
      }, {
        caption: "In the classroom",
        rows: [
          ["blackboard", "こくばん"],
          ["desk", "つくえ"],
          ["chair", "いす"],
          ["door", "ドア"],
          ["window", "まど"],
          ["light", "でんき"],
          ["curtain", "カーテン"],
          ["dictionary", "じしょ"],
          ["pencil", "えんぴつ"],
          ["eraser", "けしゴム"],
          ["book", "ほん"],
        ],
      }],
      checks: [
        {
          q: "You didn't catch what the teacher said.",
          choices: ["もういちど いってください。", "わかりました。", "きいてください。", "ちょっと まってください。"],
          answer: 0,
          why: "もういちど = once more.",
        },
      ],
      games: ["classroom-match"],
      ask: ["How do I ask what a word means?"],
    },
  ],
  dialogues: [{
    title: "Conversation 1: flea market",
    setting: "Lena and Min look around a flea market on Saturday.",
    lines: [
      { who: "みせのひと", jp: "いらっしゃいませ。", en: "Welcome." },
      { who: "レナ", jp: "すみません。そのぼうしは いくらですか。", en: "Excuse me, how much is that hat?" },
      { who: "みせのひと", jp: "これですか。せんにひゃくえんです。", en: "This one? 1,200 yen." },
      { who: "レナ", jp: "あのかばんも いくらですか。", en: "And how much is that bag over there?" },
      { who: "みせのひと", jp: "あれは はっせんえんです。", en: "That's 8,000 yen." },
      { who: "ミン", jp: "たかいですね。", en: "That's expensive." },
      { who: "レナ", jp: "じゃあ、そのぼうしを ください。", en: "Then I'll take the hat." },
      { who: "ミン", jp: "あれ？ これは だれの さいふですか。", en: "Huh? Whose wallet is this?" },
      { who: "レナ", jp: "あっ、わたしのです。ありがとう！", en: "Oh, it's mine. Thanks!" },
    ],
  }, {
    title: "Conversation 2: lunch",
    setting: "After the market they go to a small restaurant.",
    lines: [
      { who: "てんいん", jp: "いらっしゃいませ。メニューを どうぞ。", en: "Welcome. Here's the menu." },
      { who: "ミン", jp: "どうも。これは なんですか。", en: "Thanks. What's this?" },
      { who: "てんいん", jp: "それは うどんです。おいしいですよ。", en: "That's udon. It's good." },
      { who: "ミン", jp: "じゃあ、これを おねがいします。", en: "Then this, please." },
      { who: "レナ", jp: "わたしも うどんを おねがいします。", en: "Udon for me too, please." },
      { who: "レナ", jp: "あのう、すみません。トイレは どこですか。", en: "Um, excuse me. Where's the restroom?" },
      { who: "てんいん", jp: "あそこです。", en: "Over there." },
      { who: "レナ", jp: "どうも。", en: "Thanks." },
    ],
  }],
  together: ["flea-market", "restaurant"],
  test: [
    {
      q: "The pen is in your friend's hand. \"Is that your pen?\"",
      jp: "＿は ミンさんの ペンですか。",
      choices: ["それ", "これ", "あれ", "その"],
      answer: 0,
      why: "Near the listener, standing alone: それ.",
    },
    {
      q: "¥800",
      choices: ["はっぴゃくえん", "はちひゃくえん", "はっひゃくえん", "はちびゃくえん"],
      answer: 0,
      why: "はっぴゃく.",
    },
    {
      q: "\"How much is this bag?\"",
      choices: ["このかばんは いくらですか。", "これかばんは いくらですか。", "このは かばん いくらですか。", "かばんは このいくらですか。"],
      answer: 0,
      why: "この + noun.",
    },
    {
      q: "\"Excuse me, where's the restroom?\"",
      choices: ["すみません。トイレは どこですか。", "すみません。トイレは どれですか。", "すみません。トイレは なんですか。", "すみません。トイレを ください。"],
      answer: 0,
      why: "Places: どこ.",
    },
    {
      q: "\"Whose umbrella is this?\"",
      choices: ["これは だれの かさですか。", "これは だれ かさですか。", "これは だれですか かさ。", "だれは これの かさですか。"],
      answer: 0,
      why: "だれの + noun.",
    },
    {
      q: "Haruto is Japanese. His father is Japanese too.",
      jp: "おとうさん＿ にほんじんです。",
      choices: ["も", "は", "の", "を"],
      answer: 0,
      why: "Same fact: も.",
    },
    {
      q: "\"I'm not an international student.\"",
      choices: ["りゅうがくせいじゃないです。", "りゅうがくせいないです。", "りゅうがくせいですじゃない。", "じゃないです りゅうがくせい。"],
      answer: 0,
      why: "Noun + じゃないです.",
    },
    {
      q: "You tell a lost tourist: the bank is over there.",
      jp: "ぎんこうは あそこです＿。",
      choices: ["よ", "ね", "か", "も"],
      answer: 0,
      why: "New information: よ.",
    },
    {
      q: "¥35,000",
      choices: ["さんまんごせんえん", "さんじゅうごせんえん", "さんまんごひゃくえん", "さんぜんごまんえん"],
      answer: 0,
      why: "3 × 10,000 + 5 × 1,000.",
    },
    {
      q: "Ordering food:",
      choices: ["ラーメンを おねがいします。", "ラーメンは ください。", "ラーメンです か。", "ラーメンの おねがいします。"],
      answer: 0,
      why: "〜を おねがいします.",
    },
    {
      q: "Which is the written-style negative?",
      choices: ["がくせいではありません。", "がくせいじゃないです。", "がくせいじゃありません。", "がくせいないです。"],
      answer: 0,
      why: "ではありません.",
    },
    {
      q: "Your friend points at the T-shirt you're wearing: それは どこの Tシャツですか. Your answer starts:",
      choices: ["これは…", "それは…", "あれは…", "どれは…"],
      answer: 0,
      why: "It's on your side: これ.",
    },
  ],
};

export const GENKI_LESSONS: GenkiLesson[] = [L1, L2, L3, L4];

/** Every lesson in Genki I, for the unit list; the first four are built. */
export const GENKI_MAP: { num: number; jp: string; en: string; topics: string }[] = [
  { num: 1, jp: "あたらしいともだち", en: "New Friends", topics: "Greetings · numbers · X は Y です · か · の · time" },
  { num: 2, jp: "かいもの", en: "Shopping", topics: "こそあど · だれの · も · じゃないです · ね/よ · prices" },
  { num: 3, jp: "デートのやくそく", en: "Making a Date", topics: "Verbs (ます) · を で に へ · time words · 〜ませんか · frequency" },
  { num: 4, jp: "はじめてのデート", en: "The First Date", topics: "あります/います · location words · past tense · も with particles · と" },
  { num: 5, jp: "おきなわりょこう", en: "A Trip to Okinawa", topics: "い/な adjectives · すき/きらい · 〜ましょう · counting" },
  { num: 6, jp: "ロバートさんのいちにち", en: "A Day in Robert's Life", topics: "て-form · てください · てもいい · てはいけない · から" },
  { num: 7, jp: "かぞくのしゃしん", en: "Family Picture", topics: "〜ている · describing people · adjective て-forms · counting people" },
  { num: 8, jp: "バーベキュー", en: "Barbecue", topics: "Short forms · と思います · と言っていました · ないでください · が" },
  { num: 9, jp: "かぶき", en: "Kabuki", topics: "Past short forms · noun-modifying clauses · もう/まだ · から" },
  { num: 10, jp: "ふゆやすみのよてい", en: "Winter Vacation Plans", topics: "Comparisons · つもり · なる · どこかに/どこにも · で (means)" },
  { num: 11, jp: "やすみのあと", en: "After the Vacation", topics: "〜たい · 〜たり〜たりする · 〜ことがある · や" },
  { num: 12, jp: "びょうき", en: "Feeling Ill", topics: "〜んです · すぎる · ほうがいい · ので · なければいけない · でしょうか" },
];
