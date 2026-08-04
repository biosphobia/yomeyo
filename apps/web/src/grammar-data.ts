/**
 * The grammar course content: units of annotated sentences, and the plain-
 * language grammar dictionary.
 *
 * The model (after Cure Dolly's "Unlocking Japanese"): every sentence is a
 * train. Cars carry words, the engine sits at the end and says what happens
 * or what something is, and the doer-car — who or what the sentence is
 * about — is always there, even when it is invisible. Nothing here uses
 * grammar jargon: cars have plain labels written per chunk, right in the
 * data, so the words a learner sees can be tuned by editing this file.
 *
 * Sentences are written in kana only — this sits next to the kana course —
 * with romaji carried per chunk for people still learning them.
 */

export type Role = "engine" | "doer" | "topic" | "ghost" | "object" | "other";

export interface Chunk {
  /** The text of this car, kana only, particle included: さくらが */
  t: string;
  /** Romaji for the car. */
  r: string;
  role: Role;
  /** The plain-words label shown when the sentence is opened up. */
  label: string;
  /** The particle this car ends with, when it has one. */
  p?: string;
  /** True when the particle is fair to quiz (only one right answer). */
  q?: boolean;
  /** True for a describing word glued to the NEXT car — it must stay
   * immediately before it, even where cars otherwise move freely. */
  glue?: boolean;
}

export interface Sentence {
  chunks: Chunk[];
  en: string;
  /** The literal skeleton, for sentences where it differs: "As for me, (it) is an eel." */
  lit?: string;
}

export type DrillKind = "find-engine" | "find-doer" | "particle" | "build";

export interface GrammarUnit {
  title: string;
  tagline: string;
  drills: DrillKind[];
  /** Particle choices offered in this unit's particle drill. */
  particles: string[];
  sentences: Sentence[];
}

// Shorthand builders keep the data readable.
const doer = (t: string, r: string): Chunk => ({ t, r, role: "doer", label: "who or what it's about", p: "が" });
const doerTopic = (t: string, r: string): Chunk => ({
  t,
  r,
  role: "doer",
  label: "who it's about, flying the “as for” flag",
  p: "は",
  q: true,
});
const topic = (t: string, r: string): Chunk => ({
  t,
  r,
  role: "topic",
  label: "the “as for” flag — what we're talking about",
  p: "は",
  q: true,
});
const ghost = (): Chunk => ({ t: "∅が", r: "(it)", role: "ghost", label: "the hidden doer — an invisible “it” or “I”" });
const engine = (t: string, r: string, label: string): Chunk => ({ t, r, role: "engine", label });
const doWord = (t: string, r: string): Chunk => engine(t, r, "the engine — a do-word");
const isWord = (t: string, r: string): Chunk => engine(t, r, "the engine — a describing word (its “is” is built in)");
const daWord = (t: string, r: string): Chunk => engine(t, r, "the engine — a thing + だ (“is”)");
const obj = (t: string, r: string): Chunk => ({ t, r, role: "object", label: "the thing it happens to", p: "を", q: true });
const car = (t: string, r: string, label: string, p?: string, q?: boolean): Chunk => ({
  t,
  r,
  role: "other",
  label,
  ...(p ? { p } : {}),
  ...(q ? { q } : {}),
});

