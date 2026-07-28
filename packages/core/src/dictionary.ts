import type { DictEntry, Dictionary, LookupMatch } from "./types.js";
import { deinflect, classesMatchPos } from "./deinflect.js";

/** Serialized dictionary: a flat array of entries (used by the seed dict). */
export type DictFile = DictEntry[];

/**
 * Compact on-the-wire dictionary format.
 *
 * A full JMdict export as plain objects repeats the same four keys and the
 * same few hundred part-of-speech strings tens of thousands of times. Here
 * entries are positional tuples and POS tags are interned into a table, which
 * roughly halves the download for phones on mobile data.
 */
export interface CompactDictFile {
  format: "yomeyo-dict-1";
  /** Interned part-of-speech tags; entries reference these by index. */
  pos: string[];
  /** [term, reading, posIndexes, glosses, freq?] */
  entries: Array<[string, string, number[], string[], number?]>;
  /** Optional provenance, shown in Settings. */
  meta?: { source?: string; date?: string; count?: number };
}

function isCompact(data: unknown): data is CompactDictFile {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as CompactDictFile).format === "yomeyo-dict-1" &&
    Array.isArray((data as CompactDictFile).entries)
  );
}

/**
 * Accept either dictionary encoding and return plain entries.
 * Lets the bundled seed dictionary and a built JMdict be used interchangeably.
 */
export function parseDictFile(data: unknown): DictEntry[] {
  if (isCompact(data)) {
    const posTable = data.pos;
    return data.entries.map(([term, reading, posIdx, glosses, freq]) => {
      const entry: DictEntry = {
        term,
        reading,
        pos: posIdx.map((i) => posTable[i]).filter((p): p is string => p !== undefined),
        glosses,
      };
      if (freq !== undefined) entry.freq = freq;
      return entry;
    });
  }
  if (Array.isArray(data)) return data as DictEntry[];
  throw new Error("Unrecognized dictionary file format");
}

/** Read the metadata block from a compact dictionary, if present. */
export function dictFileMeta(data: unknown): CompactDictFile["meta"] {
  return isCompact(data) ? data.meta : undefined;
}

/** In-memory dictionary indexed by term and by reading. */
export class MemoryDictionary implements Dictionary {
  private index = new Map<string, DictEntry[]>();

  constructor(entries: DictFile) {
    for (const e of entries) {
      this.add(e.term, e);
      if (e.reading && e.reading !== e.term) this.add(e.reading, e);
    }
  }

  private add(key: string, entry: DictEntry): void {
    const list = this.index.get(key);
    if (list) list.push(entry);
    else this.index.set(key, [entry]);
  }

  lookupExact(text: string): DictEntry[] {
    return this.index.get(text) ?? [];
  }
}

/**
 * Several dictionaries consulted as one.
 *
 * Results keep their source order — the first dictionary is the primary, so
 * a monolingual or specialist dictionary can be added without burying the
 * everyday one. Entries are tagged with their source so the UI can say where
 * a definition came from.
 */
export class CombinedDictionary implements Dictionary {
  constructor(private readonly parts: Array<{ name: string; dictionary: Dictionary }>) {}

  lookupExact(text: string): DictEntry[] {
    const out: DictEntry[] = [];
    for (const { name, dictionary } of this.parts) {
      for (const entry of dictionary.lookupExact(text)) {
        out.push(entry.source ? entry : { ...entry, source: name });
      }
    }
    return out;
  }
}

/**
 * Yomitan/Yomichan "term bank" rows, the format most downloadable Japanese
 * dictionaries ship in — including the monolingual ones JMdict cannot
 * provide. Each row is positional:
 *
 *   [term, reading, definitionTags, rules, score, definitions, sequence, termTags]
 *
 * `definitions` holds plain strings in simple dictionaries and structured
 * content objects in richer ones; the text is pulled out of both.
 */
