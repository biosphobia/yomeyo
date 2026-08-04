/**
 * The grammar course content: units of annotated sentences, and the plain-
 * language grammar dictionary.
 *
 * The model comes from Cure Dolly's lessons, but none of her vocabulary
 * ("engine", "carriage", "A-car") reaches the screen, and neither does the
 * textbook vocabulary ("subject", "predicate", "copula"). A beginner sees
 * only what each piece MEANS and what job it is doing, in ordinary words:
 *
 *   ねこ  が   ねる
 *   the cat    sleeps
 *   the one    what
 *   doing it   happens
 *
 * Every chunk therefore carries `g`, its English meaning, which is shown
 * under the Japanese. The `label` is the job, in plain words. Both are
 * written per sentence right here, so the wording a learner reads can be
 * changed by editing this file alone.
 *
 * Sentences are kana only — this sits beside the kana course — with romaji
 * per chunk for people still learning them.
 */

export type Role = "engine" | "doer" | "topic" | "ghost" | "object" | "other";

export interface Chunk {
  /** The piece, kana only, particle included: さくらが */
  t: string;
  /** Romaji, particle last: "sakura ga" */
  r: string;
  /** What this piece means in English: "Sakura" */
  g: string;
  role: Role;
  /** The job it does, in plain words: "the one doing it" */
  label: string;
  /** The particle this piece ends with, when it has one. */
  p?: string;
  /**
   * だ or です, when the piece ends with one. Shown as a small block of its
   * own — うなぎ｜だ — because it is a word doing its own job ("it IS that"),
   * not part of うなぎ. It is not a particle and never shares their colour.
   */
  tail?: string;
  /** True when the particle is fair to quiz (only one right answer). */
  q?: boolean;
  /** True for a piece bound to the NEXT one — it must stay just before it. */
  glue?: boolean;
}

export interface Sentence {
  chunks: Chunk[];
  en: string;
  /** The word-for-word version, when it differs: "As for me, (it) is eel." */
  lit?: string;
}

export type DrillKind =
  | "find-engine"
  | "find-doer"
  | "particle"
  | "build"
  | "meaning"
  | "who"
  | "swap"
  | "translate"
  | "real"
  | "listen";

/**
 * Two sentences built from the same words, where only the little connecting
 * words differ — so the meaning changes completely. Nothing teaches what
 * those words are FOR like seeing them move.
 */
export interface SwapPair {
  a: { jp: string; r: string; en: string };
  b: { jp: string; r: string; en: string };
  /** What actually moved, in plain words. */
  note: string;
}

export const SWAP_PAIRS: SwapPair[] = [
  {
    a: { jp: "わたしが さくらに ボールを なげる", r: "watashi ga sakura ni booru wo nageru", en: "I throw the ball to Sakura." },
    b: { jp: "さくらが わたしに ボールを なげる", r: "sakura ga watashi ni booru wo nageru", en: "Sakura throws the ball to me." },
    note: "が moved, so the thrower changed.",
  },
  {
    a: { jp: "ねこが さかなを たべる", r: "neko ga sakana wo taberu", en: "The cat eats the fish." },
    b: { jp: "さかなが ねこを たべる", r: "sakana ga neko wo taberu", en: "The fish eats the cat." },
    note: "が and を swapped, so who eats whom flipped.",
  },
  {
    a: { jp: "いぬが こどもを おいかける", r: "inu ga kodomo wo oikakeru", en: "The dog chases the child." },
    b: { jp: "こどもが いぬを おいかける", r: "kodomo ga inu wo oikakeru", en: "The child chases the dog." },
    note: "が and を swapped, so the chaser changed.",
  },
  {
    a: { jp: "さくらが ともだちに てがみを かく", r: "sakura ga tomodachi ni tegami wo kaku", en: "Sakura writes a letter to a friend." },
    b: { jp: "ともだちが さくらに てがみを かく", r: "tomodachi ga sakura ni tegami wo kaku", en: "A friend writes a letter to Sakura." },
    note: "が moved, so the writer changed.",
  },
  {
    a: { jp: "ははが ちちを よぶ", r: "haha ga chichi wo yobu", en: "Mum calls Dad." },
    b: { jp: "ちちが ははを よぶ", r: "chichi ga haha wo yobu", en: "Dad calls Mum." },
    note: "が and を swapped, so the caller changed.",
  },
];

