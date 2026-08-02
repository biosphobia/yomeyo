import { getMeta, setMeta } from "./db.js";

/**
 * Advanced mode.
 *
 * Most people never touch API keys, FSRS parameters or field mappings, and a
 * screen full of them makes the two settings everyone does use hard to find.
 * So the rarely-used and harder options stay hidden until this is switched
 * on. It is a device preference, not an account one: it describes who is
 * holding the phone, and flipping it must survive signing in and out.
 */

const KEY = "advancedMode";

export async function getAdvancedMode(): Promise<boolean> {
  return (await getMeta<boolean>(KEY)) === true;
}

export async function setAdvancedMode(on: boolean): Promise<void> {
  await setMeta(KEY, on);
}
