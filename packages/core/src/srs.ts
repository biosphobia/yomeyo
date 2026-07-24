import type { Card, CardState, Grade } from "./types.js";

/**
 * Anki-style SM-2 scheduler.
 *
 * New cards go through learning steps (1 min, 10 min), then graduate to
 * review with a 1-day interval. Review intervals grow by the card's ease
 * factor; lapses send the card to relearning and reduce ease.
 */
export interface SrsConfig {
  /** Learning steps in minutes. */
  learningStepsMin: number[];
  /** Relearning steps in minutes after a lapse. */
  relearningStepsMin: number[];
  /** Interval (days) on graduating from learning with "good". */
  graduatingIntervalDays: number;
  /** Interval (days) when answering "easy" on a learning card. */
  easyIntervalDays: number;
  startingEase: number;
  minEase: number;
  /** Multiplier applied on top of ease for "easy" reviews. */
  easyBonus: number;
  /** Interval multiplier for "hard" reviews. */
  hardMultiplier: number;
  /** Fraction of the old interval kept after a lapse. */
  lapseMultiplier: number;
  maxIntervalDays: number;
}

export const DEFAULT_SRS_CONFIG: SrsConfig = {
  learningStepsMin: [1, 10],
  relearningStepsMin: [10],
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  startingEase: 2.5,
  minEase: 1.3,
  easyBonus: 1.3,
  hardMultiplier: 1.2,
  lapseMultiplier: 0.5,
  maxIntervalDays: 365 * 10,
};

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Create a brand-new card's scheduling fields. */
export function newCardSchedule(now: number, config: SrsConfig = DEFAULT_SRS_CONFIG): Pick<
  Card,
  "state" | "due" | "intervalDays" | "ease" | "stepIndex" | "reps" | "lapses"
> {
  return {
    state: "new",
    due: now,
    intervalDays: 0,
    ease: config.startingEase,
    stepIndex: 0,
    reps: 0,
    lapses: 0,
  };
}

/** True if the card should be shown in today's review queue. */
export function isDue(card: Card, now: number): boolean {
  return !card.deleted && card.due <= now;
}

/**
 * Apply a review grade. Returns a NEW card object with updated scheduling
 * fields and updatedAt = now.
 */
export function gradeCard(card: Card, grade: Grade, now: number, config: SrsConfig = DEFAULT_SRS_CONFIG): Card {
  const next: Card = { ...card, reps: card.reps + 1, updatedAt: now };

  const inLearning = card.state === "new" || card.state === "learning" || card.state === "relearning";

  if (inLearning) {
    const steps = card.state === "relearning" ? config.relearningStepsMin : config.learningStepsMin;
    const state: CardState = card.state === "relearning" ? "relearning" : "learning";

    switch (grade) {
      case "again": {
        next.state = state;
        next.stepIndex = 0;
        next.due = now + steps[0] * MIN_MS;
        break;
      }
      case "hard": {
        // repeat current step at ~1.5x the step delay
        next.state = state;
        next.stepIndex = card.stepIndex;
        const delay = steps[Math.min(card.stepIndex, steps.length - 1)] * 1.5;
        next.due = now + delay * MIN_MS;
        break;
      }
      case "good": {
        const nextStep = card.stepIndex + 1;
        if (nextStep < steps.length) {
          next.state = state;
          next.stepIndex = nextStep;
          next.due = now + steps[nextStep] * MIN_MS;
        } else {
          // graduate
          next.state = "review";
          next.stepIndex = 0;
          next.intervalDays =
            card.state === "relearning"
              ? Math.max(1, Math.round(card.intervalDays))
              : config.graduatingIntervalDays;
          next.due = now + next.intervalDays * DAY_MS;
        }
        break;
      }
      case "easy": {
        next.state = "review";
        next.stepIndex = 0;
        next.intervalDays =
          card.state === "relearning"
            ? Math.max(config.easyIntervalDays, Math.round(card.intervalDays))
            : config.easyIntervalDays;
        next.due = now + next.intervalDays * DAY_MS;
        break;
      }
    }
    return next;
  }

  // --- review state ---
  switch (grade) {
    case "again": {
      next.state = "relearning";
      next.lapses = card.lapses + 1;
      next.ease = Math.max(config.minEase, card.ease - 0.2);
      next.intervalDays = Math.max(1, Math.round(card.intervalDays * config.lapseMultiplier));
      next.stepIndex = 0;
      next.due = now + config.relearningStepsMin[0] * MIN_MS;
      break;
    }
    case "hard": {
      next.ease = Math.max(config.minEase, card.ease - 0.15);
      next.intervalDays = clampInterval(card.intervalDays * config.hardMultiplier, card.intervalDays, config);
      next.due = now + next.intervalDays * DAY_MS;
      break;
    }
    case "good": {
      next.intervalDays = clampInterval(card.intervalDays * card.ease, card.intervalDays, config);
      next.due = now + next.intervalDays * DAY_MS;
      break;
    }
    case "easy": {
      next.ease = card.ease + 0.15;
      next.intervalDays = clampInterval(card.intervalDays * card.ease * config.easyBonus, card.intervalDays, config);
      next.due = now + next.intervalDays * DAY_MS;
      break;
    }
  }
  return next;
}

function clampInterval(days: number, previousDays: number, config: SrsConfig): number {
  const rounded = Math.round(days);
  return Math.min(config.maxIntervalDays, Math.max(previousDays + 1, rounded, 1));
}

/** Cards due now, ordered: relearning/learning first, then by due time. */
export function dueCards(cards: Card[], now: number): Card[] {
  const statePriority: Record<CardState, number> = {
    relearning: 0,
    learning: 1,
    review: 2,
    new: 3,
  };
  return cards
    .filter((c) => isDue(c, now))
    .sort((a, b) => statePriority[a.state] - statePriority[b.state] || a.due - b.due);
}

/** Summary counts for a deck. */
export function deckStats(cards: Card[], now: number): {
  total: number;
  due: number;
  newCount: number;
  learning: number;
  review: number;
} {
  const live = cards.filter((c) => !c.deleted);
  return {
    total: live.length,
    due: live.filter((c) => isDue(c, now)).length,
    newCount: live.filter((c) => c.state === "new").length,
    learning: live.filter((c) => c.state === "learning" || c.state === "relearning").length,
    review: live.filter((c) => c.state === "review").length,
  };
}
