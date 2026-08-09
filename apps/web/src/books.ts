import { getMeta, setMeta, onAccountChange, deleteMetaByPrefix, getMetaByPrefix } from "./db.js";
import { saveMedia, getMedia } from "./media.js";
import { currentAccount, firestoreApi, type AccountInfo } from "./cloud.js";

/**
 * The bookshelf behind the Reading tab.
 *
 * A book is any file somebody wants to read with a dictionary under their
 * finger: plain text, EPUB, PDF, a CBZ of manga pages, or a lone image.
 * The file itself lives in the media store on this device; this module
 * keeps the shelf — what is here, what kind of thing each file is — and
 * moves books through the shared library, the same way decks travel:
 * a record in `books/{id}` and the bytes in base64 blocks beneath it.
 *
 * Private by default. Sharing is a choice, per book, and shared books can
 * be browsed and added by anyone, signed in or not.
 */

export type BookKind = "text" | "epub" | "pdf" | "cbz" | "image";

export interface BookInfo {
  id: string;
  name: string;
  kind: BookKind;
  /** Bytes on disk, for the shelf and the share cap. */
  size: number;
  addedAt: number;
  /** Set once this book has been published (or came from the library). */
  sharedId?: string;
  ownerName?: string;
}

export interface LibraryBook {
  id: string;
  name: string;
  kind: BookKind;
  size: number;
  blockCount: number;
  ownerUid?: string;
  ownerName?: string;
}

const SHELF_KEY = "readerBooks";
/** Firestore documents cap at 1MB; these chunks leave generous headroom. */
const BLOCK_BYTES = 480_000;
/** The share cap. Firestore is a card catalogue, not a warehouse. */
export const SHARE_LIMIT_BYTES = 25 * 1024 * 1024;

let shelfCache: BookInfo[] | null = null;
onAccountChange(() => {
  shelfCache = null;
});

export async function listBooks(): Promise<BookInfo[]> {
  shelfCache ??= (await getMeta<BookInfo[]>(SHELF_KEY)) ?? [];
  return shelfCache;
}

async function saveShelf(books: BookInfo[]): Promise<void> {
  shelfCache = books;
  await setMeta(SHELF_KEY, books);
}

/** What kind of book a file is, by its name (the mime type often lies). */
export function kindOfFile(name: string): BookKind | null {
  const ext = name.toLowerCase().replace(/^.*\./, "");
  if (ext === "pdf") return "pdf";
  if (ext === "epub") return "epub";
  if (ext === "cbz" || ext === "zip") return "cbz";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (["txt", "md", "html", "htm", "srt", "ass"].includes(ext)) return "text";
  return null;
}

export function bookFileKey(id: string): string {
  return `book/${id}`;
}

/**
 * Several files become one book. A folder's worth of page images turns
 * into a CBZ built right here (stored, not compressed — they are JPEGs
 * already), and several text files concatenate into one. Order is the
 * filenames', compared numerically, so page2 sits before page10.
 */
