import { getMeta, onAccountChange, setMeta } from "./db.js";
import { toast } from "./toast.js";

/**
 * The three keys to the mystery door.
 *
 * The door in the casino wears three keyholes. How a key is earned is never
 * written anywhere the player can read: one arrives with the hiragana
 * milestone exam, one with the katakana exam much later, one with finishing
 * the grammar course. Earning one says only that something, somewhere,
 * unlocked — the door is the player's to puzzle out.
 *
 * Keys held and keys already turned in their holes both live in the synced
 * progress, so the door remembers across devices. Both only ever grow.
 */

export const DOOR_KEY_IDS = ["hiragana", "katakana", "grammar"] as const;
export type DoorKeyId = (typeof DOOR_KEY_IDS)[number];

const HELD_KEY = "doorKeys";
const INSERTED_KEY = "doorKeysInserted";

let heldCache: DoorKeyId[] | null = null;
let insertedCache: DoorKeyId[] | null = null;
onAccountChange(() => {
  heldCache = null;
  insertedCache = null;
});

const clean = (list: unknown): DoorKeyId[] =>
  Array.isArray(list)
    ? DOOR_KEY_IDS.filter((id) => list.includes(id))
    : [];

/** Keys earned, in canonical order. */
export async function heldDoorKeys(): Promise<DoorKeyId[]> {
  heldCache ??= clean(await getMeta<string[]>(HELD_KEY));
  return heldCache;
}

/** Keys already turned in their holes, in canonical order. */
export async function insertedDoorKeys(): Promise<DoorKeyId[]> {
  insertedCache ??= clean(await getMeta<string[]>(INSERTED_KEY));
  return insertedCache;
}

/**
 * Hand over a key. True only the first time. The toast says nothing about
 * what it opens — that is the whole point of it.
 */
export async function grantDoorKey(id: DoorKeyId): Promise<boolean> {
  const held = await heldDoorKeys();
  if (held.includes(id)) return false;
  heldCache = DOOR_KEY_IDS.filter((k) => k === id || held.includes(k));
  await setMeta(HELD_KEY, heldCache);
  toast("🗝️ Somewhere far away, something unlocked.");
  return true;
}

/** Turn a held key in its hole. It stays turned for ever. */
export async function insertDoorKey(id: DoorKeyId): Promise<void> {
  const inserted = await insertedDoorKeys();
  if (inserted.includes(id)) return;
  insertedCache = DOOR_KEY_IDS.filter((k) => k === id || inserted.includes(k));
  await setMeta(INSERTED_KEY, insertedCache);
}
