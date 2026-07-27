import { describe, expect, it } from "vitest";
import {
  DEFAULT_FSRS_WEIGHTS,
  RATING,
  decayOf,
  factorOf,
  initialDifficulty,
  initialStability,
  intervalFor,
  nextDifficulty,
  nextMemoryState,
  parseFsrsWeights,
  retrievability,
  shortTermStability,
} from "../src/fsrs.js";
import { DEFAULT_DECK_CONFIG, formatSteps, parseSteps } from "../src/deck-config.js";
import { buildQueue, gradeCard, gradePreview } from "../src/scheduler.js";
import { createCard } from "../src/card.js";
import type { Card } from "../src/types.js";

/** The parameter set from the user's Anki deck (FSRS-6, 21 weights). */
const MINE = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

describe("FSRS-6 core", () => {
  it("reads decay from the last weight", () => {
    expect(decayOf(MINE)).toBeCloseTo(-0.1542, 6);
    expect(decayOf(DEFAULT_FSRS_WEIGHTS)).toBeCloseTo(-0.2, 6);
  });

  it("is calibrated so recall is exactly 90% at t = stability", () => {
    for (const w of [MINE, DEFAULT_FSRS_WEIGHTS]) {
      expect(retrievability(10, 10, w)).toBeCloseTo(0.9, 6);
      expect(retrievability(2.5, 2.5, w)).toBeCloseTo(0.9, 6);
    }
    expect(factorOf(MINE)).toBeGreaterThan(0);
  });

  it("has recall start at 1 and fall monotonically", () => {
    expect(retrievability(0, 5, MINE)).toBeCloseTo(1, 6);
    let previous = 1;
    for (const days of [1, 2, 5, 10, 30, 100]) {
      const r = retrievability(days, 5, MINE);
      expect(r).toBeLessThan(previous);
      expect(r).toBeGreaterThan(0);
      previous = r;
    }
  });

  it("inverts retrievability: the interval hits the target retention", () => {
    for (const retention of [0.75, 0.8, 0.9, 0.95]) {
      const days = intervalFor(12, retention, MINE);
      expect(retrievability(days, 12, MINE)).toBeCloseTo(retention, 6);
    }
  });

  it("gives shorter intervals for higher desired retention", () => {
    const at80 = intervalFor(10, 0.8, MINE);
    const at90 = intervalFor(10, 0.9, MINE);
    const at95 = intervalFor(10, 0.95, MINE);
    expect(at90).toBeLessThan(at80);
    expect(at95).toBeLessThan(at90);
  });

  it("takes initial stability straight from the first four weights", () => {
    expect(initialStability(RATING.again, MINE)).toBeCloseTo(MINE[0]);
    expect(initialStability(RATING.hard, MINE)).toBeCloseTo(MINE[1]);
    expect(initialStability(RATING.good, MINE)).toBeCloseTo(MINE[2]);
    expect(initialStability(RATING.easy, MINE)).toBeCloseTo(MINE[3]);
    // A better first rating must mean a more stable memory.
    expect(initialStability(RATING.easy, MINE)).toBeGreaterThan(initialStability(RATING.good, MINE));
  });

  it("makes a card easier the better it is rated, within 1..10", () => {
    const again = initialDifficulty(RATING.again, MINE);
    const good = initialDifficulty(RATING.good, MINE);
    const easy = initialDifficulty(RATING.easy, MINE);
    expect(again).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(easy);
    for (const d of [again, good, easy]) {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
    }
  });

  it("keeps difficulty inside 1..10 however it is hammered", () => {
    let d = 5;
    for (let i = 0; i < 200; i++) d = nextDifficulty(d, RATING.again, MINE);
    expect(d).toBeLessThanOrEqual(10);
    expect(d).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 200; i++) d = nextDifficulty(d, RATING.easy, MINE);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(10);
  });

  it("grows stability on recall and never on a lapse", () => {
    const state = { stability: 10, difficulty: 5 };
    const good = nextMemoryState(state, RATING.good, 10, MINE);
    const easy = nextMemoryState(state, RATING.easy, 10, MINE);
    const hard = nextMemoryState(state, RATING.hard, 10, MINE);
    const again = nextMemoryState(state, RATING.again, 10, MINE);

    expect(good.stability).toBeGreaterThan(state.stability);
    expect(easy.stability).toBeGreaterThan(good.stability);
    expect(hard.stability).toBeLessThan(good.stability);
    expect(again.stability).toBeLessThan(state.stability);
  });

  it("rewards a longer successful delay with more stability", () => {
    const state = { stability: 10, difficulty: 5 };
    const soon = nextMemoryState(state, RATING.good, 3, MINE).stability;
    const late = nextMemoryState(state, RATING.good, 30, MINE).stability;
    expect(late).toBeGreaterThan(soon);
  });

  it("treats a same-day review as a learning step, not a recall test", () => {
    const state = { stability: 5, difficulty: 5 };
    const sameDay = nextMemoryState(state, RATING.good, 0, MINE);
    expect(sameDay.stability).toBeCloseTo(shortTermStability(5, RATING.good, MINE), 9);
    // Drilling must not shrink a memory you just got right.
    expect(sameDay.stability).toBeGreaterThanOrEqual(state.stability);
  });

  it("cannot be inflated without bound by drilling the same day", () => {
    // w19 damps same-day growth as stability rises, so repeated drilling
    // converges to a fixed point instead of running away.
    let s = 5;
    for (let i = 0; i < 500; i++) s = shortTermStability(s, RATING.easy, MINE);

    expect(Number.isFinite(s)).toBe(true);
    // It settles on a fixed point rather than running away: one more review
    // barely moves it.
    const once = shortTermStability(s, RATING.easy, MINE);
    expect(once / s - 1).toBeLessThan(0.001);
    // The fixed point of s -> e^(w17·(1+w18))·s^(1-w19) is finite.
    const fixedPoint = Math.pow(Math.exp(MINE[17] * (1 + MINE[18])), 1 / MINE[19]);
    expect(s).toBeCloseTo(fixedPoint, -2);
  });

  it("keeps every value finite across a long random history", () => {
    let state = nextMemoryState(null, RATING.good, 0, MINE);
    const ratings = [RATING.good, RATING.again, RATING.hard, RATING.easy] as const;
    for (let i = 0; i < 500; i++) {
      state = nextMemoryState(state, ratings[i % 4], (i % 17) + 1, MINE);
      expect(Number.isFinite(state.stability)).toBe(true);
      expect(Number.isFinite(state.difficulty)).toBe(true);
      expect(state.stability).toBeGreaterThan(0);
      expect(state.difficulty).toBeGreaterThanOrEqual(1);
      expect(state.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it("validates pasted parameters", () => {
    expect(parseFsrsWeights(MINE.join(", "))).toHaveLength(21);
    expect(() => parseFsrsWeights("1, 2, 3")).toThrow(/21 parameters/);
    expect(() => parseFsrsWeights(MINE.map(() => "x").join(","))).toThrow(/numbers/);
    const badDecay = [...MINE];
    badDecay[20] = 0;
    expect(() => parseFsrsWeights(badDecay.join(","))).toThrow(/decay/);
  });
});

describe("deck settings", () => {
  it("parses Anki step syntax including sub-minute steps", () => {
    expect(parseSteps("20s 1m 5m")).toEqual([20, 60, 300]);
    expect(parseSteps("3m")).toEqual([180]);
    expect(parseSteps("1 10")).toEqual([60, 600]); // bare numbers are minutes
    expect(parseSteps("1h 1d")).toEqual([3600, 86400]);
  });

  it("round-trips steps back to Anki's notation", () => {
    expect(formatSteps([20, 60, 300])).toBe("20s 1m 5m");
    expect(formatSteps([180])).toBe("3m");
  });

  it("rejects nonsense steps", () => {
    expect(() => parseSteps("banana")).toThrow();
    expect(() => parseSteps("")).toThrow(/at least one/);
    expect(() => parseSteps("0m")).toThrow(/longer than zero/);
  });

  it("ships the user's preset as the default", () => {
    expect(DEFAULT_DECK_CONFIG.fsrs).toBe(true);
    expect(DEFAULT_DECK_CONFIG.desiredRetention).toBe(0.8);
    expect(formatSteps(DEFAULT_DECK_CONFIG.learningStepsSec)).toBe("20s 1m 5m");
    expect(formatSteps(DEFAULT_DECK_CONFIG.relearningStepsSec)).toBe("3m");
    expect(DEFAULT_DECK_CONFIG.newPerDay).toBe(20);
    expect(DEFAULT_DECK_CONFIG.maxReviewsPerDay).toBe(9999);
    expect(DEFAULT_DECK_CONFIG.leechThreshold).toBe(5);
    expect(DEFAULT_DECK_CONFIG.leechAction).toBe("tag");
    expect(DEFAULT_DECK_CONFIG.newCardOrder).toBe("added");
  });
});

describe("scheduling with FSRS", () => {
  const config = { ...DEFAULT_DECK_CONFIG, fsrsWeights: MINE };
  const fresh = (now = T0): Card => createCard({ term: "猫", reading: "ねこ", glosses: ["cat"] }, now);

  it("walks a new card through the learning steps", () => {
    let card = fresh();
    card = gradeCard(card, "good", T0, config);
    expect(card.state).toBe("learning");
    expect(card.due - T0).toBe(60_000); // second step: 1m
    card = gradeCard(card, "good", T0 + 60_000, config);
    expect(card.state).toBe("learning");
    expect(card.due - (T0 + 60_000)).toBe(300_000); // third step: 5m
  });

  it("starts the first step at 20 seconds", () => {
    const card = gradeCard(fresh(), "again", T0, config);
    expect(card.due - T0).toBe(20_000);
    expect(card.state).toBe("learning");
  });

  it("graduates after the last step and uses FSRS for the interval", () => {
    let card = fresh();
    const times = [T0, T0 + 60_000, T0 + 360_000];
    for (const t of times) card = gradeCard(card, "good", t, config);
    expect(card.state).toBe("review");
    expect(card.intervalDays).toBeGreaterThan(0);
    expect(card.stability).toBeGreaterThan(0);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
  });

  it("gives a longer first interval at lower desired retention", () => {
    const graduate = (retention: number) => {
      let card = fresh();
      let t = T0;
      for (const step of [0, 60_000, 360_000]) {
        t = T0 + step;
        card = gradeCard(card, "good", t, { ...config, desiredRetention: retention });
      }
      return card.intervalDays;
    };
    expect(graduate(0.8)).toBeGreaterThan(graduate(0.9));
  });

  it("orders the buttons Again < Hard < Good < Easy", () => {
    let card = fresh();
    for (const t of [T0, T0 + 60_000, T0 + 360_000]) card = gradeCard(card, "good", t, config);
    const later = T0 + 20 * DAY;
    const preview = gradePreview(card, later, config);
    expect(preview.again).toBeLessThan(preview.hard);
    expect(preview.hard).toBeLessThan(preview.good);
    expect(preview.good).toBeLessThan(preview.easy);
  });

  it("sends a lapsed review card to the 3-minute relearning step", () => {
    let card = fresh();
    for (const t of [T0, T0 + 60_000, T0 + 360_000]) card = gradeCard(card, "good", t, config);
    const later = T0 + 30 * DAY;
    card = gradeCard(card, "again", later, config);
    expect(card.state).toBe("relearning");
    expect(card.due - later).toBe(180_000);
    expect(card.lapses).toBe(1);
  });

  it("flags a card as a leech at the configured lapse count", () => {
    let card: Card = { ...fresh(), state: "review", intervalDays: 10, stability: 10, difficulty: 5 };
    let t = T0;
    for (let i = 0; i < 5; i++) {
      card = gradeCard(card, "again", t, config);
      t += 200_000;
      card = gradeCard(card, "good", t, config); // leave relearning
      t += DAY * 5;
    }
    expect(card.lapses).toBe(5);
    expect(card.leech).toBe(true);
  });

  it("still works with FSRS switched off", () => {
    const sm2 = { ...config, fsrs: false };
    let card = gradeCard(fresh(), "good", T0, sm2);
    expect(card.state).toBe("learning");
    expect(card.stability).toBeUndefined();
  });
});

describe("daily limits", () => {
  const config = { ...DEFAULT_DECK_CONFIG, fsrsWeights: MINE };
  const make = (i: number, state: Card["state"], due: number): Card => ({
    ...createCard({ term: `語${i}`, reading: "x", glosses: ["y"] }, T0 + i),
    id: `c${i}`,
    state,
    due,
  });

  it("caps new cards at the daily limit", () => {
    const cards = Array.from({ length: 50 }, (_, i) => make(i, "new", T0));
    expect(buildQueue(cards, T0, config)).toHaveLength(20);
  });

  it("counts cards already introduced today", () => {
    const cards = Array.from({ length: 50 }, (_, i) => make(i, "new", T0));
    expect(buildQueue(cards, T0, config, { introducedToday: 15 })).toHaveLength(5);
    expect(buildQueue(cards, T0, config, { introducedToday: 20 })).toHaveLength(0);
  });

  it("introduces new cards in the order they were added", () => {
    const cards = Array.from({ length: 5 }, (_, i) => make(i, "new", T0)).reverse();
    expect(buildQueue(cards, T0, config).map((c) => c.id)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("never limits cards already in learning", () => {
    const learning = Array.from({ length: 40 }, (_, i) => make(i, "learning", T0 - 1000));
    const queue = buildQueue(learning, T0, config, { introducedToday: 20, reviewedToday: 9999 });
    expect(queue).toHaveLength(40);
  });

  it("caps reviews at the daily limit", () => {
    const due = Array.from({ length: 30 }, (_, i) => make(i, "review", T0 - 1000));
    const tight = { ...config, maxReviewsPerDay: 10 };
    expect(buildQueue(due, T0, tight).filter((c) => c.state === "review")).toHaveLength(10);
  });

  it("leaves cards that are not due yet alone", () => {
    const future = Array.from({ length: 5 }, (_, i) => make(i, "review", T0 + DAY));
    expect(buildQueue(future, T0, config)).toHaveLength(0);
  });

  it("keeps leeches in the queue when the action is tag, drops them when suspend", () => {
    const leech: Card = { ...make(1, "review", T0 - 1000), leech: true };
    expect(buildQueue([leech], T0, config)).toHaveLength(1);
    expect(buildQueue([leech], T0, { ...config, leechAction: "suspend" })).toHaveLength(0);
  });
});
