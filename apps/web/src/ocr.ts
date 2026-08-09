import { getMeta, setMeta } from "./db.js";
import { assetUrl } from "./store.js";

/**
 * OCR for pages the computer cannot read: scanned manga, photographed
 * pages, image-only PDFs.
 *
 * Two engines, tried in order. Claude first, through the same server
 * endpoint the grammar course uses: it reads manga typesetting Tesseract
 * cannot, and it is asked for tight boxes in thousandths of the exact
 * frame we later overlay on, so the positions land true. On a host with
 * no key — or offline — Tesseract runs entirely in the browser instead,
 * with the Japanese models (vertical first: manga is columns) fetched on
 * first use.
 *
 * A page's result is cached by book and page, so each page pays the OCR
 * cost exactly once per device. What comes back is always the same shape:
 * text blocks with boxes as FRACTIONS of the page, valid at any zoom.
 */

export interface OcrWord {
  text: string;
  /** Box as fractions of the page, 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const CACHE_PREFIX = "bookOcr:";

/** Where a shared book's OCR lives, when the book is shared at all. */
export interface SharedOcrRef {
  id: string;
  page: number;
}

/**
 * A page already read — locally, or by anyone who read this shared book
 * before. A remote hit is cached locally, so it is fetched once.
 */
export async function cachedOcr(cacheKey: string, shared?: SharedOcrRef): Promise<OcrWord[] | null> {
  const held = await getMeta<OcrWord[]>(CACHE_PREFIX + cacheKey);
  if (held && held.length > 0) return held;
  if (!shared) return null;
  const { fetchSharedOcr } = await import("./books.js");
  const remote = await fetchSharedOcr(shared.id, shared.page);
  if (!Array.isArray(remote)) return null;
  const words = (remote as OcrWord[]).filter(
    (w) => w && typeof w.text === "string" && w.text.trim() !== "" && Number.isFinite(w.x) && Number.isFinite(w.y),
  );
  if (words.length === 0) return null;
  await setMeta(CACHE_PREFIX + cacheKey, words);
  return words;
}

let workerPromise: Promise<any> | null = null;

async function worker(): Promise<any> {
  workerPromise ??= (async () => {
    const Tesseract = await import("tesseract.js");
    // Vertical Japanese first: manga is columns. The horizontal model rides
    // along for the pages that are not.
    return Tesseract.createWorker(["jpn_vert", "jpn"]);
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

const hasJapanese = (text: string): boolean => /[぀-ヿ一-鿿]/.test(text);

/** Is the Claude endpoint deployed here? Asked once per page load. */
let claudeReady: Promise<boolean> | null = null;
function claudeAvailable(): Promise<boolean> {
  claudeReady ??= fetch(assetUrl("grammar.php?probe=1"))
    .then((res) => res.status === 204)
    .catch(() => false);
  return claudeReady;
}

/**
 * Claude reads the page. The canvas is downscaled to what vision models
 * see best, and because the boxes come back in thousandths of that exact
 * frame, mapping them onto the page keeps the coordinate spaces honest —
 * and then each box is SNAPPED to the actual ink under it, because a
 * model's spatial estimate lands near the text, not on it.
 */
async function claudeOcr(canvas: HTMLCanvasElement, onStatus?: (line: string) => void): Promise<OcrWord[] | null> {
  if (!(await claudeAvailable())) return null;
  onStatus?.("Claude is reading the page…");

  const MAX_SIDE = 1500;
  const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  let frame = canvas;
  if (scale < 1) {
    frame = document.createElement("canvas");
    frame.width = Math.round(canvas.width * scale);
    frame.height = Math.round(canvas.height * scale);
    frame.getContext("2d")!.drawImage(canvas, 0, 0, frame.width, frame.height);
  }
  const dataUrl = frame.toDataURL("image/jpeg", 0.88);
  const image = dataUrl.slice(dataUrl.indexOf(",") + 1);

  const res = await fetch(assetUrl("grammar.php"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "ocr", image, media: "image/jpeg", width: frame.width, height: frame.height }),
  });
  if (!res.ok) return null;
  const { raw } = (await res.json()) as { raw?: string };
  if (!raw) return null;
  let parsed: { blocks?: unknown[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.blocks)) return null;

  const ink = inkMap(frame);
  const words: OcrWord[] = [];
  for (const block of parsed.blocks as { text?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown }[]) {
    const text = typeof block.text === "string" ? block.text.trim() : "";
    if (!text || !hasJapanese(text)) continue;
    const per = (v: unknown): number => Math.min(1000, Math.max(0, Number(v) || 0)) / 1000;
    const w = per(block.w);
    const h = per(block.h);
    if (w <= 0.001 || h <= 0.001) continue;
    words.push(snapToInk({ text, x: per(block.x), y: per(block.y), w, h }, ink));
  }
  return words;
}

// ---------------- snapping boxes to the page's ink ----------------

interface InkMap {
  width: number;
  height: number;
  /** One byte per pixel: 1 where the page is dark enough to be print. */
  dark: Uint8Array;
}

function inkMap(frame: HTMLCanvasElement): InkMap {
  const ctx = frame.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, frame.width, frame.height);
  const dark = new Uint8Array(frame.width * frame.height);
  for (let i = 0; i < dark.length; i++) {
    const at = i * 4;
    const luma = data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114;
    dark[i] = luma < 110 ? 1 : 0;
  }
  return { width: frame.width, height: frame.height, dark };
}

/**
 * Tighten a claimed box onto the ink actually under it. The search window
 * is the claim grown by half its size each way; within it, the tight
 * bounds of rows and columns that carry real ink become the box. A window
 * that is mostly dark is artwork, not text on paper — left alone.
 */
function snapToInk(word: OcrWord, ink: InkMap): OcrWord {
  const growX = word.w * 0.5;
  const growY = word.h * 0.5;
  const x0 = Math.max(0, Math.floor((word.x - growX) * ink.width));
  const x1 = Math.min(ink.width, Math.ceil((word.x + word.w + growX) * ink.width));
  const y0 = Math.max(0, Math.floor((word.y - growY) * ink.height));
  const y1 = Math.min(ink.height, Math.ceil((word.y + word.h + growY) * ink.height));
  const cols = x1 - x0;
  const rows = y1 - y0;
  if (cols < 4 || rows < 4) return word;

  const colInk = new Uint32Array(cols);
  const rowInk = new Uint32Array(rows);
  let total = 0;
  for (let y = y0; y < y1; y++) {
    const base = y * ink.width;
    for (let x = x0; x < x1; x++) {
      if (ink.dark[base + x]) {
        colInk[x - x0]++;
        rowInk[y - y0]++;
        total++;
      }
    }
  }
  // Nothing printed here, or so much dark it is a drawing: trust the claim.
  const coverage = total / (cols * rows);
  if (total < 12 || coverage > 0.55) return word;

  // A row or column counts when it carries more than stray specks.
  const colBar = Math.max(2, rows * 0.02);
  const rowBar = Math.max(2, cols * 0.02);
  let left = 0;
  while (left < cols && colInk[left] <= colBar) left++;
  let right = cols - 1;
  while (right > left && colInk[right] <= colBar) right--;
  let top = 0;
  while (top < rows && rowInk[top] <= rowBar) top++;
  let bottom = rows - 1;
  while (bottom > top && rowInk[bottom] <= rowBar) bottom--;
  if (right - left < 3 || bottom - top < 3) return word;

  const pad = 2;
  return {
    text: word.text,
    x: Math.max(0, (x0 + left - pad) / ink.width),
    y: Math.max(0, (y0 + top - pad) / ink.height),
    w: Math.min(1, (right - left + 1 + pad * 2) / ink.width),
    h: Math.min(1, (bottom - top + 1 + pad * 2) / ink.height),
  };
}

/**
 * Read one page. `image` is anything tesseract accepts — a canvas, a blob,
 * an object URL. `cacheKey` is `${bookId}:${page}`.
 */
export async function ocrPage(
  image: HTMLCanvasElement | Blob | string,
  cacheKey: string,
  size: { width: number; height: number },
  onStatus?: (line: string) => void,
  shared?: SharedOcrRef,
  options: { force?: boolean } = {},
): Promise<OcrWord[]> {
  // Read before running anything: this device's cache, then whatever any
  // earlier reader of the shared book already contributed. A forced run
  // reads the page afresh and replaces both.
  if (!options.force) {
    const held = await cachedOcr(cacheKey, shared);
    if (held) return held;
  }

  /** A fresh result also joins the shared book, for everyone after. */
  const contribute = (words: OcrWord[]): void => {
    if (!shared || words.length === 0) return;
    void import("./books.js")
      .then((m) => m.publishOcr(shared.id, shared.page, words))
      .catch(() => undefined);
  };

  // Claude first: better print reading by far. Tesseract when the host
  // has no key, the network is down, or Claude found nothing.
  if (image instanceof HTMLCanvasElement) {
    const viaClaude = await claudeOcr(image, onStatus).catch(() => null);
    if (viaClaude && viaClaude.length > 0) {
      await setMeta(CACHE_PREFIX + cacheKey, viaClaude);
      contribute(viaClaude);
      return viaClaude;
    }
  }

  onStatus?.("Reading the page… the first one also downloads the Japanese OCR model.");
  const w = await worker();
  const { data } = await w.recognize(image);
  const words: OcrWord[] = [];
  for (const word of data.words ?? []) {
    const text = String(word.text ?? "").trim();
    if (!text || !hasJapanese(text)) continue;
    const box = word.bbox;
    if (!box) continue;
    words.push({
      text,
      x: box.x0 / size.width,
      y: box.y0 / size.height,
      w: Math.max(0.004, (box.x1 - box.x0) / size.width),
      h: Math.max(0.004, (box.y1 - box.y0) / size.height),
    });
  }
  await setMeta(CACHE_PREFIX + cacheKey, words);
  contribute(words);
  return words;
}

/** Forget a page's OCR, here and (permissions willing) in the share. */
export async function clearOcr(cacheKey: string, shared?: SharedOcrRef): Promise<void> {
  const { deleteMeta } = await import("./db.js");
  await deleteMeta(CACHE_PREFIX + cacheKey).catch(() => undefined);
  if (shared) {
    void import("./books.js")
      .then((m) => m.deleteSharedOcr(shared.id, shared.page))
      .catch(() => undefined);
  }
}
