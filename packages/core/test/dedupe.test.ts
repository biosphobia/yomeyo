import { describe, expect, it } from "vitest";
import { cardKey, createCard, dedupeCards, findDuplicate } from "../src/card.js";
import type { Card } from "../src/types.js";

const T0 = 1_700_000_000_000;

function card(term: string, reading: string, extra: Partial<Card> = {}): Card {
  return { ...createCard({ term, reading, glosses: [term] }, T0), ...extra };
}

describe("word identity", () => {
  it("treats the same written form and reading as one word", () => {
    expect(cardKey("読む", "よむ")).toBe(cardKey("読む", "よむ"));
  });

  it("keeps homographs with different readings apart", () => {
    // 生 is なま (raw) or せい (life) — genuinely different words.
    expect(cardKey("生", "なま")).not.toBe(cardKey("生", "せい"));
  });

  it("ignores surrounding whitespace", () => {
    expect(cardKey(" 読む ", " よむ ")).toBe(cardKey("読む", "よむ"));
  });

  it("falls back to the term when there is no reading", () => {
    expect(cardKey("ありがとう", "")).toBe(cardKey("ありがとう", "ありがとう"));
  });
});

describe("finding an existing card", () => {
  const deck = [card("読む", "よむ"), card("猫", "ねこ")];

  it("finds a word already in the deck", () => {
    expect(findDuplicate(deck, "読む", "よむ")?.term).toBe("読む");
  });

  it("returns nothing for a new word", () => {
    expect(findDuplicate(deck, "犬", "いぬ")).toBeUndefined();
  });

  it("does not match a homograph with another reading", () => {
    expect(findDuplicate([card("生", "なま")], "生", "せい")).toBeUndefined();
  });

  it("ignores deleted cards, so a re-saved word comes back", () => {
    const deleted = [card("読む", "よむ", { deleted: true })];
    expect(findDuplicate(deleted, "読む", "よむ")).toBeUndefined();
  });

  it("matches regardless of which dictionary supplied the definition", () => {
    // The same word from a monolingual dictionary is still the same word.
    const fromJmdict = card("辞書", "じしょ", { glosses: ["dictionary"] });
    expect(findDuplicate([fromJmdict], "辞書", "じしょ")?.glosses).toEqual(["dictionary"]);
  });
});

describe("collapsing duplicates already in a deck", () => {
  it("keeps one card per word", () => {
    const merged = dedupeCards([card("読む", "よむ"), card("読む", "よむ"), card("猫", "ねこ")]);
    expect(merged).toHaveLength(2);
  });

  it("keeps the copy with the most review history", () => {
    const fresh = card("読む", "よむ", { id: "new", reps: 0 });
    const studied = card("読む", "よむ", { id: "old", reps: 12, intervalDays: 30 });
    const [kept] = dedupeCards([fresh, studied]);
    expect(kept.id).toBe("old");
    expect(kept.reps).toBe(12);
  });

  it("falls back to the older card when neither has been reviewed", () => {
    const older = card("読む", "よむ", { id: "a", createdAt: T0 });
    const newer = card("読む", "よむ", { id: "b", createdAt: T0 + 5000 });
    expect(dedupeCards([newer, older])[0].id).toBe("a");
  });

  it("drops deleted cards", () => {
    expect(dedupeCards([card("読む", "よむ", { deleted: true })])).toHaveLength(0);
  });

  it("leaves a deck with no duplicates untouched", () => {
    const deck = [card("読む", "よむ"), card("猫", "ねこ"), card("生", "なま"), card("生", "せい")];
    expect(dedupeCards(deck)).toHaveLength(4);
  });
});
