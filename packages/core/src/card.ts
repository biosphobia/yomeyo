import type { Card } from "./types.js";
import { newCardSchedule } from "./srs.js";

/** RFC4122-ish random id without depending on crypto.randomUUID presence. */
export function makeId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && "randomUUID" in cryptoObj) return cryptoObj.randomUUID();
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export interface NewCardInput {
  term: string;
  reading: string;
  glosses: string[];
  sentence?: string;
  source?: string;
}

export function createCard(input: NewCardInput, now: number): Card {
  return {
    id: makeId(),
    term: input.term,
    reading: input.reading,
    glosses: input.glosses,
    sentence: input.sentence,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    ...newCardSchedule(now),
  };
}
