import type { Card, CardState } from "./types.js";
import { makeId } from "./card.js";
import { openZip, openZipRanged, type ByteRangeReader, type ZipArchive } from "./zip.js";
import { SqliteFile, type SqlRow } from "./sqlite.js";

/**
 * Reading an Anki collection.
 *
 * Anyone moving here from Anki has years of review history in it, and asking
 * them to start those words from zero is asking them not to move. So this
 * reads the notes *and* the scheduling: a card that was on a four-month
 * interval in Anki arrives on a four-month interval.
 *
 * Two shapes are read. An `.apkg` is a ZIP holding a SQLite collection, the
 * deck's media files, and a manifest naming them; the collection carries
 * everything including scheduling, and the fields say which media file
 * belongs to which note. A plain-text export is a TSV of fields only — no
 * scheduling or media exists in that format to lose — and is the escape
 * hatch when a collection uses a compression the browser cannot undo.
 */

// ---------------- field text ----------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * Anki fields are HTML. Turned into the plain text a flashcard shows, with
 * the tags that mean "new line" honoured rather than dropped, so a field of
 * three glosses in a list does not become one run-on line. `[sound:…]` tags
 * are Anki's replay buttons, not text, so they vanish here the way they do
 * on a card.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/\[sound:[^\]]*\]/gi, "")
    .replace(/<\s*(br|BR)\s*\/?\s*>/g, "\n")
    .replace(/<\s*\/\s*(div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&[#a-z0-9]+;/gi, (entity) => decodeEntities(entity))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface Furigana {
  text: string;
  reading: string;
}

/**
 * Split Anki's furigana notation, `漢字[かんじ]`, into the word and its reading.
 *
 * Japanese decks store readings this way inside the expression field rather
 * than in a field of their own, so a deck can look like it has no readings
 * when in fact every one of them is right there.
 */
export function splitFurigana(field: string): Furigana {
  const source = field.replace(/&nbsp;/g, " ");
  if (!/\[[^\]]+\]/.test(source)) return { text: source.trim(), reading: "" };

  let text = "";
  let reading = "";
  // A ruby group is an optional separating space, the run of characters the
  // reading belongs to, then the reading in brackets. Everything else is
  // taken one character at a time: matching plain text greedily would swallow
  // the very run the next bracket belongs to.
  const pattern = / ?([^\s[\]]+)\[([^\]]*)\]|([^[\]])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[2] !== undefined) {
      text += match[1] ?? "";
      reading += match[2];
    } else {
      const plain = match[3] ?? "";
      text += plain;
      reading += plain;
    }
  }
  return { text: text.trim(), reading: reading.trim() };
}

/** Break one field into separate meanings, the way a card would show them. */
export function splitGlosses(field: string): string[] {
  return stripHtml(field)
    .split(/\n+|\s*;\s*|\s*、\s*/)
    .map((part) => part.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter((part) => part.length > 0);
}

// ---------------- media in the fields ----------------

/** The media one field refers to: `[sound:…]` clips and `<img>` pictures. */
export interface MediaRefs {
  audio: string[];
  images: string[];
}

const SOUND_TAG = /\[sound:([^\]]+)\]/gi;
const IMG_TAG = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))[^>]*>/gi;

/**
 * The media files a field names.
 *
 * The filenames sit in HTML, so entities are undone — a file with `&` in its
 * name is stored as `&amp;` in the field but under `&` in the archive. An
 * image fetched from the web is left out: it is not in the archive, and
 * there is nothing local to keep.
 */
export function extractMediaRefs(field: string): MediaRefs {
  const audio: string[] = [];
  const images: string[] = [];
  for (const match of field.matchAll(SOUND_TAG)) {
    const name = decodeEntities(match[1]).trim();
    if (name) audio.push(name);
  }
  for (const match of field.matchAll(IMG_TAG)) {
    const name = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (name && !/^(https?:|data:|\/\/)/i.test(name)) images.push(name);
  }
  return { audio, images };
}

/** The media belonging to one note, by what each file is for. */
export interface NoteMedia {
  /** The word being pronounced. */
  audio?: string;
  /** The example sentence being read out. */
  sentenceAudio?: string;
  image?: string;
}

const SENTENCE_FIELD = /sentence|例文/i;

