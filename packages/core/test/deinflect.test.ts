import { describe, expect, it } from "vitest";
import { deinflect, classesMatchPos } from "../src/deinflect.js";
import { MemoryDictionary, lookup } from "../src/dictionary.js";
import type { DictEntry } from "../src/types.js";

function terms(text: string): string[] {
  return deinflect(text).map((d) => d.term);
}

describe("deinflect", () => {
  it("always includes the identity", () => {
    expect(terms("猫")).toContain("猫");
  });

  it("handles ichidan conjugations", () => {
    expect(terms("食べた")).toContain("食べる");
    expect(terms("食べます")).toContain("食べる");
    expect(terms("食べました")).toContain("食べる");
    expect(terms("食べない")).toContain("食べる");
    expect(terms("食べなかった")).toContain("食べる");
    expect(terms("食べて")).toContain("食べる");
    expect(terms("食べられる")).toContain("食べる");
    expect(terms("食べさせる")).toContain("食べる");
    expect(terms("食べれば")).toContain("食べる");
    expect(terms("食べよう")).toContain("食べる");
    expect(terms("食べたい")).toContain("食べる");
  });

  it("handles godan sound changes", () => {
    expect(terms("買った")).toContain("買う");
    expect(terms("書いて")).toContain("書く");
    expect(terms("泳いだ")).toContain("泳ぐ");
    expect(terms("話した")).toContain("話す");
    expect(terms("待って")).toContain("待つ");
    expect(terms("死んだ")).toContain("死ぬ");
    expect(terms("遊んで")).toContain("遊ぶ");
    expect(terms("読んだ")).toContain("読む");
    expect(terms("取って")).toContain("取る");
    expect(terms("読みます")).toContain("読む");
    expect(terms("書かない")).toContain("書く");
    expect(terms("読める")).toContain("読む");
    expect(terms("書けば")).toContain("書く");
    expect(terms("読もう")).toContain("読む");
  });

  it("handles suru and kuru", () => {
    expect(terms("して")).toContain("する");
    expect(terms("しました")).toContain("する");
    expect(terms("勉強した")).toContain("勉強する");
    expect(terms("きて")).toContain("くる");
    expect(terms("こない")).toContain("くる");
  });

  it("handles chained auxiliaries", () => {
    expect(terms("食べている")).toContain("食べる");
    expect(terms("読んでいる")).toContain("読む");
    expect(terms("食べてしまった")).toContain("食べる");
    expect(terms("飲んじゃった")).toContain("飲む");
    expect(terms("食べていました")).toContain("食べる");
    expect(terms("書いてみる")).toContain("書く");
  });

  it("handles -tara and -tari", () => {
    expect(terms("食べたら")).toContain("食べる");
    expect(terms("読んだり")).toContain("読む");
  });

  it("handles i-adjectives", () => {
    expect(terms("高かった")).toContain("高い");
    expect(terms("高くない")).toContain("高い");
    expect(terms("高くて")).toContain("高い");
    expect(terms("高ければ")).toContain("高い");
    expect(terms("高く")).toContain("高い");
  });

  it("handles negative past chains", () => {
    expect(terms("読まなかった")).toContain("読む");
    expect(terms("食べたくない")).toContain("食べる");
  });
});

describe("classesMatchPos", () => {
  it("accepts unconstrained", () => {
    expect(classesMatchPos([], ["n"])).toBe(true);
  });
  it("matches godan subclasses", () => {
    expect(classesMatchPos(["v5k"], ["v5k"])).toBe(true);
    expect(classesMatchPos(["v5k"], ["v5k-s"])).toBe(true);
    expect(classesMatchPos(["v5k"], ["v1"])).toBe(false);
  });
  it("rejects verb classes for nouns", () => {
    expect(classesMatchPos(["v1"], ["n"])).toBe(false);
  });
});

describe("lookup", () => {
  const entries: DictEntry[] = [
    { term: "食べる", reading: "たべる", pos: ["v1"], glosses: ["to eat"], freq: 100 },
    { term: "食べ物", reading: "たべもの", pos: ["n"], glosses: ["food"], freq: 200 },
    { term: "高い", reading: "たかい", pos: ["adj-i"], glosses: ["tall; expensive"], freq: 150 },
    { term: "切る", reading: "きる", pos: ["v5r"], glosses: ["to cut"], freq: 300 },
    { term: "着る", reading: "きる", pos: ["v1"], glosses: ["to wear"], freq: 310 },
    { term: "本", reading: "ほん", pos: ["n"], glosses: ["book"], freq: 50 },
    { term: "日本", reading: "にほん", pos: ["n"], glosses: ["Japan"], freq: 10 },
    { term: "日本語", reading: "にほんご", pos: ["n"], glosses: ["Japanese language"], freq: 20 },
  ];
  const dict = new MemoryDictionary(entries);

  it("finds longest match first", () => {
    const matches = lookup(dict, "日本語を勉強する");
    expect(matches[0].term).toBe("日本語");
    expect(matches.map((m) => m.term)).toContain("日本");
  });

  it("deinflects at the tap point", () => {
    const matches = lookup(dict, "食べていた");
    expect(matches[0].term).toBe("食べる");
    expect(matches[0].matchedText).toBe("食べていた");
  });

  it("respects POS constraints on deinflection", () => {
    // 切って must resolve to 切る (v5r), never 着る (v1)
    const matches = lookup(dict, "切って");
    const kitte = matches.filter((m) => m.matchedText === "切って");
    expect(kitte.some((m) => m.term === "切る")).toBe(true);
    expect(kitte.some((m) => m.term === "着る")).toBe(false);
  });

  it("matches kana input against readings", () => {
    const matches = lookup(dict, "たべた");
    expect(matches.some((m) => m.entries.some((e) => e.term === "食べる"))).toBe(true);
  });

  it("stops at non-Japanese characters", () => {
    expect(lookup(dict, "hello")).toEqual([]);
    const matches = lookup(dict, "本, and more");
    expect(matches[0].matchedText).toBe("本");
  });

  it("supports offsets", () => {
    const matches = lookup(dict, "私は本を読む", 2);
    expect(matches[0].term).toBe("本");
  });
});
