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
  await deleteMetaByPrefix(`bookOcr:${id}:`).catch(() => 0);
}

export async function renameBook(id: string, name: string): Promise<void> {
  await saveShelf((await listBooks()).map((book) => (book.id === id ? { ...book, name } : book)));
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
 */
export async function fetchSharedOcr(sharedId: string, page: number): Promise<unknown | null> {
  try {
    const { db, storeApi } = await firestoreApi();
    const snapshot = await storeApi.getDoc(storeApi.doc(db, "books", sharedId, "ocr", String(page)));
    const data = snapshot.exists?.() ? snapshot.data?.() : null;
    return Array.isArray(data?.words) ? data.words : null;
  } catch {
    return null;
  }
}

/** Contribute one page's OCR. Quiet about every possible failure. */
export async function publishOcr(sharedId: string, page: number, words: unknown): Promise<void> {
  try {
    if (!(await currentAccount().catch(() => null))) return;
    const { db, storeApi } = await firestoreApi();
    await storeApi.setDoc(storeApi.doc(db, "books", sharedId, "ocr", String(page)), { words });
  } catch {
    /* the local cache still stands; somebody else can contribute it */
  }
}

/** Every page of this book OCR'd on this device, uploaded to its share. */
export async function publishAllOcr(bookId: string, sharedId: string): Promise<void> {
  const pages = await getMetaByPrefix(`bookOcr:${bookId}:`).catch((): [string, unknown][] => []);
  for (const [key, words] of pages) {
    const page = Number(key.slice(key.lastIndexOf(":") + 1));
    if (Number.isFinite(page) && Array.isArray(words) && words.length > 0) {
      await publishOcr(sharedId, page, words);
    }
  }
}
