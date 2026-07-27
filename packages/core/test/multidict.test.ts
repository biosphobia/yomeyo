import { describe, expect, it } from "vitest";
import {
  CombinedDictionary,
  MemoryDictionary,
  lookup,
  parseYomitanTermBank,
} from "../src/dictionary.js";
import type { DictEntry } from "../src/types.js";

const JMDICT: DictEntry[] = [
  { term: "辞書", reading: "じしょ", pos: ["n"], glosses: ["dictionary"], freq: 10 },
  { term: "食べる", reading: "たべる", pos: ["v1"], glosses: ["to eat"], freq: 5 },
];

/** Rows shaped like a real Yomitan term bank, including structured content. */
const TERM_BANK = [
  ["辞書", "じしょ", "n", "", 42, ["言葉を集めて並べ、意味を説明した書物。"], 1, ""],
  [
    "食べる",
    "たべる",
    "v1 vt",
    "v1",
    30,
    [{ type: "structured-content", content: ["物を口に入れて", { tag: "em", content: "かむ" }, "。"] }],
    2,
    "",
  ],
  ["空行", "からぎょう", "n", "", 1, [], 3, ""],
];

describe("Yomitan term bank import", () => {
  const entries = parseYomitanTermBank(TERM_BANK, "三省堂");

  it("reads term, reading and plain-text definitions", () => {
    const jisho = entries.find((e) => e.term === "辞書")!;
    expect(jisho.reading).toBe("じしょ");
    expect(jisho.glosses[0]).toContain("言葉を集めて");
    expect(jisho.source).toBe("三省堂");
  });

  it("flattens structured content into text", () => {
    const taberu = entries.find((e) => e.term === "食べる")!;
    expect(taberu.glosses[0]).toBe("物を口に入れてかむ。");
  });

  it("keeps rule flags as part-of-speech hints", () => {
    expect(entries.find((e) => e.term === "食べる")!.pos).toContain("v1");
  });

  it("skips entries with no definitions", () => {
    expect(entries.some((e) => e.term === "空行")).toBe(false);
  });

  it("ranks higher-scored entries as more common", () => {
    const jisho = entries.find((e) => e.term === "辞書")!;
    const taberu = entries.find((e) => e.term === "食べる")!;
    expect(jisho.freq!).toBeLessThan(taberu.freq!);
  });

  it("rejects things that are not term banks", () => {
    expect(() => parseYomitanTermBank({ nope: true }, "x")).toThrow(/array/);
    expect(() => parseYomitanTermBank([], "x")).toThrow(/No usable entries/);
  });
});

describe("combined dictionaries", () => {
  const combined = new CombinedDictionary([
    { name: "JMdict", dictionary: new MemoryDictionary(JMDICT) },
    { name: "三省堂", dictionary: new MemoryDictionary(parseYomitanTermBank(TERM_BANK, "三省堂")) },
  ]);

  it("returns entries from every dictionary", () => {
    const hits = combined.lookupExact("辞書");
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.source)).toEqual(["JMdict", "三省堂"]);
  });

  it("keeps the primary dictionary first", () => {
    expect(combined.lookupExact("辞書")[0].glosses[0]).toBe("dictionary");
  });

  it("still deinflects through the combined set", () => {
    const matches = lookup(combined, "食べた");
    expect(matches[0].term).toBe("食べる");
    const sources = matches[0].entries.map((e) => e.source);
    expect(sources).toContain("JMdict");
    expect(sources).toContain("三省堂");
  });

  it("gives a monolingual definition for a mined word", () => {
    const matches = lookup(combined, "辞書を引く");
    const japanese = matches[0].entries.find((e) => e.source === "三省堂");
    expect(japanese?.glosses[0]).toMatch(/書物/);
  });
});
