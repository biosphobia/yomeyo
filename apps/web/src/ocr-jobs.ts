import { openZip } from "@yomeyo/core";
import { getMeta, getMetaByPrefix, setMeta } from "./db.js";
import { getMedia } from "./media.js";
import { cachedOcr, newCanvas, ocrPage, OcrBusyError, type AnyCanvas } from "./ocr.js";

/**
 * Reading a whole book, page after page, without anybody watching.
 *
 * "OCR all pages" used to be a loop inside the open book: leave the page
 * and the work stopped. It is now a job, written down where the app can
 * find it again — so it carries on while you read something else, picks
 * itself up when the app is opened again, and (where the browser allows
 * it) keeps going in the service worker after the tab is closed.
 *
 * The job records nothing but what has been done. The results themselves
 * live where they always did: the page's boxes and text in this device's
 * cache, and, for a shared book, in the shared copy so nobody ever reads
 * the same page twice. Anything read while offline or in the background
 * is swept into the share the next time the app runs.
 */

export interface OcrJob {
  bookId: string;
  name: string;
  /** How many pages the book has. */
  total: number;
  /** Page slots finished, in the book's own numbering. */
  done: number[];
  /** Slots that failed this pass; retried before the job gives up. */
  failed: number[];
  state: "running" | "paused" | "done";
  /** Set when the job cannot run here at all (a PDF in the background). */
  note?: string;
  /** Why the last page that would not read did not read. */
  lastError?: string;
  /** When a busy server asked us to come back; the job resumes itself. */
  waitUntil?: number;
  startedAt: number;
  updatedAt: number;
}

const JOBS_KEY = "ocrJobs";
/** Pages already pushed to a book's shared copy, so the sweep is cheap. */
const SHARED_KEY = "ocrShared:";

type Jobs = Record<string, OcrJob>;

const listeners = new Set<() => void>();

/** Told whenever a job's progress changes, wherever the change came from. */
export function onOcrJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

export async function allJobs(): Promise<Jobs> {
  return (await getMeta<Jobs>(JOBS_KEY)) ?? {};
}

export async function jobFor(bookId: string): Promise<OcrJob | null> {
  return (await allJobs())[bookId] ?? null;
}

async function writeJob(job: OcrJob): Promise<void> {
  const jobs = await allJobs();
  jobs[job.bookId] = { ...job, updatedAt: Date.now() };
  await setMeta(JOBS_KEY, jobs);
  announce();
}

/**
 * Change part of a job, leaving the rest as stored.
 *
 * Progress is written after every page, and a pause can land while a page
 * is being read. Writing the whole record back would put "running" over
 * the pause the reader just asked for, so only what changed is written.
 */
async function patchJob(bookId: string, patch: Partial<OcrJob>): Promise<OcrJob | null> {
  const jobs = await allJobs();
  const held = jobs[bookId];
  if (!held) return null;
  const next = { ...held, ...patch, updatedAt: Date.now() };
  jobs[bookId] = next;
  await setMeta(JOBS_KEY, jobs);
  announce();
  return next;
}