/**
 * Which of a note's media files is which.
 *
 * The mapping cannot say: media nearly always lives in fields of its own
 * ("Vocabulary-Audio", "Picture") that map to no role at all, so every field
 * is searched. All that is told apart is the sentence being read out — found
 * by the field it is in — from the word being pronounced, because playing a
 * whole sentence when the card asks for its word gives the answer away.
 */
export function noteMedia(fields: string[], mapping: FieldMapping, fieldNames: string[] = []): NoteMedia {
  const media: NoteMedia = {};
  fields.forEach((field, index) => {
    const refs = extractMediaRefs(field);
    const forSentence = index === mapping.sentence || SENTENCE_FIELD.test(fieldNames[index] ?? "");
    if (refs.audio.length > 0) {
      if (forSentence) media.sentenceAudio ??= refs.audio[0];
      else media.audio ??= refs.audio[0];
    }
    if (refs.images.length > 0) media.image ??= refs.images[0];
  });
  return media;
}

// ---------------- which field is which ----------------

export type FieldRole =
  | "term"
  | "reading"
  | "meaning"
  | "sentence"
  | "sentenceMeaning"
  | "notes"
  | "ignore";

/** Which field of a note type holds what, by index into its field list. */
export type FieldMapping = Record<Exclude<FieldRole, "ignore">, number>;

/** The roles, in the order they are guessed and offered. */
export const FIELD_ROLES = ["term", "reading", "meaning", "sentence", "sentenceMeaning", "notes"] as const;

const HINTS: Record<Exclude<FieldRole, "ignore">, RegExp[]> = {
  term: [
    /^(word|expression|vocab\w*|term|front|kanji|target)$/i,
    // Prefixed variants ("Word 1") — but never a sibling like "Word Reading".
    /^(word|expression|vocab\w*|term|front|kanji|target)(?![-_ ]?(sentence|reading|furigana|kana|yomi|meaning|definition|translation|english|audio|sound|picture|image))/i,
    /単語|表現|語彙/,
  ],
  reading: [
    /^(reading|kana|furigana|pronunciation|yomi)/i,
    // "Word Reading", "Vocab-Furigana" — the word's own name in front.
    /^(word|expression|vocab\w*|term)[-_ ]?(reading|furigana|kana|yomi)/i,
    /読み|ふりがな|かな/,
  ],
  meaning: [
    /^(meaning|definition|glossar\w*|gloss|english|translation|back|sense)/i,
    /^(word|expression|vocab\w*|term)[-_ ]?(meaning|definition|translation|english|gloss)/i,
    /意味|訳|定義/,
  ],
  sentence: [/^(sentence|example|context|expression sentence|cloze|snippet)$/i, /^(sentence|example|context)(?![-_ ]?(meaning|translation|english|audio|furigana|reading|kana))/i, /例文|文/],
  sentenceMeaning: [/^(sentence|example|context)[-_ ]?(meaning|translation|english)/i, /例文.*(意味|訳)/],
  notes: [/^notes?\b/i, /備考|メモ|ノート/],
};

/**
 * Guess the roles from the field names.
 *
 * Anki note types are whatever their author decided, so this is only ever a
 * first offer — the point is that the common Japanese decks (Core 2k/6k,
 * the mining templates, JLPT decks) land right without anyone touching it,
 * and everything else starts from a sensible position rather than blank.
 */
export function guessFieldMapping(fieldNames: string[]): FieldMapping {
  const mapping: FieldMapping = {
    term: -1,
    reading: -1,
    meaning: -1,
    sentence: -1,
    sentenceMeaning: -1,
    notes: -1,
  };
  const taken = new Set<number>();

  for (const role of FIELD_ROLES) {
    for (const hint of HINTS[role]) {
      const index = fieldNames.findIndex((name, i) => !taken.has(i) && hint.test(name.trim()));
      if (index >= 0) {
        mapping[role] = index;
        taken.add(index);
        break;
      }
    }
  }

  // A note type with no recognisable names still has an order, and the first
  // field is the one Anki itself treats as the card's identity.
  if (mapping.term < 0 && fieldNames.length > 0 && !taken.has(0)) {
    mapping.term = 0;
    taken.add(0);
  }
  if (mapping.meaning < 0) {
    const next = fieldNames.findIndex((_, i) => !taken.has(i));
    if (next >= 0) mapping.meaning = next;
  }
  return mapping;
}

// ---------------- the collection ----------------

export interface AnkiNoteType {
  id: number;
  name: string;
  fieldNames: string[];
}

