import {
  Card,
  MemoryDictionary,
  dictFileMeta,
  mergeCards,
  parseDictFile,
  type CompactDictFile,
  type SyncRequest,
  type SyncResponse,
} from "@yomeyo/core";
import { getAllCards, getMeta, putCard, putCards, setMeta, type StoredCard } from "./db.js";

/** App-wide state: dictionary + cards, loaded once, mutated through here. */

let dictionary: MemoryDictionary | null = null;
let dictLoading: Promise<MemoryDictionary> | null = null;
let dictSize = 0;
let dictMeta: CompactDictFile["meta"];

/** URL of a bundled asset, correct at any deploy path (root or /yomeyo/). */
function assetUrl(path: string): string {
  return new URL(path, new URL(import.meta.env.BASE_URL, location.href)).href;
}

export async function loadDictionary(): Promise<MemoryDictionary> {
  if (dictionary) return dictionary;
  // Concurrent callers (e.g. fast tab switches) must share one download.
  if (!dictLoading) {
    dictLoading = (async () => {
      const res = await fetch(assetUrl("dict/dict.json"));
      if (!res.ok) throw new Error(`Could not load dictionary (${res.status})`);
      const raw = await res.json();
      const entries = parseDictFile(raw);
      dictSize = entries.length;
      dictMeta = dictFileMeta(raw);
      dictionary = new MemoryDictionary(entries);
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
  const applied = mergeCards(plain, incoming);
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

/** Push dirty cards, pull remote changes, LWW-merge them in. */
export async function syncNow(): Promise<SyncOutcome> {
  const settings = await getSyncSettings();
  if (!settings?.url || !settings.token) {
    throw new Error("Set the sync server URL and token in Settings first.");
  }
  const cards = await loadCards();
  const since = (await getMeta<number>("syncSince")) ?? 0;

  const dirty = [...cards.values()].filter((c) => c.dirty);
  const request: SyncRequest = {
    since,
    changes: dirty.map(({ dirty: _d, ...card }) => card),
  };

  const endpoint = settings.url.replace(/\/+$/, "") + "/sync";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(res.status === 401 ? "Sync failed: wrong token." : `Sync failed (${res.status}).`);
  }
  const data = (await res.json()) as SyncResponse;

  // Merge remote changes; anything remote-newer overwrites local state.
  const plain = new Map<string, Card>([...cards.entries()]);
  const applied = mergeCards(plain, data.changes);
  const appliedStored: StoredCard[] = applied.map((c) => ({ ...c, dirty: false }));
  for (const c of appliedStored) cards.set(c.id, c);

  // Clear dirty flags on everything we pushed (unless remote overwrote it).
  const cleared: StoredCard[] = [];
  for (const d of dirty) {
    const current = cards.get(d.id);
    if (current && current.dirty) {
      const clean = { ...current, dirty: false };
      cards.set(d.id, clean);
      cleared.push(clean);
    }
  }

  await putCards([...appliedStored, ...cleared]);
  await setMeta("syncSince", data.now);
  return { pushed: dirty.length, pulled: applied.length };
}