export async function startJob(book: { id: string; name: string }, total: number): Promise<OcrJob> {
  const held = await jobFor(book.id);
  const job: OcrJob = {
    bookId: book.id,
    name: book.name,
    total,
    done: held?.done ?? [],
    failed: [],
    state: "running",
    startedAt: held?.startedAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  await writeJob(job);
  return job;
}

export async function pauseJob(bookId: string): Promise<void> {
  const job = await jobFor(bookId);
  if (!job) return;
  await writeJob({ ...job, state: "paused" });
}

export async function forgetJob(bookId: string): Promise<void> {
  const jobs = await allJobs();
  delete jobs[bookId];
  await setMeta(JOBS_KEY, jobs);
  announce();
}

/** Is anything waiting to be read? Asked on startup, and by the worker. */
export async function pendingJobs(): Promise<OcrJob[]> {
  const now = Date.now();
  return Object.values(await allJobs()).filter(
    (job) => job.state === "running" && !(job.waitUntil && job.waitUntil > now),
  );
}

// ---------------- getting at a book's pages ----------------

export interface PageSource {
  total: number;
  /** The page number a slot is cached under: PDFs count from 1, images from 0. */
  pageOf: (slot: number) => number;
  /** The pixels, or null when this page needs no OCR (it has real text). */
  render: (slot: number) => Promise<AnyCanvas | null>;
  close?: () => void;
}

/**
 * The parts of the job that only the app can do. The service worker runs
 * the same code with none of these set: it reads CBZ and image books,
 * which need nothing but pixels, and leaves PDFs for the app.
 */
export interface JobEnv {
  /** Opens a PDF for page-by-page rendering (the app has the renderer). */
  pdf?: (blob: Blob) => Promise<PageSource>;
}

let env: JobEnv = {};

export function setJobEnv(next: JobEnv): void {
  env = next;
}

interface ShelfBook {
  id: string;
  name: string;
  kind: string;
  sharedId?: string;
}

async function shelf(): Promise<ShelfBook[]> {
  return (await getMeta<ShelfBook[]>("readerBooks")) ?? [];
}

/** Decode an image into a canvas, in a page or in a worker. */
async function canvasOfImage(bytes: Uint8Array): Promise<AnyCanvas> {
  const blob = new Blob([bytes as unknown as BlobPart]);
  const bitmap = await createImageBitmap(blob);
  const canvas = newCanvas(bitmap.width, bitmap.height);
  (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
  bitmap.close?.();
  return canvas;
}

/**
 * How to get at each page of a book. CBZ and images work anywhere; a PDF
 * needs its renderer, which only loads in the app, so a PDF job simply
 * waits for the app rather than failing in the background.
 */
async function pagesOf(book: ShelfBook): Promise<PageSource> {
  const blob = await getMedia(`book/${book.id}`);
  if (!blob || blob.size === 0) throw new Error("The file for this book is not on this device.");

  if (book.kind === "cbz") {
    const zip = await openZip(new Uint8Array(await blob.arrayBuffer()));
    const entries = zip.entries
      .filter((entry) => /\.(png|jpe?g|webp|gif)$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return {
      total: entries.length,
      pageOf: (slot) => slot,
      render: async (slot) => canvasOfImage(await zip.read(entries[slot].name)),
    };
  }

  if (book.kind === "image") {
    return {
      total: 1,
      pageOf: (slot) => slot,
      render: async () => canvasOfImage(new Uint8Array(await blob.arrayBuffer())),
    };
  }

  if (book.kind === "pdf") {
    if (!env.pdf) throw new Error("PDF pages are read while the app is open.");
    return env.pdf(blob);
  }

  throw new Error("This kind of book has no pages to read.");
}

// ---------------- the runner ----------------

/**
 * The run happening in this context, if any. Handed back to anyone who
 * asks for a run while it is going, so "start it and tell me when it is
 * finished" means what it says instead of returning to an empty promise.
 */
let inFlight: Promise<void> | null = null;

/**
 * Work through whatever is pending, one page at a time.
 *
 * `budgetMs` bounds a run: the service worker gets a limited slice of
 * time after the tab closes, and stopping cleanly inside it means the job
 * resumes rather than being killed mid-page. The lock keeps two runners
 * (a tab and the worker, or two tabs) off the same book.
 */
export function runJobs(options: { budgetMs?: number; signal?: { stopped: boolean } } = {}): Promise<void> {
  if (inFlight) return inFlight;
  const deadline = options.budgetMs ? Date.now() + options.budgetMs : Infinity;
  inFlight = (async () => {
    const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
    // A job this context cannot finish — a PDF in the background worker —
    // steps aside rather than blocking the books that can be read here.
    const parked = new Set<string>();
    const work = async (): Promise<void> => {
      while (Date.now() < deadline && !options.signal?.stopped) {
        const next = (await pendingJobs()).find((job) => !parked.has(job.bookId));
        if (!next) break;
        if (!(await runOne(next, deadline, options.signal))) parked.add(next.bookId);
      }
      await sweepShares().catch(() => undefined);
    };
    if (locks?.request) {
      await locks.request("yomeyo-ocr", { ifAvailable: true }, async (lock) => {
        if (lock) await work();
      });
    } else {
      await work();
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** One job, until it finishes, pauses, or the budget runs out. */
async function runOne(job: OcrJob, deadline: number, signal?: { stopped: boolean }): Promise<boolean> {
  const book = (await shelf()).find((b) => b.id === job.bookId);
  if (!book) {
    await forgetJob(job.bookId);
    return true;
  }

  let source: PageSource;
  try {
    source = await pagesOf(book);
  } catch (err) {
    // A PDF in the background: leave it running and say why, so the app
    // picks it up as soon as it is open again.
    await writeJob({
      ...job,
      note: err instanceof Error ? err.message : "This book cannot be read here.",
    });
    return false;
  }

  const done = new Set(job.done);
  let failed = new Set(job.failed);
  let live: OcrJob = { ...job, total: source.total, note: undefined, waitUntil: undefined };
  await writeJob(live);

  try {
    for (let pass = 0; pass < 2; pass++) {
      for (let slot = 0; slot < source.total; slot++) {
        if (signal?.stopped) return false;
        if (Date.now() >= deadline) return false;
        if (done.has(slot)) continue;
        if (pass === 0 && failed.has(slot)) continue;

        // A pause from the UI lands in storage; check it as we go.
        const current = await jobFor(job.bookId);
        if (!current || current.state !== "running") return true;

        const page = source.pageOf(slot);
        const cacheKey = `${book.id}:${page}`;
        const shared = book.sharedId ? { id: book.sharedId, page } : undefined;
        try {
          if (!(await cachedOcr(cacheKey, shared))) {
            const canvas = await source.render(slot);
            if (canvas) {
              await ocrPage(canvas, cacheKey, { width: canvas.width, height: canvas.height }, undefined, shared);
            }
          }
          done.add(slot);
          failed.delete(slot);
        } catch (err) {
          if (err instanceof OcrBusyError) {
            // The service is rate-limiting, which says nothing about this
            // page. Stop, note when to come back, and leave the job running
            // so it picks itself up rather than condemning the rest.
            const seconds = err.retryAfter > 0 ? Math.min(600, err.retryAfter) : 90;
            await patchJob(job.bookId, {
              waitUntil: Date.now() + seconds * 1000,
              lastError: `The reading service was busy. Carrying on in about ${
                seconds < 90 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`
              }.`,
            });
            return false;
          }
          failed.add(slot);
          live = (await patchJob(job.bookId, {
            lastError: err instanceof Error ? err.message : String(err),
          })) ?? live;
        }
        live =
          (await patchJob(job.bookId, {
            done: [...done].sort((a, b) => a - b),
            failed: [...failed].sort((a, b) => a - b),
          })) ?? live;
      }
      if (failed.size === 0) break;
      // Second pass: the failures were usually a flaky moment, not a bad page.
      failed = new Set(failed);
    }
    const current = await jobFor(job.bookId);
    if (current?.state === "running") {
      await patchJob(job.bookId, { state: "done", failed: [...failed].sort((a, b) => a - b) });
    }
    return true;
  } finally {
    source.close?.();
  }
}

// ---------------- keeping the shared copy fed ----------------

/**
 * Everything read here that the book's shared copy has not got yet.
 *
 * Pages read in the background never reach the share (the worker has no
 * sign-in), and a page read offline never reached it either. This runs
 * after every batch and on startup, so the shared copy catches up on its
 * own and the next reader pays for none of it.
 */
export async function sweepShares(): Promise<void> {
  const books = (await shelf()).filter((book) => book.sharedId);
  if (books.length === 0) return;
  let publishOcr: (id: string, page: number, words: unknown) => Promise<void>;
  try {
    ({ publishOcr } = await import("./books.js"));
  } catch {
    return; // no cloud here (the background worker); the app does it later
  }
  for (const book of books) {
    const sent = new Set((await getMeta<number[]>(SHARED_KEY + book.id)) ?? []);
    // Every page this device has read, batch or not: the cache is the
    // record, so a page read one at a time while offline travels too.
    const read = await getMetaByPrefix(`bookOcr3:${book.id}:`).catch((): [string, unknown][] => []);
    let changed = false;
    for (const [key, words] of read) {
      const page = Number(key.slice(key.lastIndexOf(":") + 1));
      if (!Number.isFinite(page) || sent.has(page)) continue;
      if (Array.isArray(words) && words.length > 0) {
        await publishOcr(book.sharedId!, page, words).catch(() => undefined);
      }
      sent.add(page);
      changed = true;
    }
    if (changed) await setMeta(SHARED_KEY + book.id, [...sent]);
  }
}