export interface AnkiNote {
  id: number;
  noteTypeId: number;
  fields: string[];
  tags: string[];
}

/** An Anki card's scheduling, as stored. */
export interface AnkiSchedule {
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
}

export interface AnkiCollection {
  /** Epoch seconds the collection was created; review due dates count from it. */
  createdAt: number;
  noteTypes: AnkiNoteType[];
  notes: AnkiNote[];
  /** The first card of each note, which is the one carrying its history. */
  schedules: Map<number, AnkiSchedule>;
}

const FIELD_SEPARATOR = "\u001f";

function readNoteTypes(db: SqliteFile): AnkiNoteType[] {
  const tables = db.tables();

  // Newer collections keep note types in tables of their own; older ones keep
  // them as a JSON blob in the single row of `col`.
  if (tables.includes("notetypes") && tables.includes("fields")) {
    const byId = new Map<number, AnkiNoteType>();
    for (const row of db.rows("notetypes")) {
      const id = Number(row.id);
      byId.set(id, { id, name: String(row.name ?? `Note type ${id}`), fieldNames: [] });
    }
    const ordered: { ntid: number; ord: number; name: string }[] = [];
    for (const row of db.rows("fields")) {
      ordered.push({ ntid: Number(row.ntid), ord: Number(row.ord ?? 0), name: String(row.name ?? "") });
    }
    ordered.sort((a, b) => a.ord - b.ord);
    for (const field of ordered) byId.get(field.ntid)?.fieldNames.push(field.name);
    const found = [...byId.values()].filter((t) => t.fieldNames.length > 0);
    if (found.length > 0) return found;
  }

  const col = db.rows("col")[0];
  const models = typeof col?.models === "string" ? col.models : "{}";
  let parsed: Record<string, { name?: string; flds?: { name?: string; ord?: number }[] }>;
  try {
    parsed = JSON.parse(models);
  } catch {
    return [];
  }
  return Object.entries(parsed).map(([id, model]) => ({
    id: Number(id),
    name: model.name ?? `Note type ${id}`,
    fieldNames: (model.flds ?? [])
      .slice()
      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))
      .map((f) => f.name ?? ""),
  }));
}

function readSchedules(db: SqliteFile): Map<number, AnkiSchedule> {
  const best = new Map<number, { ord: number; schedule: AnkiSchedule }>();
  let rows: SqlRow[];
  try {
    rows = db.rows("cards");
  } catch {
    return new Map();
  }
  for (const row of rows) {
    const nid = Number(row.nid);
    const ord = Number(row.ord ?? 0);
    const existing = best.get(nid);
    // A note can have several cards (recognition, recall, …). Yomeyo has one
    // card per word, so the first template's history is the one kept.
    if (existing && existing.ord <= ord) continue;
    best.set(nid, {
      ord,
      schedule: {
        type: Number(row.type ?? 0),
        queue: Number(row.queue ?? 0),
        due: Number(row.due ?? 0),
        ivl: Number(row.ivl ?? 0),
        factor: Number(row.factor ?? 0),
        reps: Number(row.reps ?? 0),
        lapses: Number(row.lapses ?? 0),
      },
    });
  }
  return new Map([...best].map(([nid, { schedule }]) => [nid, schedule]));
}

/** Read an already-extracted collection database. */
export function readCollection(bytes: Uint8Array): AnkiCollection {
  const db = new SqliteFile(bytes);
  const col = db.rows("col")[0];
  const notes: AnkiNote[] = db.rows("notes").map((row) => ({
    id: Number(row.id),
    noteTypeId: Number(row.mid),
    fields: String(row.flds ?? "").split(FIELD_SEPARATOR),
    tags: String(row.tags ?? "")
      .split(/\s+/)
      .filter(Boolean),
  }));
  return {
    createdAt: Number(col?.crt ?? 0),
    noteTypes: readNoteTypes(db),
    notes,
    schedules: readSchedules(db),
  };
}

/** The collection entries an .apkg may hold, best first. */
const COLLECTIONS = ["collection.anki21b", "collection.anki21", "collection.anki2"];

/**
 * Open an .apkg and read its collection.
 *
 * Recent Anki compresses the collection with zstd, which browsers have no
 * decompressor for. When that is all the file has, say so precisely and name
 * the two ways out, rather than failing with something the user cannot act on.
 */
export async function readApkg(bytes: Uint8Array): Promise<AnkiCollection> {
  return readApkgArchive(await openZip(bytes));
}

