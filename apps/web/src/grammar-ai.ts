import { getMeta, setMeta } from "./db.js";
import { assetUrl } from "./store.js";
import { PARTICLE_JOB, type Chunk, type GrammarUnit, type Role, type Sentence } from "./grammar-data.js";

/**
 * Fresh practice sentences, written by Claude, for a unit that is starting.
 *
 * The built-in sentences are few enough to memorise, which teaches the
 * sentences rather than the grammar. When the site has an API key configured
 * (see `public/grammar.php` — the key stays on the server, never in the
 * browser), each unit start asks for a new batch in exactly the same shape,
 * built from the same words and the same jobs.
 *
 * Everything here is optional. No key, no network, a malformed answer, a
 * sentence that breaks the unit's rules — any of those and the unit runs on
 * the sentences that ship with the app, with nothing said about it.
 *
 * Generated batches are cached per unit for a day, so opening a unit twice
 * in an evening costs one request, not two.
 */

const CACHE_PREFIX = "grammarGen:";
const CACHE_MS = 24 * 60 * 60 * 1000;

interface Cached {
  at: number;
  sentences: Sentence[];
}

let available: Promise<boolean> | null = null;

/** Is generation configured on this host? Asked once per page load. */
export function generationAvailable(): Promise<boolean> {
  available ??= fetch(assetUrl("grammar.php?probe=1"))
    .then((res) => res.status === 204)
    .catch(() => false);
  return available;
}

const ROLES: Role[] = ["engine", "doer", "topic", "ghost", "object", "other"];

/**
 * The rules a batch has to satisfy to be used at all.
 *
 * A generated sentence is shown to a beginner as fact, so anything doubtful
 * is dropped rather than repaired: a wrong label teaches something wrong.
 */
function validSentence(value: unknown, unit: GrammarUnit): Sentence | null {
  const s = value as Sentence | null;
  if (!s || typeof s.en !== "string" || !s.en.trim() || !Array.isArray(s.chunks)) return null;
  if (s.chunks.length < 2 || s.chunks.length > 6) return null;

  const chunks: Chunk[] = [];
  for (const raw of s.chunks) {
    const c = raw as Chunk;
    if (!c || typeof c.t !== "string" || typeof c.r !== "string") return null;
    if (typeof c.g !== "string" || !c.g.trim()) return null;
    if (typeof c.label !== "string" || !c.label.trim()) return null;
    if (!ROLES.includes(c.role)) return null;
    // Kana only: a beginner running alongside the kana course cannot read
    // kanji yet, and the whole course is written without it.
    if (/[一-龯]/.test(c.t)) return null;
    if (c.p !== undefined) {
      if (typeof c.p !== "string" || !(c.p in PARTICLE_JOB)) return null;
      if (!c.t.endsWith(c.p)) return null;
    }
    if (c.role === "ghost" && c.t !== "") return null;
    chunks.push({
      t: c.t,
      r: c.r,
      g: c.g,
      role: c.role,
      label: c.label,
      ...(c.p ? { p: c.p } : {}),
      ...(c.q ? { q: true } : {}),
      ...(c.glue ? { glue: true } : {}),
    });
  }

  // Exactly one ending, and it comes last: the one rule the drills lean on.
  const engines = chunks.filter((c) => c.role === "engine");
  if (engines.length !== 1 || chunks[chunks.length - 1].role !== "engine") return null;
  // The question shown to the learner is built from this wording.
  if (!["what happens", "what it is", "what it's like"].includes(engines[0].label)) return null;
  // A doer must be there, said or unsaid.
  if (!chunks.some((c) => c.role === "doer" || c.role === "ghost")) return null;
  // Only particles this unit has taught.
  const taught = new Set(unit.particles);
  if (chunks.some((c) => c.p && !taught.has(c.p))) return null;

  return {
    chunks,
    en: s.en.trim(),
    ...(typeof s.lit === "string" && s.lit.trim() ? { lit: s.lit.trim() } : {}),
  };
}

/** A worked example from the unit itself, so the model copies the house style. */
function promptFor(unit: GrammarUnit, count: number): string {
  const sample = JSON.stringify(unit.sentences.slice(0, 2), null, 1);
  return [
    `Write ${count} new practice sentences for a beginner Japanese lesson called "${unit.title}".`,
    `The lesson teaches: ${unit.tagline}`,
    "",
    "Return JSON: an array of objects exactly like these two examples.",
    "",
    sample,
    "",
    "Rules, all required:",
    "- Kana only. No kanji anywhere, not even common ones.",
    `- Use only these little connecting words: ${unit.particles.join(" ")}.`,
    '- "g" is what that piece means in plain English ("the cat", "sleeps"). It is shown to the learner.',
    '- "label" is the job in plain English. Reuse the labels from the examples exactly.',
    '- The last piece must be the ending, with label "what happens" (an action), "what it is" (a thing + だ) or "what it\'s like" (a describing word).',
    '- Every sentence needs a doer: either a piece with role "doer", or a role "ghost" piece with t and r empty and g set to who it means ("I", "it", "she").',
    '- "r" is romaji matching "t", with the little word as the last space-separated part.',
    '- Set "q": true on a little word only if exactly one is possible there.',
    "- Use simple, concrete, everyday words a beginner knows.",
    "- Do not reuse the example sentences.",
    "",
    "Output the JSON array and nothing else.",
  ].join("\n");
}

/**
 * Fresh sentences for this unit, or null to use the built-in ones. Never
 * throws: every failure path is a quiet null.
 */
export async function generateSentences(
  unit: GrammarUnit,
  unitIndex: number,
  count = 8,
): Promise<Sentence[] | null> {
  try {
    const key = `${CACHE_PREFIX}${unitIndex}`;
    const cached = await getMeta<Cached>(key);
    if (cached && Date.now() - cached.at < CACHE_MS && cached.sentences.length > 0) {
      return cached.sentences;
    }
    if (!(await generationAvailable())) return null;

    const res = await fetch(assetUrl("grammar.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: promptFor(unit, count), count }),
    });
    if (!res.ok) return null;
    const { raw } = (await res.json()) as { raw?: string };
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as { sentences?: unknown[] })?.sentences;
    if (!Array.isArray(list)) return null;

    const good = list.map((item) => validSentence(item, unit)).filter((s): s is Sentence => s !== null);
    // A batch that mostly failed the rules is a batch not worth trusting.
    if (good.length < 4) return null;

    await setMeta(key, { at: Date.now(), sentences: good } satisfies Cached);
    return good;
  } catch {
    return null;
  }
}
