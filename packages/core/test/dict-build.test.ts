import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JS build script, imported for its pure functions
import { convertJmdict, verifyDict } from "../../../scripts/build-dict.mjs";
import { MemoryDictionary, lookup, parseDictFile } from "../src/dictionary.js";

/**
 * Fixture mirroring the real jmdict-simplified schema (verified against
 * scriptin/jmdict-simplified packages/jmdict-simplified-types/index.ts).
 * If upstream changes shape, these tests fail before CI ships a broken dict.
 */
const FIXTURE = {
  version: "3.6.1",
  languages: ["eng"],
  commonOnly: true,
  dictDate: "2025-01-01",
  dictRevisions: ["1.09"],
  tags: { v1: "Ichidan verb", n: "noun" },
  words: [
    {
      id: "1358280",
      kanji: [{ common: true, text: "食べる", tags: [] }],
      kana: [{ common: true, text: "たべる", tags: [], appliesToKanji: ["*"] }],
      sense: [
        {
          partOfSpeech: ["v1", "vt"],
          appliesToKanji: ["*"],
          appliesToKana: ["*"],
          related: [],
          antonym: [],
          field: [],
          dialect: [],
          misc: [],
          info: [],
          languageSource: [],
          gloss: [
            { lang: "eng", gender: null, type: null, text: "to eat" },
            { lang: "eng", gender: null, type: null, text: "to live on" },
          ],
        },
      ],
    },
    {
      // Two common spellings with DIFFERENT readings sharing one entry —
      // the case that makes appliesToKanji matter.
      id: "1404410",
      kanji: [
        { common: true, text: "早い", tags: [] },
        { common: true, text: "速い", tags: [] },
        { common: false, text: "疾い", tags: ["rK"] },
      ],
      kana: [
        { common: true, text: "はやい", tags: [], appliesToKanji: ["早い"] },
        { common: true, text: "はやい", tags: [], appliesToKanji: ["速い"] },
      ],
      sense: [
        {
          partOfSpeech: ["adj-i"],
          appliesToKanji: ["*"],
          appliesToKana: ["*"],
          related: [],
          antonym: [],
          field: [],
          dialect: [],
          misc: [],
          info: [],
          languageSource: [],
          gloss: [{ lang: "eng", gender: null, type: null, text: "fast; quick; early" }],
        },
      ],
    },
    {
      // Kana-only word
      id: "1000000",
      kanji: [],
      kana: [{ common: true, text: "ありがとう", tags: [], appliesToKanji: [] }],
      sense: [
        {
          partOfSpeech: ["int"],
          appliesToKanji: ["*"],
          appliesToKana: ["*"],
          related: [],
          antonym: [],
          field: [],
          dialect: [],
          misc: [],
          info: [],
          languageSource: [],
          gloss: [{ lang: "eng", gender: null, type: null, text: "thank you" }],
        },
      ],
    },
    {
      // Rare-kanji-only headword: rK is skipped, so the kana form is used.
      id: "2000000",
      kanji: [{ common: false, text: "或る", tags: ["rK"] }],
      kana: [{ common: true, text: "ある", tags: [], appliesToKanji: ["*"] }],
      sense: [
        {
          partOfSpeech: ["adj-pn"],
          appliesToKanji: ["*"],
          appliesToKana: ["*"],
          related: [],
          antonym: [],
          field: [],
          dialect: [],
          misc: [],
          info: [],
          languageSource: [],
          gloss: [{ lang: "eng", gender: null, type: null, text: "a certain; some" }],
        },
      ],
    },
    {
      // Non-English glosses must be filtered out.
      id: "3000000",
      kanji: [{ common: true, text: "本", tags: [] }],
      kana: [{ common: true, text: "ほん", tags: [], appliesToKanji: ["*"] }],
      sense: [
        {
          partOfSpeech: ["n"],
          appliesToKanji: ["*"],
          appliesToKana: ["*"],
          related: [],
          antonym: [],
          field: [],
          dialect: [],
          misc: [],
          info: [],
          languageSource: [],
          gloss: [
            { lang: "eng", gender: null, type: null, text: "book" },
            { lang: "spa", gender: null, type: null, text: "libro" },
          ],
        },
      ],
    },
  ],
};

