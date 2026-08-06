import { getMeta, setMeta } from "./db.js";
import { assetUrl } from "./store.js";
import { generationAvailable } from "./grammar-ai.js";
import type { KanaEntry } from "./kana-data.js";

/**
 * The alien dictionary: made-up words with made-up meanings, written by
 * Claude out of exactly the kana the player picked.
 *
 * Generation happens when a game starts, in the background, so the level
 * itself opens instantly from the cache. The cache remembers which words a
 * run has already used, so no word comes round twice until the whole
 * stock has been read — and when the unused pile runs low, a fresh batch
 * is quietly fetched and folded in. No key, no network, a batch that
 * fails the rules — any of those and the level runs on locally invented
 * words with meanings drawn from the hat below, which is still an alien
 * dictionary, just a smaller one.
 */

const CACHE_PREFIX = "alienWords:";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
/** Words per fetch, and the most the cache will hold after merging. */
const BATCH = 60;
const STOCK_MAX = 150;
/** Below this many unused words, a top-up fetch is worth firing. */
const LOW_WATER = 24;

export interface AlienWord {
  kana: string;
  gloss: string;
}

interface Cached {
  at: number;
  words: AlienWord[];
  /** Kana already served to a level, so nothing repeats while stock lasts. */
  used?: string[];
}

const signatureOf = (groups: string[]): string => [...groups].sort().join(",");

/**
 * Meanings for the hat, for when nobody can be asked. The same register
 * the AI is asked for: oddly specific, slightly absurd, words you wish
 * existed.
 */
const HAT: string[] = [
  "the panic of waving back at someone who wasn't waving at you",
  "a sock that has accepted its solitude",
  "the exact warmth of a laptop that has been thinking too hard",
  "the dignity of a pigeon walking somewhere important",
  "the silence after saying 'anyway' twice",
  "a crumb that escapes the plate on purpose",
  "the third attempt at parallel parking, as a lifestyle",
  "an umbrella's opinion of light drizzle",
  "the smell of a book you were supposed to return",
  "the courage it takes to eat the last dumpling",
  "a staircase that counts you as you climb",
  "the ghost of a sneeze that never came",
  "the pride of a vending machine giving exact change",
  "a cloud shaped like a better cloud",
  "the eye contact between two people reaching for the same tomato",
  "a queue that exists for no reason and everyone respects it",
  "the special speed you walk past a shop you can't afford",
  "the moment a cat decides you are furniture",
  "a puddle pretending to be shallow",
  "the last 2% of a phone battery, spiritually",
  "the smugness of an unread bestseller on a shelf",
  "a doorbell that rings a day late",
  "the private festival of cancelled plans",
  "a spoon too proud to stir",
  "the north side of a song",
  "the dream a vending machine has at 3am",
  "a map of somewhere that moved away",
  "the pause before a joke lands, stretched thin",
  "an apology addressed to a houseplant",
  "the exact weight of an empty inbox",
  "a ladder that only goes sideways",
  "the applause inside a rice cooker when it finishes",
  "the small government of ants under the sink",
  "a river's day off",
  "the feeling of a train just missed, kept as a pet",
  "the fourth sock, who knows what happened to the third",
  "moonlight, secondhand, slightly used",
  "a window that shows yesterday on request",
  "the ceremonial first bite of someone else's fries",
  "a shadow that waves back, but only on Tuesdays",
  "the ambition of a shopping cart with one bad wheel",
  "the etiquette of pretending not to see a neighbour",
  "a pillow's memory of every bad dream it absorbed",
  "the diplomacy of splitting the last slice",
  "an escalator's quiet disappointment in people who stand still",
  "the brief immortality of a fresh haircut",
  "a snowman's retirement plan",
  "the acoustics of an empty fridge at midnight",
  "the true name of the drawer that holds everything",
  "a bus that arrives exactly when you stop wanting it",
  "the loneliness of the last chess piece in the box",
  "an echo that improves on the original",
  "the professional pride of a door that squeaks on purpose",
  "the long vacation of a New Year's resolution",
  "a bath that has reached the perfect temperature and knows it",
  "the underground economy of borrowed pens",
];

/**
 * Warm the cache for these groups. Fire-and-forget from the screens that
 * know a game is starting; every failure path is a quiet return. New
 * batches MERGE into the old stock (deduplicated) rather than replacing
 * it, so the dictionary only ever grows richer.
 */
