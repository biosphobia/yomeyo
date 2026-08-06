import type { Card } from "./types.js";
import { makeId } from "./card.js";
import { newCardSchedule } from "./srs.js";

/**
 * Decks, and the shared library of ready-made ones.
 *
 * There are two kinds. A **mining deck** is the words you saved yourself, off
 * the pages you were reading — personal, and nobody else's business. A
 * **premade deck** is a whole vocabulary list somebody imported from Anki:
 * Core 2k, a JLPT list, a deck for a particular novel. Those are worth
 * sharing, and sharing them is the point — the first person to import one
 * spares everybody else finding the file, and everyone after them adds it
 * with a tap.
 *
 * What is shared is only the *content* of the cards. Scheduling is not:
 * intervals, ease and rep counts describe one person's memory, and copying
 * them onto somebody else would be meaningless. Whoever adds a premade deck
 * starts it as new, which is also what they want — it is new to them.
 */

/** The deck words go into when nothing says otherwise. */
export const MINING_DECK_ID = "mining";

export type DeckKind = "mining" | "premade";

export interface DeckInfo {
  id: string;
  name: string;
  kind: DeckKind;
  /** How many cards it holds, for showing a list without reading every card. */
  cardCount: number;
  description?: string;
  /** Where the deck came from, e.g. the .apkg it was imported from. */
  source?: string;

  // --- set only on decks in the shared library ---
  /** Who published it. Also who is allowed to change or withdraw it. */
  ownerUid?: string;
  /** A display name, so a list of decks says who made each one. */
  ownerName?: string;
  publishedAt?: number;
  /** Set on a local deck once it has been published, so the app can say so. */
  shared?: boolean;
  /**
   * When this record last changed, so two devices holding the same deck can
   * agree on which copy is the later one. Absent on records written before
   * decks synced at all, which is the same as "as old as it gets".
   */
  updatedAt?: number;
}

/**
 * A card as the library stores it: what the word means, and nothing about
 * how well anyone knows it.
 */
export interface SharedCard {
  term: string;
  reading: string;
  glosses: string[];
  sentence?: string;
  sentenceMeaning?: string;
  sentenceFurigana?: string;
  notes?: string;
  pitchAccents?: number[];
}

/** Which deck a card belongs to; cards from before decks existed are mined. */
export function deckOf(card: Card): string {
  return card.deckId ?? MINING_DECK_ID;
}

/**
 * Where a card sits in its deck.
 *
 * The order words arrive in is the order they are met in, which is what
 * anybody importing a graded deck expects. Rearranging a deck writes an
 * explicit position on the cards that moved, and this is where the two meet.
 */
export function orderOf(card: Card): number {
  return card.order ?? card.createdAt;
}

/**
 * The position that puts a card between these two neighbours.
 *
 * Halfway between them, or clear of the end when there is only one. Doubles
 * have enough room to halve the gap some fifty times before two positions
 * collide, which no hand-rearranged deck will ever reach.
 */
export function positionBetween(before: Card | undefined, after: Card | undefined): number {
  const GAP = 60_000; // a minute of createdAt, which is what the scale is
  if (!before && !after) return Date.now();
  if (!before) return orderOf(after!) - GAP;
  if (!after) return orderOf(before) + GAP;
  return (orderOf(before) + orderOf(after)) / 2;
}

export function toSharedCards(cards: Card[]): SharedCard[] {
  return cards
    .filter((card) => !card.deleted && card.term.trim().length > 0)
    .map((card) => ({
      term: card.term,
      reading: card.reading,
      glosses: card.glosses,
      ...(card.sentence ? { sentence: card.sentence } : {}),
      ...(card.sentenceMeaning ? { sentenceMeaning: card.sentenceMeaning } : {}),
      ...(card.sentenceFurigana ? { sentenceFurigana: card.sentenceFurigana } : {}),
      ...(card.notes ? { notes: card.notes } : {}),
      ...(card.pitchAccents?.length ? { pitchAccents: card.pitchAccents } : {}),
    }));
}

/** Cards for somebody adding this deck: same words, none of anyone's history. */
export function fromSharedCards(shared: SharedCard[], deckId: string, now: number): Card[] {
  return shared
    .filter((card) => typeof card?.term === "string" && card.term.trim().length > 0)
    .map((card) => ({
      id: makeId(),
      term: card.term,
      reading: typeof card.reading === "string" ? card.reading : "",
      glosses: Array.isArray(card.glosses) ? card.glosses.filter((g) => typeof g === "string") : [],
      sentence: typeof card.sentence === "string" ? card.sentence : undefined,
      ...(typeof card.sentenceMeaning === "string" && card.sentenceMeaning
        ? { sentenceMeaning: card.sentenceMeaning }
        : {}),
      ...(typeof card.sentenceFurigana === "string" && card.sentenceFurigana
        ? { sentenceFurigana: card.sentenceFurigana }
        : {}),
      ...(typeof card.notes === "string" && card.notes ? { notes: card.notes } : {}),
      ...(Array.isArray(card.pitchAccents) && card.pitchAccents.some((a) => typeof a === "number")
        ? { pitchAccents: card.pitchAccents.filter((a): a is number => typeof a === "number") }
        : {}),
      deckId,
      createdAt: now,
      updatedAt: now,
      ...newCardSchedule(now),
    }));
}

/**
 * Whether this account could publish this deck.
 *
 * Not the mining deck: those are the words somebody saved off the pages they
 * were reading, and they are nobody else's business. Not a deck published by
 * someone else either — adding it from the library does not make it yours to
 * republish. Everything else, *including* a deck this account published and
 * then withdrew: the old rule read "has a publisher" as "belongs to somebody
 * else", so withdrawing your own deck made it unshareable for ever.
 */
