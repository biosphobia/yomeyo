/**
 * The Genki companion: a teacher's guide that walks beside Genki I (3rd
 * edition), lesson by lesson.
 *
 * Genki is written for a classroom. Half of every practice section is pair
 * work, the grammar notes are short, and the "why" is left for the teacher
 * to say out loud. This course is that teacher: it follows the book's order
 * and points at its pages, but every explanation, example sentence,
 * dialogue and drill here is written fresh for the app. Nothing is copied
 * from the book; it is meant to be used WITH it, not instead of it.
 *
 * The cast is our own too: レナ (Lena, a first-year from Germany), はると
 * (Haruto, a Japanese third-year), ミン (Min, a Korean second-year), ノア
 * (Noah, a Canadian), and やまもとせんせい, their teacher.
 *
 * Everything is kana, as in Genki lessons 1 and 2. Romaji is a toggle on
 * screen, computed, never stored.
 *
 * Steps marked `optional` (greetings, numbers, the classroom phrases) are
 * warm-ups: worth a few minutes, never in the way. A lesson counts as done
 * when its test is passed; nothing is ever locked.
 */

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
  en: string;
  /** Appears in the lesson's main conversation, so worth learning first. */
  star?: boolean;
}

export interface VocabGroup {
  title: string;
  /** "Make it yours" words: learn the ones that describe your life. */
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
  /** Warm-ups never count against finishing a lesson. */
  optional?: boolean;
  /** The pattern as Genki prints it: "X は Y です". */
  title: string;
  /** What it does, in plain words. */
  name: string;
  /** Where to look in the book. */
  genki: string;
  /** The teacher talking. Blank lines split paragraphs; **bold** works. */
  teach: string;
  /** The pattern box: a template and what it means. */
  pattern?: [jp: string, en: string][];
  examples?: GenkiExample[];
  table?: GenkiTable;
  /** The mistakes students actually make. */
  watch?: string[];
  /** What a university class will expect. */
  uni?: string;
  /** How it sounds outside the classroom. */
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
  num: number;
  jp: string;
  en: string;
  /** Book pages the lesson spans. */
  pages: string;
  /** "By the end you can…" */
  goals: string[];
  /** The teacher's opening words. */
  intro: string;
  /** A suggested week, for a class that meets daily or a self-studier. */
  plan: string[];
  vocab: VocabGroup[];
  steps: GenkiStep[];
  /** An original scene using everything, read and shadowed at the end. */
  dialogue: GenkiDialogue;
  /** Games for the "put it together" stage. */
  together: string[];
  test: GenkiCheck[];
}

// ====================================================================
// Lesson 1 — あたらしいともだち (New Friends)
// ====================================================================

