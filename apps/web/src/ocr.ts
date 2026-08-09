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

// Versioned: results from the old estimate-the-box pipeline are not worth
// keeping, so a prefix bump quietly retires them.
const CACHE_PREFIX = "bookOcr2:";

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
 * Claude reads the page — but never guesses where anything is. A vision
 * model transcribes print beautifully and estimates coordinates terribly,
 * so the two jobs are split: this device finds the text blocks itself by
 * looking at the pixels (exact positions, no judgement calls), and Claude
 * is shown each block as its own numbered crop, purely to say what it
 * says. The boxes drawn on the page are the detected ones, so they sit on
 * the ink by construction.
 *
 * When detection finds nothing to crop (low contrast, odd pages), the old
 * whole-page estimate runs as a fallback, snapped to ink after the fact.
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

  const found = detectTextBlocks(frame);
  if (found.length > 0) {
    const words = await transcribeBlocks(frame, found).catch(() => null);
    if (words && words.length > 0) return words;
  }
  return estimateWholePage(frame);
}

/** Each detected block, cropped and sent for transcription only. */
async function transcribeBlocks(frame: HTMLCanvasElement, boxes: DetectedBox[]): Promise<OcrWord[] | null> {
  const images: string[] = [];
  for (const box of boxes) {
    const pad = 6;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const cw = Math.min(frame.width - x, box.w + pad * 2);
    const ch = Math.min(frame.height - y, box.h + pad * 2);
    const crop = document.createElement("canvas");
    // Tiny crops read badly; double them so the strokes survive JPEG.
    const up = Math.max(cw, ch) < 120 ? 2 : 1;
    crop.width = Math.max(1, cw * up);
    crop.height = Math.max(1, ch * up);
    crop.getContext("2d")!.drawImage(frame, x, y, cw, ch, 0, 0, crop.width, crop.height);
    const dataUrl = crop.toDataURL("image/jpeg", 0.85);
    images.push(dataUrl.slice(dataUrl.indexOf(",") + 1));
  }

  const res = await fetch(assetUrl("grammar.php"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "ocr", images, media: "image/jpeg" }),
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

  const textOf = new Map<number, string>();
  for (const block of parsed.blocks as { i?: unknown; text?: unknown }[]) {
    const i = Number(block.i);
    if (Number.isInteger(i) && typeof block.text === "string") textOf.set(i, block.text.trim());
  }
  const words: OcrWord[] = [];
  boxes.forEach((box, at) => {
    const text = textOf.get(at + 1) ?? "";
    // Crops that were artwork after all come back empty and vanish here.
    if (!text || !hasJapanese(text)) return;
    words.push({
      text,
      x: box.x / frame.width,
      y: box.y / frame.height,
      w: box.w / frame.width,
      h: box.h / frame.height,
    });
  });
  return words;
}

/** The old whole-page ask, kept as the fallback when nothing detects. */
async function estimateWholePage(frame: HTMLCanvasElement): Promise<OcrWord[] | null> {
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

// ---------------- finding the text blocks ourselves ----------------

/** A text block found on the page, in pixels of the frame. */
interface DetectedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  ink: number;
}

/**
 * Where is the text on this page? Answered from the pixels alone.
 *
 * The page is binarised, long straight runs are cut (panel borders and
 * ruled lines weld everything they touch into one blob), and every
 * remaining mark is grown a little so the characters of a block join
 * hands while separate blocks stay apart — a bubble pads its text more
 * than lines pad each other. Each connected blob becomes a candidate,
 * filtered by size and ink density so page-wide artwork and stray specks
 * drop out. What survives might still include drawings; those come back
 * from transcription as empty text and vanish. The boxes are the tight
 * bounds of the real ink, so a box always sits exactly on its text.
 */
