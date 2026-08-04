import type { DictEntry, Dictionary } from "./types.js";
import type { CompactDictFile } from "./dictionary.js";

/**
 * A dictionary that is searched where it lies, without being parsed.
 *
 * The JSON dictionary cost about four seconds on a mid-range phone before the
 * first word could be looked up: decoding twelve megabytes of UTF-8, parsing
 * it, building a quarter of a million entry objects and a Map over them —
 * work repeated on every page load, because the app's page and the
 * extension's service worker both start from nothing each time. It also held
 * ~180MB of heap afterwards.
 *
 * This format is laid out so that none of that is necessary. Keys are stored
 * sorted by their UTF-8 bytes, so a lookup is a binary search comparing raw
 * bytes — the query is encoded once, and no stored key is ever decoded.
 * Only the entries a search actually hits are decoded, a handful per tap.
 * Loading is `fetch(...).arrayBuffer()` and nothing more, and the resident
 * cost is the buffer itself.
 *
 * Layout (all integers little-endian, all sections 4-byte aligned):
 *
 *   header      64 bytes, see HEADER_* below
 *   keyOffsets  Uint32Array[keyCount + 1] — slices of keyBlob
 *   keyBlob     UTF-8 bytes of every key, concatenated, sorted bytewise
 *   postOffsets Uint32Array[keyCount + 1] — slices of postings
 *   postings    Uint32Array — entry numbers, grouped by key
 *   entOffsets  Uint32Array[entryCount + 1] — slices of entryBlob
 *   entryBlob   one JSON array per entry: [term, reading, pos[], glosses[], freq?]
 *   tail        JSON: { pos: string[], meta?: {...} }
 */

const MAGIC = 0x32594d59; // "YMY2" little-endian
const HEADER_BYTES = 64;

export interface BinaryDictSource {
  entries: Array<[string, string, number[], string[], number?]>;
  pos: string[];
  meta?: CompactDictFile["meta"];
}

/** True if these bytes are a Yomeyo binary dictionary. */
export function isBinaryDict(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEADER_BYTES) return false;
  return new DataView(buffer).getUint32(0, true) === MAGIC;
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

/** Order two byte sequences the way `memcmp` would. */
function compareBytes(
  a: Uint8Array,
  aStart: number,
  aEnd: number,
  b: Uint8Array,
  bStart: number,
  bEnd: number,
): number {
  const aLen = aEnd - aStart;
  const bLen = bEnd - bStart;
  const shared = aLen < bLen ? aLen : bLen;
  for (let i = 0; i < shared; i++) {
    const diff = a[aStart + i] - b[bStart + i];
    if (diff !== 0) return diff;
  }
  return aLen - bLen;
}

