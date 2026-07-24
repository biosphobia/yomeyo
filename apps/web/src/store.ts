import {
  Card,
  MemoryDictionary,
  mergeCards,
  type DictFile,
  type SyncRequest,
  type SyncResponse,
} from "@yomeyo/core";
import { getAllCards, getMeta, putCard, putCards, setMeta, type StoredCard } from "./db.js";

/** App-wide state: dictionary + cards, loaded once, mutated through here. */

let dictionary: MemoryDictionary | null = null;
let dictSize = 0;

export async function loadDictionary(): Promise<MemoryDictionary> {
  if (dictionary) return dictionary;
  const res = await fetch("/dict/dict.json");
  if (!res.ok) throw new Error(`Could not load dictionary (${res.status})`);
  const file = (await res.json()) as DictFile;
  dictSize = file.length;
  dictionary = new MemoryDictionary(file);
  return dictionary;
}

export function dictionarySize(): number {
  return dictSize;
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