export type YomitanTermRow = [
  string,
  string,
  string | null,
  string,
  number,
  Array<string | Record<string, unknown>>,
  number,
  string,
];

function structuredText(node: unknown, depth = 0): string {
  if (depth > 8) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map((n) => structuredText(n, depth + 1)).join("");
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.content !== "undefined") return structuredText(record.content, depth + 1);
    if (typeof record.text === "string") return record.text;
  }
  return "";
}

/** Convert Yomitan term-bank rows into dictionary entries. */
export function parseYomitanTermBank(rows: unknown, source: string): DictEntry[] {
  if (!Array.isArray(rows)) throw new Error("A term bank must be a JSON array");
  const entries: DictEntry[] = [];

  for (const row of rows as YomitanTermRow[]) {
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    const term = row[0];
    const reading = typeof row[1] === "string" && row[1] ? row[1] : term;
    const rules = typeof row[3] === "string" ? row[3] : "";
    const score = typeof row[4] === "number" ? row[4] : 0;

    const glosses = (Array.isArray(row[5]) ? row[5] : [])
      .map((d) => structuredText(d).trim())
      .filter(Boolean);
    if (glosses.length === 0) continue;

    entries.push({
      term,
      reading,
      // Yomitan rule flags ("v5 vt", "v1", "adj-i") line up with the
      // deinflector's classes closely enough to be useful as POS hints.
      pos: rules ? rules.split(/\s+/).filter(Boolean) : [],
      glosses: glosses.slice(0, 5),
      // Higher Yomitan score = more common; our ranking is lower-is-better.
      freq: 1000 - score,
      source,
    });
  }

  if (entries.length === 0) throw new Error("No usable entries found in that file");
  return entries;
}

const HIRAGANA_START = 0x3041;
const KATAKANA_START = 0x30a1;

/** Convert katakana to hiragana so カタカナ text matches kana readings. */
export function kataToHira(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCodePoint(code - KATAKANA_START + HIRAGANA_START);
    } else {
      out += ch;
    }
  }
  return out;
}

/** True if the character can be part of a Japanese word. */
export function isJapaneseChar(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  return (
    (code >= 0x3041 && code <= 0x309f) || // hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // katakana
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified
    (code >= 0x3400 && code <= 0x4dbf) || // CJK ext A
    code === 0x3005 || // 々
    code === 0x30fc // ー
  );
}

const MAX_SCAN_LENGTH = 20;

/**
 * How far back from the tapped character to look for the start of a word.
 *
 * Japanese is written without spaces, so nothing on screen tells you where a
 * word begins — and a fingertip covers several characters anyway. Scanning
 * only forwards, as a desktop hover tool can afford to, means a tap on the 臭
 * of 水臭い finds 臭い, and a tap on its い finds 遺孤 or 胃: the word actually
 * under the finger is missed. Most Japanese words are within this many
 * characters of any point inside them.
 */
const MAX_LOOKBEHIND = 8;

/** Step back one whole character, never into the middle of a surrogate pair. */
function previousCharStart(text: string, index: number): number {
  if (index <= 0) return -1;
  const back = index - 1;
  const code = text.charCodeAt(back);
  if (code >= 0xdc00 && code <= 0xdfff && back > 0) {
    const high = text.charCodeAt(back - 1);
    if (high >= 0xd800 && high <= 0xdbff) return back - 1;
  }
  return back;
}

/** Character starts at or before `offset`, nearest first. */
function scanStarts(text: string, offset: number): number[] {
  const starts = [offset];
  let at = offset;
  for (let i = 0; i < MAX_LOOKBEHIND; i++) {
    at = previousCharStart(text, at);
    if (at < 0) break;
    const point = text.codePointAt(at);
    if (point === undefined) break;
    if (!isJapaneseChar(String.fromCodePoint(point))) break; // stop at a boundary
    starts.push(at);
  }
  return starts;
}

