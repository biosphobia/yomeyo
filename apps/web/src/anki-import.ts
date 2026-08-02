import {
  guessFieldMapping,
  notesToCards,
  parseTextExport,
  readApkgRanged,
  summarise,
  type AnkiSchedule,
  type Card,
  type FieldMapping,
  type ImportSummary,
} from "@yomeyo/core";
import { importCards } from "./store.js";
import { putCards } from "./db.js";
import { cardsInDeck, forgetDeck, rememberDeck } from "./my-decks.js";
import type { AccountInfo } from "./cloud.js";

/**
 * Bringing a deck over from Anki.
 *
 * The parsing lives in core, where it is tested against real SQLite and ZIP
 * files. What is here is everything that needs the browser: getting at the
 * bytes without holding a gigabyte of media in memory, and shaping the result
 * into something the Settings screen can offer choices about.
 */

/** One note type's worth of notes, with the field roles offered for it. */
export interface AnkiGroup {
  key: string;
  name: string;
  fieldNames: string[];
  notes: { id?: number; fields: string[] }[];
  mapping: FieldMapping;
  /** Whether this note type is included in the import. */
  include: boolean;
}

export interface AnkiSource {
  fileName: string;
  /** True when the file carries review history at all — text exports do not. */
  hasScheduling: boolean;
  collectionCreatedAt: number;
  schedules: Map<number, AnkiSchedule>;
  groups: AnkiGroup[];
}

/** ZIP files start with these four bytes, whatever they are named. */
async function looksLikeZip(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

export async function readAnkiFile(file: File): Promise<AnkiSource> {
  if (await looksLikeZip(file)) return readPackage(file);
  return readText(file);
}

async function readPackage(file: File): Promise<AnkiSource> {
  const collection = await readApkgRanged(
    async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
    file.size,
  );

  const byType = new Map<number, { id?: number; fields: string[] }[]>();
  for (const note of collection.notes) {
    const list = byType.get(note.noteTypeId) ?? [];
    list.push({ id: note.id, fields: note.fields });
    byType.set(note.noteTypeId, list);
  }

  const groups: AnkiGroup[] = [];
  for (const noteType of collection.noteTypes) {
    const notes = byType.get(noteType.id) ?? [];
    if (notes.length === 0) continue; // a note type nothing uses
    groups.push({
      key: String(noteType.id),
      name: noteType.name,
      fieldNames: noteType.fieldNames,
      notes,
      mapping: guessFieldMapping(noteType.fieldNames),
      include: true,
    });
  }

  // Notes whose note type the collection does not describe still have fields,
  // and dropping them silently would lose words with no explanation.
  const described = new Set(collection.noteTypes.map((t) => t.id));
  const orphans = collection.notes.filter((n) => !described.has(n.noteTypeId));
  if (orphans.length > 0) {
    const width = orphans.reduce((most, n) => Math.max(most, n.fields.length), 0);
    const fieldNames = Array.from({ length: width }, (_, i) => `Field ${i + 1}`);
    groups.push({
      key: "unknown",
      name: "Notes of an unnamed type",
      fieldNames,
      notes: orphans.map((n) => ({ id: n.id, fields: n.fields })),
      mapping: guessFieldMapping(fieldNames),
      include: true,
    });
  }

  groups.sort((a, b) => b.notes.length - a.notes.length);
  return {
    fileName: file.name,
    hasScheduling: collection.schedules.size > 0,
    collectionCreatedAt: collection.createdAt,
    schedules: collection.schedules,
    groups,
  };
}

async function readText(file: File): Promise<AnkiSource> {
  const parsed = parseTextExport(await file.text());
  if (parsed.rows.length === 0) {
    throw new Error(
      "That file has no notes in it. Expected an Anki .apkg, or a “Notes in Plain Text” export.",
    );
  }
  return {
    fileName: file.name,
    hasScheduling: false,
    collectionCreatedAt: 0,
    schedules: new Map(),
    groups: [
      {
        key: "text",
        name: file.name,
        fieldNames: parsed.fieldNames,
        notes: parsed.rows.map((fields) => ({ fields })),
        mapping: guessFieldMapping(parsed.fieldNames),
        include: true,
      },
    ],
  };
}

/** The cards a group would produce, as configured right now. */
export function cardsFor(source: AnkiSource, group: AnkiGroup, keepScheduling: boolean): Card[] {
  return notesToCards(
    group.notes,
    group.mapping,
    {
      keepScheduling: keepScheduling && source.hasScheduling,
      collectionCreatedAt: source.collectionCreatedAt,
    },
    source.schedules,
  );
}

export interface AnkiImportResult extends ImportSummary {
  /** Cards actually added; the rest were already in the deck. */
  added: number;
  /** The deck the words went into, so it can be shared or removed later. */
  deckId: string;
}

/**
 * Import every included group as one premade deck.
 *
 * A whole vocabulary list is its own deck rather than a pile of words added
 * to the mined ones: the two are different things — one you chose to study,
 * one you met while reading — and keeping them apart is what lets a premade
 * deck be shared, or removed again, without touching your own words.
 *
 * The cards go through the same door as everything else, so a word already in
 * the deck is not duplicated — someone moving over gradually can import the
 * same deck twice and end up with one copy of each word.
 */
export async function importAnki(
  source: AnkiSource,
  keepScheduling: boolean,
  deckName: string,
): Promise<AnkiImportResult> {
  const deckId = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const cards: Card[] = [];
  for (const group of source.groups) {
    if (!group.include) continue;
    for (const card of cardsFor(source, group, keepScheduling)) {
      cards.push({ ...card, deckId });
    }
  }
  const added = await importCards(cards);
  await rememberDeck({
    id: deckId,
    name: deckName,
    kind: "premade",
    cardCount: cards.length,
    source: source.fileName,
  });
  return { ...summarise(cards), added, deckId };
}

/**
 * Put an imported deck in the shared library.
 *
 * Done after the import rather than as part of it: if the library is
 * unreachable the words are already safely in the deck, and the deck can be
 * shared later instead of the whole import failing.
 *
 * The deck is re-created under a library id, because a deck's id says who
 * published it — that is what lets the security rules decide who may change
 * it without reading the deck first. So the local cards are moved to the new
 * id at the same time, and the two stay the same deck.
 */
export async function shareDeck(
  account: AccountInfo,
  localDeckId: string,
  name: string,
  fileName: string,
): Promise<string> {
  const { publishDeck } = await import("./library.js");
  const cards = await cardsInDeck(localDeckId);
  if (cards.length === 0) throw new Error("that deck has no words in it");

  const published = await publishDeck(account, cards, { name, source: fileName });

  // Re-file the local cards under the library's id, so adding the deck
  // elsewhere and having it here are recognisably the same deck.
  await putCards(cards.map((card) => ({ ...card, deckId: published.id, dirty: true })));
  await forgetDeck(localDeckId);
  await rememberDeck({
    id: published.id,
    name,
    kind: "premade",
    cardCount: cards.length,
    source: fileName,
    ownerUid: account.uid,
    ownerName: published.ownerName,
    publishedAt: published.publishedAt,
    shared: true,
  });
  return published.id;
}
