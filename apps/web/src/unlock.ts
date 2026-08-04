import { getMeta, setMeta } from "./db.js";

/**
 * The admin's key to every level.
 *
 * The courses unlock in order, which is right for learning and wrong for
 * checking that unit eight still works. This lets whoever holds the admin
 * seat open all of it at once — on their own device only: it is a setting,
 * not a change to anyone's progress, and turning it off puts every course
 * back exactly where the learner had actually reached.
 */

const KEY = "unlockEverything";

let cached: boolean | null = null;

export async function unlockAll(): Promise<boolean> {
  cached ??= (await getMeta<boolean>(KEY)) ?? false;
  return cached;
}

/** What the last `unlockAll()` found, for code that cannot wait for a promise. */
export function unlockAllNow(): boolean {
  return cached ?? false;
}

export async function setUnlockAll(on: boolean): Promise<void> {
  cached = on;
  await setMeta(KEY, on);
}
