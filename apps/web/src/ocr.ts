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
const CACHE_PREFIX = "bookOcr3:";

/** Where a shared book's OCR lives, when the book is shared at all. */
export interface SharedOcrRef {
  id: string;
  page: number;
}

/**
 * A page already read — locally, or by anyone who read this shared book
 * before. A remote hit is cached locally, so it is fetched once.
 *
 * An empty result counts as read: a page of pure artwork has no text on
 * it, and finding that out once is enough. Only a page never read at all
 * comes back null.
 */
export async function cachedOcr(cacheKey: string, shared?: SharedOcrRef): Promise<OcrWord[] | null> {
  const held = await getMeta<OcrWord[]>(CACHE_PREFIX + cacheKey);
  if (Array.isArray(held)) return held;
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
 * When detection finds nothing at all, this returns null and Tesseract
 * takes the page — it is a worse reader, but its boxes are its own too.
 * Nothing here ever asks a model where something is.
 */
async function claudeOcr(canvas: HTMLCanvasElement, onStatus?: (line: string) => void): Promise<OcrWord[] | null> {
  if (!(await claudeAvailable())) return null;

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
  if (found.length === 0) return null;
  onStatus?.(`Reading ${found.length} block${found.length === 1 ? "" : "s"} of text…`);
  return transcribeBlocks(frame, found).catch(() => null);
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

// ---------------- finding the text blocks ourselves ----------------

/** A text block found on the page, in pixels of the frame. */
interface DetectedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  ink: number;
}

/** One mark on the page: a character, a speck, a stroke of a drawing. */
interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
  ink: number;
  /** Longest side, which is what "how big is this character" means here. */
  size: number;
}

/**
 * Where is the text on this page? Answered from the pixels alone, so the
 * boxes are the text by construction rather than by anyone's estimate.
 *
 * The trick is to look for what makes text text, which is not darkness —
 * artwork is dark too — but SHAPE and COMPANY. A printed character is a
 * compact mark of a particular size, and it never appears alone: its
 * neighbours are the same size, evenly spaced, and lined up with it, down
 * a column or across a row. Drawings have none of that discipline, and
 * screentone dots and hatching fail the size test outright.
 *
 * So: threshold against the LOCAL average (a bubble on a grey panel is
 * still white paper locally, and this is what makes screentone drop out),
 * take every connected mark, keep the ones shaped like characters, and
 * join up marks that are the same size and properly lined up. A run of two
 * or more joined marks is a line of text, and its box is theirs.
 *
 * Both polarities run: black on white, and the white-on-black lettering
 * manga puts inside title pills.
 */
