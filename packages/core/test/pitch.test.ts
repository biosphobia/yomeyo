import { describe, expect, it } from "vitest";
import { dropAfter, furiganaSegments, moraeOf, parsePitchAccents, pitchLevels } from "../src/index.js";

describe("reading pitch numbers out of a field", () => {
  it("reads plain, circled and full-width digits", () => {
    expect(parsePitchAccents("0")).toEqual([0]);
    expect(parsePitchAccents("①")).toEqual([1]);
    expect(parsePitchAccents("３")).toEqual([3]);
  });

  it("reads a list of accepted accents", () => {
    expect(parsePitchAccents("0, 3")).toEqual([0, 3]);
    expect(parsePitchAccents("[1] [3]")).toEqual([1, 3]);
  });

  it("ignores numbers far too large to be pitch", () => {
    expect(parsePitchAccents("rank 3200")).toEqual([]);
  });

  it("finds nothing in prose", () => {
    expect(parsePitchAccents("heiban")).toEqual([]);
    expect(parsePitchAccents("")).toEqual([]);
  });
});

describe("morae", () => {
  it("attaches small kana to the mora before them", () => {
    expect(moraeOf("きょう")).toEqual(["きょ", "う"]);
    expect(moraeOf("がっこう")).toEqual(["が", "っ", "こ", "う"]);
    expect(moraeOf("ファン")).toEqual(["ファ", "ン"]);
  });

  it("counts the long-vowel mark as its own mora", () => {
    expect(moraeOf("コーヒー")).toEqual(["コ", "ー", "ヒ", "ー"]);
  });
});

describe("pitch shape", () => {
  it("heiban starts low and stays high, never dropping", () => {
    expect(pitchLevels(4, 0)).toEqual([false, true, true, true]);
    expect(dropAfter(4, 0)).toBeNull();
  });

  it("atamadaka starts high and drops at once", () => {
    expect(pitchLevels(3, 1)).toEqual([true, false, false]);
    expect(dropAfter(3, 1)).toBe(0);
  });

  it("nakadaka rises then drops after the accented mora", () => {
    expect(pitchLevels(4, 3)).toEqual([false, true, true, false]);
    expect(dropAfter(4, 3)).toBe(2);
  });

  it("treats an accent beyond the word as heiban rather than drawing nonsense", () => {
    expect(pitchLevels(2, 7)).toEqual([false, true]);
    expect(dropAfter(2, 7)).toBeNull();
  });
});

describe("furigana segments", () => {
  it("splits notation into ruby runs and plain runs", () => {
    expect(furiganaSegments("水[みず]を 飲[の]む")).toEqual([
      { text: "水", ruby: "みず" },
      { text: "を" },
      { text: "飲", ruby: "の" },
      { text: "む" },
    ]);
  });

  it("passes plain text through as one segment", () => {
    expect(furiganaSegments("みずをのむ")).toEqual([{ text: "みずをのむ" }]);
  });

  it("returns nothing for an empty field", () => {
    expect(furiganaSegments("  ")).toEqual([]);
  });
});