export const GRAMMAR_UNITS: GrammarUnit[] = [
  {
    title: "The smallest sentence",
    tagline: "Someone or something + what it does or is. That's a whole sentence.",
    drills: ["find-engine", "find-doer", "build"],
    particles: ["が"],
    sentences: [
      { chunks: [doer("さくらが", "sakura ga"), doWord("あるく", "aruku")], en: "Sakura walks." },
      { chunks: [doer("ねこが", "neko ga"), doWord("ねる", "neru")], en: "The cat sleeps." },
      { chunks: [doer("はなが", "hana ga"), daWord("きれいだ", "kirei da")], en: "The flower is pretty." },
      { chunks: [doer("ペンが", "pen ga"), isWord("あかい", "akai")], en: "The pen is red." },
      { chunks: [doer("とりが", "tori ga"), doWord("とぶ", "tobu")], en: "The bird flies." },
      { chunks: [doer("みずが", "mizu ga"), isWord("つめたい", "tsumetai")], en: "The water is cold." },
      { chunks: [doer("さかなが", "sakana ga"), doWord("およぐ", "oyogu")], en: "The fish swims." },
      { chunks: [doer("いぬが", "inu ga"), isWord("おおきい", "ookii")], en: "The dog is big." },
    ],
  },
  {
    title: "The hidden doer",
    tagline: "は points at the topic. The real doer can hide — but it's always there.",
    drills: ["find-doer", "particle", "build"],
    particles: ["は", "が"],
    sentences: [
      {
        chunks: [topic("わたしは", "watashi wa"), ghost(), daWord("うなぎだ", "unagi da")],
        en: "I'll have the eel.",
        lit: "As for me, (it) is an eel.",
      },
      {
        chunks: [topic("わたしは", "watashi wa"), ghost(), daWord("がくせいだ", "gakusei da")],
        en: "I'm a student.",
        lit: "As for me, (I) am a student.",
      },
      {
        chunks: [topic("きょうは", "kyou wa"), ghost(), isWord("あつい", "atsui")],
        en: "It's hot today.",
        lit: "As for today, (it) is hot.",
      },
      {
        chunks: [topic("ねこは", "neko wa"), ghost(), isWord("かわいい", "kawaii")],
        en: "Cats are cute.",
        lit: "As for cats, (they) are cute.",
      },
      {
        chunks: [topic("あしたは", "ashita wa"), ghost(), daWord("やすみだ", "yasumi da")],
        en: "Tomorrow is a day off.",
        lit: "As for tomorrow, (it) is a day off.",
      },
      {
        chunks: [topic("にほんごは", "nihongo wa"), ghost(), isWord("たのしい", "tanoshii")],
        en: "Japanese is fun.",
        lit: "As for Japanese, (it) is fun.",
      },
      {
        chunks: [topic("さくらは", "sakura wa"), ghost(), isWord("やさしい", "yasashii")],
        en: "Sakura is kind.",
        lit: "As for Sakura, (she) is kind.",
      },
      {
        chunks: [topic("わたしは", "watashi wa"), ghost(), daWord("げんきだ", "genki da")],
        en: "I'm doing well.",
        lit: "As for me, (I) am well.",
      },
    ],
  },
  {
    title: "Doing things to things",
    tagline: "を marks what the doing lands on.",
    drills: ["find-engine", "find-doer", "particle", "build"],
    particles: ["を", "が", "は"],
    sentences: [
      { chunks: [doer("ねこが", "neko ga"), obj("さかなを", "sakana wo"), doWord("たべる", "taberu")], en: "The cat eats a fish." },
      {
        chunks: [doerTopic("わたしは", "watashi wa"), obj("みずを", "mizu wo"), doWord("のむ", "nomu")],
        en: "I drink water.",
        lit: "As for me, (I) drink water.",
      },
      { chunks: [doer("さくらが", "sakura ga"), obj("ほんを", "hon wo"), doWord("よむ", "yomu")], en: "Sakura reads a book." },
      { chunks: [doer("いぬが", "inu ga"), obj("ボールを", "booru wo"), doWord("とる", "toru")], en: "The dog takes the ball." },
      {
        chunks: [doerTopic("わたしは", "watashi wa"), obj("うたを", "uta wo"), doWord("うたう", "utau")],
        en: "I sing a song.",
        lit: "As for me, (I) sing a song.",
      },
      { chunks: [doer("とりが", "tori ga"), obj("むしを", "mushi wo"), doWord("たべる", "taberu")], en: "The bird eats a bug." },
      { chunks: [doer("こどもが", "kodomo ga"), obj("えを", "e wo"), doWord("かく", "kaku")], en: "The child draws a picture." },
      {
        chunks: [doerTopic("わたしは", "watashi wa"), obj("パンを", "pan wo"), doWord("かう", "kau")],
        en: "I buy bread.",
        lit: "As for me, (I) buy bread.",
      },
    ],
  },
  {
    title: "Where and how",
    tagline: "に pins a place or target. で says where or how it happens. へ points the way.",
    drills: ["find-engine", "particle", "build"],
    particles: ["に", "で", "へ", "を", "が"],
    sentences: [
      {
        chunks: [doer("さくらが", "sakura ga"), car("がっこうに", "gakkou ni", "where it lands — the destination", "に"), doWord("いく", "iku")],
        en: "Sakura goes to school.",
      },
      {
        chunks: [doer("ねこが", "neko ga"), car("へやに", "heya ni", "where it is", "に"), doWord("いる", "iru")],
        en: "The cat is in the room.",
      },
      {
        chunks: [doerTopic("わたしは", "watashi wa"), car("でんしゃで", "densha de", "how it's done — by train", "で", true), doWord("いく", "iku")],
        en: "I go by train.",
        lit: "As for me, (I) go by train.",
      },
      {
        chunks: [doer("こどもが", "kodomo ga"), car("こうえんで", "kouen de", "where it happens", "で", true), doWord("あそぶ", "asobu")],
        en: "The child plays in the park.",
      },
      {
        chunks: [doerTopic("わたしは", "watashi wa"), car("うちへ", "uchi e", "the direction — towards home", "へ"), doWord("かえる", "kaeru")],
        en: "I head home.",
        lit: "As for me, (I) return home.",
      },
      {
        chunks: [doer("さくらが", "sakura ga"), car("ともだちに", "tomodachi ni", "the target — the friend", "に", true), doWord("あう", "au")],
        en: "Sakura meets a friend.",
      },
      {
        chunks: [doerTopic("わたしは", "watashi wa"), car("はしで", "hashi de", "how it's done — with chopsticks", "で", true), doWord("たべる", "taberu")],
        en: "I eat with chopsticks.",
        lit: "As for me, (I) eat with chopsticks.",
      },
      {
        chunks: [doer("とりが", "tori ga"), car("そらへ", "sora e", "the direction — towards the sky", "へ"), doWord("とぶ", "tobu")],
        en: "The bird flies toward the sky.",
      },
    ],
  },
  {
    title: "From and until",
    tagline: "から is where it starts. まで is how far it goes.",
    drills: ["find-engine", "particle", "build"],
    particles: ["から", "まで", "に", "で"],
    sentences: [
      {
        chunks: [
          doerTopic("わたしは", "watashi wa"),
          car("あさから", "asa kara", "where it starts — the morning", "から", true),
          car("よるまで", "yoru made", "how far it goes — until night", "まで", true),
          doWord("はたらく", "hataraku"),
        ],
        en: "I work from morning until night.",
        lit: "As for me, (I) work from morning until night.",
      },
      {
        chunks: [doer("でんしゃが", "densha ga"), car("えきから", "eki kara", "where it starts", "から", true), doWord("でる", "deru")],
        en: "The train leaves from the station.",
      },
      {
        chunks: [
          doer("さくらが", "sakura ga"),
          car("うちから", "uchi kara", "where it starts", "から", true),
          car("がっこうまで", "gakkou made", "how far it goes", "まで", true),
          doWord("はしる", "hashiru"),
        ],
        en: "Sakura runs from home to school.",
      },
      {
        chunks: [topic("がっこうは", "gakkou wa"), ghost(), car("9じに", "ku-ji ni", "when it happens", "に"), doWord("はじまる", "hajimaru")],
        en: "School starts at nine.",
        lit: "As for school, (it) starts at nine.",
      },
      {
        chunks: [doerTopic("わたしは", "watashi wa"), car("ばんごはんまで", "bangohan made", "how far it goes — until dinner", "まで", true), doWord("まつ", "matsu")],
        en: "I wait until dinner.",
        lit: "As for me, (I) wait until dinner.",
      },
      {
        chunks: [doer("ふゆが", "fuyu ga"), car("12がつから", "juuni-gatsu kara", "where it starts", "から", true), doWord("はじまる", "hajimaru")],
        en: "Winter starts in December.",
      },
      {
        chunks: [doerTopic("わたしは", "watashi wa"), car("えきまで", "eki made", "how far it goes — as far as the station", "まで", true), doWord("あるく", "aruku")],
        en: "I walk to the station.",
        lit: "As for me, (I) walk as far as the station.",
      },
    ],
  },
  {
    title: "Describing words",
    tagline: "い-words carry their own “is”. な is just だ in its glue-on shape.",
    drills: ["find-engine", "find-doer", "build"],
    particles: ["が", "は"],
    sentences: [
      { chunks: [doer("そらが", "sora ga"), isWord("あおい", "aoi")], en: "The sky is blue." },
      { chunks: [doer("うみが", "umi ga"), daWord("しずかだ", "shizuka da")], en: "The sea is quiet." },
      {
        chunks: [
          { ...car("あかい", "akai", "a describing word, glued to the next car"), glue: true },
          doer("はなが", "hana ga"),
          doWord("さく", "saku"),
        ],
        en: "A red flower blooms.",
      },
      {
        chunks: [
          { ...car("おおきい", "ookii", "a describing word, glued to the next car"), glue: true },
          doer("いぬが", "inu ga"),
          doWord("ねる", "neru"),
        ],
        en: "A big dog sleeps.",
      },
      {
        chunks: [
          { ...car("きれいな", "kirei na", "a describing word — な is its だ, in glue-on shape"), glue: true },
          doer("とりが", "tori ga"),
          doWord("とぶ", "tobu"),
        ],
        en: "A pretty bird flies.",
      },
      { chunks: [topic("にほんごは", "nihongo wa"), ghost(), isWord("おもしろい", "omoshiroi")], en: "Japanese is interesting.", lit: "As for Japanese, (it) is interesting." },
      {
        chunks: [
          { ...car("ちいさい", "chiisai", "a describing word, glued to the next car"), glue: true },
          doer("ねこが", "neko ga"),
          isWord("かわいい", "kawaii"),
        ],
        en: "The small cat is cute.",
      },
      { chunks: [doer("ゆきが", "yuki ga"), isWord("しろい", "shiroi")], en: "The snow is white." },
    ],
  },
];