function detectTextBlocks(frame: HTMLCanvasElement): DetectedBox[] {
  const DETECT = 1100;
  const s = Math.min(1, DETECT / Math.max(frame.width, frame.height));
  const w = Math.max(16, Math.round(frame.width * s));
  const h = Math.max(16, Math.round(frame.height * s));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const luma = new Uint8Array(w * h);
  for (let i = 0; i < luma.length; i++) {
    const at = i * 4;
    luma[i] = (data[at] * 299 + data[at + 1] * 587 + data[at + 2] * 114) / 1000;
  }

  // Local average over a window a few characters wide. Compared against
  // this, ink is what stands out from its own surroundings — so grey
  // screentone reads as background, and a dark panel's white lettering
  // reads as ink just as well as black lettering on white paper.
  const mean = localMean(luma, w, h, Math.max(9, Math.round(Math.max(w, h) * 0.035)));
  const dark = new Uint8Array(w * h);
  const light = new Uint8Array(w * h);
  const MARGIN = 14;
  for (let i = 0; i < luma.length; i++) {
    if (luma[i] < mean[i] - MARGIN) dark[i] = 1;
    else if (luma[i] > mean[i] + MARGIN) light[i] = 1;
  }

  let found = [...linesOfText(dark, w, h), ...linesOfText(light, w, h)];
  // Nothing character-shaped anywhere: a blurred scan, or a page whose
  // print is too small to survive the downscale. The blunt detector gets
  // a turn rather than leaving the page unread.
  if (found.length === 0) found = blobBlocks(dark, w, h);

  found = mergeTouching(found);
  found.sort((a, b) => b.ink - a.ink);
  const top = found.slice(0, 24);
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

/** Box average of `src`, radius `r`, via a summed-area table. */
function localMean(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const total =
        sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
      out[y * w + x] = total / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Marks of this mask that are shaped like characters, joined into the
 * lines they belong to. A joined pair is the same size, side by side or
 * one under the other, and lined up on the other axis — the arrangement
 * print has and drawings do not.
 */
function linesOfText(mask: Uint8Array, w: number, h: number): DetectedBox[] {
  const maxSide = Math.max(w, h);
  const minChar = Math.max(5, maxSide * 0.011);
  const maxChar = maxSide * 0.17;
  const marks: Mark[] = [];
  for (const c of blobs(mask, mask, w, h)) {
    const size = Math.max(c.w, c.h);
    const thin = Math.max(1, Math.min(c.w, c.h));
    const fill = c.ink / (c.w * c.h);
    // A character is compact, of printed size, and neither a hairline nor
    // a solid block. Hatching is too thin, screentone too small, a filled
    // panel too big and too solid.
    if (size < minChar || size > maxChar) continue;
    if (size / thin > 4.5) continue;
    if (fill < 0.12 || fill > 0.96) continue;
    marks.push({ x: c.x, y: c.y, w: c.w, h: c.h, ink: c.ink, size });
  }
  if (marks.length < 2) return [];

  // Only near neighbours can be joined, so the marks go in a coarse grid
  // and each is tested against its own cell and the ring around it.
  const cell = Math.max(8, Math.round(maxChar));
  const cols = Math.ceil(w / cell);
  const buckets = new Map<number, number[]>();
  marks.forEach((m, i) => {
    const key = Math.floor((m.y + m.h / 2) / cell) * cols + Math.floor((m.x + m.w / 2) / cell);
    const held = buckets.get(key);
    if (held) held.push(i);
    else buckets.set(key, [i]);
  });

  const parent = new Int32Array(marks.length).map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  marks.forEach((a, i) => {
    const cx = Math.floor((a.x + a.w / 2) / cell);
    const cy = Math.floor((a.y + a.h / 2) / cell);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (const j of buckets.get(gy * cols + gx) ?? []) {
          if (j <= i) continue;
          if (neighbours(a, marks[j])) union(i, j);
        }
      }
    }
  });

  const groups = new Map<number, Mark[]>();
  marks.forEach((m, i) => {
    const root = find(i);
    const held = groups.get(root);
    if (held) held.push(m);
    else groups.set(root, [m]);
  });

  const pageArea = w * h;
  const out: DetectedBox[] = [];
  for (const members of groups.values()) {
    // One mark alone is a speck, a stray, or an eye. Text keeps company.
    if (members.length < 2) continue;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let ink = 0;
    for (const m of members) {
      if (m.x < x0) x0 = m.x;
      if (m.y < y0) y0 = m.y;
      if (m.x + m.w > x1) x1 = m.x + m.w;
      if (m.y + m.h > y1) y1 = m.y + m.h;
      ink += m.ink;
    }
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, ink };
    // A "line" spanning the page is a row of look-alike drawings, not print.
    if (box.w * box.h > pageArea * 0.3) continue;
    out.push(box);
  }
  return out;
}

/** Are these two marks neighbours in the same line of print? */
function neighbours(a: Mark, b: Mark): boolean {
  const ratio = Math.max(a.size, b.size) / Math.max(1, Math.min(a.size, b.size));
  // Print sets a line in one size. Furigana beside a column is half the
  // size of the words it belongs to, and stays a line of its own.
  if (ratio > 2.2) return false;
  const reach = (a.size + b.size) / 2;
  const dx = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
  const dy = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
  // Stacked (vertical writing) or side by side (horizontal writing): close
  // along the line, and squarely lined up across it.
  return (dx <= reach * 0.55 && dy <= reach * 1.7) || (dy <= reach * 0.55 && dx <= reach * 1.7);
}

/**
 * The blunt detector, kept for pages whose print does not survive as
 * separate characters: grow every mark until neighbours touch, then take
 * the blobs of a text-like size and density.
 */
function blobBlocks(mask: Uint8Array, w: number, h: number): DetectedBox[] {
  const pageArea = w * h;
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.009));
  return blobs(dilate(mask, w, h, r), mask, w, h).filter((b) => {
    const density = b.ink / (b.w * b.h);
    const aspect = Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h));
    return (
      b.ink >= 30 && Math.min(b.w, b.h) >= 6 && b.w * b.h <= pageArea * 0.25 && density >= 0.06 && aspect <= 25
    );
  });
}

/** Boxes that overlap or sit against each other are one block. */
function mergeTouching(boxes: DetectedBox[]): DetectedBox[] {
  const kept = [...boxes];
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
  return kept;
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

  // Claude first: better print reading by far, and its boxes are this
  // device's own. Tesseract only when that could not run at all — the
  // host has no key, the network is down, or nothing on the page looked
  // like print. A page Claude did read and found no words on is finished:
  // it is artwork, and saying so once saves reading it again.
  if (image instanceof HTMLCanvasElement) {
    const viaClaude = await claudeOcr(image, onStatus).catch(() => null);
    if (viaClaude) {
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
