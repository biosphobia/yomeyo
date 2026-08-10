import { MINING_DECK_ID, mergeDeckLists, type DeckGone, type DeckInfo } from "@yomeyo/core";
import { currentAccount, firestoreApi, getFirebaseConfig } from "./cloud.js";
import { UNNAMED, listDecks, replaceDecks, tombstones } from "./my-decks.js";

/**
 * Which decks this account has, across its devices.
 *
 * Cards have always synced. The *record* of a deck — its name, where it came
 * from, whether it has been published — never did, and it is not something
 * that can be worked out from the cards: a card carries a deck id and nothing
 * else. So a second device pulled down six thousand cards belonging to a deck
 * it had never heard of, and showed "no decks added" over the top of them.
 * That is the bug this fixes.
 *
 * It lives in the account's own user document, which the security rules
 * already grant to its owner alone — no new collection, no rules to deploy.
 * The document is small: a line per deck, and the words themselves are not
 * in it.
 *
 * Merging is by id, later record wins, with removals remembered as
 * tombstones — otherwise a deck deleted on the phone would be handed back by
 * the laptop on the next sync, for ever.
 */

/** How the record travels. Firestore refuses `undefined`, so it is stripped. */
interface DeckRecord {
  id: string;
  name: string;
  kind: string;
  emoji?: string;
  description?: string;
  source?: string;
  ownerUid?: string;
  ownerName?: string;
  publishedAt?: number;
  shared?: boolean;
  updatedAt: number;
}

function toRecord(deck: DeckInfo): DeckRecord {
  const record: DeckRecord = {
    id: deck.id,
    name: deck.name,
    kind: deck.kind,
    updatedAt: deck.updatedAt ?? 0,
  };
  if (deck.emoji) record.emoji = deck.emoji;
  if (deck.description) record.description = deck.description;
  if (deck.source) record.source = deck.source;
  if (deck.ownerUid) record.ownerUid = deck.ownerUid;
  if (deck.ownerName) record.ownerName = deck.ownerName;
  if (typeof deck.publishedAt === "number") record.publishedAt = deck.publishedAt;
  if (deck.shared) record.shared = true;
  return record;
}

function toDeck(record: DeckRecord): DeckInfo {
  return {
    ...record,
    kind: record.kind === "mining" ? "mining" : "premade",
    // Filled in from the cards themselves whenever the list is read.
    cardCount: 0,
  };
}

function isRecord(value: unknown): value is DeckRecord {
  const r = value as DeckRecord | null;
  return !!r && typeof r.id === "string" && typeof r.name === "string" && r.id !== MINING_DECK_ID;
}

function isGone(value: unknown): value is DeckGone {
  const g = value as DeckGone | null;
  return !!g && typeof g.id === "string" && typeof g.at === "number";
}

let running: Promise<boolean> | null = null;

/**
 * Exchange deck records with the cloud. True when the local list changed.
 *
 * Quiet about everything: no account, no cloud, no permission, no network —
 * all of them simply mean the local list stands, which is what it did before
 * any of this existed.
 */
export async function syncDecks(): Promise<boolean> {
  running ??= exchange().finally(() => {
    running = null;
  });
  return running;
}

async function exchange(): Promise<boolean> {
  try {
    if (!(await getFirebaseConfig())) return false;
    const me = await currentAccount().catch(() => null);
    if (!me) return false;

    const { db, storeApi } = await firestoreApi();
    const ref = storeApi.doc(db, "users", me.uid);
    const snapshot = await storeApi.getDoc(ref);
    const data = (snapshot.exists?.() ? snapshot.data?.() : null) ?? {};
    const remote = Array.isArray(data.decks) ? data.decks.filter(isRecord) : [];
    const goneRemote = Array.isArray(data.decksRemoved) ? data.decksRemoved.filter(isGone) : [];

    // The mining deck is not a record; every other deck on the device is.
    const local = (await listDecks()).filter((deck) => deck.id !== MINING_DECK_ID);
    const goneLocal = await tombstones();
    const merged = mergeDeckLists(local, remote.map(toDeck), goneLocal, goneRemote);

    // A deck recovered from its words alone has no name. If it came from the
    // library its name is public, so ask — the library is where it came from
    // in the first place.
    for (const deck of merged.decks) {
      if (deck.name !== UNNAMED || !deck.id.includes("__")) continue;
      const published = await storeApi.getDoc(storeApi.doc(db, "decks", deck.id)).catch(() => null);
      const data = published?.exists?.() ? published.data?.() : null;
      if (typeof data?.name === "string" && data.name) {
        deck.name = data.name;
        deck.description = typeof data.description === "string" ? data.description : undefined;
        deck.ownerUid = typeof data.ownerUid === "string" ? data.ownerUid : undefined;
        deck.ownerName = typeof data.ownerName === "string" ? data.ownerName : undefined;
        deck.updatedAt = Date.now();
      }
    }

    const before = JSON.stringify(local.map(toRecord).sort(byId));
    const after = JSON.stringify(merged.decks.map(toRecord).sort(byId));
    const changed = before !== after;
    if (changed || goneLocal.length !== merged.gone.length) {
      await replaceDecks(merged.decks, merged.gone);
    }

    // Write back only when this device is bringing something the cloud does
    // not have, so opening the Decks tab is a read on every device but one.
    const theirs = JSON.stringify([...remote].sort(byId));
    if (theirs !== after || goneRemote.length !== merged.gone.length) {
      await storeApi.setDoc(
        ref,
        { decks: merged.decks.map(toRecord), decksRemoved: merged.gone },
        { merge: true },
      );
    }
    return changed;
  } catch {
    // A deck list that will not sync is not a reason to lose the one here.
    return false;
  }
}

function byId(a: DeckRecord, b: DeckRecord): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
