import type { Card } from "@yomeyo/core";

/**
 * Minimal promisified IndexedDB layer.
 * Stores: "cards" (keyPath: id), "meta" (arbitrary key/value).
 */

const DB_NAME = "yomeyo";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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
  });
  return dbPromise;
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
  const db = await open();
  const tx = db.transaction("meta", "readonly");
  return reqResult(tx.objectStore("meta").get(key) as IDBRequest<T | undefined>);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(value, key);
  await txDone(tx);
}