/** Build the binary form of a dictionary. Used by the build scripts. */
export function encodeBinaryDict(source: BinaryDictSource): Uint8Array {
  const encoder = new TextEncoder();

  // Group entry numbers by the keys they can be found under: the written
  // form, and the reading when it differs.
  const byKey = new Map<string, number[]>();
  source.entries.forEach(([term, reading], i) => {
    const add = (key: string) => {
      const list = byKey.get(key);
      if (list) list.push(i);
      else byKey.set(key, [i]);
    };
    if (term) add(term);
    if (reading && reading !== term) add(reading);
  });

  // Sort by UTF-8 bytes, not by code point, so the reader can compare raw
  // bytes without decoding anything.
  const keys = [...byKey.keys()].map((key) => ({ key, bytes: encoder.encode(key) }));
  keys.sort((a, b) => compareBytes(a.bytes, 0, a.bytes.length, b.bytes, 0, b.bytes.length));

  const keyCount = keys.length;
  const entryCount = source.entries.length;

  const keyOffsets = new Uint32Array(keyCount + 1);
  let keyBytes = 0;
  keys.forEach((k, i) => {
    keyOffsets[i] = keyBytes;
    keyBytes += k.bytes.length;
  });
  keyOffsets[keyCount] = keyBytes;

  const postOffsets = new Uint32Array(keyCount + 1);
  let postCount = 0;
  keys.forEach((k, i) => {
    postOffsets[i] = postCount;
    postCount += byKey.get(k.key)!.length;
  });
  postOffsets[keyCount] = postCount;

  const postings = new Uint32Array(postCount);
  let p = 0;
  for (const k of keys) for (const id of byKey.get(k.key)!) postings[p++] = id;

  const entryBytes: Uint8Array[] = source.entries.map((row) => encoder.encode(JSON.stringify(row)));
  const entOffsets = new Uint32Array(entryCount + 1);
  let entryTotal = 0;
  entryBytes.forEach((b, i) => {
    entOffsets[i] = entryTotal;
    entryTotal += b.length;
  });
  entOffsets[entryCount] = entryTotal;

  const tail = encoder.encode(JSON.stringify({ pos: source.pos, meta: source.meta }));

  const offKeyOffsets = HEADER_BYTES;
  const offKeyBlob = offKeyOffsets + keyOffsets.byteLength;
  const offPostOffsets = align4(offKeyBlob + keyBytes);
  const offPostings = offPostOffsets + postOffsets.byteLength;
  const offEntOffsets = offPostings + postings.byteLength;
  const offEntryBlob = offEntOffsets + entOffsets.byteLength;
  const offTail = align4(offEntryBlob + entryTotal);
  const total = offTail + tail.length;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true); // format version
  view.setUint32(8, keyCount, true);
  view.setUint32(12, entryCount, true);
  view.setUint32(16, offKeyOffsets, true);
  view.setUint32(20, offKeyBlob, true);
  view.setUint32(24, offPostOffsets, true);
  view.setUint32(28, offPostings, true);
  view.setUint32(32, offEntOffsets, true);
  view.setUint32(36, offEntryBlob, true);
  view.setUint32(40, offTail, true);
  view.setUint32(44, tail.length, true);

  out.set(new Uint8Array(keyOffsets.buffer), offKeyOffsets);
  keys.forEach((k, i) => out.set(k.bytes, offKeyBlob + keyOffsets[i]));
  out.set(new Uint8Array(postOffsets.buffer), offPostOffsets);
  out.set(new Uint8Array(postings.buffer), offPostings);
  out.set(new Uint8Array(entOffsets.buffer), offEntOffsets);
  entryBytes.forEach((b, i) => out.set(b, offEntryBlob + entOffsets[i]));
  out.set(tail, offTail);
  return out;
}

/**
 * Prepare plain entries for encoding, interning the part-of-speech tags.
 *
 * The same few hundred tags repeat across hundreds of thousands of entries,
 * so storing indexes into a table rather than the strings themselves is a
 * large saving on a format that is otherwise one JSON array per entry.
 */
export function binarySourceFromEntries(
  entries: DictEntry[],
  meta?: CompactDictFile["meta"],
): BinaryDictSource {
  const pos: string[] = [];
  const posIndex = new Map<string, number>();
  const rows = entries.map((e): [string, string, number[], string[], number?] => {
    const idx = (e.pos ?? []).map((tag) => {
      let i = posIndex.get(tag);
      if (i === undefined) {
        i = pos.length;
        pos.push(tag);
        posIndex.set(tag, i);
      }
      return i;
    });
    return e.freq === undefined
      ? [e.term, e.reading ?? e.term, idx, e.glosses]
      : [e.term, e.reading ?? e.term, idx, e.glosses, e.freq];
  });
  return { entries: rows, pos, meta: meta ?? { count: rows.length } };
}

/** Read a binary dictionary, decoding only what each lookup touches. */
export class BinaryDictionary implements Dictionary {
  private readonly bytes: Uint8Array;
  private readonly keyOffsets: Uint32Array;
  private readonly postOffsets: Uint32Array;
  private readonly postings: Uint32Array;
  private readonly entOffsets: Uint32Array;
  private readonly offKeyBlob: number;
  private readonly offEntryBlob: number;
  private readonly keyCount: number;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  /** Decoded entries, kept so repeated taps on a word do no work twice. */
  private readonly cache = new Map<number, DictEntry>();

  readonly size: number;
  readonly pos: string[];
  readonly meta: CompactDictFile["meta"];
  /** Tags every entry with where it came from, for the multi-dictionary UI. */
  source?: string;

