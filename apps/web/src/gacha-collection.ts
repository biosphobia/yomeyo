import { getMeta, onAccountChange, setMeta } from "./db.js";

/**
 * What has been pulled, and what is being worn.
 *
 * Only ids are stored, so the prize table stays the single source of truth
 * for what a prize actually is — rename a skin or repaint it on GitHub and
 * every collection follows. An id that no longer exists is simply not shown;
 * it costs nothing to keep, and it comes back if the prize does.
 *
 * Lives in the account's own database like everything else, so it follows
 * the person and works the same signed out.
 */

const OWNED_KEY = "gachaOwned";
const SKIN_KEY = "gachaSkin";
const ITEMS_KEY = "gachaItems";

let ownedCache: Set<string> | null = null;
let skinCache: string | null | undefined;
let itemsCache: Record<string, number> | null = null;

onAccountChange(() => {
  ownedCache = null;
  skinCache = undefined;
  itemsCache = null;
});

/** No stack goes past this: five bento boxes is enough bento boxes. */
export const ITEM_LIMIT = 5;

/** How many of each stackable item is held, by prize id. */
export async function itemCounts(): Promise<Record<string, number>> {
  itemsCache ??= (await getMeta<Record<string, number>>(ITEMS_KEY)) ?? {};
  return itemsCache;
}

/**
 * One more of a stackable item, up to the limit. Returns the new count,
 * or null when the stack was already full — the caller refunds, the same
 * as pulling a duplicate gif.
 */
export async function addItem(id: string): Promise<number | null> {
  const counts = await itemCounts();
  if ((counts[id] ?? 0) >= ITEM_LIMIT) return null;
  counts[id] = (counts[id] ?? 0) + 1;
  await setMeta(ITEMS_KEY, counts);
  return counts[id];
}

export async function owned(): Promise<Set<string>> {
  ownedCache ??= new Set((await getMeta<string[]>(OWNED_KEY)) ?? []);
  return ownedCache;
}

export async function ownsPrize(id: string): Promise<boolean> {
  return (await owned()).has(id);
}

/** Record a pull. False when it was already owned — the caller refunds. */
export async function addOwned(id: string): Promise<boolean> {
  const have = await owned();
  if (have.has(id)) return false;
  have.add(id);
  await setMeta(OWNED_KEY, [...have]);
  return true;
}

/** The skin being worn, or null for the one the app ships with. */
export async function equippedSkin(): Promise<string | null> {
  if (skinCache === undefined) skinCache = (await getMeta<string>(SKIN_KEY)) ?? null;
  return skinCache;
}

export async function equipSkin(id: string | null): Promise<void> {
  skinCache = id;
  await setMeta(SKIN_KEY, id);
}
