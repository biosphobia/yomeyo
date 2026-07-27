import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JS build script, imported for its pure functions
import { convertKanjidic, extractStrokes, bucketFor, verifyKanji } from "../../../scripts/build-kanji.mjs";
import {
  extractKanji,
  gradeLabel,
  isJoyo,
  isKanji,
  parseKanjiFile,
  strokeBucket,
} from "../src/kanji.js";

/** Shaped exactly like jmdict-simplified's published KANJIDIC2 JSON. */
function character(literal: string, grade: number | null, strokes: number, on: string[], kun: string[], meanings: string[], jlpt: number | null = null, frequency: number | null = null) {
  return {
    literal,
    codepoints: [{ type: "ucs", value: literal.codePointAt(0)!.toString(16) }],
    radicals: [{ type: "classical", value: 1 }],
    misc: { grade, strokeCounts: [strokes], variants: [], frequency, radicalNames: [], jlptLevel: jlpt },
    dictionaryReferences: [],
    queryCodes: [],
    readingMeaning: {
      groups: [
        {
          readings: [
            ...on.map((value) => ({ type: "ja_on", value })),
            ...kun.map((value) => ({ type: "ja_kun", value })),
            { type: "pinyin", value: "yi1" },
          ],
          meanings: [
            ...meanings.map((value) => ({ lang: "en", value })),
            { lang: "fr", value: "un" },
          ],
        },
      ],
      nanori: [],
    },
  };
}

const FIXTURE = {
  version: "1.0",
  languages: ["en"],
  dictDate: "2026-01-01",
  fileVersion: 4,
  databaseVersion: "2026-01",
  characters: [
    character("一", 1, 1, ["イチ", "イツ"], ["ひと", "ひと.つ"], ["one"], 4, 2),
    character("日", 1, 4, ["ニチ", "ジツ"], ["ひ", "-び"], ["day", "sun", "Japan"], 4, 1),
    character("語", 2, 14, ["ゴ"], ["かた.る"], ["word", "speech", "language"], 3, 301),
    character("鬱", 8, 29, ["ウツ"], ["ふさ.ぐ"], ["gloom", "depression"], null, 1900),
    character("苺", 9, 8, ["バイ"], ["いちご"], ["strawberry"]),
  ],
};

const built = convertKanjidic(FIXTURE);
const parsed = parseKanjiFile(built);
const byChar = (c: string) => parsed.find((k) => k.char === c)!;

describe("KANJIDIC2 conversion", () => {
  it("emits the compact format", () => {
    expect(built.format).toBe("yomeyo-kanji-1");
    expect(built.kanji).toHaveLength(5);
    expect(built.meta?.count).toBe(5);
  });

  it("keeps grade, stroke count, JLPT and frequency", () => {
    const hi = byChar("日");
    expect(hi.grade).toBe(1);
    expect(hi.strokes).toBe(4);
    expect(hi.jlpt).toBe(4);
    expect(hi.freq).toBe(1);
  });

  it("separates on and kun readings and drops other languages", () => {
    const go = byChar("語");
    expect(go.on).toEqual(["ゴ"]);
    expect(go.kun).toEqual(["かた.る"]);
    // pinyin must not leak into either list
    expect([...go.on, ...go.kun]).not.toContain("yi1");
  });

  it("keeps only English meanings", () => {
    expect(byChar("日").meanings).toEqual(["day", "sun", "Japan"]);
    expect(byChar("日").meanings).not.toContain("un");
  });

  it("treats a missing grade as unknown rather than dropping the kanji", () => {
    expect(byChar("苺").grade).toBe(9);
    expect(byChar("鬱").jlpt).toBe(0);
  });

  it("classifies jōyō and name-use kanji", () => {
    expect(isJoyo(byChar("一"))).toBe(true);
    expect(isJoyo(byChar("鬱"))).toBe(true); // grade 8 is still jōyō
    expect(isJoyo(byChar("苺"))).toBe(false); // grade 9 is jinmeiyō
  });

  it("labels grades readably", () => {
    expect(gradeLabel(1)).toBe("Grade 1");
    expect(gradeLabel(8)).toBe("Secondary");
    expect(gradeLabel(9)).toBe("Name use");
    expect(gradeLabel(0)).toBe("Uncommon");
  });
});

