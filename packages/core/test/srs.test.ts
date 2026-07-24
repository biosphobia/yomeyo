import { describe, expect, it } from "vitest";
import { createCard } from "../src/card.js";
import { DEFAULT_SRS_CONFIG, deckStats, dueCards, gradeCard, isDue } from "../src/srs.js";
import { mergeCards } from "../src/sync.js";
import type { Card } from "../src/types.js";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const T0 = 1_700_000_000_000;

function freshCard(now = T0): Card {
  return createCard({ term: "猫", reading: "ねこ", glosses: ["cat"] }, now);
}

describe("srs scheduling", () => {
  it("new cards are due immediately", () => {
    const card = freshCard();
    expect(isDue(card, T0)).toBe(true);
    expect(card.state).toBe("new");
  });

  it("good on a new card enters learning at step 2", () => {
    const card = gradeCard(freshCard(), "good", T0);
    expect(card.state).toBe("learning");
    expect(card.due).toBe(T0 + 10 * MIN);
  });

  it("again resets to first learning step", () => {
    let card = gradeCard(freshCard(), "good", T0);
    card = gradeCard(card, "again", T0 + 10 * MIN);
    expect(card.due).toBe(T0 + 10 * MIN + 1 * MIN);
    expect(card.stepIndex).toBe(0);
  });

  it("graduates to review after all learning steps", () => {
    let card = gradeCard(freshCard(), "good", T0);
    card = gradeCard(card, "good", T0 + 10 * MIN);
    expect(card.state).toBe("review");
    expect(card.intervalDays).toBe(1);
    expect(card.due).toBe(T0 + 10 * MIN + DAY);
  });

  it("easy on a new card graduates immediately at 4 days", () => {
    const card = gradeCard(freshCard(), "easy", T0);
    expect(card.state).toBe("review");
    expect(card.intervalDays).toBe(4);
  });

  it("review intervals grow by ease", () => {
    let card = freshCard();
    card = gradeCard(card, "easy", T0); // review, 4d
    const t1 = T0 + 4 * DAY;
    card = gradeCard(card, "good", t1);
    expect(card.intervalDays).toBe(10); // 4 * 2.5
    expect(card.due).toBe(t1 + 10 * DAY);
  });

  it("lapses reduce ease and interval and go to relearning", () => {
    let card = freshCard();
    card = gradeCard(card, "easy", T0);
    const t1 = T0 + 4 * DAY;
    card = gradeCard(card, "good", t1); // 10d
    const t2 = t1 + 10 * DAY;
    card = gradeCard(card, "again", t2);
    expect(card.state).toBe("relearning");
    expect(card.lapses).toBe(1);
    expect(card.ease).toBeCloseTo(2.3);
    expect(card.intervalDays).toBe(5);
    // graduating from relearning restores the reduced interval
    const t3 = t2 + 10 * MIN;
    card = gradeCard(card, "good", t3);
    expect(card.state).toBe("review");
    expect(card.intervalDays).toBe(5);
  });

  it("hard grows slowly and reduces ease", () => {
    let card = freshCard();
    card = gradeCard(card, "easy", T0);
    const t1 = T0 + 4 * DAY;
    card = gradeCard(card, "hard", t1);
    expect(card.ease).toBeCloseTo(2.35);
    expect(card.intervalDays).toBe(5); // 4 * 1.2 = 4.8 -> at least prev+1
  });

  it("ease never drops below the floor", () => {
    let card = freshCard();
    card = gradeCard(card, "easy", T0);
    let t = T0 + 4 * DAY;
    for (let i = 0; i < 10; i++) {
      card = gradeCard(card, "again", t);
      card = gradeCard(card, "good", t + 10 * MIN);
      t += DAY;
    }
    expect(card.ease).toBeGreaterThanOrEqual(DEFAULT_SRS_CONFIG.minEase);
  });

  it("dueCards orders learning before review and excludes deleted", () => {
    const learning = { ...gradeCard(freshCard(), "good", T0), id: "a" };
    const review: Card = { ...freshCard(), id: "b", state: "review", due: T0 - DAY };
    const deleted: Card = { ...freshCard(), id: "c", deleted: true };
    const future: Card = { ...freshCard(), id: "d", due: T0 + DAY };
    const due = dueCards([review, learning, deleted, future], T0 + 11 * MIN);
    expect(due.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("deckStats counts states", () => {
    const cards = [freshCard(), gradeCard(freshCard(), "good", T0), gradeCard(freshCard(), "easy", T0)];
    const stats = deckStats(cards, T0);
    expect(stats.total).toBe(3);
    expect(stats.newCount).toBe(1);
    expect(stats.learning).toBe(1);
    expect(stats.review).toBe(1);
  });
});

describe("sync merge", () => {
  it("last write wins per card", () => {
    const a1: Card = { ...freshCard(), id: "a", updatedAt: 100 };
    const a2: Card = { ...a1, updatedAt: 200, glosses: ["newer"] };
    const local = new Map<string, Card>([["a", a1]]);
    const applied = mergeCards(local, [a2]);
    expect(applied).toHaveLength(1);
    expect(local.get("a")!.glosses).toEqual(["newer"]);
    // older incoming does not clobber
    const stale = mergeCards(local, [a1]);
    expect(stale).toHaveLength(0);
    expect(local.get("a")!.updatedAt).toBe(200);
  });

  it("soft deletes propagate", () => {
    const a1: Card = { ...freshCard(), id: "a", updatedAt: 100 };
    const local = new Map<string, Card>([["a", a1]]);
    mergeCards(local, [{ ...a1, deleted: true, updatedAt: 300 }]);
    expect(local.get("a")!.deleted).toBe(true);
  });
});