/**
 * The same, over a file this never has to hold all of.
 *
 * A collection with media can run to a gigabyte. Reading it by ranges means
 * a phone only ever holds the collection database, and later one media file
 * at a time — never the archive.
 */
export async function readApkgRanged(read: ByteRangeReader, size: number): Promise<AnkiCollection> {
  return readApkgArchive(await openZipRanged(read, size));
}

/** Read the collection out of an archive already opened, keeping the archive usable for media. */
export async function readApkgArchive(zip: ZipArchive): Promise<AnkiCollection> {
  const names = new Set(zip.entries.map((e) => e.name));

  for (const name of COLLECTIONS) {
    if (!names.has(name)) continue;
    const raw = await zip.read(name);
    const decoded = await maybeDecompressZstd(raw);
    if (!decoded) continue;
    try {
      return readCollection(decoded);
    } catch (err) {
      // Try the next candidate: an .apkg often carries two collections, one
      // of them a stub kept only so older Anki can open the file.
      if (name === COLLECTIONS[COLLECTIONS.length - 1]) throw err;
    }
  }

  if (COLLECTIONS.some((name) => names.has(name))) {
    throw new Error(
      "This deck is compressed with zstd, which this browser cannot decompress. " +
        "In Anki, export again with “Support older Anki versions” ticked, or export " +
        "as Notes in Plain Text and import the .txt file here.",
    );
  }
  throw new Error("That .apkg has no Anki collection in it.");
}

/**
 * zstd frames start with a fixed magic number; other bytes pass through.
 *
 * Newer exports compress the collection, the media manifest and every media
 * file this way, so all three readers share this. Null means the bytes are
 * zstd and this browser has no decompressor for it.
 */
