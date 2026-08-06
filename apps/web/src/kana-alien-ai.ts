import { getMeta, setMeta } from "./db.js";
import { assetUrl } from "./store.js";
import { generationAvailable } from "./grammar-ai.js";
import type { KanaEntry } from "./kana-data.js";

/**
 * The alien dictionary: made-up words with made-up meanings, written by
 * Claude out of exactly the kana the player picked.
 *
 * Generation happens when a game starts, in the background, so the level
 * itself opens instantly from the cache. No key, no network, a batch that
 * fails the rules — any of those and the level runs on locally invented
 * words with meanings drawn from a hat, which is still an alien
 * dictionary, just a smaller one.
 */

const CACHE_PREFIX = "alienWords:";
const CACHE_MS = 24 * 60 * 60 * 1000;
const BATCH = 24;

export interface AlienWord {
  kana: string;
  gloss: string;
}

interface Cached {
  at: number;
  words: AlienWord[];
}

const signatureOf = (groups: string[]): string => [...groups].sort().join(",");

/**
 * Meanings for the hat, for when nobody can be asked. Whimsical but plain,
 * like the AI is asked to be.
 */
const HAT: string[] = [
  "a pocket for carrying rain",
  "the ghost of a sneeze",
  "the smell of a library",
  "a ladder that only goes sideways",
  "the last warm spot in the bath",
  "a map of somewhere that moved",
  "the sound snow makes at night",
  "an umbrella that misses you",
  "the third sock",
  "a staircase that hums",
  "the feeling of a train just missed",
  "a cloud kept as a pet",
  "the corner where lost pens go",
  "a window that shows yesterday",
  "the courage of a small dog",
  "a door that knocks back",
  "moonlight, secondhand",
  "the pause before a joke lands",
  "a river's day off",
  "the echo of a good meal",
  "a shadow that waves",
  "the north side of a song",
  "a spoon too proud to stir",
  "the dream a vending machine has",
];

/**
 * Warm the cache for these groups. Fire-and-forget from the screens that
 * know a game is starting; every failure path is a quiet return.
 */
export async function warmAlienWords(groups: string[], pool: KanaEntry[]): Promise<void> {
  try {
    const key = CACHE_PREFIX + signatureOf(groups);
    const cached = await getMeta<Cached>(key);
    if (cached && Date.now() - cached.at < CACHE_MS && cached.words.length >= 8) return;
    if (!(await generationAvailable())) return;

    const kanaList = pool.map((entry) => entry.kana).join(" ");
    const prompt = [
      `Invent ${BATCH} completely made-up words for a kana reading game, with invented English meanings.`,
      "",
      "Rules, all required:",
      `- Each word is 2 to 4 kana long and uses ONLY these kana: ${kanaList}`,
      "- The words must NOT be real Japanese words. Invented sound-shapes only.",
      '- "term" and "reading" are both the word itself, in those kana. No kanji, no other kana.',
      '- "glosses" holds exactly one short invented English meaning — concrete, playful, plain words.',
      '  Good: "a pocket for carrying rain", "the ghost of a sneeze", "a ladder that only goes sideways".',
      "- No two words alike, no two meanings alike.",
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

    // Only what obeys the rules is worth caching: every character from the
    // pool, a meaning that fits on a screen, no duplicates.
    const allowed = new Set(pool.flatMap((entry) => [...entry.kana]));
    const seen = new Set<string>();
    const words: AlienWord[] = [];
    for (const card of parsed.cards) {
      const kana = (card.term ?? "").trim();
      const gloss = (card.glosses?.[0] ?? "").trim();
      if (!kana || !gloss || gloss.length > 70) continue;
      const size = [...kana].length;
      if (size < 2 || size > 5) continue;
      if (![...kana].every((ch) => allowed.has(ch))) continue;
      if (seen.has(kana)) continue;
      seen.add(kana);
      words.push({ kana, gloss });
    }
    if (words.length < 8) return;
    await setMeta(key, { at: Date.now(), words } satisfies Cached);
  } catch {
    // The hat still has meanings in it.
  }
}

/**
 * Words for one run of the level: the cached AI batch when there is one,
 * the hat otherwise. `makeWord` is the caller's local pseudo-word maker,
 * so this module needs no opinion on how kana combine.
 */
export async function takeAlienWords(
  groups: string[],
  count: number,
  makeWord: () => string,
): Promise<AlienWord[]> {
  const cached = await getMeta<Cached>(CACHE_PREFIX + signatureOf(groups)).catch(() => null);
  const fresh = cached && Date.now() - cached.at < CACHE_MS ? cached.words : [];
  if (fresh.length >= count) {
    return shuffle([...fresh]).slice(0, count);
  }
  // The hat: locally invented words, meanings drawn without repeats.
  const meanings = shuffle([...HAT]);
  const out: AlienWord[] = [...fresh];
  const used = new Set(out.map((word) => word.kana));
  let guard = 0;
  while (out.length < count && guard++ < 60) {
    const kana = makeWord();
    if (used.has(kana)) continue;
    used.add(kana);
    out.push({ kana, gloss: meanings[out.length % meanings.length] });
  }
  return shuffle(out).slice(0, count);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