  constructor(buffer: ArrayBuffer, source?: string) {
    if (!isBinaryDict(buffer)) throw new Error("Not a Yomeyo binary dictionary");
    const view = new DataView(buffer);
    if (view.getUint32(4, true) !== 2) {
      throw new Error("This dictionary was built by a newer version of Yomeyo");
    }
    this.bytes = new Uint8Array(buffer);
    this.keyCount = view.getUint32(8, true);
    this.size = view.getUint32(12, true);
    this.keyOffsets = new Uint32Array(buffer, view.getUint32(16, true), this.keyCount + 1);
    this.offKeyBlob = view.getUint32(20, true);
    this.postOffsets = new Uint32Array(buffer, view.getUint32(24, true), this.keyCount + 1);
    const offPostings = view.getUint32(28, true);
    const offEntOffsets = view.getUint32(32, true);
    this.postings = new Uint32Array(buffer, offPostings, (offEntOffsets - offPostings) / 4);
    this.entOffsets = new Uint32Array(buffer, offEntOffsets, this.size + 1);
    this.offEntryBlob = view.getUint32(36, true);
    const tail = JSON.parse(
      this.decoder.decode(
        this.bytes.subarray(view.getUint32(40, true), view.getUint32(40, true) + view.getUint32(44, true)),
      ),
    );
    this.pos = tail.pos ?? [];
    this.meta = tail.meta;
    this.source = source;
  }

  /** Index of `needle` among the sorted keys, or -1. */
  private find(needle: Uint8Array): number {
    let lo = 0;
    let hi = this.keyCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = this.offKeyBlob + this.keyOffsets[mid];
      const end = this.offKeyBlob + this.keyOffsets[mid + 1];
      const cmp = compareBytes(this.bytes, start, end, needle, 0, needle.length);
      if (cmp === 0) return mid;
      if (cmp < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  private decodeAt(id: number): DictEntry {
    const json = this.decoder.decode(
      this.bytes.subarray(this.offEntryBlob + this.entOffsets[id], this.offEntryBlob + this.entOffsets[id + 1]),
    );
    const [term, reading, posIdx, glosses, freq] = JSON.parse(json) as [
      string,
      string,
      number[],
      string[],
      number?,
    ];
    const entry: DictEntry = {
      term,
      reading,
      pos: posIdx.map((i) => this.pos[i]).filter((p): p is string => p !== undefined),
      glosses,
    };
    if (freq !== undefined) entry.freq = freq;
    if (this.source) entry.source = this.source;
    return entry;
  }

  private entryAt(id: number): DictEntry {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const entry = this.decodeAt(id);
    this.cache.set(id, entry);
    return entry;
  }

  /**
   * Every entry once, decoded on the fly and deliberately not cached — for
   * one-off scans (finding words made of certain kana, say) that must not
   * leave the whole dictionary sitting decoded in memory afterwards.
   */
  *entries(): Generator<DictEntry> {
    for (let id = 0; id < this.size; id++) yield this.decodeAt(id);
  }

  /**
   * Words whose reading uses only the given characters — what the kana game
   * asks for when it needs real words spelt with the rows you have picked.
   *
   * Walking `entries()` for this decodes every entry in the dictionary, which
   * is a JSON parse each and long enough on a phone to look like a hang. This
   * walks the sorted key index instead. Two arithmetic tests throw out almost
   * every key before anything is decoded: a kana is always three UTF-8 bytes,
   * so a key of two to four kana is a key of six to twelve bytes, and every
   * one of them begins 0xE3. Only what survives is decoded, and only what
   * matches is looked up in full.
   */
  wordsMadeOf(allowed: Set<string>, minLength = 2, maxLength = 4): DictEntry[] {
    const out: DictEntry[] = [];
    for (let k = 0; k < this.keyCount; k++) {
      const start = this.offKeyBlob + this.keyOffsets[k];
      const end = this.offKeyBlob + this.keyOffsets[k + 1];
      const length = end - start;
      if (length < minLength * 3 || length > maxLength * 3 || length % 3 !== 0) continue;
      if (this.bytes[start] !== 0xe3) continue;

      const key = this.decoder.decode(this.bytes.subarray(start, end));
      let ok = true;
      for (const ch of key) {
        if (!allowed.has(ch)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      for (let i = this.postOffsets[k]; i < this.postOffsets[k + 1]; i++) {
        const entry = this.decodeAt(this.postings[i]);
        // The key can be this entry's written form rather than its reading;
        // the game spells words out in kana, so only the reading counts.
        if (entry.reading === key) out.push(entry);
      }
    }
    return out;
  }

  lookupExact(text: string): DictEntry[] {
    const at = this.find(this.encoder.encode(text));
    if (at < 0) return [];
    const from = this.postOffsets[at];
    const to = this.postOffsets[at + 1];
    const out: DictEntry[] = new Array(to - from);
    for (let i = from; i < to; i++) out[i - from] = this.entryAt(this.postings[i]);
    return out;
  }
}
