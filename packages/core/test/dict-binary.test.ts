import { describe, expect, it } from "vitest";
import {
  BinaryDictionary,
  binarySourceFromEntries,
  encodeBinaryDict,
  isBinaryDict,
} from "../src/dict-binary.js";
import { MemoryDictionary, parseDictFile } from "../src/dictionary.js";
import { lookup } from "../src/dictionary.js";
import type { DictEntry } from "../src/types.js";

function build(entries: DictEntry[], source?: string): BinaryDictionary {
  const bytes = encodeBinaryDict(binarySourceFromEntries(entries));
  // Copy into an exactly-sized buffer, as `fetch(...).arrayBuffer()` gives.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new BinaryDictionary(buffer, source);
}

const SAMPLE: DictEntry[] = [
  { term: "読む", reading: "よむ", pos: ["v5m", "vt"], glosses: ["to read"] },
  { term: "猫", reading: "ねこ", pos: ["n"], glosses: ["cat"], freq: 12 },
  { term: "生", reading: "なま", pos: ["n", "adj-no"], glosses: ["raw", "fresh"] },
  { term: "生", reading: "せい", pos: ["n"], glosses: ["life"] },
  { term: "ありがとう", reading: "ありがとう", pos: ["int"], glosses: ["thank you"] },
  { term: "遠距離恋愛", reading: "えんきょりれんあい", pos: ["n"], glosses: ["long-distance relationship"] },
];

describe("finding a word", () => {
  const dict = build(SAMPLE);

  it("finds a word by its written form", () => {
    expect(dict.lookupExact("読む")[0].glosses).toEqual(["to read"]);
  });

  it("finds a word by its reading", () => {
    expect(dict.lookupExact("よむ")[0].term).toBe("読む");
  });

  it("returns both homographs for a shared written form", () => {
    expect(dict.lookupExact("生").map((e) => e.reading).sort()).toEqual(["せい", "なま"]);
  });

  it("finds a long compound", () => {
    expect(dict.lookupExact("遠距離恋愛")[0].glosses[0]).toMatch(/long-distance/);
  });

  it("returns nothing for a word it does not have", () => {
    expect(dict.lookupExact("存在しない")).toEqual([]);
  });

  it("does not confuse a word with a prefix of it", () => {
    // 生 and 生きる share a first character; a byte-range search must not
    // treat the shorter key as a match for the longer one.
    const d = build([
      { term: "生", reading: "なま", pos: ["n"], glosses: ["raw"] },
      { term: "生きる", reading: "いきる", pos: ["v1"], glosses: ["to live"] },
    ]);
    expect(d.lookupExact("生").map((e) => e.glosses[0])).toEqual(["raw"]);
    expect(d.lookupExact("生きる").map((e) => e.glosses[0])).toEqual(["to live"]);
    expect(d.lookupExact("生き")).toEqual([]);
  });

  it("keeps the parts of speech", () => {
    expect(dict.lookupExact("読む")[0].pos).toEqual(["v5m", "vt"]);
  });

  it("keeps a frequency when there is one, and omits it otherwise", () => {
    expect(dict.lookupExact("猫")[0].freq).toBe(12);
    expect(dict.lookupExact("読む")[0]).not.toHaveProperty("freq");
  });

  it("reports how many entries it holds", () => {
    expect(dict.size).toBe(SAMPLE.length);
  });

  it("tags entries with the dictionary they came from, when asked", () => {
    expect(build(SAMPLE, "大辞林").lookupExact("猫")[0].source).toBe("大辞林");
  });
});

describe("matching the in-memory dictionary it replaces", () => {
  it("gives the same answers for every key", () => {
    const memory = new MemoryDictionary(SAMPLE);
    const binary = build(SAMPLE);
    for (const key of ["読む", "よむ", "猫", "ねこ", "生", "せい", "ありがとう", "遠距離恋愛", "なし"]) {
      expect(binary.lookupExact(key)).toEqual(memory.lookupExact(key));
    }
  });

  it("deinflects through it, so 読んだ still finds 読む", () => {
    const matches = lookup(build(SAMPLE), "本を読んだ。", 2);
    expect(matches[0].entries[0].term).toBe("読む");
  });
});

describe("the encoding itself", () => {
  it("is recognisable from its first bytes", () => {
    const bytes = encodeBinaryDict(binarySourceFromEntries(SAMPLE));
    expect(isBinaryDict(bytes.buffer.slice(0))).toBe(true);
  });

  it("does not mistake a JSON dictionary for a binary one", () => {
    const json = new TextEncoder().encode(JSON.stringify({ format: "yomeyo-dict-1", entries: [] }));
    expect(isBinaryDict(json.buffer.slice(0))).toBe(false);
  });

  it("refuses to read something that is not a dictionary", () => {
    expect(() => new BinaryDictionary(new TextEncoder().encode("hello there!!").buffer)).toThrow(
      /not a yomeyo binary dictionary/i,
    );
  });

  it("refuses a truncated file rather than reading nonsense", () => {
    expect(() => new BinaryDictionary(new Uint8Array(8).buffer)).toThrow();
  });

  it("survives an empty dictionary", () => {
    const empty = build([]);
    expect(empty.size).toBe(0);
    expect(empty.lookupExact("猫")).toEqual([]);
  });

  it("carries the provenance shown in Settings", () => {
    const bytes = encodeBinaryDict({
      ...binarySourceFromEntries(SAMPLE),
      meta: { source: "JMdict", date: "2026-01-01", count: SAMPLE.length },
    });
    expect(new BinaryDictionary(bytes.buffer.slice(0)).meta?.source).toBe("JMdict");
  });

  it("holds every key of a large dictionary, in bytewise order", () => {
    // Enough entries, and enough scripts, to exercise the binary search over
    // multi-byte UTF-8 rather than a handful of lucky comparisons.
    const many: DictEntry[] = [];
    const scripts = ["あ", "ア", "漢", "a", "Ａ", "㍿", "🈁"];
    for (let i = 0; i < 5000; i++) {
      const term = scripts[i % scripts.length] + i.toString(36);
      many.push({ term, reading: term, pos: ["n"], glosses: [`gloss ${i}`] });
    }
    const dict = build(many);
    for (const e of many) expect(dict.lookupExact(e.term)[0]?.glosses).toEqual(e.glosses);
    expect(dict.lookupExact("nothing-here")).toEqual([]);
  });

  it("round-trips a compact dictionary file unchanged", () => {
    const compact = {
      format: "yomeyo-dict-1" as const,
      pos: ["n", "v5m"],
      entries: [["猫", "ねこ", [0], ["cat"], 3] as [string, string, number[], string[], number]],
    };
    const bytes = encodeBinaryDict({ entries: compact.entries, pos: compact.pos });
    const dict = new BinaryDictionary(bytes.buffer.slice(0));
    expect(dict.lookupExact("猫")).toEqual(parseDictFile(compact));
  });
});
