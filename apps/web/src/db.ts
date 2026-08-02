import type { Card } from "@yomeyo/core";

/**
 * Minimal promisified IndexedDB layer.
 * Stores: "cards" (keyPath: id), "meta" (arbitrary key/value).
 *
 * One database per account. Two people sharing a browser — or one person with
 * two accounts — must not see each other's deck, review history or settings,
 * and signing out must not leave the previous account's cards on screen. The
 * signed-out database keeps the original name, so a deck mined before there
 * were accounts is exactly where it always was.
 */

const BASE_NAME = "yomeyo";
const DB_VERSION = 1;

/** Which account's data is in use; null means nobody is signed in. */
let activeUid: string | null = null;
const profileListeners = new Set<() => void>();

function dbName(): string {
  return activeUid ? `${BASE_NAME}-${activeUid}` : BASE_NAME;
}

/**
 * Settings that belong to the device rather than to a person.
 *
 * Most of what is stored is somebody's: their cards, their scheduling, how
 * many they have done today. A few things are not, and splitting them per
 * account would be actively wrong:
 *
 *  - `activeAccount` names the account whose database to use, so it plainly
 *    cannot live inside it.
 *  - `firebaseConfig` is needed *in order to* sign in. Kept per account, a
 *    second person would be asked to paste it before they could sign in and
 *    thereby get it.
 *  - `extensionToken` is what one installed extension shows when delivering
 *    words. There is one extension, so there is one token.
 *  - imported dictionaries are reference books, not personal data, and run to
 *    hundreds of megabytes — copying them per account would fill the disk.
 *  - downloaded audio clips are a cache of public recordings, keyed by the
 *    word itself.
 */
const DEVICE_KEYS = new Set([
  "activeAccount",
  "firebaseConfig",
  "extensionToken",
  "extraDictionaries",
]);
const DEVICE_PREFIXES = ["dictData:", "audioClip:"];

function isDeviceKey(key: string): boolean {
  return DEVICE_KEYS.has(key) || DEVICE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Which database a given meta key lives in. */
function metaDbName(key: string): string {
  return isDeviceKey(key) ? BASE_NAME : dbName();
}

/** The database in use, for callers that need to name it (tests, debugging). */
export function activeDatabaseName(): string {
  return dbName();
}

/** Who the local data currently belongs to. */
export function activeAccount(): string | null {
  return activeUid;
}

/**
 * Point every store at this account's data.
 *
 * Returns true when the account actually changed, so callers can throw away
 * anything they had cached from the previous one — a stale card list is the
 * previous user's deck.
 */
export function setActiveAccount(uid: string | null): boolean {
  const next = uid ?? null;
  if (next === activeUid) return false;
  activeUid = next;
  for (const listener of profileListeners) listener();
  return true;
}

/** Called whenever the active account changes, to drop cached state. */
export function onAccountChange(listener: () => void): void {
  profileListeners.add(listener);
}

/**
 * Open connections, one per database name.
 *
 * Kept rather than closed on a switch: signing out and back in is common, and
 * an idle connection costs nothing next to reopening.
 */
const connections = new Map<string, Promise<IDBDatabase>>();

function openNamed(name: string): Promise<IDBDatabase> {
  const existing = connections.get(name);
  if (existing) return existing;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cards")) {
        db.createObjectStore("cards", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    connections.delete(name); // let a later attempt try again
    throw err;
  });
  connections.set(name, opening);
  return opening;
}

/** The signed-in account's database — cards and everything personal. */
function open(): Promise<IDBDatabase> {
  return openNamed(dbName());
}

/** One account's own data: its deck and the settings that belong to a person. */
export interface Profile {
  cards: StoredCard[];
  meta: [string, unknown][];
}

/**
 * Read or write a named account's data without making it the active one.
 *
 * Adoption has to touch two accounts at once. Doing that by swapping the
 * active account back and forth would mean that, for a moment, screens
 * re-rendering in the background would read from the wrong database — so the
 * account is named here instead of implied.
 */
export async function readProfile(uid: string | null): Promise<Profile> {
  const db = await openNamed(uid ? `${BASE_NAME}-${uid}` : BASE_NAME);
  const cards = await reqResult(
    db.transaction("cards", "readonly").objectStore("cards").getAll() as IDBRequest<StoredCard[]>,
  );
  const metaTx = db.transaction("meta", "readonly").objectStore("meta");
  const keys = await reqResult(metaTx.getAllKeys() as IDBRequest<IDBValidKey[]>);
  const values = await reqResult(metaTx.getAll() as IDBRequest<unknown[]>);
  const meta = keys
    .map((key, i): [string, unknown] => [String(key), values[i]])
    // While signed out the account database *is* the base one, so it also
    // holds the device-wide entries. Those stay where they are.
    .filter(([key]) => !isDeviceKey(key));
  return { cards, meta };
}

/** Empty an account's deck, leaving its settings alone. */
export async function clearProfileCards(uid: string | null): Promise<void> {
  const db = await openNamed(uid ? `${BASE_NAME}-${uid}` : BASE_NAME);
  const tx = db.transaction("cards", "readwrite");
  tx.objectStore("cards").clear();
  await txDone(tx);
}

export async function writeProfile(uid: string | null, profile: Partial<Profile>): Promise<void> {
  const db = await openNamed(uid ? `${BASE_NAME}-${uid}` : BASE_NAME);
  if (profile.cards?.length) {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    for (const card of profile.cards) store.put(card);
    await txDone(tx);
  }
  const meta = (profile.meta ?? []).filter(([key]) => !isDeviceKey(key));
  if (meta.length > 0) {
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");
    for (const [key, value] of meta) store.put(value, key);
    await txDone(tx);
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A card as stored locally: adds a dirty flag for sync bookkeeping. */
export type StoredCard = Card & { dirty?: boolean };

export async function getAllCards(): Promise<StoredCard[]> {
  const db = await open();
  const tx = db.transaction("cards", "readonly");
  return reqResult(tx.objectStore("cards").getAll() as IDBRequest<StoredCard[]>);
}

export async function putCard(card: StoredCard): Promise<void> {
  const db = await open();
  const tx = db.transaction("cards", "readwrite");
  tx.objectStore("cards").put(card);
  await txDone(tx);
}

export async function putCards(cards: StoredCard[]): Promise<void> {
  if (cards.length === 0) return;
  const db = await open();
  const tx = db.transaction("cards", "readwrite");
  const store = tx.objectStore("cards");
  for (const card of cards) store.put(card);
  await txDone(tx);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openNamed(metaDbName(key));
  const tx = db.transaction("meta", "readonly");
  return reqResult(tx.objectStore("meta").get(key) as IDBRequest<T | undefined>);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openNamed(metaDbName(key));
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(value, key);
  await txDone(tx);
}