export async function warmAlienWords(groups: string[], pool: KanaEntry[]): Promise<void> {
  try {
    const key = CACHE_PREFIX + signatureOf(groups);
    const cached = await getMeta<Cached>(key);
    const usedSet = new Set(cached?.used ?? []);
    const unused = (cached?.words ?? []).filter((word) => !usedSet.has(word.kana)).length;
    if (cached && Date.now() - cached.at < CACHE_MS && unused >= LOW_WATER) return;
    if (!(await generationAvailable())) return;

    const kanaList = pool.map((entry) => entry.kana).join(" ");
    const prompt = [
      `Invent ${BATCH} completely made-up words for a kana reading game, with invented English meanings.`,
      "",
      "Rules, all required:",
      `- Each word is 2 to 4 kana long and uses ONLY these kana: ${kanaList}`,
      "- The words must NOT be real Japanese words. Invented sound-shapes only.",
      '- "term" and "reading" are both the word itself, in those kana. No kanji, no other kana.',
      '- "glosses" holds exactly one short invented English meaning. Make them FUNNY —',
      "  oddly specific, a little absurd, the kind of word you wish existed. The register:",
      '  "the panic of waving back at someone who wasn\'t waving at you",',
      '  "a sock that has accepted its solitude",',
      '  "the dignity of a pigeon walking somewhere important",',
      '  "the exact warmth of a laptop that has been thinking too hard".',
      "- Vary the territory: tiny objects with feelings, moods nobody has named, weather",
      "  with opinions, small animals with agendas, ghosts of everyday moments, food politics.",
      "- No two words alike, no two meanings alike, nothing generic like 'a strange thing'.",
    ].join("\n");

    const res = await fetch(assetUrl("grammar.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "deck", prompt }),
    });
    if (!res.ok) return;
    const { raw } = (await res.json()) as { raw?: string };
    if (!raw) return;
    const parsed = JSON.parse(raw) as { cards?: { term?: string; glosses?: string[] }[] };
    if (!Array.isArray(parsed.cards)) return;

    // Only what obeys the rules is worth keeping: every character from the
    // pool, a meaning that fits on a screen, nothing already in stock.
    const allowed = new Set(pool.flatMap((entry) => [...entry.kana]));
    const stock: AlienWord[] = [...(cached?.words ?? [])];
    const seen = new Set(stock.map((word) => word.kana));
    let added = 0;
    for (const card of parsed.cards) {
      const kana = (card.term ?? "").trim();
      const gloss = (card.glosses?.[0] ?? "").trim();
      if (!kana || !gloss || gloss.length > 90) continue;
      const size = [...kana].length;
      if (size < 2 || size > 5) continue;
      if (![...kana].every((ch) => allowed.has(ch))) continue;
      if (seen.has(kana)) continue;
      seen.add(kana);
      stock.push({ kana, gloss });
      added++;
    }
    if (added === 0) return;
    // Overflow drops the oldest USED words first — the unused are the point.
    let trimmed = stock;
    if (stock.length > STOCK_MAX) {
      const stillUsed = new Set(cached?.used ?? []);
      const unusedWords = stock.filter((word) => !stillUsed.has(word.kana));
      const usedWords = stock.filter((word) => stillUsed.has(word.kana));
      trimmed = [...usedWords.slice(-(STOCK_MAX - unusedWords.length)), ...unusedWords].slice(-STOCK_MAX);
    }
    await setMeta(key, {
      at: Date.now(),
      words: trimmed,
      used: (cached?.used ?? []).filter((kana) => trimmed.some((word) => word.kana === kana)),
    } satisfies Cached);
  } catch {
    // The hat still has meanings in it.
  }
}

/**
 * Words for one run of the level: unused stock first, never a repeat while
 * stock lasts, and a background top-up fired when the pile runs low. The
 * hat fills whatever the stock cannot. `makeWord` is the caller's local
 * pseudo-word maker, so this module needs no opinion on how kana combine.
 */
export async function takeAlienWords(
  groups: string[],
  count: number,
  makeWord: () => string,
  pool?: KanaEntry[],
): Promise<AlienWord[]> {
  const key = CACHE_PREFIX + signatureOf(groups);
  const cached = await getMeta<Cached>(key).catch(() => null);
  const stock = cached?.words ?? [];
  const used = new Set(cached?.used ?? []);

  let fresh = shuffle(stock.filter((word) => !used.has(word.kana)));
  if (fresh.length < count && stock.length >= count) {
    // The whole stock has been read: the rotation starts over rather than
    // falling back to the hat while sixty perfectly good words sit there.
    used.clear();
    fresh = shuffle([...stock]);
  }
  const taken = fresh.slice(0, count);

  if (cached && taken.length > 0) {
    for (const word of taken) used.add(word.kana);
    await setMeta(key, { ...cached, used: [...used] } satisfies Cached);
  }
  // Running low is tomorrow's problem, handled today, quietly.
  if (pool && stock.filter((word) => !used.has(word.kana)).length < LOW_WATER) {
    void warmAlienWords(groups, pool);
  }
  if (taken.length >= count) return taken;

  // The hat: locally invented words, meanings drawn without repeats.
  const meanings = shuffle([...HAT]);
  const out: AlienWord[] = [...taken];
  const have = new Set(out.map((word) => word.kana));
  let guard = 0;
  while (out.length < count && guard++ < 80) {
    const kana = makeWord();
    if (have.has(kana)) continue;
    have.add(kana);
    out.push({ kana, gloss: meanings[out.length % meanings.length] });
  }
  return shuffle(out);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
