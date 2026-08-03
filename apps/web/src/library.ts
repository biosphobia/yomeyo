import {
  newDeckId,
  packDeck,
  toSharedCards,
  unpackDeck,
  type Card,
  type DeckInfo,
  type SharedCard,
} from "@yomeyo/core";
import { currentAccount, firestoreApi, type AccountInfo } from "./cloud.js";

/**
 * The shared library of premade decks.
 *
 * A premade deck is a vocabulary list somebody imported once — Core 2k, a
 * JLPT list, the words from a particular novel. Finding the file, getting it
 * out of Anki and mapping its fields is work, and it is the same work for
 * everybody. So the first person to do it publishes the result, and everyone
 * after them adds the deck with a tap and no file at all.
 *
 * What travels is the content of the cards and nothing else. Scheduling stays
 * where it belongs: intervals and ease describe one person's memory of a
 * word, and whoever adds a deck is meeting it for the first time anyway.
 *
 * Decks live at `decks/{deckId}`, with the cards in compressed blocks
 * beneath. The id begins with the publisher's account, so the security rules
 * can tell who may change a deck from its name alone — without reading the
 * deck first, which would cost a lookup on every write.
 */

export interface LibraryDeck extends DeckInfo {
  /** How many blocks the cards are split across. */
  blockCount: number;
}

/** How many decks a browse shows at once. */
const PAGE = 60;

function toLibraryDeck(id: string, data: Record<string, unknown>): LibraryDeck {
  const publishedAt = data.publishedAt as { toMillis?: () => number } | number | undefined;
  return {
    id,
    name: typeof data.name === "string" ? data.name : "Untitled deck",
    kind: "premade",
    cardCount: typeof data.cardCount === "number" ? data.cardCount : 0,
    description: typeof data.description === "string" ? data.description : undefined,
    source: typeof data.source === "string" ? data.source : undefined,
    ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : undefined,
    ownerName: typeof data.ownerName === "string" ? data.ownerName : undefined,
    publishedAt:
      typeof publishedAt === "number"
        ? publishedAt
        : typeof publishedAt?.toMillis === "function"
          ? publishedAt.toMillis()
          : undefined,
    blockCount: typeof data.blockCount === "number" ? data.blockCount : 0,
  };
}

/** Decks other people have published, newest first. */
export async function browseLibrary(): Promise<LibraryDeck[]> {
  const { db, storeApi } = await firestoreApi();
  const snapshot = await storeApi.getDocs(
    storeApi.query(
      storeApi.collection(db, "decks"),
      storeApi.orderBy("publishedAt", "desc"),
      storeApi.limit(PAGE),
    ),
  );
  const decks: LibraryDeck[] = [];
  snapshot.forEach((doc: any) => decks.push(toLibraryDeck(doc.id, doc.data())));
  return decks;
}

export interface PublishOptions {
  name: string;
  description?: string;
  source?: string;
  /** The publisher's username — never their account's real name. */
  ownerName?: string;
  /** Republish over an existing deck rather than making a new one. */
  deckId?: string;
}

/**
 * Put a deck in the library.
 *
 * Returns the id it was published under, which the local copy records so the
 * app can say it is shared and offer to withdraw it.
 */
export async function publishDeck(
  account: AccountInfo,
  cards: Card[],
  options: PublishOptions,
): Promise<LibraryDeck> {
  const shared = toSharedCards(cards);
  if (shared.length === 0) throw new Error("There are no words in that deck to share.");

  const { db, storeApi } = await firestoreApi();
  const deckId = options.deckId ?? newDeckId(account.uid, Date.now());
  const blocks = await packDeck(shared);
  const deckRef = storeApi.doc(db, "decks", deckId);

  // Blocks first, then the deck record: until the record exists nothing lists
  // the deck, so a half-written deck is invisible rather than broken.
  for (let i = 0; i < blocks.length; i += 1) {
    await storeApi.setDoc(storeApi.doc(db, "decks", deckId, "blocks", String(i)), {
      data: blocks[i],
    });
  }

  const record = {
    name: options.name,
    description: options.description ?? "",
    source: options.source ?? "",
    cardCount: shared.length,
    blockCount: blocks.length,
    ownerUid: account.uid,
    // The username, never the sign-in identity: the real name behind an
    // account is nobody else's to see.
    ownerName: options.ownerName || "Someone",
    publishedAt: storeApi.serverTimestamp(),
  };
  await storeApi.setDoc(deckRef, record);

  return { ...toLibraryDeck(deckId, record), publishedAt: Date.now(), blockCount: blocks.length };
}

/** Fetch a published deck's words. */
export async function downloadDeck(deck: LibraryDeck): Promise<SharedCard[]> {
  const { db, storeApi } = await firestoreApi();
  const blocks: string[] = [];
  for (let i = 0; i < deck.blockCount; i += 1) {
    const snapshot = await storeApi.getDoc(storeApi.doc(db, "decks", deck.id, "blocks", String(i)));
    const data = snapshot.data?.();
    if (!snapshot.exists?.() || typeof data?.data !== "string") {
      throw new Error("Part of that deck is missing from the library.");
    }
    blocks.push(data.data);
  }
  return unpackDeck(blocks);
}

// ---------------- the admin seat ----------------

/**
 * One account is the admin, who may withdraw anyone's deck from the
 * library. The seat is a single document, `admin/owner`, that the security
 * rules never let change hands — it is already held, so all the app needs
 * to know is whether the signed-in account is the holder.
 */
export interface AdminState {
  /** Who holds the seat, or null while it is unclaimed. */
  adminUid: string | null;
  /** Whether the signed-in account is that holder. */
  isAdmin: boolean;
}

export async function adminState(): Promise<AdminState> {
  const { db, storeApi } = await firestoreApi();
  const snapshot = await storeApi.getDoc(storeApi.doc(db, "admin", "owner"));
  const uid = snapshot.exists?.() ? String(snapshot.data?.()?.uid ?? "") : "";
  const me = await currentAccount();
  return { adminUid: uid || null, isAdmin: uid !== "" && uid === me?.uid };
}

/** Take a deck back out of the library. Its publisher can; so can the admin. */
export async function unpublishDeck(deckId: string): Promise<void> {
  const { db, storeApi } = await firestoreApi();
  const deckRef = storeApi.doc(db, "decks", deckId);

  // How many blocks there are is on the deck record, so read it before
  // deleting it — otherwise there is no way to know what to clean up.
  const snapshot = await storeApi.getDoc(deckRef);
  const blockCount = Number(snapshot.data?.()?.blockCount ?? 0);

  // The record first: once it is gone the deck is unlisted, so a failure part
  // way through leaves stray blocks rather than a deck nobody can read.
  await storeApi.deleteDoc(deckRef);
  for (let i = 0; i < blockCount; i += 1) {
    await storeApi.deleteDoc(storeApi.doc(db, "decks", deckId, "blocks", String(i))).catch(() => {
      /* already gone */
    });
  }
}