export async function addBookFromFiles(files: File[]): Promise<BookInfo> {
  if (files.length === 0) throw new Error("No files selected.");
  if (files.length === 1) return addBookFromFile(files[0]);

  const ordered = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
  const kinds = new Set(ordered.map((file) => kindOfFile(file.name)));

  if (kinds.size === 1 && kinds.has("image")) {
    // Pages into a CBZ; the CBZ reader sorts by entry name the same way.
    const entries: { name: string; bytes: Uint8Array }[] = [];
    for (const file of ordered) {
      entries.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const zip = buildStoredZip(entries);
    const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await saveMedia(bookFileKey(id), new Blob([zip as unknown as BlobPart]));
    const book: BookInfo = {
      id,
      name: `${albumName(ordered.map((f) => f.name))} (${ordered.length} pages)`,
      kind: "cbz",
      size: zip.length,
      addedAt: Date.now(),
    };
    await saveShelf([book, ...(await listBooks())]);
    return book;
  }

  if (kinds.size === 1 && kinds.has("text")) {
    const parts: string[] = [];
    for (const file of ordered) parts.push(await file.text());
    const text = parts.join("\n\n");
    const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const blob = new Blob([text], { type: "text/plain" });
    await saveMedia(bookFileKey(id), blob);
    const book: BookInfo = {
      id,
      name: albumName(ordered.map((f) => f.name)),
      kind: "text",
      size: blob.size,
      addedAt: Date.now(),
    };
    await saveShelf([book, ...(await listBooks())]);
    return book;
  }

  throw new Error("Select several images (one book of pages) or several text files — not a mix.");
}

/** A name for a set of files: their shared stem, or the first one's. */
function albumName(names: string[]): string {
  const stems = names.map((name) => name.replace(/\.[^.]+$/, ""));
  let prefix = stems[0];
  for (const stem of stems) {
    while (prefix && !stem.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const cleaned = prefix.replace(/[\s_\-#0-9]+$/, "").trim();
  return cleaned || stems[0] || "Untitled";
}

/** Take a file onto the shelf. Returns the new book. */
export async function addBookFromFile(file: File): Promise<BookInfo> {
  const kind = kindOfFile(file.name);
  if (!kind) throw new Error(`Cannot read ${file.name} — supported: pdf, epub, cbz, txt, html, images.`);
  const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await saveMedia(bookFileKey(id), file);
  const book: BookInfo = {
    id,
    name: file.name.replace(/\.[^.]+$/, ""),
    kind,
    size: file.size,
    addedAt: Date.now(),
  };
  await saveShelf([book, ...(await listBooks())]);
  return book;
}

export async function getBookFile(id: string): Promise<Blob | null> {
  return getMedia(bookFileKey(id));
}

export async function forgetBook(id: string): Promise<void> {
  await saveShelf((await listBooks()).filter((book) => book.id !== id));
  // The file blob is overwritten rather than deleted (the media store has
  // no delete-by-key here); the OCR cache goes properly.
  await saveMedia(bookFileKey(id), new Blob([]));
  await deleteMetaByPrefix(`bookOcr2:${id}:`).catch(() => 0);
}

export async function renameBook(id: string, name: string): Promise<void> {
  const books = await listBooks();
  const book = books.find((b) => b.id === id);
  await saveShelf(books.map((b) => (b.id === id ? { ...b, name } : b)));
  // A shared book this account published carries the new name to the
  // library too, so the two shelves never disagree about what it is called.
  const account = await currentAccount().catch(() => null);
  if (book?.sharedId && account && book.sharedId.startsWith(account.uid)) {
    try {
      const { db, storeApi } = await firestoreApi();
      await storeApi.updateDoc(storeApi.doc(db, "books", book.sharedId), { name });
    } catch {
      /* offline is fine; the local rename already happened */
    }
  }
}

// ---------------- a zip of our own ----------------

/**
 * Just enough ZIP to WRITE an archive: stored entries, no compression —
 * page images are compressed already, and our own reader (core/zip)
 * reads method 0 without a decompressor. UTF-8 names, flagged as such.
 */
function buildStoredZip(entries: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length + entry.bytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.bytes.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.bytes.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------- the shared shelf ----------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Put a book in the shared library. The id begins with the publisher's uid,
 * which is what the security rules read ownership from.
 */
export async function publishBook(account: AccountInfo, book: BookInfo, ownerName: string): Promise<string> {
  if (book.size > SHARE_LIMIT_BYTES) {
    throw new Error(`Too big to share — the cap is ${Math.round(SHARE_LIMIT_BYTES / 1024 / 1024)}MB.`);
  }
  const blob = await getBookFile(book.id);
  if (!blob || blob.size === 0) throw new Error("The file for that book is not on this device.");

  const { db, storeApi } = await firestoreApi();
  const sharedId = `${account.uid}__book_${Date.now().toString(36)}`;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const blockCount = Math.ceil(bytes.length / BLOCK_BYTES);
  // Blocks first, record second: a half-uploaded book is invisible, not broken.
  for (let i = 0; i < blockCount; i++) {
    await storeApi.setDoc(storeApi.doc(db, "books", sharedId, "blocks", String(i)), {
      data: bytesToBase64(bytes.subarray(i * BLOCK_BYTES, (i + 1) * BLOCK_BYTES)),
    });
  }
  await storeApi.setDoc(storeApi.doc(db, "books", sharedId), {
    name: book.name,
    kind: book.kind,
    size: bytes.length,
    blockCount,
    ownerUid: account.uid,
    ownerName: ownerName || "Someone",
    publishedAt: storeApi.serverTimestamp(),
  });

  await saveShelf(
    (await listBooks()).map((b) => (b.id === book.id ? { ...b, sharedId, ownerName } : b)),
  );
  // Pages already OCR'd on this device travel with the book, so nobody
  // downstream pays for a page that has been read once.
  await publishAllOcr(book.id, sharedId).catch(() => undefined);
  return sharedId;
}

export async function browseBooks(): Promise<LibraryBook[]> {
  const { db, storeApi } = await firestoreApi();
  const snapshot = await storeApi.getDocs(
    storeApi.query(storeApi.collection(db, "books"), storeApi.orderBy("publishedAt", "desc"), storeApi.limit(60)),
  );
  const books: LibraryBook[] = [];
  snapshot.forEach((doc: any) => {
    const data = doc.data?.() ?? {};
    books.push({
      id: doc.id,
      name: String(data.name ?? "(unnamed)"),
      kind: (data.kind as BookKind) ?? "text",
      size: Number(data.size ?? 0),
      blockCount: Number(data.blockCount ?? 0),
      ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : undefined,
      ownerName: typeof data.ownerName === "string" ? data.ownerName : undefined,
    });
  });
  return books;
}

/** Fetch a shared book onto this shelf. Returns the local book. */
export async function downloadBook(shared: LibraryBook): Promise<BookInfo> {
  const { db, storeApi } = await firestoreApi();
  const parts: Uint8Array[] = [];
  for (let i = 0; i < shared.blockCount; i++) {
    const snapshot = await storeApi.getDoc(storeApi.doc(db, "books", shared.id, "blocks", String(i)));
    const data = snapshot.data?.();
    if (!snapshot.exists?.() || typeof data?.data !== "string") {
      throw new Error("That book is missing a piece; ask its publisher to share it again.");
    }
    parts.push(base64ToBytes(data.data));
  }
  const blob = new Blob(parts as unknown as BlobPart[]);
  const id = `shared-${shared.id.slice(-10)}`;
  await saveMedia(bookFileKey(id), blob);
  const book: BookInfo = {
    id,
    name: shared.name,
    kind: shared.kind,
    size: blob.size,
    addedAt: Date.now(),
    sharedId: shared.id,
    ownerName: shared.ownerName,
  };
  const shelf = (await listBooks()).filter((b) => b.id !== id);
  await saveShelf([book, ...shelf]);
  return book;
}

/** Take a book back out of the shared library. */
export async function unpublishBook(sharedId: string, blockCount: number): Promise<void> {
  const { db, storeApi } = await firestoreApi();
  await storeApi.deleteDoc(storeApi.doc(db, "books", sharedId));
  for (let i = 0; i < blockCount; i++) {
    await storeApi.deleteDoc(storeApi.doc(db, "books", sharedId, "blocks", String(i))).catch(() => undefined);
  }
}

/** Whoever is signed in, for the share buttons. Null quietly. */
export async function shelfAccount(): Promise<AccountInfo | null> {
  return currentAccount().catch(() => null);
}

// ---------------- shared OCR ----------------

/**
 * OCR travels with a shared book: a page anyone has read lands at
 * `books/{id}/ocr/{page}`, and everyone after that gets the boxes for a
 * single small read instead of a whole OCR run. Signed-in readers may
 * contribute — the shelf is shared work, not just shared files.
 *
 * The doc id carries a pipeline version, so results written by an older,
 * worse OCR simply stop being found rather than poisoning every reader.
 */
const ocrDocId = (page: number): string => `v2-${page}`;

export async function fetchSharedOcr(sharedId: string, page: number): Promise<unknown | null> {
  try {
    const { db, storeApi } = await firestoreApi();
    const snapshot = await storeApi.getDoc(storeApi.doc(db, "books", sharedId, "ocr", ocrDocId(page)));
    const data = snapshot.exists?.() ? snapshot.data?.() : null;
    return Array.isArray(data?.words) ? data.words : null;
  } catch {
    return null;
  }
}

/** Take one page's OCR back out of the share. Quiet about failures. */
export async function deleteSharedOcr(sharedId: string, page: number): Promise<void> {
  try {
    const { db, storeApi } = await firestoreApi();
    await storeApi.deleteDoc(storeApi.doc(db, "books", sharedId, "ocr", ocrDocId(page)));
  } catch {
    /* somebody else's book and not the admin: the local clear stands */
  }
}

/** Contribute one page's OCR. Quiet about every possible failure. */
export async function publishOcr(sharedId: string, page: number, words: unknown): Promise<void> {
  try {
    if (!(await currentAccount().catch(() => null))) return;
    const { db, storeApi } = await firestoreApi();
    await storeApi.setDoc(storeApi.doc(db, "books", sharedId, "ocr", ocrDocId(page)), { words });
  } catch {
    /* the local cache still stands; somebody else can contribute it */
  }
}

/** Every page of this book OCR'd on this device, uploaded to its share. */
export async function publishAllOcr(bookId: string, sharedId: string): Promise<void> {
  const pages = await getMetaByPrefix(`bookOcr2:${bookId}:`).catch((): [string, unknown][] => []);
  for (const [key, words] of pages) {
    const page = Number(key.slice(key.lastIndexOf(":") + 1));
    if (Number.isFinite(page) && Array.isArray(words) && words.length > 0) {
      await publishOcr(sharedId, page, words);
    }
  }
}