function detectTextBlocks(frame: HTMLCanvasElement): DetectedBox[] {
  const DETECT = 700;
  const s = Math.min(1, DETECT / Math.max(frame.width, frame.height));
  const w = Math.max(8, Math.round(frame.width * s));
  const h = Math.max(8, Math.round(frame.height * s));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d")!;
  ctx.drawImage(frame, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) {
    const at = i * 4;
    ink[i] = data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114 < 110 ? 1 : 0;
  }

  // Cut long straight runs: no character stroke is 5% of the page long.
  const maxRun = Math.round(Math.max(w, h) * 0.05);
  const cut = Uint8Array.from(ink);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && ink[y * w + x]) run++;
      else {
        if (run > maxRun) for (let k = x - run; k < x; k++) cut[y * w + k] = 0;
        run = 0;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && ink[y * w + x]) run++;
      else {
        if (run > maxRun) for (let k = y - run; k < y; k++) cut[k * w + x] = 0;
        run = 0;
      }
    }
  }

  const r = Math.max(2, Math.round(Math.max(w, h) * 0.009));
  const pageArea = w * h;

  // Ordinary text: blobs of the cut map, measured on the real ink.
  const kept = blobs(dilate(cut, w, h, r), cut, w, h).filter((b) => {
    const density = b.ink / (b.w * b.h);
    const aspect = Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h));
    return (
      b.ink >= 30 &&
      Math.min(b.w, b.h) >= 6 &&
      b.w * b.h <= pageArea * 0.25 &&
      density >= 0.06 &&
      aspect <= 25
    );
  });

  // The line cut erases solid shapes, and some of those are text: manga
  // titles printed white on a black pill. A second pass over the uncut
  // ink keeps free-standing solid blobs of plausible pill size as
  // candidates too — the solid ones that are just art transcribe to
  // nothing and vanish downstream.
  const solid = blobs(dilate(ink, w, h, r), ink, w, h).filter((b) => {
    const density = b.ink / (b.w * b.h);
    const aspect = Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h));
    return (
      density >= 0.45 &&
      Math.min(b.w, b.h) >= 8 &&
      b.w * b.h <= pageArea * 0.08 &&
      aspect <= 12
    );
  });
  for (const pill of solid) {
    const claimed = kept.some((b) => {
      const ox = Math.max(0, Math.min(b.x + b.w, pill.x + pill.w) - Math.max(b.x, pill.x));
      const oy = Math.max(0, Math.min(b.y + b.h, pill.y + pill.h) - Math.max(b.y, pill.y));
      return ox * oy > pill.w * pill.h * 0.3;
    });
    if (!claimed) kept.push(pill);
  }

  // Blobs that ended up touching are one block.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        const a = kept[i];
        const b = kept[j];
        if (a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2) {
          const x0 = Math.min(a.x, b.x);
          const y0 = Math.min(a.y, b.y);
          kept[i] = {
            x: x0,
            y: y0,
            w: Math.max(a.x + a.w, b.x + b.w) - x0,
            h: Math.max(a.y + a.h, b.y + b.h) - y0,
            ink: a.ink + b.ink,
          };
          kept.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  kept.sort((a, b) => b.ink - a.ink);
  const top = kept.slice(0, 32);
  // Manga reading order: right to left, then down.
  top.sort((a, b) => b.x + b.w - (a.x + a.w) || a.y - b.y);

  const inv = 1 / s;
  return top.map((b) => ({
    x: Math.max(0, Math.round((b.x - 1) * inv)),
    y: Math.max(0, Math.round((b.y - 1) * inv)),
    w: Math.min(frame.width, Math.round((b.w + 2) * inv)),
    h: Math.min(frame.height, Math.round((b.h + 2) * inv)),
    ink: b.ink,
  }));
}

/** Connected blobs of `mask`, each measured as the tight bounds of `base`. */
function blobs(mask: Uint8Array, base: Uint8Array, w: number, h: number): DetectedBox[] {
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const found: DetectedBox[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    let count = 0;
    while (head < tail) {
      const p = queue[head++];
      const px = p % w;
      const py = (p / w) | 0;
      if (base[p]) {
        count++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      if (px > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        queue[tail++] = p - 1;
      }
      if (px < w - 1 && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        queue[tail++] = p + 1;
      }
      if (py > 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        queue[tail++] = p - w;
      }
      if (py < h - 1 && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        queue[tail++] = p + w;
      }
    }
    if (count > 0) found.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, ink: count });
  }
  return found;
}

/** Box dilation by radius `r`, one sliding-window pass per axis. */
function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const mid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) if (src[row + x]) count++;
    for (let x = 0; x < w; x++) {
      const add = x + r;
      if (add < w && src[row + add]) count++;
      mid[row + x] = count > 0 ? 1 : 0;
      const sub = x - r;
      if (sub >= 0 && src[row + sub]) count--;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) if (mid[y * w + x]) count++;
    for (let y = 0; y < h; y++) {
      const add = y + r;
      if (add < h && mid[add * w + x]) count++;
      out[y * w + x] = count > 0 ? 1 : 0;
      const sub = y - r;
      if (sub >= 0 && mid[sub * w + x]) count--;
    }
  }
  return out;
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