export async function maybeDecompressZstd(bytes: Uint8Array): Promise<Uint8Array | null> {
  const isZstd =
    bytes.length > 4 &&
    bytes[0] === 0x28 &&
    bytes[1] === 0xb5 &&
    bytes[2] === 0x2f &&
    bytes[3] === 0xfd;
  if (!isZstd) return bytes;
  try {
    // Some browsers have grown a zstd decompressor; use it when it is there.
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new (DecompressionStream as unknown as new (f: string) => TransformStream)("zstd"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

// ---------------- the media manifest ----------------

/**
 * What the archive's media entries are called.
 *
 * Media files are stored under bare numbers — `0`, `1`, … — and a `media`
 * entry says which number is which file. Older exports write it as JSON,
 * `{"0": "水.mp3"}`; newer ones as a zstd-compressed protobuf list whose
 * i-th entry names the archive member `i`.
 *
 * Returns filename → archive entry name. Empty when the archive has no
 * media, and also when the manifest is zstd on a browser that cannot undo
 * it — the words still import, so an unreadable manifest costs the pictures
 * and sounds, not the deck.
 */
export async function readMediaManifest(zip: ZipArchive): Promise<Map<string, string>> {
  if (!zip.entries.some((entry) => entry.name === "media")) return new Map();
  let raw: Uint8Array;
  try {
    raw = await zip.read("media");
  } catch {
    return new Map();
  }
  const decoded = await maybeDecompressZstd(raw);
  if (!decoded) return new Map();
  return parseMediaManifest(decoded);
}

/** Parse an already-decompressed manifest, whichever shape it is. */
export function parseMediaManifest(bytes: Uint8Array): Map<string, string> {
  const names = new Map<string, string>();
  if (bytes.length === 0) return names;

  if (bytes[0] === 0x7b) {
    // '{' — the JSON manifest of older exports: entry name → filename.
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      for (const [entry, filename] of Object.entries(parsed)) {
        if (typeof filename === "string" && filename) names.set(filename, entry);
      }
    } catch {
      // Not a manifest after all; treated as a deck without media.
    }
    return names;
  }

  // The protobuf list: the message is repeated entries in field 1, and each
  // entry carries its filename in field 1. Order is meaning — the i-th entry
  // is the archive member named "i" — so entries without a name still count.
  try {
    const decoder = new TextDecoder();
    let index = 0;
    for (const [field, wire, value] of protoFields(bytes)) {
      if (field !== 1 || wire !== 2) continue;
      for (const [inner, innerWire, name] of protoFields(value as Uint8Array)) {
        if (inner === 1 && innerWire === 2) {
          const filename = decoder.decode(name as Uint8Array);
          if (filename) names.set(filename, String(index));
          break;
        }
      }
      index++;
    }
  } catch {
    names.clear(); // half a manifest would attach the wrong file to a card
  }
  return names;
}

function readVarint(bytes: Uint8Array, at: number): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  while (at < bytes.length && shift <= 63) {
    const byte = bytes[at++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, at];
    shift += 7;
  }
  throw new Error("truncated varint");
}

/** Walk one protobuf message: field number, wire type, and the payload. */
function* protoFields(bytes: Uint8Array): Generator<[number, number, Uint8Array | number]> {
  let at = 0;
  while (at < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, at);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    at = afterTag;
    if (wire === 0) {
      const [value, next] = readVarint(bytes, at);
      at = next;
      yield [field, wire, value];
    } else if (wire === 2) {
      const [length, start] = readVarint(bytes, at);
      at = start + length;
      if (at > bytes.length) throw new Error("truncated field");
      yield [field, wire, bytes.subarray(start, at)];
    } else if (wire === 5) {
      yield [field, wire, 0];
      at += 4;
    } else if (wire === 1) {
      yield [field, wire, 0];
      at += 8;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

// ---------------- plain-text exports ----------------

export interface TextExport {
  /** Column names if the export declared them, else positional placeholders. */
  fieldNames: string[];
  rows: string[][];
}

/**
 * Anki's "Notes in Plain Text" export.
 *
 * Tab-separated, optionally preceded by `#key:value` lines that say what the
 * separator is and whether the fields are HTML. There is no scheduling in
 * this format at all, which is the trade for it always being readable.
 */
export function parseTextExport(text: string): TextExport {
  let separator = "\t";
  let columns: string[] | null = null;
  const rows: string[][] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\ufeff/, "");
    if (line.startsWith("#")) {
      const [key, ...rest] = line.slice(1).split(":");
      const value = rest.join(":").trim();
      const name = key.trim().toLowerCase();
      if (name === "separator") separator = separatorFor(value);
      else if (name === "columns") columns = value.split(separator);
      continue;
    }
    if (line.trim() === "") continue;
    rows.push(line.split(separator));
  }

  const width = rows.reduce((most, row) => Math.max(most, row.length), 0);
  const fieldNames =
    columns && columns.length >= width
      ? columns.slice(0, width)
      : Array.from({ length: width }, (_, i) => `Field ${i + 1}`);
  return { fieldNames, rows };
}

function separatorFor(name: string): string {
  const named: Record<string, string> = {
    tab: "\t",
    comma: ",",
    semicolon: ";",
    colon: ":",
    space: " ",
    pipe: "|",
  };
  return named[name.toLowerCase()] ?? (name.length === 1 ? name : "\t");
}

// ---------------- making cards ----------------

export interface ImportOptions {
  /** Bring Anki's intervals and ease across, rather than starting from new. */
  keepScheduling?: boolean;
  /** Where due dates are counted from; the collection's creation, in seconds. */
  collectionCreatedAt?: number;
  /**
   * The note type's field names, so a clip in a "Sentence-Audio" field is
   * kept apart from the word's own pronunciation.
   */
  fieldNames?: string[];
  now?: number;
}

const DAY = 86400000;

/**
 * Anki's scheduling for one card, in Yomeyo's terms.
 *
 * Both schedulers are the same family, so most of this is unit conversion:
 * ease is stored per mille, intervals in days, and a review card's due date
 * as a day number counted from when the collection was made.
 */
export function convertSchedule(
  schedule: AnkiSchedule,
  collectionCreatedAt: number,
  now: number,
): Pick<Card, "state" | "due" | "intervalDays" | "ease" | "stepIndex" | "reps" | "lapses" | "leech"> {
  const ease = schedule.factor > 0 ? Math.max(1.3, schedule.factor / 1000) : 2.5;
  // Old collections stored intervals under a day as negative seconds.
  const intervalDays = schedule.ivl < 0 ? Math.max(0, Math.round(-schedule.ivl / 86400)) : schedule.ivl;
  const common = {
    ease,
    reps: Math.max(0, schedule.reps),
    lapses: Math.max(0, schedule.lapses),
    // Anki suspends a card outright; Yomeyo's nearest thing is a leech, which
    // its deck options can be told to suspend.
    ...(schedule.queue === -1 ? { leech: true } : {}),
  };

  switch (schedule.type) {
    case 2: // review
      return {
        ...common,
        state: "review" as CardState,
        intervalDays: Math.max(1, intervalDays),
        due: (collectionCreatedAt + schedule.due * 86400) * 1000,
        stepIndex: 0,
      };
    case 1: // learning
    case 3: // relearning
      return {
        ...common,
        state: (schedule.type === 1 ? "learning" : "relearning") as CardState,
        intervalDays: 0,
        // Learning cards store their due time as epoch seconds; anything too
        // small to be a timestamp is a day number the card is waiting on.
        due: schedule.due > 1_000_000_000 ? schedule.due * 1000 : now,
        stepIndex: 0,
      };
    default: // new, or anything unrecognised
      return {
        ...common,
        state: "new" as CardState,
        intervalDays: 0,
        due: now,
        stepIndex: 0,
        ease: 2.5,
      };
  }
}

export interface ImportedCard {
  card: Card;
  /** Why a note produced nothing, for the report. */
  skipped?: "no term";
}

/**
 * Turn notes into cards.
 *
 * A note with nothing in its term field produces nothing: those are the
 * empty rows every large collection accumulates, and importing them would
 * fill the deck with blanks that can never be reviewed.
 *
 * Media references come across as the filenames the note used; whoever has
 * the archive swaps them for stored copies, and a caller with no archive —
 * a plain-text import — gets the names to report as unavailable.
 */
export function notesToCards(
  notes: { fields: string[]; id?: number; tags?: string[] }[],
  mapping: FieldMapping,
  options: ImportOptions = {},
  schedules?: Map<number, AnkiSchedule>,
): Card[] {
  const now = options.now ?? Date.now();
  const createdAt = options.collectionCreatedAt ?? 0;
  const cards: Card[] = [];

  for (const note of notes) {
    const field = (index: number) => (index >= 0 ? (note.fields[index] ?? "") : "");
    const rawTerm = field(mapping.term);
    const rawReading = field(mapping.reading);
    const rawMeaning = field(mapping.meaning);
    const rawSentence = field(mapping.sentence);
    const sentenceMeaning = stripHtml(field(mapping.sentenceMeaning));
    const noteText = stripHtml(field(mapping.notes));

    // The reading is often not in a field of its own but written into the
    // term as furigana, so take it from there when the field is empty.
    const split = splitFurigana(stripHtml(rawTerm));
    const term = split.text;
    if (!term) continue;
    const reading = stripHtml(rawReading) || split.reading;

    const schedule = options.keepScheduling && note.id !== undefined ? schedules?.get(note.id) : undefined;
    const scheduling = schedule
      ? convertSchedule(schedule, createdAt, now)
      : { state: "new" as CardState, due: now, intervalDays: 0, ease: 2.5, stepIndex: 0, reps: 0, lapses: 0 };
    const media = noteMedia(note.fields, mapping, options.fieldNames);

    cards.push({
      id: makeId(),
      term,
      reading,
      glosses: splitGlosses(rawMeaning),
      sentence: splitFurigana(stripHtml(rawSentence)).text || undefined,
      ...(sentenceMeaning ? { sentenceMeaning } : {}),
      ...(noteText ? { notes: noteText } : {}),
      source: "Anki",
      createdAt: note.id !== undefined && note.id > 1_000_000_000_000 ? note.id : now,
      updatedAt: now,
      ...(media.audio ? { audio: media.audio } : {}),
      ...(media.sentenceAudio ? { sentenceAudio: media.sentenceAudio } : {}),
      ...(media.image ? { image: media.image } : {}),
      ...scheduling,
    });
  }
  return cards;
}

/** A due date so far out it is almost certainly wrong, for the summary. */
export const FAR_FUTURE_DAYS = 365 * 20;

/** What an import would do, for showing before it is committed. */
export interface ImportSummary {
  total: number;
  withScheduling: number;
  suspended: number;
  /** Cards whose due date lands implausibly far ahead — a sign of a bad crt. */
  implausible: number;
}

export function summarise(cards: Card[], now: number = Date.now()): ImportSummary {
  let withScheduling = 0;
  let suspended = 0;
  let implausible = 0;
  for (const card of cards) {
    if (card.state !== "new" || card.reps > 0) withScheduling++;
    if (card.leech) suspended++;
    if (card.due > now + FAR_FUTURE_DAYS * DAY) implausible++;
  }
  return { total: cards.length, withScheduling, suspended, implausible };
}
