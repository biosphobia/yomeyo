import { describe, expect, it } from "vitest";
import {
  deckNameFromFile,
  deckOf,
  fromSharedCards,
  MINING_DECK_ID,
  newDeckId,
  ownerOfDeckId,
  packDeck,
  toSharedCards,
  unpackDeck,
  type Card,
  type SharedCard,
} from "../src/index.js";

function card(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    term: "水",
    reading: "みず",
    glosses: ["water"],
    createdAt: 1,
    updatedAt: 1,
    state: "review",
    due: 5_000,
    intervalDays: 30,
    ease: 2.4,
    stepIndex: 0,
    reps: 12,
    lapses: 1,
    ...over,
  };
}

describe("which deck a card is in", () => {
  it("treats a card from before decks existed as mined", () => {
    expect(deckOf(card())).toBe(MINING_DECK_ID);
  });

  it("reads the deck when there is one", () => {
    expect(deckOf(card({ deckId: "core2k" }))).toBe("core2k");
  });
});

describe("what a shared deck carries", () => {
  it("shares the words but not anyone's review history", () => {
    const shared = toSharedCards([card()]);
    expect(shared).toEqual([{ term: "水", reading: "みず", glosses: ["water"] }]);
    expect(JSON.stringify(shared)).not.toMatch(/interval|ease|reps|due/);
  });

  it("keeps the example sentence, which is part of the card", () => {
    expect(toSharedCards([card({ sentence: "水を飲む" })])[0].sentence).toBe("水を飲む");
  });

  it("leaves out deleted cards and blanks", () => {
    const cards = [card({ id: "a" }), card({ id: "b", deleted: true }), card({ id: "c", term: "  " })];
    expect(toSharedCards(cards)).toHaveLength(1);
  });

  it("gives whoever adds the deck a fresh start", () => {
    const shared = toSharedCards([card()]);
    const mine = fromSharedCards(shared, "core2k", 9_000);
    expect(mine[0]).toMatchObject({
      term: "水",
      reading: "みず",
      deckId: "core2k",
      state: "new",
      reps: 0,
      lapses: 0,
    });
    expect(mine[0].due).toBe(9_000);
  });

  it("gives every added card its own id, not the publisher's", () => {
    const mine = fromSharedCards(toSharedCards([card({ id: "theirs" }), card({ id: "theirs2", term: "火" })]), "d", 1);
    expect(mine[0].id).not.toBe("theirs");
    expect(mine[0].id).not.toBe(mine[1].id);
  });

  it("ignores rubbish in a downloaded deck rather than storing it", () => {
    const junk = [
      { term: "本", reading: "ほん", glosses: ["book"] },
      { term: "", reading: "", glosses: [] },
      { reading: "x", glosses: [] },
      { term: "字", glosses: ["nope", 7], reading: 5 },
    ] as unknown as SharedCard[];
    const cards = fromSharedCards(junk, "d", 1);
    expect(cards.map((c) => c.term)).toEqual(["本", "字"]);
    expect(cards[1].reading).toBe("");
    expect(cards[1].glosses).toEqual(["nope"]);
  });
});

describe("moving a deck through a document store", () => {
  const deck = (n: number): SharedCard[] =>
    Array.from({ length: n }, (_, i) => ({
      term: `単語${i}`,
      reading: `たんご${i}`,
      glosses: [`meaning ${i}`, "a second sense that makes the card realistic"],
      sentence: `これは${i}番目の例文です。`,
    }));

  it("packs and unpacks a deck unchanged", async () => {
    const cards = deck(500);
    const blocks = await packDeck(cards);
    expect(await unpackDeck(blocks)).toEqual(cards);
  });

  it("keeps every block small enough to store", async () => {
    const blocks = await packDeck(deck(20000), 200_000);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(200_000);
  });

  it("splits until the pieces fit, however small the limit", async () => {
    const blocks = await packDeck(deck(40), 400);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(400);
    expect(await unpackDeck(blocks)).toHaveLength(40);
  });

  it("gives up splitting a single card rather than looping forever", async () => {
    // One card can be larger than the limit; there is nothing left to split.
    const huge = [{ term: "長", reading: "な", glosses: ["あ".repeat(50000)] }];
    const blocks = await packDeck(huge, 100);
    expect(blocks).toHaveLength(1);
    expect(await unpackDeck(blocks)).toEqual(huge);
  });

  it("sends a whole deck in a handful of writes rather than one per card", async () => {
    // The point of packing at all: 6,000 words is Core 2k/6k territory, and
    // a write per card would spend a day's free Firestore quota on one deck.
    const blocks = await packDeck(deck(6000));
    expect(blocks.length).toBeLessThanOrEqual(4);
  });

  it("is much smaller than the words themselves", async () => {
    const cards = deck(2000);
    const packed = (await packDeck(cards)).reduce((sum, b) => sum + b.length, 0);
    expect(packed).toBeLessThan(JSON.stringify(cards).length / 3);
  });

  it("has nothing to pack for an empty deck", async () => {
    expect(await packDeck([])).toEqual([]);
    expect(await unpackDeck([])).toEqual([]);
  });

  it("refuses a block that is not a deck", async () => {
    const notAList = (await packDeck([{ term: "x", reading: "", glosses: [] }]))[0];
    await expect(unpackDeck([notAList.slice(0, 8)])).rejects.toThrow();
  });
});

describe("deck ids", () => {
  it("says who owns the deck", () => {
    const id = newDeckId("uid-abc", 1700000000000);
    expect(ownerOfDeckId(id)).toBe("uid-abc");
  });

  it("does not collide for two decks published at the same moment", () => {
    let n = 0;
    const ids = new Set(
      Array.from({ length: 50 }, () => newDeckId("uid", 1700000000000, () => (n++ * 0.019) % 1)),
    );
    expect(ids.size).toBe(50);
  });

  it("reports no owner for an id that carries none", () => {
    expect(ownerOfDeckId("mining")).toBe(null);
  });

  it("names a deck after the file it came from", () => {
    expect(deckNameFromFile("Core_2k-6k_Optimized.apkg")).toBe("Core 2k 6k Optimized");
    expect(deckNameFromFile("notes.txt")).toBe("notes");
    expect(deckNameFromFile(".apkg")).toBe("Imported deck");
  });
});