const L1: GenkiLesson = {
  id: "l1",
  num: 1,
  jp: "あたらしいともだち",
  en: "New Friends",
  pages: "Genki I pp. 30–55 (greetings and numbers pp. 30–35, the lesson pp. 36–55)",
  goals: [
    "Greet people properly at any time of day, at home and at school",
    "Count from 0 to 100",
    "Introduce yourself: name, where you're from, school, year, major, age",
    "Ask other people the same things, and understand their answers",
    "Tell the time and give a phone number",
  ],
  intro:
    "Lesson 1 is small on paper (three grammar points) but it is the floor everything else stands on. " +
    "By Friday you should be able to walk into a room of strangers and get through the first two minutes " +
    "of conversation entirely in Japanese.\n\n" +
    "Genki assumes a teacher will explain why the sentences work. That is my job here. Read a step, " +
    "answer its quick check, play its game if you want more, and move on. The warm-ups are optional; if " +
    "you already know your greetings and numbers, skip straight to vocabulary.",
  plan: [
    "Day 1 · Greetings and numbers warm-ups (10–15 min each) · start the vocabulary",
    "Day 2 · Vocabulary again · X は Y です",
    "Day 3 · Questions with か · the の link",
    "Day 4 · Time and phone numbers · names and politeness",
    "Day 5 · The conversation, your own self-introduction, then the lesson test",
  ],
  vocab: [
    {
      title: "School",
      words: [
        { jp: "だいがく", en: "university, college", star: true },
        { jp: "こうこう", en: "high school" },
        { jp: "がくせい", en: "student", star: true },
        { jp: "だいがくせい", en: "university student" },
        { jp: "りゅうがくせい", en: "international (exchange) student", star: true },
        { jp: "せんせい", en: "teacher, professor" },
        { jp: "〜ねんせい", en: "…-year student", star: true },
        { jp: "いちねんせい", en: "first-year student" },
        { jp: "せんこう", en: "major (subject)", star: true },
      ],
    },
    {
      title: "People",
      words: [
        { jp: "わたし", en: "I, me" },
        { jp: "ともだち", en: "friend" },
        { jp: "〜さん", en: "Mr./Ms. … (never for yourself)" },
        { jp: "〜じん", en: "a person from …", star: true },
        { jp: "にほんじん", en: "a Japanese person" },
      ],
    },
    {
      title: "Time",
      words: [
        { jp: "いま", en: "now" },
        { jp: "ごぜん", en: "a.m. (comes before the time)" },
        { jp: "ごご", en: "p.m. (comes before the time)" },
        { jp: "〜じ", en: "… o'clock" },
        { jp: "いちじ", en: "one o'clock" },
        { jp: "はん", en: "half (past)" },
        { jp: "にじはん", en: "half past two" },
      ],
    },
    {
      title: "Everything else",
      words: [
        { jp: "にほん", en: "Japan", star: true },
        { jp: "アメリカ", en: "the USA" },
        { jp: "〜ご", en: "… language", star: true },
        { jp: "にほんご", en: "Japanese (the language)" },
        { jp: "〜さい", en: "… years old", star: true },
        { jp: "でんわ", en: "telephone" },
        { jp: "〜ばん", en: "number …" },
        { jp: "ばんごう", en: "number" },
        { jp: "なまえ", en: "name" },
        { jp: "なん／なに", en: "what", star: true },
      ],
    },
    {
      title: "Little words you'll say constantly",
      words: [
        { jp: "あのう", en: "um… (polite hesitation)", star: true },
        { jp: "はい", en: "yes" },
        { jp: "そうです", en: "that's right" },
        { jp: "そうですか", en: "I see / oh, really?", star: true },
      ],
    },
    {
      title: "Where you're from",
      extra: true,
      words: [
        { jp: "アメリカ", en: "the USA" },
        { jp: "イギリス", en: "the UK" },
        { jp: "カナダ", en: "Canada" },
        { jp: "オーストラリア", en: "Australia" },
        { jp: "ドイツ", en: "Germany" },
        { jp: "フランス", en: "France" },
        { jp: "かんこく", en: "South Korea" },
        { jp: "ちゅうごく", en: "China" },
        { jp: "ベトナム", en: "Vietnam" },
        { jp: "インド", en: "India" },
        { jp: "ブラジル", en: "Brazil" },
        { jp: "トルコ", en: "Türkiye" },
      ],
    },
    {
      title: "What you study",
      extra: true,
      words: [
        { jp: "けいざい", en: "economics" },
        { jp: "れきし", en: "history" },
        { jp: "ぶんがく", en: "literature" },
        { jp: "こうがく", en: "engineering" },
        { jp: "せいじ", en: "politics" },
        { jp: "コンピューター", en: "computer science" },
        { jp: "ビジネス", en: "business" },
        { jp: "いがく", en: "medicine" },
        { jp: "ほうがく", en: "law" },
        { jp: "しんりがく", en: "psychology" },
        { jp: "すうがく", en: "mathematics" },
        { jp: "えいご", en: "English" },
      ],
    },
    {
      title: "Family and jobs",
      extra: true,
      words: [
        { jp: "おかあさん", en: "(someone's) mother" },
        { jp: "おとうさん", en: "(someone's) father" },
        { jp: "おにいさん", en: "older brother" },
        { jp: "おねえさん", en: "older sister" },
        { jp: "いもうと", en: "younger sister" },
        { jp: "おとうと", en: "younger brother" },
        { jp: "かいしゃいん", en: "office worker" },
        { jp: "いしゃ", en: "doctor" },
        { jp: "こうこうせい", en: "high-school student" },
        { jp: "だいがくいんせい", en: "graduate student" },
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
      name: "Greetings for every part of the day",
      genki: "Genki pp. 30–34 · Greetings, Culture Notes, Expression Notes 1",
      teach:
        "Japanese greetings are less about the words and more about the **moment**: what time it is, who " +
        "you're talking to, and whether someone is leaving or coming home. Learn them as pairs of " +
        "situation + phrase, not as a vocabulary list.\n\n" +
        "**Two levels of politeness.** Several greetings have a short form for friends and family and a " +
        "longer one for everyone else: おはよう / おはようございます, ありがとう / ありがとうございます. " +
        "A good rule: if you'd call them by their first name, the short one is fine. Teachers, staff, " +
        "strangers and anyone older get the long one.\n\n" +
        "**Leaving and coming home** come in pairs that the two sides say to each other. The one leaving " +
        "says いってきます (\"I'll go and come back\"), the family answers いってらっしゃい. Coming home, " +
        "you say ただいま and they answer おかえりなさい.\n\n" +
        "**Meals.** いただきます before you eat, ごちそうさまでした after. Say them even when eating alone; " +
        "people do.\n\n" +
        "**Goodbye.** さようなら is real Japanese, but it sounds final, almost like \"farewell\". " +
        "Between friends who'll meet again soon, じゃあ、また is the everyday goodbye. Leaving a " +
        "professor's office, say しつれいします.",
      examples: [
        { jp: "おはようございます。", en: "Good morning. (polite)" },
        { jp: "こんにちは。", en: "Hello. / Good afternoon.", note: "The last sound is written は but said \"wa\"." },
        { jp: "こんばんは。", en: "Good evening." },
        { jp: "すみません。", en: "Excuse me. / Sorry. / Thanks (for the trouble)." },
        { jp: "いいえ。", en: "No. / Not at all (when someone thanks you)." },
        { jp: "はじめまして。レナです。よろしくおねがいします。", en: "Nice to meet you. I'm Lena. Please treat me well." },
      ],
      table: {
        caption: "The pairs",
        rows: [
          ["Leaving home (you)", "いってきます"],
          ["…and the family", "いってらっしゃい"],
          ["Back home (you)", "ただいま"],
          ["…and the family", "おかえりなさい"],
          ["Before eating", "いただきます"],
          ["After eating", "ごちそうさまでした"],
          ["Going to bed", "おやすみなさい"],
        ],
      },
      watch: [
        "こんにちは and こんばんは end in は, pronounced \"wa\". Writing こんにちわ is a classic beginner mistake that teachers mark wrong.",
        "Don't say こんにちは to your own family at home. It sounds like you're greeting a neighbour.",
        "すみません is not only \"sorry\". You'll use it most to call a waiter or get past someone.",
      ],
      uni: "Expect a short oral check where the teacher describes a situation in English and you say the right phrase. Spelling こんにちは / こんばんは with は is a common written-quiz item.",
      life: "Shop staff will say いらっしゃいませ when you walk in. You don't reply to it; a small nod is plenty.",
      checks: [
        {
          q: "You're leaving your host family's house for class. What do YOU say?",
          choices: ["いってきます", "いってらっしゃい", "ただいま", "おかえりなさい"],
          answer: 0,
          why: "いってきます is the one leaving. The family answers いってらっしゃい.",
        },
        {
          q: "It's 9 a.m. and you meet your professor in the corridor.",
          choices: ["おはようございます", "おはよう", "こんばんは", "おやすみなさい"],
          answer: 0,
          why: "Morning + someone you'd call by title = the long, polite form.",
        },
        {
          q: "A stranger holds the door and you thank them. They reply:",
          choices: ["いいえ。", "すみません。", "いただきます。", "ただいま。"],
          answer: 0,
          why: "いいえ here means \"not at all, don't mention it\".",
        },
      ],
      games: ["greet-situations"],
      ask: ["When can I use さようなら without sounding dramatic?", "Is すみません or ごめんなさい better for apologizing?"],
    },
    // ------------------------------------------------ warm-up: numbers
    {
      id: "numbers",
      kind: "warmup",
      optional: true,
      title: "すうじ",
      name: "Numbers from 0 to 100",
      genki: "Genki p. 35 · Numbers; Expression Notes 2 (p. 44)",
      teach:
        "Good news: Japanese numbers are completely regular once you know 1 to 10. " +
        "Eleven is \"ten one\" (じゅういち), twenty is \"two ten\" (にじゅう), forty-five is \"four ten five\" " +
        "(よんじゅうご). That's the whole system up to 99.\n\n" +
        "Bad news: **4, 7 and 9 have two readings each.** For plain counting and most numbers, use " +
        "**よん, なな, きゅう**. The other readings (し, しち, く) show up in fixed words you'll learn as " +
        "you go, most importantly the clock: four o'clock is よじ, seven o'clock is しちじ, nine o'clock is くじ.\n\n" +
        "Zero is ゼロ in everyday speech; れい is more formal and appears in weather forecasts and scores.",
      table: {
        caption: "The ten you need",
        rows: [
          ["0", "ゼロ／れい"],
          ["1", "いち"],
          ["2", "に"],
          ["3", "さん"],
          ["4", "よん／し", "use よん"],
          ["5", "ご"],
          ["6", "ろく"],
          ["7", "なな／しち", "use なな"],
          ["8", "はち"],
          ["9", "きゅう／く", "use きゅう"],
          ["10", "じゅう"],
          ["11", "じゅういち", "ten + one"],
          ["20", "にじゅう", "two tens"],
          ["45", "よんじゅうご", "four tens + five"],
          ["100", "ひゃく"],
        ],
      },
      watch: [
        "Don't say いちじゅう for 10 or いちひゃく for 100. Ten and a hundred stand alone: じゅう, ひゃく.",
        "40, 70 and 90 are よんじゅう, ななじゅう, きゅうじゅう. The し/しち/く readings are not used for the tens.",
      ],
      uni: "Numbers come back in every lesson: prices (L2), times (L1, L3), dates (L4), counters (L5 onwards). A few minutes a day now pays off for months.",
      checks: [
        {
          q: "How do you read 47?",
          choices: ["よんじゅうなな", "しじゅうしち", "よんななじゅう", "しちじゅうよん"],
          answer: 0,
          why: "Four tens (よんじゅう) + seven (なな).",
        },
        {
          q: "How do you read 90?",
          choices: ["きゅうじゅう", "くじゅう", "じゅうきゅう", "きゅうひゃく"],
          answer: 0,
          why: "Nine tens. じゅうきゅう would be 19.",
        },
        {
          q: "Which is 100?",
          choices: ["ひゃく", "いちひゃく", "じゅうじゅう", "せん"],
          answer: 0,
          why: "One hundred is just ひゃく. せん is 1,000.",
        },
      ],
      games: ["numbers-read", "numbers-listen"],
      ask: ["Why does 4 have two readings?", "When do people say れい instead of ゼロ?"],
    },
    // ------------------------------------------------ grammar 1
    {
      id: "wa-desu",
      kind: "grammar",
      title: "X は Y です",
      name: "Saying what something or someone is",
      genki: "Genki p. 41 · Grammar 1; Expression Notes 2 (pp. 44–45)",
      teach:
        "**です** is the polite way to say \"is / am / are\" after a noun. がくせいです. \"(I) am a student.\" " +
        "That's already a complete, polite sentence.\n\n" +
        "Notice there's no \"I\" in it. Japanese leaves out anything the listener can already guess, and " +
        "in a conversation about you, \"you\" is obvious. Getting comfortable with sentences that have no " +
        "subject is one of the biggest mindset shifts in Japanese.\n\n" +
        "When you DO need to say what you're talking about, put it in front and mark it with **は**: " +
        "わたしは がくせいです. Think of は as \"as for…\": \"As for me, (I) am a student.\" It sets the " +
        "topic; everything after it is about that topic.\n\n" +
        "Two spelling notes. The particle は is **pronounced \"wa\"** but always **written は**. And " +
        "Japanese has no \"a\" or \"the\" and usually no plural: がくせい can be \"a student\", \"the " +
        "student\" or \"students\". Context decides.",
      pattern: [
        ["〔X〕は 〔Y〕です。", "As for X, (it) is Y. → X is Y."],
        ["〔Y〕です。", "(It) is Y. (when X is obvious)"],
      ],
      examples: [
        { jp: "わたしは レナです。", en: "I'm Lena." },
        { jp: "レナさんは ドイツじんです。", en: "Lena is German." },
        { jp: "はるとさんは さんねんせいです。", en: "Haruto is a third-year student." },
        { jp: "せんこうは れきしです。", en: "(My) major is history.", note: "\"My\" is understood. Nobody says it." },
        { jp: "いちねんせいです。", en: "(I'm) a first-year." },
      ],
      watch: [
        "Never put さん after your own name. わたしは レナさんです sounds like you're very impressed with yourself.",
        "Don't start every sentence with わたしは. Say it once to set the topic, then drop it. Repeating it sounds stiff and foreign.",
        "Avoid あなた (\"you\") with people you know. Use their name + さん: ミンさんは かんこくじんですか.",
        "Nationality is 〜じん, language is 〜ご: にほんじん = a Japanese person, にほんご = Japanese language.",
        "Don't call yourself せんせい. It's a title of respect for others.",
      ],
      uni: "Your first oral exam is almost always a self-introduction built from X は Y です. Teachers listen for: は pronounced \"wa\", no さん on yourself, and not repeating わたしは.",
      life: "In real conversation people drop は too: \"せんこう、なに？\" Fine with friends; in class keep it.",
      checks: [
        {
          q: "Choose the natural way to say \"I'm Noah.\"",
          choices: ["ノアです。", "ノアさんです。", "あなたは ノアです。", "ノアは です。"],
          answer: 0,
          why: "No さん for yourself, and わたしは can be left out entirely.",
        },
        {
          q: "How is the は in わたしは pronounced?",
          choices: ["wa", "ha", "ba", "a"],
          answer: 0,
          why: "As a particle it's always \"wa\", even though it's written は.",
        },
        {
          q: "\"Min is Korean.\"",
          jp: "ミンさんは かんこく＿です。",
          choices: ["じん", "ご", "さん", "の"],
          answer: 0,
          why: "A person from a country takes 〜じん. 〜ご is the language.",
        },
      ],
      games: ["wa-desu-builder", "jin-or-go"],
      ask: ["Why does Japanese leave out 'I' so often?", "Is は the same as 'is'?", "When should I use あなた?"],
    },
    // ------------------------------------------------ grammar 2
    {
      id: "questions",
      kind: "grammar",
      title: "〜か",
      name: "Asking questions",
      genki: "Genki p. 42 · Grammar 2; Expression Notes 2 (p. 44)",
      teach:
        "Turning a statement into a question is the easiest thing in Japanese: add **か** at the end. " +
        "りゅうがくせいです (I'm an exchange student) → りゅうがくせいですか (Are you an exchange student?). " +
        "No word order changes, no \"do\". Your voice goes up a little at the end.\n\n" +
        "**Answering yes/no.** Yes: はい、そうです. No: いいえ, then say what's actually true: " +
        "いいえ、にほんじんです. (\"No, I'm Japanese.\")\n\n" +
        "**Question words** go exactly where the answer will go. Ask with なん, answer by swapping it out:\n" +
        "せんこうは なんですか。→ せんこうは けいざいです。\n\n" +
        "This lesson's question words are all built on なん (what): なんさい (how old), なんねんせい (what " +
        "year), なんじ (what time), なんばん (what number), and なにじん (what nationality). " +
        "なん is used before です and before counters like じ, さい; なに before most other things.\n\n" +
        "Finally, **そうですか** with falling intonation means \"I see / oh, OK\". It's how you show you're " +
        "listening.",
      pattern: [
        ["〔statement〕か。", "Yes/no question"],
        ["〔X〕は なん〜ですか。", "What … is X?"],
      ],
      examples: [
        { jp: "はるとさんは にほんじんですか。", en: "Is Haruto Japanese?" },
        { jp: "はい、そうです。", en: "Yes, that's right." },
        { jp: "ノアさんは なんねんせいですか。", en: "What year is Noah in?" },
        { jp: "にねんせいです。", en: "He's a second-year." },
        { jp: "いま なんじですか。", en: "What time is it now?" },
        { jp: "ミンさんは なんさいですか。", en: "How old is Min?" },
        { jp: "でんわばんごうは なんばんですか。", en: "What's your phone number?" },
      ],
      watch: [
        "Japanese traditionally writes no question mark: か already does the job. (You'll see ？ in casual texts.)",
        "Don't answer a question-word question with はい or いいえ. なんさいですか → じゅうきゅうさいです, not \"はい…\".",
        "\"No, that's not right\" (いいえ、そうじゃないです) comes in Lesson 2. For now: いいえ + the real answer.",
      ],
      uni: "Listening quizzes love \"what year / how old / what time\" questions. Learn to hear the question word first: なんさい → expect a 〜さい answer.",
      checks: [
        {
          q: "Make it a question: \"Is Lena a first-year?\"",
          jp: "レナさんは いちねんせいです＿。",
          choices: ["か", "は", "の", "ね"],
          answer: 0,
          why: "か at the end turns any statement into a question.",
        },
        {
          q: "Someone asks なんさいですか. Which answer fits?",
          choices: ["にじゅういっさいです。", "はい、そうです。", "さんねんせいです。", "ごご にじです。"],
          answer: 0,
          why: "なんさい asks age, so the answer ends in 〜さい.",
        },
        {
          q: "\"Is Haruto an exchange student?\" He isn't; he's Japanese. Best answer:",
          choices: ["いいえ、にほんじんです。", "はい、にほんじんです。", "いいえ、そうです。", "にほんじんですか。"],
          answer: 0,
          why: "いいえ, then the true fact.",
        },
      ],
      games: ["question-words", "ages-years"],
      ask: ["When do I use なん and when なに?", "How do I say 'no, that's not right'?"],
    },
    // ------------------------------------------------ grammar 3
    {
      id: "no",
      kind: "grammar",
      title: "Noun の Noun",
      name: "Linking two nouns",
      genki: "Genki p. 43 · Grammar 3",
      teach:
        "**の** glues two nouns together into one bigger noun. The rule to remember: **the main thing " +
        "comes last**. The noun before の narrows it down.\n\n" +
        "はるとさんの でんわばんごう: the main thing is a phone number; which one? Haruto's. " +
        "にほんごの せんせい: a teacher; of what? Japanese. Japanese has the opposite order to English " +
        "\"teacher of Japanese\", so read の phrases from the back.\n\n" +
        "の covers a lot of English: possession (\"Lena's\"), \"of\", \"at\", \"from\": " +
        "さくらだいがくの がくせい is a student AT Sakura University.\n\n" +
        "Because an の phrase acts like one noun, it can go anywhere a noun can, including on both sides " +
        "of は … です, and you can chain them: わたしの ともだちの なまえ (my friend's name).",
      pattern: [["〔extra detail〕の 〔main thing〕", "the main thing, narrowed down"]],
      examples: [
        { jp: "わたしの なまえ", en: "my name" },
        { jp: "にほんごの せんせい", en: "a Japanese-language teacher" },
        { jp: "とうきょうだいがくの がくせい", en: "a student at the University of Tokyo" },
        { jp: "ミンさんの せんこうは けいざいです。", en: "Min's major is economics." },
        { jp: "はるとさんの おかあさんは いしゃです。", en: "Haruto's mother is a doctor." },
      ],
      watch: [
        "Order flips compared to English \"of\": \"a teacher OF Japanese\" = にほんごの せんせい, not せんせいの にほんご.",
        "\"Japanese person\" is にほんじん, not にほんの ひと in everyday speech (both are understood, but じん is the normal word).",
        "わたしの = my. There is no separate word; \"me + の\" is it.",
      ],
      uni: "Expect translation items like \"my friend's phone number\". Check yourself by asking: what is the THING here? That word goes last.",
      checks: [
        {
          q: "\"A high-school teacher\"",
          choices: ["こうこうの せんせい", "せんせいの こうこう", "こうこうせんせいの", "せんせい こうこう"],
          answer: 0,
          why: "The main thing (teacher) goes last; the detail (high school) before の.",
        },
        {
          q: "\"Noah's major is history.\"",
          jp: "ノアさん＿ せんこうは れきしです。",
          choices: ["の", "は", "か", "です"],
          answer: 0,
          why: "Noah's major: ノアさんの せんこう.",
        },
        {
          q: "What does わたしの ともだちの でんわばんごう mean?",
          choices: ["my friend's phone number", "my phone's friend number", "the friend of my phone", "my number is a friend"],
          answer: 0,
          why: "Read from the back: phone number ← friend's ← my.",
        },
      ],
      games: ["no-chain"],
      ask: ["Is の always possession?", "How long can an の chain get?"],
    },
    // ------------------------------------------------ expressions: time & phone
    {
      id: "time",
      kind: "expressions",
      title: "じかん・でんわばんごう",
      name: "Telling the time and phone numbers",
      genki: "Genki pp. 52–53, 55 · Practice V and Useful Expressions (Time)",
      teach:
        "Times are number + **じ** (o'clock). Half past is + **はん**. a.m. and p.m. go **in front**: " +
        "ごぜん くじ (9 a.m.), ごご にじはん (2:30 p.m.).\n\n" +
        "Three hours are irregular and come up constantly, so drill them until they're automatic: " +
        "**よじ** (4, not よんじ), **しちじ** (7, not ななじ), **くじ** (9, not きゅうじ).\n\n" +
        "**Minutes** (bonus for now) use ふん/ぷん and change sound a lot: いっぷん, にふん, さんぷん, " +
        "よんぷん, ごふん, ろっぷん, ななふん, はっぷん, きゅうふん, じゅっぷん. Genki lists them on p. 55; " +
        "learn 10, 15, 20, 30 first (じゅっぷん, じゅうごふん, にじゅっぷん, さんじゅっぷん).\n\n" +
        "**Phone numbers** are read digit by digit. The dash is read **の**: " +
        "090-1234-5678 → ゼロきゅうゼロの いちにさんよんの ごろくななはち. When reading digits, " +
        "people often stretch 2 and 5 to にい and ごお so they're easier to hear.",
      table: {
        caption: "The hours",
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
      },
      examples: [
        { jp: "いま なんじですか。", en: "What time is it now?" },
        { jp: "ごご よじはんです。", en: "It's 4:30 p.m." },
        { jp: "ソウルは いま ごぜん しちじです。", en: "It's 7 a.m. in Seoul right now." },
        { jp: "でんわばんごうは ゼロはちゼロの にいさんよんの ごおろくななはちです。", en: "My number is 080-234-5678." },
      ],
      watch: [
        "ごぜん / ごご go BEFORE the time, never after: ごご さんじ, not さんじ ごご.",
        "よじ, しちじ, くじ. The \"normal\" よん/なな/きゅう sound wrong on the clock.",
        "はん comes right after じ with no space in meaning: にじはん = 2:30.",
      ],
      uni: "Time is a favourite listening item. When you hear よ, しち or く right before じ, you already know the hour.",
      life: "Train stations and phones use 24-hour time (じゅうよじ = 14:00), but in conversation people say ごご にじ.",
      checks: [
        {
          q: "9:00",
          choices: ["くじ", "きゅうじ", "きゅうじはん", "じゅうくじ"],
          answer: 0,
          why: "Nine o'clock is くじ, one of the three irregular hours.",
        },
        {
          q: "3:30 p.m.",
          choices: ["ごご さんじはん", "さんじはん ごご", "ごぜん さんじはん", "ごご はんさんじ"],
          answer: 0,
          why: "p.m. in front, then the hour, then はん.",
        },
        {
          q: "How is the dash in a phone number read?",
          choices: ["の", "は", "と", "ばん"],
          answer: 0,
          why: "People say の between the groups of digits.",
        },
      ],
      games: ["clock", "phone-listen"],
      ask: ["How do I say 4:45?", "Do Japanese people use the 24-hour clock in speech?"],
    },
    // ------------------------------------------------ culture
    {
      id: "names",
      kind: "culture",
      title: "なまえ・さん",
      name: "Names, titles and talking to people",
      genki: "Genki pp. 44–45 · Expression Notes 2, Culture Notes (Japanese Names)",
      teach:
        "**Family name first.** Japanese say the family name, then the given name: やまもと はると. " +
        "When introducing yourself in Japanese, many foreigners keep their own order; both are understood. " +
        "There are no middle names.\n\n" +
        "**さん** works after either name and for anyone, but **never for yourself**. Children get ちゃん " +
        "(and boys often くん). Teachers, doctors and lawyers get **せんせい** instead of さん: " +
        "やまもとせんせい.\n\n" +
        "**Avoid あなた.** It isn't rude by itself, but using it with someone whose name you know sounds " +
        "distant or even pushy. Use their name + さん, even when speaking to them directly: " +
        "\"ノアさんは カナダじんですか\" = \"Are YOU Canadian, Noah?\"\n\n" +
        "**あのう…** at the start of a question is a polite little hesitation, like \"um, excuse me…\". " +
        "It softens a personal question. Use it.",
      examples: [
        { jp: "あのう、りゅうがくせいですか。", en: "Um… are you an exchange student?" },
        { jp: "やまもとせんせいは にほんじんです。", en: "Professor Yamamoto is Japanese." },
      ],
      watch: ["Using あなた with your teacher is one of the few things that can genuinely sound rude. Use せんせい."],
      checks: [
        {
          q: "You're asking your teacher, Prof. Yamamoto, if she's from Tokyo. How do you say \"you\"?",
          choices: ["やまもとせんせいは…", "あなたは…", "やまもとさんは…", "やまもとちゃんは…"],
          answer: 0,
          why: "Teachers are addressed by name + せんせい; あなた would sound rude here.",
        },
        {
          q: "Which is a typical Japanese name order?",
          choices: ["family name, then given name", "given name, then family name", "given, middle, family", "any order"],
          answer: 0,
          why: "やまもと (family) はると (given).",
        },
      ],
      games: [],
      ask: ["How should I write my own name in Japanese?", "When do people use ちゃん and くん?"],
    },
  ],
  dialogue: {
    title: "Orientation day",
    setting: "Lena has just arrived in Japan. At the welcome party she meets Haruto, a student volunteer, and then Min.",
    lines: [
      { who: "はると", jp: "こんにちは。やまもと はるとです。", en: "Hi. I'm Haruto Yamamoto." },
      { who: "レナ", jp: "はじめまして。レナ・ミュラーです。", en: "Nice to meet you. I'm Lena Müller." },
      { who: "はると", jp: "レナさんは りゅうがくせいですか。", en: "Are you an exchange student, Lena?" },
      { who: "レナ", jp: "はい、そうです。ドイツじんです。はるとさんは？", en: "Yes. I'm German. And you, Haruto?" },
      { who: "はると", jp: "にほんじんです。さくらだいがくの さんねんせいです。", en: "I'm Japanese. A third-year at Sakura University." },
      { who: "レナ", jp: "そうですか。せんこうは なんですか。", en: "I see. What's your major?" },
      { who: "はると", jp: "れきしです。レナさんの せんこうは？", en: "History. What about yours?" },
      { who: "レナ", jp: "にほんごです。いちねんせいです。", en: "Japanese. I'm a first-year." },
      { who: "ミン", jp: "あのう、すみません。いま なんじですか。", en: "Um, excuse me. What time is it now?" },
      { who: "はると", jp: "ごご よじはんです。", en: "It's 4:30 p.m." },
      { who: "ミン", jp: "ありがとうございます。", en: "Thank you." },
    ],
  },
  together: ["self-intro"],
  test: [
    {
      q: "Your host mother says いってらっしゃい. What did you just say?",
      choices: ["いってきます", "ただいま", "おやすみなさい", "いただきます"],
      answer: 0,
      why: "いってらっしゃい answers いってきます.",
    },
    {
      q: "How do you read 74?",
      choices: ["ななじゅうよん", "しちじゅうし", "よんじゅうなな", "ななよんじゅう"],
      answer: 0,
      why: "Seven tens + four, using the default readings なな and よん.",
    },
    {
      q: "\"I'm a second-year student.\"",
      choices: ["にねんせいです。", "わたしは にねんせいさんです。", "にねんせいですか。", "わたしの にねんせいです。"],
      answer: 0,
      why: "The plainest correct answer: no さん on yourself, わたしは optional.",
    },
    {
      q: "Fill the gap: \"Min is a student at Seoul University.\"",
      jp: "ミンさんは ソウルだいがく＿ がくせいです。",
      choices: ["の", "は", "か", "じん"],
      answer: 0,
      why: "A student AT Seoul University: ソウルだいがくの がくせい.",
    },
    {
      q: "Which question asks someone's year at university?",
      choices: ["なんねんせいですか。", "なんさいですか。", "なんじですか。", "なんばんですか。"],
      answer: 0,
      why: "〜ねんせい is \"…-year student\".",
    },
    {
      q: "7:30",
      choices: ["しちじはん", "ななじはん", "しちじさんじゅう", "はんしちじ"],
      answer: 0,
      why: "Seven o'clock is しちじ, and はん follows.",
    },
    {
      q: "\"A Japanese person\"",
      choices: ["にほんじん", "にほんご", "にほんの", "じんにほん"],
      answer: 0,
      why: "〜じん is a person from a country; 〜ご is the language.",
    },
    {
      q: "Which word is pronounced differently from how it is spelled?",
      choices: ["the は in わたしは", "the か in ですか", "the の in わたしの", "the じ in いちじ"],
      answer: 0,
      why: "The topic particle は is said \"wa\".",
    },
    {
      q: "Someone says ありがとうございます to you. A natural reply is:",
      choices: ["いいえ。", "はい、そうです。", "すみません。", "おかえりなさい。"],
      answer: 0,
      why: "いいえ = \"not at all / don't mention it\".",
    },
    {
      q: "\"Haruto's mother\"",
      choices: ["はるとさんの おかあさん", "おかあさんの はるとさん", "はるとさんは おかあさん", "はるとの さん おかあさん"],
      answer: 0,
      why: "Main thing last: mother, narrowed by Haruto's.",
    },
    {
      q: "Where does ごご (p.m.) go?",
      choices: ["before the time", "after the time", "after です", "anywhere"],
      answer: 0,
      why: "ごご さんじ, never さんじ ごご.",
    },
    {
      q: "\"She is 20 years old\" in the most common way:",
      choices: ["はたちです。", "にじゅうさいです。", "にさいです。", "にじゅっさいです。"],
      answer: 0,
      why: "20 has its own word, はたち. にじゅっさい is understood, but はたち is what people actually say.",
    },
  ],
};

// ====================================================================
// Lesson 2 — かいもの (Shopping)
// ====================================================================

const L2: GenkiLesson = {
  id: "l2",
  num: 2,
  jp: "かいもの",
  en: "Shopping",
  pages: "Genki I pp. 56–81",
  goals: [
    "Ask how much things cost and understand prices up to 99,999 yen",
    "Point to things and places: this, that, that over there, which",
    "Buy things and order food",
    "Say whose something is",
    "Say \"too\" and \"isn't\"",
    "Add a friendly ね or a confident よ",
  ],
  intro:
    "Lesson 2 is the lesson you'll use the first day you're actually in Japan: prices, pointing, buying, " +
    "ordering, and finding the toilet. It has seven grammar points, but four of them are one idea (the " +
    "こ・そ・あ・ど words), so it is lighter than it looks.\n\n" +
    "The single most important picture to hold in your head this week: **こ = near me, そ = near you, " +
    "あ = far from both of us, ど = which?** Every pointing word in Japanese follows it.",
  plan: [
    "Day 1 · Big numbers and prices warm-up · vocabulary",
    "Day 2 · これ・それ・あれ・どれ · この・その・あの・どの",
    "Day 3 · ここ・そこ・あそこ・どこ · だれの",
    "Day 4 · も · じゃないです · ね and よ",
    "Day 5 · Shopping and restaurant role-plays, the conversation, then the lesson test",
  ],
  vocab: [
    {
      title: "Pointing words",
      words: [
        { jp: "これ", en: "this one (near me)", star: true },
        { jp: "それ", en: "that one (near you)", star: true },
        { jp: "あれ", en: "that one over there", star: true },
        { jp: "どれ", en: "which one", star: true },
        { jp: "この", en: "this … (+ noun)" },
        { jp: "その", en: "that … (+ noun)", star: true },
        { jp: "あの", en: "that … over there (+ noun)", star: true },
        { jp: "どの", en: "which … (+ noun)" },
        { jp: "ここ", en: "here" },
        { jp: "そこ", en: "there (near you)" },
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
      title: "Money",
      words: [
        { jp: "いくら", en: "how much", star: true },
        { jp: "〜えん", en: "… yen", star: true },
        { jp: "たかい", en: "expensive; high", star: true },
      ],
    },
    {
      title: "Shop and restaurant phrases",
      words: [
        { jp: "いらっしゃいませ", en: "welcome (staff to customers)", star: true },
        { jp: "〜を おねがいします", en: "…, please (ordering)", star: true },
        { jp: "〜を ください", en: "please give me …", star: true },
        { jp: "じゃあ", en: "well then, in that case", star: true },
        { jp: "どうぞ", en: "here you are / please, go ahead", star: true },
        { jp: "どうも", en: "thanks", star: true },
      ],
    },
    {
      title: "Review from Lesson 1",
      extra: true,
      words: [
        { jp: "えいご", en: "English (language)" },
        { jp: "けいざい", en: "economics" },
        { jp: "ビジネス", en: "business" },
        { jp: "れきし", en: "history" },
        { jp: "かんこく", en: "South Korea" },
        { jp: "ちゅうごく", en: "China" },
        { jp: "イギリス", en: "the UK" },
        { jp: "おかあさん", en: "mother" },
        { jp: "おとうさん", en: "father" },
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
        "To read prices you need three more words: **ひゃく** (100), **せん** (1,000) and **まん** (10,000). " +
        "They work like じゅう: さんびゃく is \"three hundreds\", ごせん is \"five thousands\".\n\n" +
        "**Sound changes.** A few combinations are bent so they're easier to say. These are the ones " +
        "that show up on every price tag, so learn them by ear:\n" +
        "300 さんびゃく · 600 ろっぴゃく · 800 はっぴゃく · 3,000 さんぜん · 8,000 はっせん.\n\n" +
        "**10,000 is いちまん**, not just まん (unlike ひゃく and せん, which drop the いち). Japanese counts " +
        "in blocks of four zeros: 20,000 is にまん (\"two ten-thousands\"), not \"twenty thousand\". " +
        "This is the biggest mental switch: when you see 35,000, think \"3.5 まん\" → さんまんごせん.\n\n" +
        "Add **えん** for yen: ¥1,800 = せんはっぴゃくえん. (Yen is えん in Japanese; the \"y\" is an old " +
        "English spelling.)",
      table: {
        caption: "The ones that change",
        rows: [
          ["300", "さんびゃく", "h → b"],
          ["600", "ろっぴゃく", "h → pp"],
          ["800", "はっぴゃく", "h → pp"],
          ["3,000", "さんぜん", "s → z"],
          ["8,000", "はっせん", "doubled s"],
          ["10,000", "いちまん", "keeps いち"],
          ["20,000", "にまん", "two ten-thousands"],
        ],
      },
      examples: [
        { jp: "さんびゃくえん", en: "¥300" },
        { jp: "せんはっぴゃくえん", en: "¥1,800" },
        { jp: "いちまんにせんえん", en: "¥12,000" },
        { jp: "さんまんごせんえん", en: "¥35,000" },
      ],
      watch: [
        "Don't say さんひゃく, ろくひゃく, はちひゃく, さんせん, はちせん. They're understood but sound wrong.",
        "10,000 = いちまん. 100,000 = じゅうまん (ten ten-thousands), not \"hundred thousand\".",
      ],
      uni: "Price listening is the L2 listening item. Train your ear on the changed sounds; they are exactly what quizzes test.",
      life: "Prices in shops usually include tax (ぜいこみ). Cash is still common in small shops and restaurants.",
      checks: [
        {
          q: "¥600",
          choices: ["ろっぴゃくえん", "ろくひゃくえん", "ろっひゃくえん", "ろくびゃくえん"],
          answer: 0,
          why: "6 + ひゃく becomes ろっぴゃく.",
        },
        {
          q: "¥10,000",
          choices: ["いちまんえん", "まんえん", "じゅうせんえん", "いちせんえん"],
          answer: 0,
          why: "Ten thousand keeps its いち: いちまん.",
        },
        {
          q: "¥3,800",
          choices: ["さんぜんはっぴゃくえん", "さんせんはちひゃくえん", "さんぜんはちひゃくえん", "さんせんはっぴゃくえん"],
          answer: 0,
          why: "Both parts change: さんぜん + はっぴゃく.",
        },
      ],
      games: ["prices-read", "prices-listen"],
      ask: ["Why does 300 become さんびゃく?", "How do I read 150,000 yen?"],
    },
    // ------------------------------------------------ grammar 1
    {
      id: "kore",
      kind: "grammar",
      title: "これ・それ・あれ・どれ",
      name: "This one, that one, which one",
      genki: "Genki p. 60 · Grammar 1",
      teach:
        "Picture yourself and a friend standing a few steps apart. Japanese splits the world around you " +
        "two:\n" +
        "**これ** — the thing near me (the speaker)\n" +
        "**それ** — the thing near you (the listener)\n" +
        "**あれ** — the thing far from both of us\n" +
        "**どれ** — which one?\n\n" +
        "English only has \"this\" and \"that\". Japanese has two \"that\"s, and choosing between them is " +
        "about **whose side the thing is on**, not just distance.\n\n" +
        "The flip that catches everyone: if your friend points at the bag you're holding and asks " +
        "**それは なんですか** (\"what's that?\"), you answer **これは かばんです** (\"this is a bag\"). Same " +
        "bag, different word, because it's near you.\n\n" +
        "These words stand alone, like nouns: これは いくらですか (\"How much is this?\").",
      pattern: [
        ["これは 〔X〕です。", "This (near me) is X."],
        ["それは 〔X〕ですか。", "Is that (near you) X?"],
        ["どれですか。", "Which one is it?"],
      ],
      examples: [
        { jp: "これは いくらですか。", en: "How much is this?" },
        { jp: "それは さんぜんえんです。", en: "That (in your hand) is 3,000 yen." },
        { jp: "あれは なんですか。", en: "What's that over there?" },
        { jp: "あれは としょかんです。", en: "That's the library." },
        { jp: "どれですか。", en: "Which one (do you mean)?" },
      ],
      watch: [
        "The question-and-answer flip: それ in the question often becomes これ in the answer, and the other way round.",
        "Don't use これ/それ/あれ for people standing right there. \"This is my friend\" uses こちら or この ひと (coming soon).",
        "どれ is a question word, so it takes が rather than は: どれが ミンさんの かさですか. Genki explains why in Lesson 8; for now, just copy it.",
      ],
      uni: "Expect picture questions: a speaker, a listener and an object. Ask yourself \"whose side is it on?\" before you answer.",
      checks: [
        {
          q: "The umbrella is in YOUR hand. \"How much is this?\"",
          jp: "＿は いくらですか。",
          choices: ["これ", "それ", "あれ", "どれ"],
          answer: 0,
          why: "Near the speaker = これ.",
        },
        {
          q: "Your friend asks それは なんですか about the book you're holding. You reply:",
          choices: ["これは ほんです。", "それは ほんです。", "あれは ほんです。", "どれは ほんです。"],
          answer: 0,
          why: "From your side it's near you, so これ.",
        },
        {
          q: "A tall building far from both of you:",
          choices: ["あれ", "それ", "これ", "どれ"],
          answer: 0,
          why: "Far from both speaker and listener = あれ.",
        },
      ],
      games: ["kosoado-things"],
      ask: ["How do I know if something is それ or あれ?", "Why can't I use これ for people?"],
    },
    // ------------------------------------------------ grammar 2
    {
      id: "kono",
      kind: "grammar",
      title: "この・その・あの・どの ＋ noun",
      name: "This watch, that bag",
      genki: "Genki p. 61 · Grammar 2",
      teach:
        "The **の** versions follow the same map (near me / near you / far / which), but they can't stand " +
        "alone. They must have a noun right after them:\n" +
        "**この** とけい (this watch) · **その** かばん (that bag) · **あの** ひと (that person over there) · " +
        "**どの** ほん (which book).\n\n" +
        "A handy test: if the next word is は, use the **れ** word. If the next word is a noun, use the " +
        "**の** word.\n" +
        "これは たかいです. (This is expensive.)\n" +
        "このとけいは たかいです. (This watch is expensive.)\n\n" +
        "Unlike これ/それ/あれ, the の forms are fine for people: あの ひとは だれですか (\"Who's that " +
        "person?\").",
      pattern: [
        ["この／その／あの 〔noun〕", "this / that / that … over there"],
        ["どの 〔noun〕が 〜ですか。", "Which noun is …?"],
      ],
      examples: [
        { jp: "このとけいは いくらですか。", en: "How much is this watch?" },
        { jp: "そのかばんは ミンさんのです。", en: "That bag (near you) is Min's." },
        { jp: "あのひとは せんせいです。", en: "That person over there is a teacher." },
        { jp: "どのほんが いいですか。", en: "Which book is good?" },
      ],
      watch: [
        "このは / これの are both wrong. この needs a noun; これ stands alone.",
        "\"This one\" when pointing at a thing on a menu: これ, not この.",
      ],
      checks: [
        {
          q: "Choose the right word.",
          jp: "＿とけいは いくらですか。",
          choices: ["この", "これ", "ここ", "これの"],
          answer: 0,
          why: "A noun (とけい) follows, so it's the の form.",
        },
        {
          q: "Choose the right word.",
          jp: "＿は いくらですか。",
          choices: ["これ", "この", "このの", "こ"],
          answer: 0,
          why: "Nothing but は follows, so it's the れ form.",
        },
        {
          q: "\"Who is that person over there?\"",
          choices: ["あのひとは だれですか。", "あれは だれですか。", "あのは だれですか。", "あそこは だれですか。"],
          answer: 0,
          why: "For people, use あの ひと. あれ for a person sounds rude.",
        },
      ],
      games: ["kono-or-kore"],
      ask: ["Can I say この for people?", "What's the difference between それ and その?"],
    },
    // ------------------------------------------------ grammar 3
    {
      id: "koko",
      kind: "grammar",
      title: "ここ・そこ・あそこ・どこ",
      name: "Here, there, over there, where",
      genki: "Genki p. 62 · Grammar 3",
      teach:
        "One more set on the same map, this time for **places**:\n" +
        "**ここ** here (near me) · **そこ** there (near you) · **あそこ** over there · **どこ** where.\n\n" +
        "To ask where something is: **〔X〕は どこですか**. The most useful sentence in this lesson is " +
        "probably トイレは どこですか.\n\n" +
        "Notice the pattern across all three sets: こ・そ・あ・ど. Once you know which side a thing is on, " +
        "you pick the ending you need: れ (a thing), の + noun, or こ/そこ (a place). Japanese teachers call " +
        "this the こそあど system, and it keeps coming back (こちら, こんな, こう …).",
      pattern: [["〔X〕は どこですか。", "Where is X?"], ["〔X〕は あそこです。", "X is over there."]],
      examples: [
        { jp: "すみません。トイレは どこですか。", en: "Excuse me, where's the toilet?" },
        { jp: "あそこです。", en: "It's over there." },
        { jp: "ゆうびんきょくは どこですか。", en: "Where's the post office?" },
        { jp: "ここは としょかんです。", en: "This (place) is the library." },
      ],
      watch: [
        "Places use ここ/そこ/あそこ, not これ/それ/あれ. \"Here is the bank\": ここは ぎんこうです.",
        "Detailed directions (left, right, in front of) arrive in Lesson 4. For now, point and say あそこです.",
      ],
      life: "Asking for things in a shop works the same way: くつは どこですか (\"Where are the shoes?\").",
      checks: [
        {
          q: "\"Where is the bank?\"",
          choices: ["ぎんこうは どこですか。", "ぎんこうは どれですか。", "ぎんこうは だれですか。", "ぎんこうは なんですか。"],
          answer: 0,
          why: "Places: どこ.",
        },
        {
          q: "The post office is far from both of you. You point and say:",
          choices: ["あそこです。", "そこです。", "ここです。", "あれです。"],
          answer: 0,
          why: "A place far from both = あそこ.",
        },
      ],
      games: ["kosoado-places"],
      ask: ["Why is it あそこ and not あこ?", "How do I ask where something is in a shop?"],
    },
    // ------------------------------------------------ grammar 4
    {
      id: "dare-no",
      kind: "grammar",
      title: "だれの noun",
      name: "Whose is it?",
      genki: "Genki p. 62 · Grammar 4",
      teach:
        "**だれ** is \"who\". Add the の from Lesson 1 and you get **だれの** — \"whose\". It works " +
        "exactly like any other の phrase: だれの かさですか (\"Whose umbrella is it?\").\n\n" +
        "Answer by putting the owner in the same spot: ミンさんの かさです.\n\n" +
        "When the noun is obvious, you can drop it and keep the の: これは わたしのです (\"This is mine\"). " +
        "That の means \"the one belonging to\".",
      pattern: [["これは だれの 〔noun〕ですか。", "Whose noun is this?"], ["〔person〕の 〔noun〕です。", "It's (person)'s noun."]],
      examples: [
        { jp: "これは だれの かさですか。", en: "Whose umbrella is this?" },
        { jp: "ノアさんの かさです。", en: "It's Noah's umbrella." },
        { jp: "そのペンは わたしのです。", en: "That pen is mine." },
      ],
      watch: ["だれ alone is \"who\": あのひとは だれですか. You need の to make \"whose\"."],
      checks: [
        {
          q: "\"Whose bag is this?\"",
          choices: ["これは だれの かばんですか。", "これは だれ かばんですか。", "これの だれは かばんですか。", "だれは これの かばんですか。"],
          answer: 0,
          why: "だれの + noun = whose noun.",
        },
        {
          q: "\"That's mine.\" (the thing near the listener)",
          choices: ["それは わたしのです。", "それは わたしです。", "それの わたしです。", "わたしは それのです。"],
          answer: 0,
          why: "わたしの = mine, with the noun left out.",
        },
      ],
      games: ["whose"],
      ask: ["Can I always drop the noun after の?"],
    },
    // ------------------------------------------------ grammar 5
    {
      id: "mo",
      kind: "grammar",
      title: "Noun も",
      name: "Too, also",
      genki: "Genki pp. 62–63 · Grammar 5",
      teach:
        "**も** means \"too / also\", and it **replaces は**. It goes right after the thing that is \"also\" " +
        "true.\n\n" +
        "ミンさんは にねんせいです。ノアさん**も** にねんせいです。\n" +
        "\"Min is a second-year. Noah is a second-year **too**.\"\n\n" +
        "The rule of thumb: if a sentence repeats what was just said about someone else, the new person " +
        "gets も. If the fact is different, keep は.\n\n" +
        "\"Me too!\" in conversation is **わたしもです**.",
      pattern: [["A は X です。B も X です。", "A is X. B is X too."]],
      examples: [
        { jp: "このかさは たかいです。あのかさも たかいです。", en: "This umbrella is expensive. That one over there is expensive too." },
        { jp: "はるとさんは にほんじんです。おかあさんも にほんじんです。", en: "Haruto is Japanese. His mother is Japanese too." },
        { jp: "A: しゅっしんは ソウルです。 B: わたしもです。", en: "A: I'm from Seoul. B: Me too!" },
      ],
      watch: [
        "も replaces は. はも or もは are never right.",
        "も attaches to the thing that's shared, not to the end of the sentence like English \"too\".",
        "If the facts differ, it's は: ミンさんは にねんせいです。ノアさんは いちねんせいです。",
      ],
      checks: [
        {
          q: "Lena is a first-year. Noah is a first-year too.",
          jp: "レナさんは いちねんせいです。ノアさん＿ いちねんせいです。",
          choices: ["も", "は", "の", "か"],
          answer: 0,
          why: "Same fact, new person → も.",
        },
        {
          q: "Lena is a first-year. Min is a second-year.",
          jp: "レナさんは いちねんせいです。ミンさん＿ にねんせいです。",
          choices: ["は", "も", "の", "か"],
          answer: 0,
          why: "Different fact → keep は.",
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
      name: "Saying something isn't",
      genki: "Genki pp. 63–64 · Grammar 6",
      teach:
        "To say \"X is **not** Y\", replace です with **じゃないです**:\n" +
        "がくせいです → がくせい**じゃないです** (I'm not a student).\n\n" +
        "There are two more versions with the same meaning, a step up in formality:\n" +
        "**じゃありません** — polite and a bit more careful\n" +
        "**ではありません** — formal; the one to use in **writing**, essays and exams\n\n" +
        "Now you can answer \"no\" properly: いいえ、にほんじんじゃないです。カナダじんです。 " +
        "Deny, then give the right answer. That's the most natural pattern.\n\n" +
        "**Important limit:** this is for nouns (and a few words like them). Describing words that end in " +
        "い, like たかい (expensive) and おいしい (delicious), make their negative differently. You'll learn " +
        "that in Lesson 5; until then, don't put じゃないです after them.",
      pattern: [
        ["〔X〕は 〔Y〕じゃないです。", "X is not Y. (spoken)"],
        ["〔X〕は 〔Y〕ではありません。", "X is not Y. (formal, written)"],
      ],
      examples: [
        { jp: "はるとさんは りゅうがくせいじゃないです。", en: "Haruto isn't an exchange student." },
        { jp: "いいえ、さかなじゃないです。にくです。", en: "No, it's not fish. It's meat." },
        { jp: "わたしは せんせいではありません。", en: "I am not a teacher. (formal)" },
      ],
      watch: [
        "You can't answer with just いいえ、じゃないです. The noun has to be there: いいえ、がくせいじゃないです.",
        "たかいじゃないです is wrong. たかい is a describing word; its negative comes in Lesson 5.",
      ],
      uni: "Many university courses expect ではありません in written homework and じゃないです in speaking. If your teacher hasn't said, ask which they want.",
      checks: [
        {
          q: "\"Ms. Yamamoto isn't a student.\"",
          choices: ["やまもとさんは がくせいじゃないです。", "やまもとさんは がくせいないです。", "やまもとさんは じゃないです がくせい。", "やまもとさんは がくせいですじゃない。"],
          answer: 0,
          why: "です → じゃないです, right after the noun.",
        },
        {
          q: "Which is the most formal, written form?",
          choices: ["ではありません", "じゃないです", "じゃありません", "ないです"],
          answer: 0,
          why: "ではありません is the written-style negative.",
        },
        {
          q: "\"Is that fish?\" It's meat. Best answer:",
          choices: ["いいえ、さかなじゃないです。にくです。", "いいえ、じゃないです。", "はい、さかなじゃないです。", "いいえ、にくじゃないです。"],
          answer: 0,
          why: "Deny the wrong noun, then give the right one.",
        },
      ],
      games: ["negate"],
      ask: ["Why can't I say たかいじゃないです?", "Which negative should I use with my teacher?"],
    },
    // ------------------------------------------------ grammar 7
    {
      id: "ne-yo",
      kind: "grammar",
      title: "〜ね・〜よ",
      name: "Isn't it? / I'm telling you",
      genki: "Genki p. 64 · Grammar 7",
      teach:
        "Two tiny endings that make you sound like a person rather than a textbook.\n\n" +
        "**ね** asks for agreement or checks something: \"…, right?\" / \"…, isn't it?\". Use it when you " +
        "expect the other person feels the same or already knows: おいしいですね (\"It's good, isn't it?\"). " +
        "Also for double-checking: ゼロはちゼロ… ですね (\"080…, right?\").\n\n" +
        "**よ** tells the other person something they don't know yet: \"I'm telling you / you know\". " +
        "とんかつは にくですよ (\"Tonkatsu is meat, you know.\").\n\n" +
        "Quick test: does the listener **already know** it? → ね. Are you **giving them new information**? → よ.",
      pattern: [["〜ですね。", "…, isn't it? (shared)"], ["〜ですよ。", "…, I tell you. (new info)"]],
      examples: [
        { jp: "このラーメン、おいしいですね。", en: "This ramen is good, isn't it?" },
        { jp: "あれは ぎんこうじゃないですよ。ゆうびんきょくですよ。", en: "That's not a bank, you know. It's the post office." },
        { jp: "ミンさんの せんこうは けいざいですね。", en: "Your major is economics, right, Min?" },
      ],
      watch: [
        "Too much よ can sound pushy or like you're correcting people. Use it when the info is genuinely useful to them.",
        "ね on something the listener can't know (\"My name is Lena, isn't it?\") sounds odd.",
      ],
      life: "Japanese conversations are full of ね. Agreeing with そうですね is the most common reaction you'll hear.",
      checks: [
        {
          q: "You and a friend are both eating, and it's delicious.",
          jp: "おいしいです＿。",
          choices: ["ね", "よ", "か", "の"],
          answer: 0,
          why: "Shared experience → ね.",
        },
        {
          q: "Your friend thinks the store is closed. You know it isn't — it's open today.",
          jp: "きょうは だいじょうぶです＿。",
          choices: ["よ", "ね", "か", "も"],
          answer: 0,
          why: "Giving them information they don't have → よ.",
        },
      ],
      games: ["ne-or-yo"],
      ask: ["Is よ rude?", "What's the difference between ですね and そうですね?"],
    },
    // ------------------------------------------------ expressions: shopping
    {
      id: "shopping",
      kind: "expressions",
      title: "かいもの・レストラン",
      name: "Shops and restaurants",
      genki: "Genki pp. 56–57, 65–66 · the conversations, Expression Notes 3, Culture Notes (Japanese Currency)",
      teach:
        "Everything you need to buy something is now in your hands:\n" +
        "**いくらですか** — how much is it?\n" +
        "**〔X〕を ください** — please give me X (for things in a shop)\n" +
        "**〔X〕を おねがいします** — X, please (a little more polite; the natural way to order food)\n" +
        "**じゃあ** — \"OK then…\", what you say when you've decided\n\n" +
        "Staff will say **いらっしゃいませ** (welcome) when you come in, and **どうぞ** when they hand you " +
        "something or invite you to go ahead. You can answer どうぞ with **どうも** (\"thanks\"), the " +
        "all-purpose short thank-you.\n\n" +
        "**Money.** Japan uses coins for 1, 5, 10, 50, 100 and 500 yen and notes for 1,000, 5,000 and " +
        "10,000 (2,000 exists but is rare). Card and phone payments are everywhere in cities, but small " +
        "restaurants and shops can be cash-only, so most people carry some.",
      examples: [
        { jp: "すみません。このTシャツは いくらですか。", en: "Excuse me, how much is this T-shirt?" },
        { jp: "にせんえんです。", en: "It's 2,000 yen." },
        { jp: "じゃあ、これを ください。", en: "OK, I'll take this one." },
        { jp: "コーヒーを おねがいします。", en: "A coffee, please." },
      ],
      watch: [
        "を after the thing you want: ペンを ください. (を is said \"o\".)",
        "いらっしゃいませ isn't said back. Customers just come in.",
      ],
      checks: [
        {
          q: "Ordering in a restaurant, the most natural phrase is:",
          choices: ["カレーを おねがいします。", "カレーです。", "カレーは どこですか。", "カレーの ください。"],
          answer: 0,
          why: "〜を おねがいします is the standard polite order.",
        },
        {
          q: "The waiter hands you the menu and says どうぞ. A short, natural reply:",
          choices: ["どうも。", "いらっしゃいませ。", "いってきます。", "ただいま。"],
          answer: 0,
          why: "どうも = thanks.",
        },
      ],
      games: ["flea-market", "restaurant"],
      ask: ["Is it rude to say ください to a shop clerk?", "How do I ask for the bill?"],
    },
    // ------------------------------------------------ warm-up: classroom
    {
      id: "classroom",
      kind: "warmup",
      optional: true,
      title: "きょうしつ",
      name: "Classroom phrases",
      genki: "Genki p. 81 · Useful Expressions (In the Classroom)",
      teach:
        "These are the sentences you'll hear and say every single class. Learn them as fixed chunks; the " +
        "grammar inside them (〜てください) comes in Lesson 6.\n\n" +
        "The three you most need as a student: **わかりません** (I don't understand), **もういちど いって " +
        "ください** (please say it again), and **ゆっくり いってください** (please say it slowly). " +
        "Teachers are always glad to hear them; they mean you're trying.",
      table: {
        caption: "Say these in class",
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
      },
      checks: [
        {
          q: "You didn't catch what the teacher said. Ask them to repeat it.",
          choices: ["もういちど いってください。", "わかりました。", "きいてください。", "ちょっと まってください。"],
          answer: 0,
          why: "もういちど = one more time.",
        },
      ],
      games: ["classroom-match"],
      ask: ["How do I ask what a word means?"],
    },
  ],
  dialogue: {
    title: "Saturday at the flea market",
    setting: "Lena and Min look around a flea market, then get lunch at a small restaurant.",
    lines: [
      { who: "みせのひと", jp: "いらっしゃいませ。", en: "Welcome!" },
      { who: "レナ", jp: "すみません。そのぼうしは いくらですか。", en: "Excuse me, how much is that hat?" },
      { who: "みせのひと", jp: "これですか。せんにひゃくえんです。", en: "This one? It's 1,200 yen." },
      { who: "レナ", jp: "あのかばんも いくらですか。", en: "And that bag over there, how much is it?" },
      { who: "みせのひと", jp: "あれは はっせんえんです。", en: "That's 8,000 yen." },
      { who: "ミン", jp: "たかいですね。", en: "That's expensive, isn't it?" },
      { who: "レナ", jp: "じゃあ、そのぼうしを ください。", en: "OK then, I'll take that hat." },
      { who: "ミン", jp: "あれ？ これは だれの さいふですか。", en: "Huh? Whose wallet is this?" },
      { who: "レナ", jp: "あっ、わたしのです。ありがとう！", en: "Oh, it's mine. Thanks!" },
      { who: "てんいん", jp: "いらっしゃいませ。メニューを どうぞ。", en: "Welcome. Here's the menu." },
      { who: "ミン", jp: "どうも。これは なんですか。", en: "Thanks. What's this?" },
      { who: "てんいん", jp: "それは うどんです。おいしいですよ。", en: "That's udon. It's good, I promise." },
      { who: "ミン", jp: "じゃあ、これを おねがいします。", en: "Then I'll have this, please." },
      { who: "レナ", jp: "わたしも うどんを おねがいします。", en: "Udon for me too, please." },
    ],
  },
  together: ["flea-market", "restaurant"],
  test: [
    {
      q: "The pen is in your friend's hand. \"Is that your pen?\"",
      jp: "＿は ミンさんの ペンですか。",
      choices: ["それ", "これ", "あれ", "その"],
      answer: 0,
      why: "Near the listener and standing alone → それ.",
    },
    {
      q: "¥800",
      choices: ["はっぴゃくえん", "はちひゃくえん", "はっひゃくえん", "はちびゃくえん"],
      answer: 0,
      why: "8 + ひゃく → はっぴゃく.",
    },
    {
      q: "\"How much is this bag?\"",
      choices: ["このかばんは いくらですか。", "これかばんは いくらですか。", "このは かばん いくらですか。", "かばんは このいくらですか。"],
      answer: 0,
      why: "この + noun.",
    },
    {
      q: "\"Excuse me, where's the toilet?\"",
      choices: ["すみません。トイレは どこですか。", "すみません。トイレは どれですか。", "すみません。トイレは なんですか。", "すみません。トイレを ください。"],
      answer: 0,
      why: "Places take どこ.",
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
      why: "Same fact, new person → も.",
    },
    {
      q: "\"I'm not an exchange student.\"",
      choices: ["りゅうがくせいじゃないです。", "りゅうがくせいないです。", "りゅうがくせいですじゃない。", "じゃないです りゅうがくせい。"],
      answer: 0,
      why: "Noun + じゃないです.",
    },
    {
      q: "You're telling a lost tourist something they don't know: the bank is over there.",
      jp: "ぎんこうは あそこです＿。",
      choices: ["よ", "ね", "か", "も"],
      answer: 0,
      why: "New information for the listener → よ.",
    },
    {
      q: "¥35,000",
      choices: ["さんまんごせんえん", "さんじゅうごせんえん", "さんまんごひゃくえん", "さんぜんごまんえん"],
      answer: 0,
      why: "3 ten-thousands + 5 thousands.",
    },
    {
      q: "Ordering food politely:",
      choices: ["ラーメンを おねがいします。", "ラーメンは ください。", "ラーメンです か。", "ラーメンの おねがいします。"],
      answer: 0,
      why: "を marks what you want; おねがいします is the polite order.",
    },
    {
      q: "Which one is written-style formal?",
      choices: ["がくせいではありません。", "がくせいじゃないです。", "がくせいじゃありません。", "がくせいないです。"],
      answer: 0,
      why: "ではありません is the formal, written negative.",
    },
    {
      q: "Your friend points at the T-shirt you're wearing: それは どこの Tシャツですか. You start your answer with:",
      choices: ["これは…", "それは…", "あれは…", "どれは…"],
      answer: 0,
      why: "From your side it's near you: これ.",
    },
  ],
};

export const GENKI_LESSONS: GenkiLesson[] = [L1, L2];

/** Every lesson in Genki I, for the course map; the first two are built. */
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