export interface GrammarUnit {
  title: string;
  tagline: string;
  drills: DrillKind[];
  /** Particle choices offered in this unit's particle drill. */
  particles: string[];
  sentences: Sentence[];
}

/**
 * だ and です are not connecting words — they are the ending itself, saying
 * that the thing before them is what the sentence is about. Shown separately
 * so a beginner sees where "is" actually lives in a Japanese sentence.
 */
export const TAIL_JOB: Record<string, string> = {
  だ: "says it IS that",
  です: "says it IS that, politely",
};

/**
 * What each little connecting word does, shown under it. Looked up by the
 * particle itself, so it stays the same everywhere without being repeated
 * in every sentence.
 */
export const PARTICLE_JOB: Record<string, string> = {
  が: "points out who's doing it",
  は: "as for…",
  を: "what the action lands on",
  に: "to / at / on",
  で: "where or how",
  へ: "towards",
  から: "from",
  まで: "until",
};

// ---- builders: every piece gets its English meaning and its job ----

const doer = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "doer",
  label: "the one doing it",
  p: "が",
});
/** A doer wearing は instead of が — Japanese drops が when は takes over. */
const doerTopic = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "doer",
  label: "who it's about",
  p: "は",
  q: true,
});
const topic = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "topic",
  label: "what we're talking about",
  p: "は",
  q: true,
});
/** Nobody said who — but it is still there. `g` is who it means here. */
const ghost = (g: string): Chunk => ({
  t: "",
  r: "",
  g,
  role: "ghost",
  label: "nobody said this — but it's there",
});
const doWord = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "engine",
  label: "what happens",
});
const isWord = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "engine",
  label: "what it's like",
});
/**
 * A thing + だ. The だ is split off into its own block: "is" is a word in
 * Japanese too, and hiding it inside うなぎだ is exactly what leaves beginners
 * unable to find it later.
 */
const daWord = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "engine",
  label: "what it is",
  tail: t.endsWith("です") ? "です" : t.endsWith("だ") ? "だ" : undefined,
});
const obj = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "object",
  label: "what it happens to",
  p: "を",
  q: true,
});
const car = (t: string, r: string, g: string, label: string, p?: string, q?: boolean): Chunk => ({
  t,
  r,
  g,
  role: "other",
  label,
  ...(p ? { p } : {}),
  ...(q ? { q } : {}),
});
/** A describing word stuck to the next piece: あかい はな. */
const describes = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "other",
  label: "describes the next word",
  glue: true,
});
/** Part of a little sentence parked in front of a word, describing it. */
const inner = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "other",
  label: "part of the description",
  glue: true,
});
const innerDoer = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "other",
  label: "who did it, inside the description",
  p: "が",
  glue: true,
});
const innerObj = (t: string, r: string, g: string): Chunk => ({
  t,
  r,
  g,
  role: "other",
  label: "what it happened to, inside the description",
  p: "を",
  glue: true,
});
/** A first sentence wearing a hook so a second can follow. */
const joiner = (t: string, r: string, g: string, label: string): Chunk => ({
  t,
  r,
  g,
  role: "other",
  label,
});

