import { assetUrl } from "./store.js";
import { PARTICLE_JOB, type Chunk } from "./grammar-data.js";

/**
 * Taking a real Japanese sentence apart, the same way the course does.
 *
 * The drills work on sentences the app already knows the shape of. This is
 * for a sentence nobody wrote for the course — something read in the wild —
 * so the pieces, the jobs, the unsaid doer and the translation all have to
 * be worked out. That is done server-side (`public/grammar.php`, which holds
 * the API key), because a real sentence has kanji, words the dictionary may
 * inflect several ways, and pieces whose job depends on the whole.
 *
 * Nothing here is load-bearing: with no endpoint the tab falls back to a
 * plain split on the connecting words, which is honest about being rough.
 */

export interface ParsedChunk extends Chunk {
  /** The reading in kana, when the piece is written with kanji. */
  k?: string;
}

export interface Parsed {
  chunks: ParsedChunk[];
  /** Natural English. */
  en: string;
  /** Word for word, with the unsaid pieces filled in. */
  lit: string;
  /** One line on anything about this sentence worth pointing at. */
  note?: string;
  /** False when this came from the rough local split, not the parser. */
  full: boolean;
}

const ROLES = new Set(["engine", "doer", "topic", "ghost", "object", "other"]);

let available: Promise<boolean> | null = null;

export function parserAvailable(): Promise<boolean> {
  available ??= fetch(assetUrl("grammar.php?probe=1"))
    .then((res) => res.status === 204)
    .catch(() => false);
  return available;
}

function promptFor(text: string): string {
  return [
    "Take this Japanese sentence apart:",
    "",
    text,
    "",
    "The model to use, which is not negotiable:",
    "- Every sentence ends with its ending, and the ending is one of three:",
    "  a do-word (あるく), a describing word (あかい — its “is” is built in),",
    "  or a thing + だ/です.",
    "- Every sentence has someone or something the ending is about, even when",
    "  nobody says it. When it is unsaid, include a chunk with role “ghost”,",
    '  t and r empty, and g set to who it means here ("I", "it", "she").',
    "  Put it where that piece logically sits. This is required, not optional.",
    "- は is not a role. It flags the topic over whatever it sits on. A piece",
    '  wearing は keeps its own role and takes the label "what we\'re talking about"',
    "  only when it is not also the one doing it.",
    "- A connecting word belongs to the word BEFORE it, and stays inside that",
    '  chunk\'s "t", named again in "p".',
    "- Anything describing something comes immediately before it. A whole",
    '  clause parked in front of a noun is describing that noun; mark its',
    '  pieces role "other" with glue true.',
    "",
    "One chunk per piece, in the order they appear. For each chunk:",
    '- "t": the piece exactly as written in the sentence, connecting word included.',
    '- "k": the whole piece in kana, when it is written with kanji. Omit otherwise.',
    '- "r": romaji, the connecting word as the last space-separated part.',
    '- "g": what this piece means in plain English ("the cat", "eats", "at school").',
    '- "role": engine, doer, topic, ghost, object or other.',
    '- "label": the job in plain English, for a beginner who knows no grammar words.',
    '  Use "what happens" / "what it is" / "what it\'s like" for the ending,',
    '  "the one doing it", "what it happens to", "what we\'re talking about",',
    '  "where it happens", "when it happens", "who it is for" and the like.',
    '  Never write subject, object, predicate, particle, copula, verb, adjective,',
    "  noun, conjugation, passive, transitive, or any other grammar word.",
    '- "p": the connecting word this piece ends with, if any.',
    '- "tail": だ or です when the piece ends with one.',
    "",
    'Also give "en" (natural English), "lit" (word for word, with anything unsaid',
    'in brackets: "As for me, (it) is eel.") and, only when there is something',
    'genuinely worth pointing at, "note" — one plain sentence, no grammar words.',
  ].join("\n");
}

/** Keep only what is safe to show a beginner as fact. */
function clean(value: unknown): Parsed | null {
  const p = value as Parsed | null;
  if (!p || !Array.isArray(p.chunks) || p.chunks.length === 0) return null;
  if (typeof p.en !== "string" || !p.en.trim()) return null;

  const chunks: ParsedChunk[] = [];
  for (const raw of p.chunks) {
    const c = raw as ParsedChunk;
    if (!c || typeof c.t !== "string" || typeof c.g !== "string" || !c.g.trim()) continue;
    if (typeof c.label !== "string" || !c.label.trim()) continue;
    if (!ROLES.has(c.role)) continue;
    if (c.role === "ghost" && c.t !== "") c.t = "";
    chunks.push({
      t: c.t,
      r: typeof c.r === "string" ? c.r : "",
      g: c.g.trim(),
      role: c.role,
      label: c.label.trim(),
      ...(typeof c.k === "string" && c.k.trim() ? { k: c.k.trim() } : {}),
      ...(typeof c.p === "string" && c.t.endsWith(c.p) ? { p: c.p } : {}),
      ...(typeof c.tail === "string" && c.t.endsWith(c.tail) ? { tail: c.tail } : {}),
      ...(c.glue ? { glue: true } : {}),
    });
  }
  if (chunks.length === 0) return null;

  return {
    chunks,
    en: p.en.trim(),
    lit: typeof p.lit === "string" ? p.lit.trim() : "",
    ...(typeof p.note === "string" && p.note.trim() ? { note: p.note.trim() } : {}),
    full: true,
  };
}

/**
 * A rough split for when there is no parser: break on the connecting words
 * and say nothing that has not been earned. No roles are guessed beyond the
 * last piece being the ending, because guessing them wrongly is worse than
 * leaving them out.
 */
export function roughParse(text: string): Parsed {
  const particles = Object.keys(PARTICLE_JOB).sort((a, b) => b.length - a.length);
  const clean = text.replace(/[。．.\s]+$/u, "");
  const chunks: ParsedChunk[] = [];
  let buffer = "";
  for (let i = 0; i < clean.length; ) {
    const hit = particles.find((p) => clean.startsWith(p, i) && buffer !== "");
    if (hit) {
      chunks.push({ t: buffer + hit, r: "", g: "", role: "other", label: "", p: hit });
      buffer = "";
      i += hit.length;
      continue;
    }
    buffer += clean[i];
    i += 1;
  }
  if (buffer) chunks.push({ t: buffer, r: "", g: "", role: "engine", label: "the ending" });
  return { chunks, en: "", lit: "", full: false };
}

/** The sentence taken apart, or null when the parser said nothing usable. */
export async function parseSentence(text: string): Promise<Parsed | null> {
  const sentence = text.trim().slice(0, 200);
  if (!sentence) return null;
  if (!(await parserAvailable())) return null;
  try {
    const res = await fetch(assetUrl("grammar.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "parse", prompt: promptFor(sentence) }),
    });
    if (!res.ok) return null;
    const { raw } = (await res.json()) as { raw?: string };
    if (!raw) return null;
    return clean(JSON.parse(raw));
  } catch {
    return null;
  }
}