// ---------------- the grammar dictionary ----------------

/** One JLPT dictionary entry: the pattern, its plain name, one breath of
 * meaning, one example. The per-level lists live in grammar-jlpt-*.ts. */
export interface JlptPoint {
  /** The pattern itself: 〜てもいい */
  t: string;
  /** The plain-words name: "it's okay to". */
  n: string;
  /** One or two short sentences, no jargon. */
  e: string;
  /** One example. */
  ex: string;
  en: string;
}

export interface GrammarPoint {
  id: string;
  /** The thing itself: が, だ, … */
  title: string;
  /** The plain-words name. */
  name: string;
  /** One to three short sentences, no jargon. */
  explanation: string;
  /** Which unit teaches it (1-based); 0 = the big picture. */
  unit: number;
  examples: { jp: string; en: string }[];
}

export const GRAMMAR_POINTS: GrammarPoint[] = [
  {
    id: "engine",
    title: "The engine",
    name: "every sentence ends with one",
    explanation:
      "A Japanese sentence is like a train: the engine comes last and says what happens or what something is. There are only three kinds of engine: a do-word (あるく), a describing い-word (あかい), or a thing + だ (うなぎだ).",
    unit: 1,
    examples: [
      { jp: "さくらが あるく。", en: "Sakura walks. (do-word engine)" },
      { jp: "ペンが あかい。", en: "The pen is red. (describing-word engine)" },
      { jp: "はなが きれいだ。", en: "The flower is pretty. (thing + だ engine)" },
    ],
  },
  {
    id: "ga",
    title: "が",
    name: "who's doing it",
    explanation:
      "が marks who or what the sentence is about — the one doing or being. Every sentence has a が, even when you can't see it.",
    unit: 1,
    examples: [
      { jp: "ねこが ねる。", en: "The cat sleeps." },
      { jp: "みずが つめたい。", en: "The water is cold." },
    ],
  },
  {
    id: "da",
    title: "だ",
    name: "the “is” for things",
    explanation: "だ turns a thing into an engine: A だ means “(it) is A”. It only works one way — さくらが にほんじんだ says Sakura = Japanese person, not the reverse. In polite speech it becomes です.",
    unit: 1,
    examples: [
      { jp: "あしたは やすみだ。", en: "Tomorrow is a day off." },
      { jp: "わたしは がくせいだ。", en: "I'm a student." },
    ],
  },
  {
    id: "wa",
    title: "は",
    name: "the “as for” flag",
    explanation:
      "は doesn't mark the doer — it points at the topic: “as for X…”. The doer is still there, often hiding. わたしは うなぎだ isn't “I am an eel”; it's “as for me, (it) is an eel”.",
    unit: 2,
    examples: [
      { jp: "わたしは うなぎだ。", en: "As for me, (it) is an eel. — I'll have the eel." },
      { jp: "きょうは あつい。", en: "As for today, (it) is hot." },
    ],
  },
  {
    id: "ghost",
    title: "∅ (the hidden doer)",
    name: "the invisible “it”",
    explanation:
      "Japanese leaves out what's obvious. When nobody says who does it, an invisible doer is doing the job — with its invisible が. Its usual value is “I”, but context can make it anything: ウサギだ, “(that thing) is a rabbit”.",
    unit: 2,
    examples: [
      { jp: "ねこは かわいい。", en: "As for cats, (they) are cute." },
      { jp: "あつい。", en: "(It) is hot." },
    ],
  },
  {
    id: "wo",
    title: "を",
    name: "what it's done to",
    explanation: "を marks the thing the doing lands on: たべる (eat) — what gets eaten wears を.",
    unit: 3,
    examples: [
      { jp: "ねこが さかなを たべる。", en: "The cat eats a fish." },
      { jp: "さくらが ほんを よむ。", en: "Sakura reads a book." },
    ],
  },
  {
    id: "ni",
    title: "に",
    name: "the pin: to / at / on",
    explanation:
      "に pins a point: the place something goes to or sits at, the person something is aimed at, or the time it happens.",
    unit: 4,
    examples: [
      { jp: "さくらが がっこうに いく。", en: "Sakura goes to school." },
      { jp: "ねこが へやに いる。", en: "The cat is in the room." },
    ],
  },
  {
    id: "de",
    title: "で",
    name: "where or how it happens",
    explanation: "で tags the scene of the action, or the tool it's done with.",
    unit: 4,
    examples: [
      { jp: "こどもが こうえんで あそぶ。", en: "The child plays in the park." },
      { jp: "わたしは はしで たべる。", en: "I eat with chopsticks." },
    ],
  },
  {
    id: "e",
    title: "へ",
    name: "the “towards” arrow",
    explanation: "へ points a direction: towards home, towards the sky. Softer than に — the journey, not the pin.",
    unit: 4,
    examples: [
      { jp: "わたしは うちへ かえる。", en: "I head home." },
      { jp: "とりが そらへ とぶ。", en: "The bird flies toward the sky." },
    ],
  },
  {
    id: "kara",
    title: "から",
    name: "from",
    explanation: "から marks where or when something starts.",
    unit: 5,
    examples: [
      { jp: "でんしゃが えきから でる。", en: "The train leaves from the station." },
      { jp: "ふゆが 12がつから はじまる。", en: "Winter starts in December." },
    ],
  },
  {
    id: "made",
    title: "まで",
    name: "until / as far as",
    explanation: "まで marks how far something goes — in place or in time.",
    unit: 5,
    examples: [
      { jp: "わたしは えきまで あるく。", en: "I walk as far as the station." },
      { jp: "わたしは ばんごはんまで まつ。", en: "I wait until dinner." },
    ],
  },
  {
    id: "i-adj",
    title: "い-words",
    name: "describing words with “is” built in",
    explanation:
      "Words like あかい and つめたい end in い and carry their own “is” — they can be an engine all by themselves. Put one before a thing and it glues on: あかい はな, “a red flower”.",
    unit: 6,
    examples: [
      { jp: "そらが あおい。", en: "The sky is blue." },
      { jp: "あかい はなが さく。", en: "A red flower blooms." },
    ],
  },
  {
    id: "na-adj",
    title: "な-words",
    name: "describing words that borrow",
    explanation:
      "Words like きれい and しずか are really thing-words. To be an engine they take だ; and な is just だ changing shape to glue onto the next word: きれいな とり, “a pretty bird”.",
    unit: 6,
    examples: [
      { jp: "うみが しずかだ。", en: "The sea is quiet." },
      { jp: "きれいな とりが とぶ。", en: "A pretty bird flies." },
    ],
  },
];
