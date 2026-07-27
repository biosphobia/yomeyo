import {
  BinaryDictionary,
  Card,
  findDuplicate,
  mergeCards,
  runSync,
  type CompactDictFile,
  type Dictionary,
  type SyncBackend,
  type SyncRequest,
  type SyncResponse,
} from "@yomeyo/core";
import { combineWith, resetCombined } from "./dictionaries.js";
import { loadDictBytes } from "./dict-bytes.js";
import { getAllCards, getMeta, putCard, putCards, setMeta, type StoredCard } from "./db.js";
import { firestoreBackend, getFirebaseConfig } from "./cloud.js";

/** App-wide state: dictionary + cards, loaded once, mutated through here. */

let dictionary: BinaryDictionary | null = null;
let dictLoading: Promise<BinaryDictionary> | null = null;
let dictSize = 0;
let dictMeta: CompactDictFile["meta"];

/** URL of a bundled asset, correct at any deploy path (root or /yomeyo/). */
export function assetUrl(path: string): string {
  return new URL(path, new URL(import.meta.env.BASE_URL, location.href)).href;
}

/**
 * The dictionary used for lookups: the built-in one, combined with any extra
 * dictionaries the user has imported.
 */
export async function activeDictionary(): Promise<Dictionary> {
  return combineWith(await loadDictionary());
}

/** Where the dictionary lives, as both the loader and Settings need it. */
export function dictionaryUrl(): string {
  return assetUrl("dict/dict.bin");
}

export async function loadDictionary(): Promise<BinaryDictionary> {
  if (dictionary) return dictionary;
  // Concurrent callers (e.g. fast tab switches) must share one download.
  if (!dictLoading) {
    dictLoading = (async () => {
      // Nothing is parsed here: the bytes are searched where they lie, so
      // this is a read and a couple of typed-array views, not seconds of
      // JSON parsing and object building on every page load.
      dictionary = new BinaryDictionary(await loadDictBytes(dictionaryUrl()));
      dictSize = dictionary.size;
      dictMeta = dictionary.meta;
      resetCombined(); // extras must be re-attached to the new instance
      return dictionary;
    })().catch((err) => {
      dictLoading = null; // allow a retry after a failed/offline load
      throw err;
    });
  }
  return dictLoading;
}

export function dictionarySize(): number {
  return dictSize;
}

export function dictionaryMeta(): CompactDictFile["meta"] {
  return dictMeta;
}

/** True once the dictionary is in memory (Settings shows status without forcing a download). */
export function dictionaryLoaded(): boolean {
  return dictionary !== null;
}

let cardsCache: Map<string, StoredCard> | null = null;

export async function loadCards(): Promise<Map<string, StoredCard>> {
  if (cardsCache) return cardsCache;
  const all = await getAllCards();
  cardsCache = new Map(all.map((c) => [c.id, c]));
  return cardsCache;
}

export async function saveCard(card: Card): Promise<void> {
  const cards = await loadCards();
  const stored: StoredCard = { ...card, dirty: true };
  cards.set(card.id, stored);
  await putCard(stored);
}

export type SaveOutcome = "saved" | "duplicate";

/**
 * Save a newly mined word, refusing to create a second card for a word the
 * deck already has. The same word can be reached from several dictionary
 * entries, from the Reader and the extension, and on more than one device,
 * so the check belongs here rather than in each caller.
 */
export async function saveNewCard(card: Card): Promise<SaveOutcome> {
  const cards = await loadCards();
  if (findDuplicate(cards.values(), card.term, card.reading)) return "duplicate";
  await saveCard(card);
  return "saved";
}

export async function liveCards(): Promise<StoredCard[]> {
  const cards = await loadCards();
  return [...cards.values()].filter((c) => !c.deleted);
}

export async function hasCardForTerm(term: string, reading: string): Promise<boolean> {
  const cards = await loadCards();
  for (const c of cards.values()) {
    if (!c.deleted && c.term === term && c.reading === reading) return true;
  }
  return false;
}

