import { describe, expect, it } from "vitest";
import { createCard } from "../src/card.js";
import { DEFAULT_DECK_CONFIG } from "../src/deck-config.js";
import { RATING, intervalFor, nextMemoryState } from "../src/fsrs.js";
import { buildQueue, gradeCard, gradePreview } from "../src/scheduler.js";
import type { Card } from "../src/types.js";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

function card(id: string, over: Partial<Card> = {}): Card {
  return { ...createCard({ term: id, reading: id, glosses: [id] }, T0), id, ...over };
}

/** A review card with a memory state, ready to be graded again. */
function mature(id: string, stability: number, over: Partial<Card> = {}): Card {
  return card(id, {
    state: "review",
    stability,
    difficulty: 5,
    reps: 4,
    lastReview: T0 - 10 * DAY,
    intervalDays: 10,
    due: T0,
    ...over,
  });
}

/**
 * Anki's own fuzz bounds, written out again here rather than imported, so
 * the test is a statement about what Anki does and not a copy of what the
 * scheduler happens to do.
 */
function ankiFuzzRange(interval: number): [number, number] {
  if (interval < 2.5) return [interval, interval];
  let delta = 1;
  for (const [start, end, factor] of [
    [2.5, 7.0, 0.15],
    [7.0, 20.0, 0.1],
    [20.0, Infinity, 0.05],
  ] as [number, number, number][]) {
    delta += factor * Math.max(Math.min(interval, end) - start, 0);
  }
  return [Math.max(2, Math.round(interval - delta)), Math.round(interval + delta)];
}