const built = convertJmdict(FIXTURE);
const entries = parseDictFile(built);
const byTerm = (term: string) => entries.filter((e) => e.term === term);

describe("JMdict conversion", () => {
  it("emits the compact format with an interned POS table", () => {
    expect(built.format).toBe("yomeyo-dict-1");
    expect(built.pos).toContain("v1");
    expect(built.pos).toContain("adj-i");
    // each POS string is stored exactly once
    expect(new Set(built.pos).size).toBe(built.pos.length);
  });

  it("round-trips through parseDictFile", () => {
    const taberu = byTerm("食べる")[0];
    expect(taberu.reading).toBe("たべる");
    expect(taberu.pos).toContain("v1");
    expect(taberu.glosses[0]).toBe("to eat; to live on");
  });

  it("keeps common alternate spellings with the correct reading each", () => {
    expect(byTerm("早い")[0]?.reading).toBe("はやい");
    expect(byTerm("速い")[0]?.reading).toBe("はやい");
    // the rK spelling is dropped
    expect(byTerm("疾い")).toHaveLength(0);
  });

  it("uses the kana form for kana-only and rare-kanji-only words", () => {
    expect(byTerm("ありがとう")[0]?.reading).toBe("ありがとう");
    expect(byTerm("ある")[0]?.glosses[0]).toBe("a certain; some");
    expect(byTerm("或る")).toHaveLength(0);
  });

  it("drops non-English glosses", () => {
    expect(byTerm("本")[0]?.glosses[0]).toBe("book");
  });

  it("ranks common words ahead of uncommon ones", () => {
    for (const entry of entries) {
      expect(entry.freq).toBeLessThan(1_000_000);
    }
  });

  it("produces a dictionary the lookup pipeline can use", () => {
    const dict = new MemoryDictionary(entries);
    const matches = lookup(dict, "食べたい");
    expect(matches[0].term).toBe("食べる");
    expect(matches[0].reasons).toContain("-tai");
  });
});

describe("dictionary verification gate", () => {
  it("passes a well-formed dictionary", () => {
    const good = convertJmdict({
      words: [
        ...FIXTURE.words,
        makeWord("読む", "よむ", ["v5m"], "to read"),
        makeWord("高い", "たかい", ["adj-i"], "tall; expensive"),
        makeWord("日本語", "にほんご", ["n"], "Japanese language"),
        makeWord("する", "する", ["vs-i"], "to do"),
      ],
    });
    expect(() => verifyDict(good, { minEntries: 1 })).not.toThrow();
  });

  it("rejects a dictionary missing core words", () => {
    expect(() => verifyDict(built, { minEntries: 1 })).toThrow(/missing entry/);
  });

  it("rejects a truncated dictionary", () => {
    expect(() => verifyDict(built)).toThrow(/expected 10000\+/);
  });

  it("rejects wrong part-of-speech data", () => {
    const wrongPos = convertJmdict({
      words: [
        makeWord("食べる", "たべる", ["n"], "to eat"), // v1 expected
        makeWord("読む", "よむ", ["v5m"], "to read"),
        makeWord("高い", "たかい", ["adj-i"], "tall"),
        makeWord("日本語", "にほんご", ["n"], "Japanese"),
        makeWord("する", "する", ["vs-i"], "to do"),
      ],
    });
    expect(() => verifyDict(wrongPos, { minEntries: 1 })).toThrow(/lacks v1/);
  });
});

function makeWord(kanjiText: string, kanaText: string, partOfSpeech: string[], gloss: string) {
  const hasKanji = kanjiText !== kanaText;
  return {
    id: kanjiText,
    kanji: hasKanji ? [{ common: true, text: kanjiText, tags: [] }] : [],
    kana: [{ common: true, text: kanaText, tags: [], appliesToKanji: ["*"] }],
    sense: [
      {
        partOfSpeech,
        appliesToKanji: ["*"],
        appliesToKana: ["*"],
        related: [],
        antonym: [],
        field: [],
        dialect: [],
        misc: [],
        info: [],
        languageSource: [],
        gloss: [{ lang: "eng", gender: null, type: null, text: gloss }],
      },
    ],
  };
}
