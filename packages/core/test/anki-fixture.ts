import { deflateRawSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

/**
 * `node:sqlite` arrived after this Vite's list of Node built-ins was fixed,
 * so an ordinary import is taken for a package name and fails to resolve.
 * Asking Node for it directly sidesteps the bundler entirely.
 */
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...params: unknown[]): unknown };
    close(): void;
  };
};

/**
 * Real Anki files to test against.
 *
 * The reader here parses the SQLite and ZIP formats by hand, so testing it
 * against files this repository also wrote by hand would only prove the two
 * agree. Node's own SQLite writes the database and Node's own zlib does the
 * compression, so what is read back is a file neither this reader nor this
 * test invented.
 */

const SEPARATOR = "\u001f";

export interface FixtureNote {
  id: number;
  fields: string[];
  /** Scheduling for this note's card, if it should have any. */
  card?: { type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number };
}

export interface FixtureOptions {
  /** Anki schema 11 keeps note types as JSON in `col`; 18 uses its own tables. */
  schema?: 11 | 18;
  /** Epoch seconds the collection was created. */
  crt?: number;
  fieldNames?: string[];
  noteTypeName?: string;
  notes: FixtureNote[];
}

const NOTE_TYPE_ID = 1600000000000;

/** Write a collection database the way Anki lays one out. */
export function buildCollection(options: FixtureOptions): Uint8Array {
  const {
    schema = 11,
    crt = 1600000000,
    fieldNames = ["Word", "Reading", "Meaning", "Sentence"],
    noteTypeName = "Japanese vocab",
    notes,
  } = options;

  const dir = mkdtempSync(join(tmpdir(), "anki-fixture-"));
  const path = join(dir, "collection.anki2");
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE col (
        id integer primary key, crt integer not null, mod integer not null,
        scm integer not null, ver integer not null, dty integer not null,
        usn integer not null, ls integer not null, conf text not null,
        models text not null, decks text not null, dconf text not null, tags text not null
      );
      CREATE TABLE notes (
        id integer primary key, guid text not null, mid integer not null,
        mod integer not null, usn integer not null, tags text not null,
        flds text not null, sfld integer not null, csum integer not null,
        flags integer not null, data text not null
      );
      CREATE TABLE cards (
        id integer primary key, nid integer not null, did integer not null,
        ord integer not null, mod integer not null, usn integer not null,
        type integer not null, queue integer not null, due integer not null,
        ivl integer not null, factor integer not null, reps integer not null,
        lapses integer not null, left integer not null, odue integer not null,
        odid integer not null, flags integer not null, data text not null
      );
    `);

    const models =
      schema === 11
        ? JSON.stringify({
            [String(NOTE_TYPE_ID)]: {
              id: NOTE_TYPE_ID,
              name: noteTypeName,
              flds: fieldNames.map((name, ord) => ({ name, ord })),
            },
          })
        : "{}";

    db.prepare(
      `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
       VALUES (1, ?, 0, 0, ?, 0, 0, 0, '{}', ?, '{}', '{}', '{}')`,
    ).run(crt, schema, models);

    if (schema === 18) {
      db.exec(`
        CREATE TABLE notetypes (id integer not null primary key, name text not null, mtime_secs integer not null, usn integer not null, config blob not null);
        CREATE TABLE fields (ntid integer not null, ord integer not null, name text not null, config blob not null, primary key (ntid, ord));
      `);
      db.prepare("INSERT INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?, ?, 0, 0, x'')").run(
        NOTE_TYPE_ID,
        noteTypeName,
      );
      const field = db.prepare("INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, x'')");
      fieldNames.forEach((name, ord) => field.run(NOTE_TYPE_ID, ord, name));
    }

    const note = db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (?, ?, ?, 0, 0, '', ?, 0, 0, 0, '')`,
    );
    const card = db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, ?, 1, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, '')`,
    );
    // One transaction, or every row is its own commit and a few thousand
    // notes take ten seconds of disk sync for no reason.
    db.exec("BEGIN");
    for (const entry of notes) {
      note.run(entry.id, `g${entry.id}`, NOTE_TYPE_ID, entry.fields.join(SEPARATOR));
      if (entry.card) {
        const c = entry.card;
        card.run(entry.id + 1, entry.id, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses);
      }
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }

  const bytes = new Uint8Array(readFileSync(path));
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

interface ZipItem {
  name: string;
  data: Uint8Array;
  /** Stored rather than deflated, which .apkg files also do for small entries. */
  stored?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Package entries into a ZIP, the way Anki packages an .apkg. */
export function buildZip(items: ZipItem[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const item of items) {
    const name = new TextEncoder().encode(item.name);
    const payload = item.stored ? item.data : new Uint8Array(deflateRawSync(item.data));
    const method = item.stored ? 0 : 8;
    const crc = crc32(item.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, item.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, payload);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, item.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);

    offset += local.length + payload.length;
  }

  const directorySize = central.reduce((sum, e) => sum + e.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, items.length, true);
  ev.setUint16(10, items.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