/**
 * Yomitan-style scan around the given offset in `text`: try the longest
 * possible substring first, deinflect it, and collect dictionary matches.
 *
 * Unlike a hover tool this also considers words that *begin before* the
 * tapped character, keeping only those that still cover it — on a phone a tap
 * lands inside a word at least as often as at its start. Results are sorted
 * by match length (longest first), then fewest deinflection steps, then
 * kanji-initial words, then dictionary frequency, then earliest start.
 */
export function lookup(dict: Dictionary, text: string, offset = 0): LookupMatch[] {
  const matches: LookupMatch[] = [];
  const seen = new Set<string>();

  for (const start of scanStarts(text, offset)) {
    const chars: string[] = [];
    for (const ch of text.slice(start)) {
      if (!isJapaneseChar(ch)) break;
      chars.push(ch);
      if (chars.length >= MAX_SCAN_LENGTH) break;
    }
    if (chars.length === 0) continue;

    for (let len = chars.length; len >= 1; len--) {
      const fragment = chars.slice(0, len).join("");
      // A word that ends before the tapped character is not the word the
      // user pointed at, however well it matches.
      if (start + fragment.length <= offset) break;

      const candidates = [fragment];
      const hira = kataToHira(fragment);
      if (hira !== fragment) candidates.push(hira);

      for (const candidate of candidates) {
        for (const deinf of deinflect(candidate)) {
          const entries = dict
            .lookupExact(deinf.term)
            .filter((e) => classesMatchPos(deinf.classes, e.pos));
          if (entries.length === 0) continue;
          const key = start + " " + fragment + " " + deinf.term;
          if (seen.has(key)) continue;
          seen.add(key);
          matches.push({
            matchedText: fragment,
            start,
            matchLength: len,
            term: deinf.term,
            reasons: deinf.reasons,
            entries: rankEntries(entries),
          });
        }
      }
    }
  }

  matches.sort((a, b) => {
    if (a.matchLength !== b.matchLength) return b.matchLength - a.matchLength;
    if (a.reasons.length !== b.reasons.length) return a.reasons.length - b.reasons.length;
    // Between equally long candidates: a word opening with a kanji is far
    // more likely to be the content word someone is mining than a kana run
    // that happens to align (臭い vs いか in 臭いから), and after that the
    // commoner word is the likelier segmentation. Where the match starts
    // relative to the finger is close to a coin flip, so it decides last.
    const kanjiA = startsWithKanji(a.matchedText);
    const kanjiB = startsWithKanji(b.matchedText);
    if (kanjiA !== kanjiB) return kanjiA ? -1 : 1;
    const freqA = a.entries[0]?.freq ?? 1e9;
    const freqB = b.entries[0]?.freq ?? 1e9;
    if (freqA !== freqB) return freqA - freqB;
    return a.start - b.start;
  });
  return matches;
}

/**
 * Order the definitions shown for one word.
 *
 * Dictionaries keep their consulted order — the built-in one first — and only
 * entries from the same dictionary are compared by frequency. The numbers are
 * not on a shared scale: JMdict's is a rank running into the hundreds of
 * thousands, while a Yomitan import's is derived from that dictionary's own
 * score, so comparing across them let an imported dictionary bury the
 * built-in definition for almost every word.
 */
function rankEntries(entries: DictEntry[]): DictEntry[] {
  const order = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.source ?? "";
    if (!order.has(key)) order.set(key, order.size);
  }
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const sourceA = order.get(a.entry.source ?? "") ?? 0;
      const sourceB = order.get(b.entry.source ?? "") ?? 0;
      if (sourceA !== sourceB) return sourceA - sourceB;
      const freqA = a.entry.freq ?? 1e9;
      const freqB = b.entry.freq ?? 1e9;
      if (freqA !== freqB) return freqA - freqB;
      return a.index - b.index;
    })
    .map((x) => x.entry);
}

function startsWithKanji(text: string): boolean {
  const code = text.codePointAt(0);
  return code !== undefined && ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf));
}
