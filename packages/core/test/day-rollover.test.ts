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

  it("treats last night's late cards as part of the same day", () => {
    // Answered at 23:00 and at 01:00: one calendar day apart, one study day
    // together — so neither is sorted ahead of the other as "older". Same
    // bucket means the tie is broken by the shuffle, not by the clock: over
    // enough deals, each card leads sometimes. (This assertion once pinned
    // the two builds to the SAME order, back when the shuffle was seeded by
    // the day; the queue now deals fresh every build, on purpose.)
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

  it("still puts a genuinely older day first", () => {
    const yesterday = due("yesterday", at(2026, 5, 3, 20, 0));
    const tonight = due("tonight", at(2026, 5, 5, 1, 0));
    const order = buildQueue([tonight, yesterday], at(2026, 5, 5, 2, 0), config).map((c) => c.id);
    expect(order).toEqual(["yesterday", "tonight"]);
  });
});