export const GRAMMAR_UNITS: GrammarUnit[] = [
  {
    title: "The smallest sentence",
    tagline: "Someone or something, then what they do. That is already a whole sentence.",
    drills: ["find-engine", "real", "find-doer", "meaning", "listen", "build"],
    particles: ["が"],
    sentences: [
      { chunks: [doer("さくらが", "sakura ga", "Sakura"), doWord("あるく", "aruku", "walks")], en: "Sakura walks." },
      { chunks: [doer("ねこが", "neko ga", "the cat"), doWord("ねる", "neru", "sleeps")], en: "The cat sleeps." },
      { chunks: [doer("はなが", "hana ga", "the flower"), daWord("きれいだ", "kirei da", "is pretty")], en: "The flower is pretty." },
      { chunks: [doer("ペンが", "pen ga", "the pen"), isWord("あかい", "akai", "is red")], en: "The pen is red." },
      { chunks: [doer("とりが", "tori ga", "the bird"), doWord("とぶ", "tobu", "flies")], en: "The bird flies." },
      { chunks: [doer("みずが", "mizu ga", "the water"), isWord("つめたい", "tsumetai", "is cold")], en: "The water is cold." },
      { chunks: [doer("さかなが", "sakana ga", "the fish"), doWord("およぐ", "oyogu", "swims")], en: "The fish swims." },
      { chunks: [doer("いぬが", "inu ga", "the dog"), isWord("おおきい", "ookii", "is big")], en: "The dog is big." },
    ],
  },
  {
    title: "When nobody says who",
    tagline: "Japanese leaves out what's obvious. You fill it in from context.",
    drills: ["find-doer", "who", "particle", "meaning", "translate", "build"],
    particles: ["は", "が"],
    sentences: [
      {
        chunks: [topic("わたしは", "watashi wa", "as for me"), ghost("it"), daWord("うなぎだ", "unagi da", "is eel")],
        en: "I'll have the eel.",
        lit: "As for me, (it) is eel.",
      },
      {
        chunks: [topic("わたしは", "watashi wa", "as for me"), ghost("I"), daWord("がくせいだ", "gakusei da", "am a student")],
        en: "I'm a student.",
        lit: "As for me, (I) am a student.",
      },
      {
        chunks: [topic("きょうは", "kyou wa", "as for today"), ghost("it"), isWord("あつい", "atsui", "is hot")],
        en: "It's hot today.",
        lit: "As for today, (it) is hot.",
      },
      {
        chunks: [topic("ねこは", "neko wa", "as for cats"), ghost("they"), isWord("かわいい", "kawaii", "are cute")],
        en: "Cats are cute.",
        lit: "As for cats, (they) are cute.",
      },
      {
        chunks: [topic("あしたは", "ashita wa", "as for tomorrow"), ghost("it"), daWord("やすみだ", "yasumi da", "is a day off")],
        en: "Tomorrow is a day off.",
        lit: "As for tomorrow, (it) is a day off.",
      },
      {
        chunks: [topic("にほんごは", "nihongo wa", "as for Japanese"), ghost("it"), isWord("たのしい", "tanoshii", "is fun")],
        en: "Japanese is fun.",
        lit: "As for Japanese, (it) is fun.",
      },
      {
        chunks: [topic("さくらは", "sakura wa", "as for Sakura"), ghost("she"), isWord("やさしい", "yasashii", "is kind")],
        en: "Sakura is kind.",
        lit: "As for Sakura, (she) is kind.",
      },
      {
        chunks: [topic("わたしは", "watashi wa", "as for me"), ghost("I"), daWord("げんきだ", "genki da", "am well")],
        en: "I'm doing well.",
        lit: "As for me, (I) am well.",
      },
    ],
  },
  {
    title: "Doing something to something",
    tagline: "を shows what the action lands on.",
    drills: ["find-engine", "find-doer", "particle", "swap", "meaning", "listen", "build"],
    particles: ["を", "が", "は"],
    sentences: [
      {
        chunks: [doer("ねこが", "neko ga", "the cat"), obj("さかなを", "sakana wo", "a fish"), doWord("たべる", "taberu", "eats")],
        en: "The cat eats a fish.",
      },
      {
        chunks: [doerTopic("わたしは", "watashi wa", "me"), obj("みずを", "mizu wo", "water"), doWord("のむ", "nomu", "drink")],
        en: "I drink water.",
        lit: "As for me, (I) drink water.",
      },
      {
        chunks: [doer("さくらが", "sakura ga", "Sakura"), obj("ほんを", "hon wo", "a book"), doWord("よむ", "yomu", "reads")],
        en: "Sakura reads a book.",
      },
      {
        chunks: [doer("いぬが", "inu ga", "the dog"), obj("ボールを", "booru wo", "the ball"), doWord("とる", "toru", "takes")],
        en: "The dog takes the ball.",
      },
      {
        chunks: [doerTopic("わたしは", "watashi wa", "me"), obj("うたを", "uta wo", "a song"), doWord("うたう", "utau", "sing")],
        en: "I sing a song.",
        lit: "As for me, (I) sing a song.",
      },
      {
        chunks: [doer("とりが", "tori ga", "the bird"), obj("むしを", "mushi wo", "a bug"), doWord("たべる", "taberu", "eats")],
        en: "The bird eats a bug.",
      },
      {
        chunks: [doer("こどもが", "kodomo ga", "the child"), obj("えを", "e wo", "a picture"), doWord("かく", "kaku", "draws")],
        en: "The child draws a picture.",
      },
      {
        chunks: [doerTopic("わたしは", "watashi wa", "me"), obj("パンを", "pan wo", "bread"), doWord("かう", "kau", "buy")],
        en: "I buy bread.",
        lit: "As for me, (I) buy bread.",
      },
    ],
  },
  {
    title: "Where and how",
    tagline: "に pins a spot. で says where or how it happens. へ points the way.",
    drills: ["find-engine", "particle", "swap", "meaning", "translate", "build"],
    particles: ["に", "で", "へ", "を", "が"],
    sentences: [
      {
        chunks: [
          doer("さくらが", "sakura ga", "Sakura"),
          car("がっこうに", "gakkou ni", "to school", "where it ends up", "に"),
          doWord("いく", "iku", "goes"),
        ],
        en: "Sakura goes to school.",
      },
      {
        chunks: [
          doer("ねこが", "neko ga", "the cat"),
          car("へやに", "heya ni", "in the room", "where it is", "に"),
          doWord("いる", "iru", "is"),
        ],
        en: "The cat is in the room.",
      },
      {
        chunks: [
          doerTopic("わたしは", "watashi wa", "me"),
          car("でんしゃで", "densha de", "by train", "how it's done", "で", true),
          doWord("いく", "iku", "go"),
        ],
        en: "I go by train.",
        lit: "As for me, (I) go by train.",
      },
      {
        chunks: [
          doer("こどもが", "kodomo ga", "the child"),
          car("こうえんで", "kouen de", "in the park", "where it happens", "で", true),
          doWord("あそぶ", "asobu", "plays"),
        ],
        en: "The child plays in the park.",
      },
      {
        chunks: [
          doerTopic("わたしは", "watashi wa", "me"),
          car("うちへ", "uchi e", "towards home", "which way", "へ"),
          doWord("かえる", "kaeru", "head back"),
        ],
        en: "I head home.",
        lit: "As for me, (I) head home.",
      },
      {
        chunks: [
          doer("さくらが", "sakura ga", "Sakura"),
          car("ともだちに", "tomodachi ni", "a friend", "who it's aimed at", "に", true),
          doWord("あう", "au", "meets"),
        ],
        en: "Sakura meets a friend.",
      },
      {
        chunks: [
          doerTopic("わたしは", "watashi wa", "me"),
          car("はしで", "hashi de", "with chopsticks", "what it's done with", "で", true),
          doWord("たべる", "taberu", "eat"),
        ],
        en: "I eat with chopsticks.",
        lit: "As for me, (I) eat with chopsticks.",
      },
      {
        chunks: [
          doer("とりが", "tori ga", "the bird"),
          car("そらへ", "sora e", "towards the sky", "which way", "へ"),
          doWord("とぶ", "tobu", "flies"),
        ],
        en: "The bird flies toward the sky.",
      },
    ],
  },
  {
    title: "From and until",
    tagline: "から is where it starts. まで is how far it goes.",
    drills: ["find-engine", "particle", "real", "listen", "build"],
    particles: ["から", "まで", "に", "で"],
    sentences: [
      {
        chunks: [
          doerTopic("わたしは", "watashi wa", "me"),
          car("あさから", "asa kara", "from morning", "where it starts", "から", true),
          car("よるまで", "yoru made", "until night", "how far it goes", "まで", true),
          doWord("はたらく", "hataraku", "work"),
        ],
        en: "I work from morning until night.",
        lit: "As for me, (I) work from morning until night.",
      },
      {
        chunks: [
          doer("でんしゃが", "densha ga", "the train"),
          car("えきから", "eki kara", "from the station", "where it starts", "から", true),
          doWord("でる", "deru", "leaves"),
        ],
        en: "The train leaves from the station.",
      },
      {
        chunks: [
          doer("さくらが", "sakura ga", "Sakura"),
          car("うちから", "uchi kara", "from home", "where it starts", "から", true),
          car("がっこうまで", "gakkou made", "to school", "how far it goes", "まで", true),
          doWord("はしる", "hashiru", "runs"),
        ],
        en: "Sakura runs from home to school.",
      },
      {
        chunks: [
          topic("がっこうは", "gakkou wa", "as for school"),
          ghost("it"),
          car("9じに", "ku-ji ni", "at nine", "when it happens", "に"),
          doWord("はじまる", "hajimaru", "starts"),
        ],
        en: "School starts at nine.",
        lit: "As for school, (it) starts at nine.",
      },
      {
        chunks: [
          doerTopic("わたしは", "watashi wa", "me"),
          car("ばんごはんまで", "bangohan made", "until dinner", "how far it goes", "まで", true),
          doWord("まつ", "matsu", "wait"),
        ],
        en: "I wait until dinner.",
        lit: "As for me, (I) wait until dinner.",
      },
      {
        chunks: [
          doer("ふゆが", "fuyu ga", "winter"),
          car("12がつから", "juuni-gatsu kara", "from December", "where it starts", "から", true),
          doWord("はじまる", "hajimaru", "starts"),
        ],
        en: "Winter starts in December.",
      },
      {
        chunks: [
          doerTopic("わたしは", "watashi wa", "me"),
          car("えきまで", "eki made", "as far as the station", "how far it goes", "まで", true),
          doWord("あるく", "aruku", "walk"),
        ],
        en: "I walk to the station.",
        lit: "As for me, (I) walk as far as the station.",
      },
    ],
  },
  {
    title: "Describing words",
    tagline: "Words like あかい already contain “is”. Others borrow だ, or use な to stick on.",
    drills: ["find-engine", "find-doer", "translate", "build"],
    particles: ["が", "は"],
    sentences: [
      { chunks: [doer("そらが", "sora ga", "the sky"), isWord("あおい", "aoi", "is blue")], en: "The sky is blue." },
      { chunks: [doer("うみが", "umi ga", "the sea"), daWord("しずかだ", "shizuka da", "is quiet")], en: "The sea is quiet." },
      {
        chunks: [describes("あかい", "akai", "red"), doer("はなが", "hana ga", "a flower"), doWord("さく", "saku", "blooms")],
        en: "A red flower blooms.",
      },
      {
        chunks: [describes("おおきい", "ookii", "big"), doer("いぬが", "inu ga", "a dog"), doWord("ねる", "neru", "sleeps")],
        en: "A big dog sleeps.",
      },
      {
        chunks: [describes("きれいな", "kirei na", "pretty"), doer("とりが", "tori ga", "a bird"), doWord("とぶ", "tobu", "flies")],
        en: "A pretty bird flies.",
      },
      {
        chunks: [topic("にほんごは", "nihongo wa", "as for Japanese"), ghost("it"), isWord("おもしろい", "omoshiroi", "is interesting")],
        en: "Japanese is interesting.",
        lit: "As for Japanese, (it) is interesting.",
      },
      {
        chunks: [describes("ちいさい", "chiisai", "small"), doer("ねこが", "neko ga", "the cat"), isWord("かわいい", "kawaii", "is cute")],
        en: "The small cat is cute.",
      },
      { chunks: [doer("ゆきが", "yuki ga", "the snow"), isWord("しろい", "shiroi", "is white")], en: "The snow is white." },
    ],
  },
  {
    title: "Describing with a whole sentence",
    tagline: "A little sentence can sit in front of a word and describe it.",
    drills: ["find-engine", "find-doer", "meaning", "real", "build"],
    particles: ["が", "を"],
    sentences: [
      {
        chunks: [
          inner("うたった", "utatta", "sang"),
          doer("しょうじょが", "shoujo ga", "the girl"),
          doWord("ねている", "nete iru", "is sleeping"),
        ],
        en: "The girl who sang is sleeping.",
        lit: "The sang-girl is sleeping.",
      },
      {
        chunks: [
          innerObj("じしょを", "jisho wo", "the dictionary"),
          inner("たべた", "tabeta", "ate"),
          doer("いぬが", "inu ga", "the dog"),
          isWord("おおきい", "ookii", "is big"),
        ],
        en: "The dog that ate the dictionary is big.",
        lit: "The ate-the-dictionary dog is big.",
      },
      {
        chunks: [inner("はしる", "hashiru", "running"), doer("いぬが", "inu ga", "the dog"), isWord("しろい", "shiroi", "is white")],
        en: "The running dog is white.",
      },
      {
        chunks: [
          innerDoer("さくらが", "sakura ga", "Sakura"),
          inner("よんだ", "yonda", "read"),
          doer("ほんが", "hon ga", "the book"),
          isWord("おもしろい", "omoshiroi", "is interesting"),
        ],
        en: "The book Sakura read is interesting.",
        lit: "The Sakura-read book is interesting.",
      },
      {
        chunks: [inner("ねている", "nete iru", "sleeping"), doer("ねこが", "neko ga", "the cat"), isWord("かわいい", "kawaii", "is cute")],
        en: "The sleeping cat is cute.",
      },
      {
        chunks: [
          innerDoer("わたしが", "watashi ga", "I"),
          inner("かいた", "kaita", "drew"),
          doer("えが", "e ga", "the picture"),
          isWord("ちいさい", "chiisai", "is small"),
        ],
        en: "The picture I drew is small.",
        lit: "The I-drew picture is small.",
      },
      {
        chunks: [
          innerObj("みずを", "mizu wo", "the water"),
          inner("のんだ", "nonda", "drank"),
          doer("とりが", "tori ga", "the bird"),
          doWord("とぶ", "tobu", "flies"),
        ],
        en: "The bird that drank the water flies.",
      },
    ],
  },
  {
    title: "Joining two sentences",
    tagline: "The first one changes shape to hook on. The last word still finishes everything.",
    drills: ["find-engine", "meaning", "listen", "build"],
    particles: ["を", "に", "が"],
    sentences: [
      {
        chunks: [
          obj("パンを", "pan wo", "bread"),
          joiner("たべて", "tabete", "eat and then…", "the first sentence, hooked on"),
          doWord("ねる", "neru", "sleep"),
        ],
        en: "(I) eat bread and then sleep.",
      },
      {
        chunks: [
          joiner("さむいから", "samui kara", "because it's cold", "the reason, with から"),
          car("うちに", "uchi ni", "at home", "where it is", "に"),
          doWord("いる", "iru", "stay"),
        ],
        en: "It's cold, so (I) stay home.",
      },
      {
        chunks: [
          joiner("やすいけど", "yasui kedo", "it's cheap, but", "the first sentence, with けど"),
          ghost("I"),
          doWord("かわない", "kawanai", "won't buy it"),
        ],
        en: "It's cheap, but (I) won't buy it.",
      },
      {
        chunks: [
          joiner("あさ おきて", "asa okite", "wake up in the morning and…", "the first sentence, hooked on"),
          obj("みずを", "mizu wo", "water"),
          doWord("のむ", "nomu", "drink"),
        ],
        en: "(I) wake up in the morning and drink water.",
      },
      {
        chunks: [
          joiner("あめが ふって", "ame ga futte", "it rains and…", "the first sentence, hooked on"),
          doer("さくらが", "sakura ga", "Sakura"),
          doWord("かえる", "kaeru", "goes home"),
        ],
        en: "It rains and Sakura goes home.",
      },
      {
        chunks: [
          joiner("たかいから", "takai kara", "because it's expensive", "the reason, with から"),
          ghost("I"),
          doWord("かわない", "kawanai", "won't buy it"),
        ],
        en: "It's expensive, so (I) won't buy it.",
      },
      {
        chunks: [
          obj("ほんを", "hon wo", "a book"),
          joiner("よんで", "yonde", "read and then…", "the first sentence, hooked on"),
          obj("えを", "e wo", "a picture"),
          doWord("かく", "kaku", "draw"),
        ],
        en: "(I) read a book and then draw a picture.",
      },
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
    title: "The last word",
    name: "it finishes every sentence",
    explanation:
      "Japanese saves the point for last. The final word tells you what happens or what something is, and it comes in only three kinds: an action (あるく, walks), a describing word ending in い (あかい, is red), or a thing plus だ (うなぎだ, is eel).",
    unit: 1,
    examples: [
      { jp: "さくらが あるく。", en: "Sakura walks. (an action)" },
      { jp: "ペンが あかい。", en: "The pen is red. (a describing word)" },
      { jp: "はなが きれいだ。", en: "The flower is pretty. (a thing + だ)" },
    ],
  },
  {
    id: "ga",
    title: "が",
    name: "points out who's doing it",
    explanation:
      "が marks the one doing or being. Every sentence has one, even when nobody says it out loud.",
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
    explanation:
      "A thing plus だ finishes a sentence: A だ means “(it) is A”. It only points one way — さくらが にほんじんだ says Sakura is a Japanese person, not that Japanese people are Sakura. Politely it becomes です.",
    unit: 1,
    examples: [
      { jp: "あしたは やすみだ。", en: "Tomorrow is a day off." },
      { jp: "わたしは がくせいだ。", en: "I'm a student." },
    ],
  },
  {
    id: "wa",
    title: "は",
    name: "as for…",
    explanation:
      "は doesn't say who does anything. It sets what you're talking about: “as for X…”. The doer is separate, and often unsaid. わたしは うなぎだ isn't “I am an eel” — it's “as for me, (it) is eel”, which is how you order dinner.",
    unit: 2,
    examples: [
      { jp: "わたしは うなぎだ。", en: "As for me, (it) is eel. — I'll have the eel." },
      { jp: "きょうは あつい。", en: "As for today, (it) is hot." },
    ],
  },
  {
    id: "ghost",
    title: "the unsaid one",
    name: "when nobody says who",
    explanation:
      "Japanese drops whatever is obvious. If nobody says who, someone is still doing it — usually “I”, but context decides. ウサギだ on a walk means “(that) is a rabbit”. Ask yourself who or what it's about, and it appears.",
    unit: 2,
    examples: [
      { jp: "ねこは かわいい。", en: "As for cats, (they) are cute." },
      { jp: "あつい。", en: "(It) is hot." },
    ],
  },
  {
    id: "wo",
    title: "を",
    name: "what the action lands on",
    explanation:
      "を marks the thing the action is done to. When English would need a small word — talk TO Sakura — Japanese reaches for に or と instead: さくらと はなす.",
    unit: 3,
    examples: [
      { jp: "ねこが さかなを たべる。", en: "The cat eats a fish." },
      { jp: "さくらが ほんを よむ。", en: "Sakura reads a book." },
    ],
  },
  {
    id: "ni",
    title: "に",
    name: "to / at / on",
    explanation:
      "に pins a point: where something ends up, where it sits, who it's aimed at, or when it happens. Times take に exactly when English needs on, in or at.",
    unit: 4,
    examples: [
      { jp: "さくらが がっこうに いく。", en: "Sakura goes to school." },
      { jp: "ねこが へやに いる。", en: "The cat is in the room." },
    ],
  },
  {
    id: "de",
    title: "で",
    name: "where or how",
    explanation: "で tags the place something happens, or the thing it's done with.",
    unit: 4,
    examples: [
      { jp: "こどもが こうえんで あそぶ。", en: "The child plays in the park." },
      { jp: "わたしは はしで たべる。", en: "I eat with chopsticks." },
    ],
  },
  {
    id: "e",
    title: "へ",
    name: "towards",
    explanation: "へ points a direction — the way you're heading, rather than the exact spot に would pin.",
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
    explanation: "から marks where or when something starts. At the end of a sentence it means “so” — the reason for what follows.",
    unit: 5,
    examples: [
      { jp: "でんしゃが えきから でる。", en: "The train leaves from the station." },
      { jp: "さむいから、うちに いる。", en: "It's cold, so (I) stay home." },
    ],
  },
  {
    id: "made",
    title: "まで",
    name: "until / as far as",
    explanation: "まで marks how far something goes, in place or in time.",
    unit: 5,
    examples: [
      { jp: "わたしは えきまで あるく。", en: "I walk as far as the station." },
      { jp: "わたしは ばんごはんまで まつ。", en: "I wait until dinner." },
    ],
  },
  {
    id: "i-adj",
    title: "い-words",
    name: "describing words with “is” inside",
    explanation:
      "Words like あかい and つめたい end in い and already contain “is”, so they can finish a sentence alone. Put one in front of a thing and it describes it: あかい はな, “a red flower”.",
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
      "Words like きれい and しずか are really thing-words, so they take だ to finish a sentence. To stick onto the next word, that だ changes shape to な: きれいな とり, “a pretty bird”.",
    unit: 6,
    examples: [
      { jp: "うみが しずかだ。", en: "The sea is quiet." },
      { jp: "きれいな とりが とぶ。", en: "A pretty bird flies." },
    ],
  },
  {
    id: "modifier",
    title: "a sentence describing a word",
    name: "no “who” or “that” needed",
    explanation:
      "Park a whole little sentence in front of a word and it describes it: うたった しょうじょ, “the girl who sang”. Japanese does this constantly where English needs “who” or “that”. If a piece doesn't end in a joining word, it's describing something rather than finishing the sentence.",
    unit: 7,
    examples: [
      { jp: "うたった しょうじょが ねている。", en: "The girl who sang is sleeping." },
      { jp: "じしょを たべた いぬが おおきい。", en: "The dog that ate the dictionary is big." },
    ],
  },
  {
    id: "order",
    title: "the order of words",
    name: "two rules, and the rest is free",
    explanation:
      "Think of setting up a scene: you dress each figure before you stand it up, and you press the action button last. So anything describing a word comes right before it, and the ending comes last. Between those, the order is yours — メアリーが スーザンを なぐった and スーザンを メアリーが なぐった both mean Mary hit Susan, because が and を say who did what, not the positions. Move a word to the very end, though, and the whole thing turns into a description of it.",
    unit: 7,
    examples: [
      { jp: "いちばで ドレスを かった。", en: "(I) bought a dress at the market." },
      { jp: "いちばで かった ドレス", en: "the dress (I) bought at the market — no longer a sentence, but a description" },
    ],
  },
  {
    id: "te-join",
    title: "〜て",
    name: "hooks one sentence to the next",
    explanation:
      "Change an action word to its 〜て shape and it stops finishing the sentence, hooking on to what comes next instead: たべて ねる, “eat and then sleep”. The real last word still ends everything.",
    unit: 8,
    examples: [
      { jp: "パンを たべて、ねる。", en: "(I) eat bread and then sleep." },
      { jp: "ほんを よんで、えを かく。", en: "(I) read a book and then draw a picture." },
    ],
  },
];
