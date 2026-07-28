import { describe, expect, it } from "vitest";
import { MemoryDictionary, lookup } from "../src/dictionary.js";
import type { DictEntry } from "../src/types.js";

/**
 * Tapping a word, rather than pointing at its first character.
 *
 * Japanese is written without spaces, so nothing on screen says where a word
 * begins, and a fingertip covers several characters. A scan that only looks
 * forward from the character it was given finds 臭い for a tap on the 臭 of
 * 水臭い, and 遺孤 or 胃 for a tap on its い — the word under the finger is
 * missed entirely.
 */

const WORDS: DictEntry[] = [
  { term: "水臭い", reading: "みずくさい", pos: ["adj-i"], glosses: ["stand-offish; distant"], freq: 20000 },
  { term: "臭い", reading: "くさい", pos: ["adj-i", "suf"], glosses: ["stinking; smelly"], freq: 8000 },
  { term: "水", reading: "みず", pos: ["n"], glosses: ["water"], freq: 300 },
  { term: "遺孤", reading: "いこ", pos: ["n"], glosses: ["orphan"], freq: 900000 },
  { term: "胃", reading: "い", pos: ["n"], glosses: ["stomach"], freq: 5000 },
  { term: "いか", reading: "いか", pos: ["n"], glosses: ["squid"], freq: 9000 },
  { term: "こと", reading: "こと", pos: ["n"], glosses: ["thing; matter"], freq: 100 },
  { term: "から", reading: "から", pos: ["prt"], glosses: ["from; because"], freq: 50 },
  { term: "魚", reading: "さかな", pos: ["n"], glosses: ["fish"], freq: 400 },
  { term: "食べる", reading: "たべる", pos: ["v1", "vt"], glosses: ["to eat"], freq: 200 },
  { term: "遠距離恋愛", reading: "えんきょりれんあい", pos: ["n"], glosses: ["long distance relationship"], freq: 30000 },
  { term: "恋愛", reading: "れんあい", pos: ["n"], glosses: ["love; romance"], freq: 4000 },
  { term: "距離", reading: "きょり", pos: ["n"], glosses: ["distance"], freq: 2000 },
];

const dict = new MemoryDictionary(WORDS);

/** The dictionary form the first result points at. */
const topTermAt = (text: string, offset: number): string | undefined =>
  lookup(dict, text, offset)[0]?.term;

/** Every dictionary form offered, in order. */
const termsAt = (text: string, offset: number): string[] =>
  lookup(dict, text, offset).map((m) => m.term);

describe("tapping anywhere in a word finds it", () => {
  const sentence = "そんなに水臭いことを言うなよ。"; // 水臭い spans 4..6

  it("finds it from its first character", () => {
    expect(topTermAt(sentence, 4)).toBe("水臭い");
  });

  it("finds it from the middle", () => {
    expect(topTermAt(sentence, 5)).toBe("水臭い");
  });

  it("finds it from its last character", () => {
    expect(topTermAt(sentence, 6)).toBe("水臭い");
  });

  it("does not need the tap to land on the start of a long compound", () => {
    const text = "彼女とは遠距離恋愛をしている。"; // 遠距離恋愛 spans 4..8
    for (let i = 4; i <= 8; i++) expect(topTermAt(text, i)).toBe("遠距離恋愛");
  });
});

describe("a short word tapped on its last character", () => {
  const sentence = "この魚は臭いから食べない。"; // 臭い spans 4..5

  it("is offered, even when another word starts at the finger", () => {
    // いか (squid) begins exactly where the finger is; 臭い began one back.
    // Which ranks first is a judgement call, but 臭い must be there.
    expect(termsAt(sentence, 5)).toContain("臭い");
  });

  it("is found from its first character", () => {
    expect(topTermAt(sentence, 4)).toBe("臭い");
  });
});

describe("not reading past what was tapped", () => {
  it("ignores a word that ends before the tapped character", () => {
    // 水 ends at index 4; tapping index 5 must not return it.
    expect(termsAt("水臭い", 1)).not.toContain("水");
  });

  it("does not reach back across non-Japanese text", () => {
    // The scan must not join "cat" to 魚 and hunt for a word spanning both.
    expect(termsAt("cat魚", 3)).toEqual(["魚"]);
  });

  it("does not reach back past the start of the text", () => {
    expect(topTermAt("魚", 0)).toBe("魚");
  });

  it("still finds nothing when there is nothing to find", () => {
    expect(lookup(dict, "hello", 2)).toEqual([]);
  });
});

describe("where the match begins", () => {
  it("reports the start, so the highlight covers the whole word", () => {
    const [best] = lookup(dict, "そんなに水臭いことを言うなよ。", 6);
    expect(best.start).toBe(4);
    expect(best.matchLength).toBe(3);
    expect(best.matchedText).toBe("水臭い");
  });

  it("reports the tap position when the word starts there", () => {
    const [best] = lookup(dict, "そんなに水臭いことを言うなよ。", 4);
    expect(best.start).toBe(4);
  });

  it("keeps inflected matches anchored where the word starts", () => {
    // 食べない → 食べる, tapped on the ない part.
    const best = lookup(dict, "魚を食べない。", 4)[0];
    expect(best.term).toBe("食べる");
    expect(best.start).toBe(2);
    expect(best.reasons.length).toBeGreaterThan(0);
  });
});

describe("ordering", () => {
  it("puts the longest word first", () => {
    expect(termsAt("彼女とは遠距離恋愛をしている。", 6)[0]).toBe("遠距離恋愛");
  });

  it("still offers the shorter words that cover the tap", () => {
    // 距離 spans the tapped 離; 恋愛 begins after it and is rightly absent.
    const terms = termsAt("彼女とは遠距離恋愛をしている。", 6);
    expect(terms).toContain("距離");
    expect(terms).not.toContain("恋愛");
  });

  it("prefers the commoner word between equally long candidates", () => {
    // 臭い (started one character back) and いか (starts at the finger) are
    // both two characters long; the commoner one leads.
    expect(termsAt("この魚は臭いから食べない。", 5)[0]).toBe("臭い");
  });
});
