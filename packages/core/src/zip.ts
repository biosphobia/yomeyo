/**
 * Just enough ZIP to open an Anki `.apkg`.
 *
 * An .apkg is a ZIP holding one collection database and every media file the
 * deck references — which for a subtitle-mined deck is thousands of images
 * and audio clips and can run past a gigabyte. Only a few entries are wanted
 * at a time — the collection, then the media files the imported cards
 * actually use — so this never holds the whole file: it reads the index at
 * the end, then the bytes of the one entry asked for. On a phone that is the
 * difference between importing a deck and running out of memory trying.
 *
 * Decompression is the platform's: `DecompressionStream("deflate-raw")` is
 * exactly the "deflate" a ZIP stores, so there is no inflater here to get
 * wrong.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;

/** The most a ZIP comment can be, so the most the index can be buried under. */
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. Anything else this cannot read. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the entry's local header within the file. */
  headerOffset: number;
}

export interface ZipArchive {
  entries: ZipEntry[];
  /** Decompress one entry. Rejects for compression methods it cannot read. */
  read(name: string): Promise<Uint8Array>;
}

/** Read `[start, end)` of the archive. Ranges never overlap a read in flight. */
export type ByteRangeReader = (start: number, end: number) => Promise<Uint8Array>;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress ZIP files.");
  }
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Read an archive's index without reading the archive.
 *
 * `size` is the file's total length; `read` fetches a slice of it. Only the
 * tail and the central directory are touched here.
 */
export async function openZipRanged(read: ByteRangeReader, size: number): Promise<ZipArchive> {
  // The end-of-central-directory record is the last 22 bytes, unless a
  // comment follows it — so search backwards from the end.
  const tailLength = Math.min(size, MAX_COMMENT + 22);
  const tail = await read(size - tailLength, size);
  const tailView = viewOf(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file is not a ZIP archive.");

  let count = tailView.getUint16(eocd + 10, true);
  let directoryOffset = tailView.getUint32(eocd + 16, true);
  let directorySize = tailView.getUint32(eocd + 12, true);

  // ZIP64: the 32-bit fields saturate and the real ones live in a separate
  // record, found through a locator immediately before the EOCD.
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && tailView.getUint32(locator, true) === ZIP64_LOCATOR) {
      const at = Number(tailView.getBigUint64(locator + 8, true));
      const record = viewOf(await read(at, Math.min(size, at + 56)));
      if (record.getUint32(0, true) === ZIP64_EOCD) {
        count = Number(record.getBigUint64(32, true));
        directorySize = Number(record.getBigUint64(40, true));
        directoryOffset = Number(record.getBigUint64(48, true));
      }
    }
  }

  const directory = await read(directoryOffset, Math.min(size, directoryOffset + directorySize));
  const view = viewOf(directory);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count && at + 46 <= directory.length; i++) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER) break;
    const method = view.getUint16(at + 10, true);
    let compressedSize = view.getUint32(at + 20, true);
    let uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let headerOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength));

    // Oversized values are held in the ZIP64 extra field, in the order
    // uncompressed, compressed, offset — but only those that overflowed.
    if (
      uncompressedSize === 0xffffffff ||
      compressedSize === 0xffffffff ||
      headerOffset === 0xffffffff
    ) {
      let extra = at + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const tag = view.getUint16(extra, true);
        const length = view.getUint16(extra + 2, true);
        if (tag === 0x0001) {
          let field = extra + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(view.getBigUint64(field, true));
            field += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(view.getBigUint64(field, true));
            field += 8;
          }
          if (headerOffset === 0xffffffff) headerOffset = Number(view.getBigUint64(field, true));
          break;
        }
        extra += 4 + length;
      }
    }

    entries.push({ name, method, compressedSize, uncompressedSize, headerOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }

  async function readEntry(name: string): Promise<Uint8Array> {
    const entry = entries.find((e) => e.name === name);
    if (!entry) throw new Error(`The archive has no "${name}".`);
    // The local header repeats the name and may carry a *different* extra
    // field length from the central one, so the data offset must be taken
    // from here rather than computed from the directory entry.
    const header = viewOf(await read(entry.headerOffset, Math.min(size, entry.headerOffset + 30)));
    if (header.getUint32(0, true) !== LOCAL_HEADER) {
      throw new Error(`"${name}" is not where the archive says it is.`);
    }
    const start = entry.headerOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const raw = await read(start, Math.min(size, start + entry.compressedSize));
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateRaw(raw);
    throw new Error(`"${name}" uses a compression method this cannot read (${entry.method}).`);
  }

  return { entries, read: readEntry };
}

/** The same, for an archive already in memory. */
export function openZip(bytes: Uint8Array): Promise<ZipArchive> {
  return openZipRanged(async (start, end) => bytes.subarray(start, end), bytes.length);
}
