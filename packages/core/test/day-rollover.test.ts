import { describe, expect, it } from "vitest";
import { createCard } from "../src/card.js";
import { DEFAULT_DECK_CONFIG, dayKey, dayStart } from "../src/deck-config.js";
import { buildQueue } from "../src/scheduler.js";
import type { Card } from "../src/types.js";

/**
 * "Next day starts at", the setting that decides when one study day ends
 * and the next begins. Anki defaults it to 4am for one reason: a session at
 * one in the morning is the tail of yesterday's studying, and treating it
 * as a new day hands out a second helping of new cards to somebody who has
 * not been to bed.
 */

const DAY = 86_400_000;
const at = (y: number, m: number, d: number, h: number, min = 0): number =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe("the study day", () => {
  it("starts at the hour the deck says, not at midnight", () => {
    expect(dayStart(at(2026, 3, 10, 9, 30), 4)).toBe(at(2026, 3, 10, 4));
    expect(dayStart(at(2026, 3, 10, 4, 0), 4)).toBe(at(2026, 3, 10, 4));
  });

  it("counts one in the morning as the day before", () => {
    // The whole point: 01:00 on the 11th belongs to the 10th's session.
    expect(dayStart(at(2026, 3, 11, 1, 0), 4)).toBe(at(2026, 3, 10, 4));
    expect(dayKey(at(2026, 3, 11, 1, 0), 4)).toBe("2026-03-10");
    expect(dayKey(at(2026, 3, 11, 5, 0), 4)).toBe("2026-03-11");
  });

  it("puts the boundary back at midnight when asked to", () => {
    expect(dayKey(at(2026, 3, 11, 1, 0), 0)).toBe("2026-03-11");
    expect(dayStart(at(2026, 3, 11, 0, 0), 0)).toBe(at(2026, 3, 11, 0));
  });

  it("gives every hour of a day the same key, and the next day a different one", () => {
    const keys = new Set<string>();
    for (let hour = 4; hour < 28; hour++) keys.add(dayKey(at(2026, 6, 1, 0) + hour * 3600_000, 4));
    expect(keys.size).toBe(1);
    expect(dayKey(at(2026, 6, 2, 4), 4)).not.toBe([...keys][0]);
  });

  it("survives a daylight saving change intact", () => {
    // Whatever the runner's timezone, a boundary is a boundary: the day
    // containing it starts at the stated hour and holds the whole day.
    for (const day of [at(2026, 3, 29, 12), at(2026, 10, 25, 12), at(2026, 11, 1, 12)]) {
      const start = dayStart(day, 4);
      expect(new Date(start).getHours()).toBe(4);
      expect(dayStart(start, 4)).toBe(start);
      expect(dayStart(start - 1, 4)).toBeLessThan(start);
    }
  });
});

describe("the review queue's idea of a day", () => {
  const config = { ...DEFAULT_DECK_CONFIG, newPerDay: 0, rolloverHour: 4 };

  function due(id: string, when: number): Card {
    return {
      ...createCard({ term: id, reading: id, glosses: [id] }, when - 10 * DAY),
      id,
      state: "review",
      stability: 10,
      difficulty: 5,
      reps: 4,
      lastReview: when - 10 * DAY,
      intervalDays: 10,
      due: when,
    };
  }

  it("never lets the clock decide who comes first", () => {
    // Answered at 23:00 and at 01:00: with everything due pooled into one
    // shuffle, neither is sorted ahead of the other as "older" — over
    // enough deals, each card leads sometimes.
    const lateLastNight = due("late", at(2026, 5, 4, 23, 0));
    const smallHours = due("small-hours", at(2026, 5, 5, 1, 0));
    const now = at(2026, 5, 5, 2, 0);
    const leaders = new Set<string>();
    for (let deal = 0; deal < 40; deal++) {
      const order = buildQueue([lateLastNight, smallHours], now, config).map((c) => c.id);
      expect(order).toHaveLength(2);
      leaders.add(order[0]);
    }
    // Forty coin flips landing one way would be a rigged coin, i.e. the
    // clock still deciding the order inside the bucket.
    expect(leaders.size).toBe(2);
  });

  it("loses nothing to the shuffle, however old the backlog", () => {
    const yesterday = due("yesterday", at(2026, 5, 3, 20, 0));
    const tonight = due("tonight", at(2026, 5, 5, 1, 0));
    const order = buildQueue([tonight, yesterday], at(2026, 5, 5, 2, 0), config).map((c) => c.id);
    expect([...order].sort()).toEqual(["tonight", "yesterday"]);
  });
});

describe("the day's whole batch, at day start", () => {
  const config = { ...DEFAULT_DECK_CONFIG, newPerDay: 0, rolloverHour: 4 };
  const review = (id: string, when: number): Card => ({
    ...createCard({ term: id, reading: id, glosses: [id] }, when - 10 * DAY),
    id,
    state: "review",
    stability: 10,
    difficulty: 5,
    reps: 4,
    lastReview: when - 10 * DAY,
    intervalDays: 10,
    due: when,
  });

  it("hands over cards due later today, not at the o'clock they were answered", () => {
    // Reviewed at 21:00 yesterday, due 21:00 tonight: at eight in the
    // morning that card is TODAY'S work. Making it wait for the evening is
    // the drip feed — reviews trickling in all day, each at the hour it
    // was answered the time before.
    const tonight = review("tonight", at(2026, 5, 5, 21, 0));
    const smallHoursTomorrow = review("small-hours", at(2026, 5, 6, 1, 0)); // before 4am: still today
    const trulyTomorrow = review("tomorrow", at(2026, 5, 6, 9, 0));
    const queue = buildQueue([tonight, smallHoursTomorrow, trulyTomorrow], at(2026, 5, 5, 8, 0), config);
    expect(queue.map((c) => c.id).sort()).toEqual(["small-hours", "tonight"]);
  });

  it("keeps learning steps on the clock, not the calendar", () => {
    // A 5-minute step due this afternoon must NOT be handed over at 8am —
    // minutes-level cards are due when their timer runs out.
    const step: Card = {
      ...createCard({ term: "step", reading: "step", glosses: ["step"] }, at(2026, 5, 5, 7, 0)),
      id: "step",
      state: "learning",
      stepIndex: 1,
      due: at(2026, 5, 5, 15, 0),
    };
    expect(buildQueue([step], at(2026, 5, 5, 8, 0), config)).toHaveLength(0);
  });
});