describe("kanji verification gate", () => {
  it("rejects a set that is too small", () => {
    expect(() => verifyKanji(built)).toThrow(/expected 5000/);
  });

  it("rejects wrong stroke counts", () => {
    const wrong = convertKanjidic({
      characters: [
        character("一", 1, 99, ["イチ"], ["ひと"], ["one"]),
        character("日", 1, 4, ["ニチ"], ["ひ"], ["day"]),
        character("語", 2, 14, ["ゴ"], ["かた.る"], ["language"]),
      ],
    });
    expect(() => verifyKanji(wrong, { minKanji: 1, requireJoyo: false })).toThrow(/99 strokes/);
  });

  it("rejects a missing core kanji", () => {
    const missing = convertKanjidic({ characters: [character("一", 1, 1, ["イチ"], ["ひと"], ["one"])] });
    expect(() => verifyKanji(missing, { minKanji: 1, requireJoyo: false })).toThrow(/missing kanji/);
  });

  it("accepts a well-formed set", () => {
    const good = convertKanjidic({
      characters: [
        character("一", 1, 1, ["イチ"], ["ひと"], ["one"]),
        character("日", 1, 4, ["ニチ"], ["ひ"], ["day", "sun"]),
        character("語", 2, 14, ["ゴ"], ["かた.る"], ["language"]),
      ],
    });
    expect(() => verifyKanji(good, { minKanji: 1, requireJoyo: false })).not.toThrow();
  });
});

describe("KanjiVG stroke extraction", () => {
  // Shaped like a real KanjiVG file: stroke paths carry an id ending -s<n>,
  // and grouping paths (radicals) do not.
  const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="109" height="109" viewBox="0 0 109 109">
<g id="kvg:StrokePaths_04e00">
<g id="kvg:04e00" kvg:element="&#x4e00;">
  <path id="kvg:04e00-s1" kvg:type="&#x4e00;" d="M11,54.25c3.19,0.5,6.5,0.6,9.72,0.4"/>
  <path id="kvg:04e00-s2" d="M20,30c1.5,0.2,3,0.4,4.5,0.1"/>
</g></g>
<g id="kvg:StrokeNumbers_04e00"><text transform="matrix(1 0 0 1 3 55)">1</text></g>
</svg>`;

  it("pulls stroke paths in order", () => {
    const strokes = extractStrokes(SVG);
    expect(strokes).toHaveLength(2);
    expect(strokes[0]).toMatch(/^M11,54.25/);
    expect(strokes[1]).toMatch(/^M20,30/);
  });

  it("ignores files with no stroke paths", () => {
    expect(extractStrokes("<svg></svg>")).toEqual([]);
  });

  it("buckets consistently with the runtime helper", () => {
    for (const ch of ["一", "日", "語", "鬱", "苺"]) {
      expect(bucketFor(ch)).toBe(strokeBucket(ch));
    }
    expect(strokeBucket("一")).toBe("4e");
  });
});

describe("finding kanji in text", () => {
  it("recognises kanji but not kana or punctuation", () => {
    expect(isKanji("語")).toBe(true);
    expect(isKanji("ご")).toBe(false);
    expect(isKanji("ゴ")).toBe(false);
    expect(isKanji("。")).toBe(false);
    expect(isKanji("A")).toBe(false);
  });

  it("extracts each kanji once, in order of appearance", () => {
    expect(extractKanji("日本語の勉強、日本は")).toEqual(["日", "本", "語", "勉", "強"]);
  });

  it("returns nothing for kana-only text", () => {
    expect(extractKanji("ありがとうございます")).toEqual([]);
  });

  it("handles a whole deck of words", () => {
    const words = ["遠距離恋愛", "図書館", "勉強する", "ひらがな"];
    expect(extractKanji(words.join(""))).toEqual([
      "遠", "距", "離", "恋", "愛", "図", "書", "館", "勉", "強",
    ]);
  });
});
