/**
 * A read-only SQLite reader, big enough for an Anki collection and no bigger.
 *
 * Anki stores its collection as a SQLite database inside the .apkg. Reading
 * it would normally mean shipping SQLite compiled to WebAssembly — around a
 * megabyte, downloaded by everyone, to read a file most people import once.
 *
 * What is actually needed is a full table scan of three tables. That is the
 * file format's simplest path: walk a table's b-tree, and decode each row.
 * No indexes, no query planner, no writing. Roughly two hundred lines rather
 * than a megabyte.
 *
 * Reference: https://www.sqlite.org/fileformat2.html
 */

export type SqlValue = number | bigint | string | Uint8Array | null;
export type SqlRow = Record<string, SqlValue>;

const MAGIC = "SQLite format 3\0";

/** One decoder for the whole file: a collection has hundreds of thousands of
 * text values, and building a decoder for each is pure overhead. */
const TEXT = /*#__PURE__*/ new TextDecoder("utf-8");

interface Varint {
  value: number;
  size: number;
}

/** Big-endian, 7 bits per byte, up to 9 bytes (the 9th contributes 8). */
function varint(bytes: Uint8Array, at: number): Varint {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    const byte = bytes[at + i];
    if (i === 8) break;
    if (byte < 0x80) return { value: value * 128 + byte, size: i + 1 };
    value = value * 128 + (byte & 0x7f);
  }
  // Ninth byte: all eight of its bits are used.
  return { value: value * 256 + bytes[at + 8], size: 9 };
}

export class SqliteFile {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly pageSize: number;
  private readonly usableSize: number;

  constructor(bytes: Uint8Array) {
    const header = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
    if (header !== MAGIC) throw new Error("That file is not a SQLite database.");
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const declared = this.view.getUint16(16, false);
    // 1 is the format's way of writing 65536, which does not fit in 16 bits.
    this.pageSize = declared === 1 ? 65536 : declared;
    this.usableSize = this.pageSize - this.view.getUint8(20);
  }

  /** Page numbers are 1-based, and page 1 starts with the 100-byte header. */
  private page(number: number): Uint8Array {
    const start = (number - 1) * this.pageSize;
    return this.bytes.subarray(start, start + this.pageSize);
  }

  /**
   * Row payloads longer than a page spill onto a chain of overflow pages,
   * with a computed amount kept in the cell itself. The formulas are the
   * file format's, not a choice.
   */
  private payload(page: Uint8Array, at: number, total: number): Uint8Array {
    const maxLocal = this.usableSize - 35;
    if (total <= maxLocal) return page.subarray(at, at + total);

    const minLocal = Math.floor(((this.usableSize - 12) * 32) / 255) - 23;
    let local = minLocal + ((total - minLocal) % (this.usableSize - 4));
    if (local > maxLocal) local = minLocal;

    const out = new Uint8Array(total);
    out.set(page.subarray(at, at + local), 0);
    let written = local;
    let next = new DataView(page.buffer, page.byteOffset + at + local, 4).getUint32(0, false);
    while (next !== 0 && written < total) {
      const overflow = this.page(next);
      const take = Math.min(this.usableSize - 4, total - written);
      out.set(overflow.subarray(4, 4 + take), written);
      written += take;
      next = new DataView(overflow.buffer, overflow.byteOffset, 4).getUint32(0, false);
    }
    return out;
  }

  /** Decode one row's record body into values, in column order. */
  private record(payload: Uint8Array): SqlValue[] {
    const head = varint(payload, 0);
    const values: SqlValue[] = [];
    const types: number[] = [];
    let at = head.size;
    while (at < head.value) {
      const type = varint(payload, at);
      types.push(type.value);
      at += type.size;
    }

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let body = head.value;
    for (const type of types) {
      switch (type) {
        case 0:
          values.push(null);
          break;
        case 1:
          values.push(view.getInt8(body));
          body += 1;
          break;
        case 2:
          values.push(view.getInt16(body, false));
          body += 2;
          break;
        case 3: {
          // 24-bit signed, which DataView has no reader for.
          const raw = (view.getUint8(body) << 16) | (view.getUint8(body + 1) << 8) | view.getUint8(body + 2);
          values.push(raw & 0x800000 ? raw - 0x1000000 : raw);
          body += 3;
          break;
        }
        case 4:
          values.push(view.getInt32(body, false));
          body += 4;
          break;
        case 5: {
          const high = view.getInt16(body, false);
          const low = view.getUint32(body + 2, false);
          values.push(high * 0x100000000 + low);
          body += 6;
          break;
        }
        case 6: {
          const wide = view.getBigInt64(body, false);
          // Anki's ids are milliseconds, well inside the safe range; keeping
          // them as numbers spares every caller a bigint special case.
          values.push(
            wide >= BigInt(Number.MIN_SAFE_INTEGER) && wide <= BigInt(Number.MAX_SAFE_INTEGER)
              ? Number(wide)
              : wide,
          );
          body += 8;
          break;
        }
        case 7:
          values.push(view.getFloat64(body, false));
          body += 8;
          break;
        case 8:
          values.push(0);
          break;
        case 9:
          values.push(1);
          break;
        default: {
          const length = Math.floor((type - 12) / 2);
          if (type % 2 === 0) {
            values.push(payload.slice(body, body + length));
          } else {
            values.push(TEXT.decode(payload.subarray(body, body + length)));
          }
          body += length;
        }
      }
    }
    return values;
  }