export function canShareDeck(deck: DeckInfo, uid: string | null): boolean {
  if (!uid || deck.kind !== "premade" || deck.id === MINING_DECK_ID) return false;
  if (deck.shared) return false;
  return !deck.ownerUid || deck.ownerUid === uid;
}

/** Whether this deck is the library's copy, published by this account. */
export function isSharedBy(deck: DeckInfo, uid: string | null): boolean {
  return deck.shared === true && !!uid && deck.ownerUid === uid;
}

// ---------------- one account's decks, across its devices ----------------

/** A deck removed on some device, and when — so it stays removed. */
export interface DeckGone {
  id: string;
  at: number;
}

/**
 * Fold two devices' deck lists into one.
 *
 * Cards have always merged; the *records* of the decks they belong to are
 * merged here, by the same principle — a deck present on either side is
 * kept, and where both have it the later record wins. Removals are the part
 * that needs remembering: without a tombstone, a deck deleted on the phone
 * is handed straight back by the laptop on the next sync, for ever. A
 * tombstone loses only to a record written after it, which is what makes
 * adding a deck back again work.
 */
export function mergeDeckLists(
  local: DeckInfo[],
  remote: DeckInfo[],
  goneLocal: DeckGone[] = [],
  goneRemote: DeckGone[] = [],
): { decks: DeckInfo[]; gone: DeckGone[] } {
  const gone = new Map<string, number>();
  for (const stone of [...goneLocal, ...goneRemote]) {
    gone.set(stone.id, Math.max(gone.get(stone.id) ?? 0, stone.at));
  }

  const best = new Map<string, DeckInfo>();
  for (const deck of [...local, ...remote]) {
    // The mining deck is never a record: it is every card that has no deck.
    if (deck.id === MINING_DECK_ID) continue;
    const removedAt = gone.get(deck.id);
    if (removedAt !== undefined && (deck.updatedAt ?? 0) <= removedAt) continue;
    const held = best.get(deck.id);
    if (!held || (deck.updatedAt ?? 0) > (held.updatedAt ?? 0)) best.set(deck.id, deck);
  }

  // A deck that came back is no longer removed.
  for (const id of best.keys()) gone.delete(id);

  return {
    decks: [...best.values()],
    gone: [...gone.entries()].map(([id, at]) => ({ id, at })).sort((a, b) => b.at - a.at),
  };
}

// ---------------- moving a deck through a document store ----------------

/**
 * Firestore holds at most a megabyte per document, and a deck of six thousand
 * words is several times that. Writing one document per card instead would
 * mean six thousand writes for one import — enough to spend a day's free
 * quota on a single deck.
 *
 * So a deck travels as a handful of compressed blocks: the cards are gzipped
 * and base64'd, which for Japanese vocabulary is roughly a fifth of the size,
 * and split into pieces that comfortably fit a document. Six thousand words
 * becomes a few writes.
 */
const DEFAULT_MAX_BYTES = 600_000;

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks: passing a hundred thousand arguments at once overflows the
  // call stack on every engine.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function packOne(cards: SharedCard[]): Promise<string> {
  return toBase64(await gzip(JSON.stringify(cards)));
}

/**
 * Split a deck into blocks small enough to store, compressing as it goes.
 *
 * Compression ratios vary with the deck, so the split cannot be computed up
 * front: a block is packed, and halved and repacked if it came out too big.
 */
export async function packDeck(
  cards: SharedCard[],
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<string[]> {
  if (cards.length === 0) return [];
  const blocks: string[] = [];
  const queue: SharedCard[][] = [];

  // Start from a size that is nearly always right, so the common case packs
  // once per block rather than repeatedly.
  const perBlock = Math.max(1, Math.min(cards.length, 4000));
  for (let i = 0; i < cards.length; i += perBlock) queue.push(cards.slice(i, i + perBlock));

  while (queue.length > 0) {
    const batch = queue.shift()!;
    const packed = await packOne(batch);
    if (packed.length <= maxBytes || batch.length === 1) {
      blocks.push(packed);
      continue;
    }
    const half = Math.ceil(batch.length / 2);
    queue.unshift(batch.slice(0, half), batch.slice(half));
  }
  return blocks;
}

export async function unpackBlock(block: string): Promise<SharedCard[]> {
  const parsed: unknown = JSON.parse(await gunzip(fromBase64(block)));
  if (!Array.isArray(parsed)) throw new Error("That deck block is not a list of cards.");
  return parsed as SharedCard[];
}

/** Reassemble a deck from its blocks, in order. */
export async function unpackDeck(blocks: string[]): Promise<SharedCard[]> {
  const cards: SharedCard[] = [];
  for (const block of blocks) cards.push(...(await unpackBlock(block)));
  return cards;
}

// ---------------- naming ----------------

/**
 * A deck id nobody else can collide with, and that says who owns it.
 *
 * The owner is in the id itself so the security rules can check who may
 * change a deck by looking at its name, without reading the deck first.
 */
export function newDeckId(ownerUid: string, at: number, random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(4, "0");
  return `${ownerUid}__${at.toString(36)}${suffix}`;
}

/** The account that published a deck, read back out of its id. */
export function ownerOfDeckId(deckId: string): string | null {
  const at = deckId.indexOf("__");
  return at > 0 ? deckId.slice(0, at) : null;
}

/** A name for a deck imported from a file, when the file is all there is. */
export function deckNameFromFile(fileName: string): string {
  return (
    fileName
      .replace(/\.(apkg|colpkg|txt|tsv|csv)$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Imported deck"
  );
}
