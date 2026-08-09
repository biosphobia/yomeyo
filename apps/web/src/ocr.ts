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
 * frame, mapping them onto the page keeps the positions honest.
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
    body: JSON.stringify({ mode: "ocr", image, media: "image/jpeg" }),
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
  const words: OcrWord[] = [];
  for (const block of parsed.blocks as { text?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown }[]) {
    const text = typeof block.text === "string" ? block.text.trim() : "";
    if (!text || !hasJapanese(text)) continue;
    const per = (v: unknown): number => Math.min(1000, Math.max(0, Number(v) || 0)) / 1000;
    const w = per(block.w);
    const h = per(block.h);
    if (w <= 0.001 || h <= 0.001) continue;
    words.push({ text, x: per(block.x), y: per(block.y), w, h });
  }
  return words;
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
): Promise<OcrWord[]> {
  // Read before running anything: this device's cache, then whatever any
  // earlier reader of the shared book already contributed.
  const held = await cachedOcr(cacheKey, shared);
  if (held) return held;

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
