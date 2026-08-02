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
}

/**
 * Import every included group.
 *
 * The cards go through the same door as everything else, so a word already in
 * the deck is not duplicated — someone moving over gradually can import the
 * same deck twice and end up with one copy of each word.
 */
export async function importAnki(source: AnkiSource, keepScheduling: boolean): Promise<AnkiImportResult> {
  const cards: Card[] = [];
  for (const group of source.groups) {
    if (!group.include) continue;
    cards.push(...cardsFor(source, group, keepScheduling));
  }
  const added = await importCards(cards);
  return { ...summarise(cards), added };
}