/**
 * Import cards handed over by the browser extension (or a deck export).
 * Merges last-write-wins, so re-importing the same words is harmless.
 * Returns how many cards were new or newer than what is already here.
 */
export async function importCards(incoming: Card[]): Promise<number> {
  const cards = await loadCards();
  const plain = new Map<string, Card>([...cards.entries()]);

  // Drop incoming cards for words already in the deck under a different id —
  // the extension and the app mint their own ids, so id-only merging would
  // leave two cards for the same word.
  const fresh = incoming.filter((card) => {
    const existing = findDuplicate(plain.values(), card.term, card.reading);
    return !existing || existing.id === card.id;
  });

  const applied = mergeCards(plain, fresh);
  const stored: StoredCard[] = applied.map((c) => ({ ...c, dirty: true }));
  for (const c of stored) cards.set(c.id, c);
  await putCards(stored);
  return stored.length;
}

// ---------------- sync ----------------

export interface SyncSettings {
  url: string;
  token: string;
}

export async function getSyncSettings(): Promise<SyncSettings | undefined> {
  return getMeta<SyncSettings>("syncSettings");
}

export async function setSyncSettings(settings: SyncSettings): Promise<void> {
  await setMeta("syncSettings", settings);
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
}

/** An HTTP backend for the optional self-hosted sync server. */
function httpBackend(settings: SyncSettings): SyncBackend {
  const endpoint = settings.url.replace(/\/+$/, "") + "/sync";
  let pending: Card[] = [];
  return {
    // The server merges and returns in one round trip, so the push is
    // buffered and sent as part of the pull request.
    async push(cards: Card[]) {
      pending = cards;
    },
    async pull(since: number) {
      const request: SyncRequest = { since, changes: pending };
      pending = [];
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${settings.token}` },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        throw new Error(res.status === 401 ? "Sync failed: wrong token." : `Sync failed (${res.status}).`);
      }
      const data = (await res.json()) as SyncResponse;
      return { changes: data.changes, cursor: data.now };
    },
  };
}

/** Which cloud backend is configured, if any. */
export type SyncMode = "firebase" | "server" | "none";

export async function syncMode(): Promise<SyncMode> {
  if (await getFirebaseConfig()) return "firebase";
  const settings = await getSyncSettings();
  return settings?.url && settings.token ? "server" : "none";
}

/**
 * Run one sync round against whichever backend is configured.
 *
 * Firebase takes precedence when both are set up. The local deck stays the
 * source of truth either way; this only exchanges changes.
 */
export async function syncNow(): Promise<SyncOutcome> {
  const mode = await syncMode();
  let backend: SyncBackend;
  let cursorKey: string;

  if (mode === "firebase") {
    backend = await firestoreBackend();
    cursorKey = "cloudCursor";
  } else if (mode === "server") {
    backend = httpBackend((await getSyncSettings())!);
    cursorKey = "syncSince";
  } else {
    throw new Error("Set up cloud sync in Settings first.");
  }

  const cards = await loadCards();
  const since = (await getMeta<number>(cursorKey)) ?? 0;
  const dirty = [...cards.values()].filter((c) => c.dirty);

  const plain = new Map<string, Card>([...cards.entries()]);
  const result = await runSync(
    backend,
    plain,
    dirty.map(({ dirty: _d, ...card }) => card),
    since,
  );

  // Anything the pull brought in lands clean; anything we pushed is no
  // longer pending — unless the pull replaced it with a newer remote copy.
  const appliedStored: StoredCard[] = result.applied.map((c) => ({ ...c, dirty: false }));
  for (const c of appliedStored) cards.set(c.id, c);

  const cleared: StoredCard[] = [];
  for (const d of dirty) {
    const current = cards.get(d.id);
    if (current?.dirty) {
      const clean = { ...current, dirty: false };
      cards.set(d.id, clean);
      cleared.push(clean);
    }
  }

  await putCards([...appliedStored, ...cleared]);
  await setMeta(cursorKey, result.cursor);
  return { pushed: result.pushed, pulled: result.pulled };
}