  /** Walk a table b-tree, yielding every row with its rowid. */
  private *walk(rootPage: number, seen = new Set<number>()): Generator<{ rowid: number; values: SqlValue[] }> {
    if (rootPage < 1 || seen.has(rootPage)) return; // a corrupt file must not loop forever
    seen.add(rootPage);
    const page = this.page(rootPage);
    // Page 1 carries the 100-byte database header before its b-tree header.
    const base = rootPage === 1 ? 100 : 0;
    const type = page[base];
    const cellCount = (page[base + 3] << 8) | page[base + 4];
    const pointerArray = base + (type === 0x05 || type === 0x02 ? 12 : 8);

    if (type === 0x05) {
      for (let i = 0; i < cellCount; i++) {
        const cell = (page[pointerArray + i * 2] << 8) | page[pointerArray + i * 2 + 1];
        const child = new DataView(page.buffer, page.byteOffset + cell, 4).getUint32(0, false);
        yield* this.walk(child, seen);
      }
      const rightmost = new DataView(page.buffer, page.byteOffset + base + 8, 4).getUint32(0, false);
      yield* this.walk(rightmost, seen);
      return;
    }
    if (type !== 0x0d) return; // an index page: nothing here to read

    for (let i = 0; i < cellCount; i++) {
      const cell = (page[pointerArray + i * 2] << 8) | page[pointerArray + i * 2 + 1];
      const size = varint(page, cell);
      const rowid = varint(page, cell + size.size);
      const payload = this.payload(page, cell + size.size + rowid.size, size.value);
      yield { rowid: rowid.value, values: this.record(payload) };
    }
  }

  /** Every table in the file: its name, column names, and where it starts. */
  private schema(): Map<string, { rootPage: number; columns: string[] }> {
    const tables = new Map<string, { rootPage: number; columns: string[] }>();
    for (const { values } of this.walk(1)) {
      // sqlite_master: type, name, tbl_name, rootpage, sql
      if (values[0] !== "table") continue;
      const name = String(values[1]);
      const rootPage = Number(values[3]);
      tables.set(name, { rootPage, columns: columnsOf(String(values[4] ?? "")) });
    }
    return tables;
  }

  private cachedSchema: Map<string, { rootPage: number; columns: string[] }> | null = null;

  tables(): string[] {
    this.cachedSchema ??= this.schema();
    return [...this.cachedSchema.keys()];
  }

  /**
   * Every row of a table, as objects keyed by column name.
   *
   * A column declared `INTEGER PRIMARY KEY` is the rowid itself and is stored
   * as null in the record, so it is filled in from the rowid.
   */
  rows(table: string): SqlRow[] {
    this.cachedSchema ??= this.schema();
    const found = this.cachedSchema.get(table);
    if (!found) throw new Error(`The collection has no "${table}" table.`);
    const out: SqlRow[] = [];
    for (const { rowid, values } of this.walk(found.rootPage)) {
      const row: SqlRow = {};
      found.columns.forEach((column, i) => {
        row[column] = values[i] ?? null;
      });
      if (found.columns.length > 0 && row[found.columns[0]] === null) {
        row[found.columns[0]] = rowid;
      }
      out.push(row);
    }
    return out;
  }
}

/**
 * Column names from a CREATE TABLE statement.
 *
 * Only the shape SQLite itself stores is handled — the original text of the
 * statement Anki issued — which is a plain parenthesised list. Bracketed and
 * quoted identifiers appear in Anki's schema, so those are unwrapped.
 *
 * Older Anki collections annotate every column with a comment — `id integer
 * primary key, /* 0 *​/` — and a comment read as a column name shifts every
 * value into the wrong field, so comments go first.
 */
export function columnsOf(rawSql: string): string[] {
  const sql = rawSql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const open = sql.indexOf("(");
  if (open < 0) return [];
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") {
      depth++;
      if (depth === 1) continue;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
    if (ch === "," && depth === 1) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  const columns: string[] = [];
  for (const part of parts) {
    const name = part.trim().split(/\s+/)[0] ?? "";
    const bare = name.replace(/^[["'`]/, "").replace(/[\]"'`]$/, "");
    // Table constraints (PRIMARY KEY (...), UNIQUE (...)) are not columns.
    if (!bare || /^(primary|unique|check|foreign|constraint)$/i.test(bare)) continue;
    columns.push(bare);
  }
  return columns;
}