describe("interval fuzz, the way Anki does it", () => {
  it("keeps every interval inside Anki's fuzz range around the unfuzzed one", () => {
    // The unfuzzed interval is worked out here independently, straight
    // from FSRS, so this compares the scheduler against the algorithm
    // rather than against itself.
    const config = DEFAULT_DECK_CONFIG;
    let widened = 0;
    for (let s = 1; s < 400; s = Math.round(s * 1.3) + 1) {
      const subject = mature(`s${s}`, s);
      const memory = nextMemoryState(
        { stability: subject.stability!, difficulty: subject.difficulty! },
        RATING.good,
        10,
        config.fsrsWeights,
      );
      const base = Math.min(
        Math.max(Math.round(intervalFor(memory.stability, config.desiredRetention, config.fsrsWeights)), 1),
        config.maxIntervalDays,
      );
      const [low, high] = ankiFuzzRange(base);
      const days = gradeCard(subject, "good", T0, config).intervalDays;
      expect(days).toBeGreaterThanOrEqual(low);
      expect(days).toBeLessThanOrEqual(high);
      if (base >= 3 && days !== base) widened++;
    }
    // And it must actually be moving things, not quietly returning the base.
    expect(widened).toBeGreaterThan(0);
  });

  it("never fuzzes an interval under two and a half days", () => {
    // Fresh cards graduating land on short intervals; those must be exact.
    for (let i = 0; i < 40; i++) {
      const fresh = card(`short${i}`, { state: "learning", stepIndex: 2, reps: 3 });
      const graded = gradeCard(fresh, "good", T0, DEFAULT_DECK_CONFIG);
      if (graded.intervalDays < 3) {
        expect(Number.isInteger(graded.intervalDays)).toBe(true);
        expect(graded.intervalDays).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("spreads a clump of identical cards across different days", () => {
    // The whole point of fuzz: same word, same history, same answer — and
    // yet they must not all come due on one day.
    const days = new Set<number>();
    for (let i = 0; i < 60; i++) {
      days.add(gradeCard(mature(`clump${i}`, 30), "good", T0, DEFAULT_DECK_CONFIG).intervalDays);
    }
    expect(days.size).toBeGreaterThan(1);
  });

  it("promises on the buttons exactly what the answer delivers", () => {
    // Anki seeds the fuzz from the card, so the preview cannot drift from
    // the result. Every grade, on a range of cards.
    for (let i = 0; i < 25; i++) {
      const subject = mature(`promise${i}`, 5 + i * 3);
      const preview = gradePreview(subject, T0, DEFAULT_DECK_CONFIG);
      for (const grade of ["again", "hard", "good", "easy"] as const) {
        const applied = gradeCard(subject, grade, T0, DEFAULT_DECK_CONFIG).due - T0;
        expect(applied).toBe(preview[grade]);
      }
    }
  });

  it("gives the same card the same answer twice, and a different one next time", () => {
    const subject = mature("stable", 40);
    const first = gradeCard(subject, "good", T0, DEFAULT_DECK_CONFIG);
    const again = gradeCard(subject, "good", T0, DEFAULT_DECK_CONFIG);
    expect(again.intervalDays).toBe(first.intervalDays);
    // The next review is a different draw, so a card cannot get stuck
    // taking the same nudge every single time.
    const rolls = new Set<number>();
    for (let reps = 0; reps < 12; reps++) {
      rolls.add(gradeCard(mature("stable", 40, { reps }), "good", T0, DEFAULT_DECK_CONFIG).intervalDays);
    }
    expect(rolls.size).toBeGreaterThan(1);
  });

  it("respects the easy cap and the maximum interval even after fuzzing", () => {
    const capped = gradeCard(
      card("capme", { state: "learning", stepIndex: 2, reps: 3, stability: 90, difficulty: 5 }),
      "easy",
      T0,
      DEFAULT_DECK_CONFIG,
    );
    expect(capped.intervalDays).toBeLessThanOrEqual(DEFAULT_DECK_CONFIG.easyIntervalDays);

    const tight = { ...DEFAULT_DECK_CONFIG, maxIntervalDays: 21 };
    for (let i = 0; i < 30; i++) {
      const far = gradeCard(mature(`far${i}`, 500), "easy", T0, tight);
      expect(far.intervalDays).toBeLessThanOrEqual(21);
    }
  });
});

describe("review order, the way Anki does it", () => {
  const config = { ...DEFAULT_DECK_CONFIG, newPerDay: 0 };

  it("shows an older day before a newer one", () => {
    const cards = [
      mature("today", 10, { due: T0 - 60_000 }),
      mature("yesterday", 10, { due: T0 - DAY }),
      mature("last week", 10, { due: T0 - 7 * DAY }),
    ];
    const queue = buildQueue(cards, T0, config);
    // Everything owed from before today is one bucket; within it, oldest
    // day first — and today's card comes after all of them.
    expect(queue[queue.length - 1].id).toBe("today");
  });

  it("does not simply replay the order cards were answered in", () => {
    // Twenty cards due within the same day, timestamped in order. Sorting
    // by the timestamp alone would hand them back in exactly that order.
    const cards = Array.from({ length: 20 }, (_, i) =>
      mature(`c${i}`, 10, { due: T0 - 20_000 + i * 1000 }),
    );
    const queue = buildQueue(cards, T0, config);
    expect(queue).toHaveLength(20);
    const byTimestamp = cards.map((c) => c.id);
    expect(queue.map((c) => c.id)).not.toEqual(byTimestamp);
    // Every card still appears exactly once.
    expect(new Set(queue.map((c) => c.id)).size).toBe(20);
  });

  it("keeps the same order when the queue is rebuilt mid-session", () => {
    const cards = Array.from({ length: 15 }, (_, i) => mature(`r${i}`, 10, { due: T0 - i * 1000 }));
    const first = buildQueue(cards, T0, config).map((c) => c.id);
    const second = buildQueue([...cards].reverse(), T0 + 5000, config).map((c) => c.id);
    expect(second).toEqual(first);
  });

  it("pulls a learning card forward when nothing else is left", () => {
    // Anki's learn-ahead limit: rather than "come back in four minutes".
    const soon = card("soon", { state: "learning", stepIndex: 1, due: T0 + 4 * 60_000 });
    const later = card("later", { state: "learning", stepIndex: 1, due: T0 + 3 * 3600_000 });
    expect(buildQueue([soon, later], T0, config).map((c) => c.id)).toEqual(["soon"]);
  });

  it("does not pull learning cards forward while real work remains", () => {
    const soon = card("soon", { state: "learning", stepIndex: 1, due: T0 + 4 * 60_000 });
    const owed = mature("owed", 10, { due: T0 - DAY });
    expect(buildQueue([soon, owed], T0, config).map((c) => c.id)).toEqual(["owed"]);
  });
});
