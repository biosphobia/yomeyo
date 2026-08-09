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

/**
 * A drawing surface, whichever kind this context has. The page has real
 * canvases; the service worker that keeps a batch running after the tab
 * closes has OffscreenCanvas, which does everything needed here.
 */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function newCanvas(width: number, height: number): AnyCanvas {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
}

function context2d(canvas: AnyCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  return canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
}

/** Is this a drawing surface (either kind), rather than a blob or a URL? */
function isCanvas(value: unknown): value is AnyCanvas {
  return (
    (typeof HTMLCanvasElement !== "undefined" && value instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas)
  );
}

/** The canvas as base64 JPEG, by whichever route this context provides. */
async function jpegBase64(canvas: AnyCanvas, quality: number): Promise<string> {
  if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) {
    const url = canvas.toDataURL("image/jpeg", quality);
    return url.slice(url.indexOf(",") + 1);
  }
  const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: "image/jpeg", quality });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export interface OcrWord {
  text: string;
  /** Box as fractions of the page, 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Vertical writing: the characters run down the box rather than across
   * it. This is what lets a line be divided into one cell per character,
   * which is how individual words become tappable.
   */
  vertical?: boolean;
}

// Versioned: results from the old estimate-the-box pipeline are not worth
// keeping, so a prefix bump quietly retires them.
const CACHE_PREFIX = "bookOcr4:";

/**
 * "Ask again in a moment", not "this cannot be read".
 *
 * A whole book is hundreds of requests in a row, and an API answers that
 * with a rate limit sooner or later. Treating that as a failed page would
 * condemn the rest of the book on the strength of a queue being full, so
 * it gets a type of its own and the batch waits instead.
 */
export class OcrBusyError extends Error {
  /** Seconds the server asked us to wait, when it said. */
  readonly retryAfter: number;
  constructor(message: string, retryAfter = 0) {
    super(message);
    this.name = "OcrBusyError";
    this.retryAfter = retryAfter;
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  const books = await bookCloud();
  if (!books) return null;
  const remote = await books.fetchSharedOcr(shared.id, shared.page);
  if (!Array.isArray(remote)) return null;
  const words = (remote as OcrWord[]).filter(
    (w) => w && typeof w.text === "string" && w.text.trim() !== "" && Number.isFinite(w.x) && Number.isFinite(w.y),
  );
  if (words.length === 0) return null;
  await setMeta(CACHE_PREFIX + cacheKey, words);
  return words;
}

/**
 * The shared-bookshelf half of a book, when it is reachable at all.
 *
 * The service worker that finishes a batch after the tab closes has no
 * sign-in and no cloud library bundled into it, so every one of these
 * calls has to be allowed to come back empty rather than throw.
 */
async function bookCloud(): Promise<typeof import("./books.js") | null> {
  try {
    return await import("./books.js");
  } catch {
    return null;
  }
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
 * Null means one thing only: this host has no key, so the fallback engine
 * should take the page. Anything else that goes wrong is thrown, because
 * a busy service and a failed request are both "ask again", not "read it
 * some worse way". Nothing here ever asks a model where something is.
 */
async function claudeOcr(canvas: AnyCanvas, onStatus?: (line: string) => void): Promise<OcrWord[] | null> {
  if (!(await claudeAvailable())) return null;

  const MAX_SIDE = 1500;
  const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  let frame = canvas;
  if (scale < 1) {
    frame = newCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
    context2d(frame).drawImage(canvas as CanvasImageSource, 0, 0, frame.width, frame.height);
  }

  const found = detectTextLines(frame);
  // Claude is here and found nothing print-shaped: the page is a drawing.
  // That is an answer, not a failure, and Tesseract would not do better.
  if (found.length === 0) return [];
  onStatus?.(`Reading ${found.length} block${found.length === 1 ? "" : "s"} of text…`);
  const words = await transcribeBlocks(frame, found);
  // Claude is configured here but this request would not go through. That
  // is a page to try again later, not a page for the fallback engine —
  // handing it to Tesseract would download a huge model to do worse.
  if (!words) throw new Error("The reading service did not answer. Try this page again.");
  return words;
}

/**
 * Each detected line, cropped and sent for transcription only.
 *
 * One line per crop is the whole point: a single column cannot be read in
 * the wrong order, and what comes back belongs to exactly one box, whose
 * characters can then be placed along it.
 */
async function transcribeBlocks(frame: AnyCanvas, boxes: DetectedLine[]): Promise<OcrWord[] | null> {
  const images: string[] = [];
  for (const box of boxes) {
    const pad = 6;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const cw = Math.min(frame.width - x, box.w + pad * 2);
    const ch = Math.min(frame.height - y, box.h + pad * 2);
    // Tiny crops read badly; double them so the strokes survive JPEG.
    const up = Math.max(cw, ch) < 120 ? 2 : 1;
    const crop = newCanvas(Math.max(1, cw * up), Math.max(1, ch * up));
    context2d(crop).drawImage(frame as CanvasImageSource, x, y, cw, ch, 0, 0, crop.width, crop.height);
    images.push(await jpegBase64(crop, 0.85));
  }

  // Hundreds of pages in a row will meet a rate limit. Wait the time the
  // server asks for (or a growing guess), and only give up after several
  // tries — and then say it was busy, which is not the same as unreadable.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(assetUrl("grammar.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "ocr", images, media: "image/jpeg" }),
    }).catch(() => null);
    if (res?.ok) break;
    const busy = !res || res.status === 429 || res.status >= 500;
    if (!busy) return null;
    if (attempt === 3) {
      const asked = Number(res?.headers.get("retry-after") ?? 0);
      throw new OcrBusyError("The reading service is busy.", Number.isFinite(asked) ? asked : 0);
    }
    const asked = Number(res?.headers.get("retry-after") ?? 0);
    const backoff = Number.isFinite(asked) && asked > 0 ? asked * 1000 : 2000 * 3 ** attempt;
    await wait(Math.min(60000, backoff));
  }
  if (!res?.ok) return null;
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
      vertical: box.vertical,
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

/** One line of print: a column of vertical text, or a row of horizontal. */
interface DetectedLine extends DetectedBox {
  vertical: boolean;
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
 * a column or across a row.
 *
 * What comes back is one entry per LINE — a single column of vertical
 * text, or a single row of horizontal text — never a whole bubble. That
 * matters three times over: a column crops to an unambiguous strip so
 * nothing is read out of order, a line's box hugs its own text instead of
 * a bubble's worth of white, and a line of N characters can be divided
 * into N cells, which is what makes individual words tappable.
 *
 * Both polarities run: black on white, and the white-on-black lettering
 * manga puts inside title pills.
 */
function detectTextLines(frame: AnyCanvas): DetectedLine[] {
  const DETECT = 1100;
  const s = Math.min(1, DETECT / Math.max(frame.width, frame.height));
  const w = Math.max(16, Math.round(frame.width * s));
  const h = Math.max(16, Math.round(frame.height * s));
  const small = newCanvas(w, h);
  const ctx = context2d(small);
  ctx.drawImage(frame as CanvasImageSource, 0, 0, w, h);
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

  // Black on white first. Then white on black — but only where it is not
  // standing inside something already read: the white enclosed by a 口 or
  // a 日 is a hole in a character, and rows of holes line up convincingly
  // into lines that are not there. Lettering in a black title pill has no
  // such parent, because the pill itself is far too big to be a character.
  const inked = linesOfText(dark, w, h);
  const reversed = linesOfText(light, w, h).filter((line) => !insideAny(line, inked));
  const kept = dropDuplicates([...inked, ...reversed]);
  ordered(kept);

  const inv = 1 / s;
  return kept.slice(0, 60).map((line) => ({
    x: Math.max(0, Math.round((line.x - 1) * inv)),
    y: Math.max(0, Math.round((line.y - 1) * inv)),
    w: Math.min(frame.width, Math.round((line.w + 2) * inv)),
    h: Math.min(frame.height, Math.round((line.h + 2) * inv)),
    vertical: line.vertical,
    ink: line.ink,
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
 * The lines of print in this mask.
 *
 * Marks are joined along ONE axis at a time, which is what separates a
 * line from a paragraph: characters in a column are stacked with their
 * centres in line, characters in a row sit side by side with theirs. The
 * two readings are worked out separately and then compete — a mark
 * belongs to the longest line that claims it — so a column of ten never
 * loses to some accidental pair running the other way.
 *
 * Joining one axis at a time also handles characters made of separate
 * strokes (い, り, 川): their parts sit side by side within the width of
 * one character, so a column swallows them all without a second thought.
 */
function linesOfText(mask: Uint8Array, w: number, h: number): DetectedLine[] {
  const maxSide = Math.max(w, h);
  const minChar = Math.max(5, maxSide * 0.011);
  const maxChar = maxSide * 0.17;
  const marks: Mark[] = [];
  for (const c of blobs(mask, mask, w, h)) {
    const size = Math.max(c.w, c.h);
    const thin = Math.max(1, Math.min(c.w, c.h));
    const fill = c.ink / (c.w * c.h);
    // A character is a compact mark of printed size. The tolerances are
    // wide on purpose: a stroke like the bar of 一 or a stem of 川 fills
    // its box almost solidly and is many times longer than it is thick,
    // and refusing those loses whole characters — which breaks the column
    // they stand in, because the gap left behind is what a line ends at.
    // Hatching is still excluded (far too long and thin), and screentone
    // (far too small), which is what these bounds are really for.
    if (size < minChar || size > maxChar) continue;
    if (size / thin > 8) continue;
    if (fill < 0.12) continue;
    marks.push({ x: c.x, y: c.y, w: c.w, h: c.h, ink: c.ink, size });
  }
  if (marks.length === 0) return [];

  const candidates = [...runsAlong(marks, true, w, maxChar), ...runsAlong(marks, false, w, maxChar)];
  // Longest first, so the real line wins the marks it shares with a
  // chance alignment crossing it.
  candidates.sort((a, b) => b.members.length - a.members.length || b.ink - a.ink);

  const taken = new Set<number>();
  const lines: DetectedLine[] = [];
  for (const run of candidates) {
    const free = run.members.filter((i) => !taken.has(i));
    if (free.length < run.members.length * 0.6) continue;
    const line = measure(free.map((i) => marks[i]), run.vertical, maxSide);
    if (!line) continue;
    for (const i of free) taken.add(i);
    lines.push(line);
  }
  return lines;
}

/** Every maximal run of marks joined along one axis. */
function runsAlong(
  marks: Mark[],
  vertical: boolean,
  w: number,
  maxChar: number,
): { members: number[]; vertical: boolean; ink: number }[] {
  const cell = Math.max(8, Math.round(maxChar));
  const cols = Math.ceil(w / cell) + 1;
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

  marks.forEach((a, i) => {
    const cx = Math.floor((a.x + a.w / 2) / cell);
    const cy = Math.floor((a.y + a.h / 2) / cell);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (const j of buckets.get(gy * cols + gx) ?? []) {
          if (j <= i) continue;
          if (!inLine(a, marks[j], vertical)) continue;
          const ra = find(i);
          const rb = find(j);
          if (ra !== rb) parent[rb] = ra;
        }
      }
    }
  });

  const groups = new Map<number, number[]>();
  marks.forEach((_, i) => {
    const root = find(i);
    const held = groups.get(root);
    if (held) held.push(i);
    else groups.set(root, [i]);
  });
  return [...groups.values()].map((members) => ({
    members,
    vertical,
    ink: members.reduce((sum, i) => sum + marks[i].ink, 0),
  }));
}

/** Do these two marks follow each other along one axis of a line? */
function inLine(a: Mark, b: Mark, vertical: boolean): boolean {
  const ratio = Math.max(a.size, b.size) / Math.max(1, Math.min(a.size, b.size));
  // Print sets a line in one size. Furigana beside a column is half the
  // size of the words it belongs to, and stays a line of its own.
  if (ratio > 2.2) return false;
  const reach = (a.size + b.size) / 2;
  const dx = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
  const dy = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
  // Along the line, the reach spans a little over two characters, so one
  // character the mark-finder happened to miss does not cut a column in
  // half. Across it, the tolerance stays tight: that is what keeps
  // neighbouring columns apart.
  return vertical ? dx <= reach * 0.55 && dy <= reach * 2.4 : dy <= reach * 0.55 && dx <= reach * 2.4;
}

/**
 * A run of marks as a line, if it looks like one.
 *
 * The test that earns its keep is thickness: a column of print is barely
 * wider than one character, however tall it grows. A run of marks that
 * happens to trend downwards through a drawing sprawls, and is refused
 * here — which is what stops a box swallowing half a panel.
 */
function measure(members: Mark[], vertical: boolean, maxSide: number): DetectedLine | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = 0;
  let y1 = 0;
  let ink = 0;
  const sizes: number[] = [];
  for (const m of members) {
    x0 = Math.min(x0, m.x);
    y0 = Math.min(y0, m.y);
    x1 = Math.max(x1, m.x + m.w);
    y1 = Math.max(y1, m.y + m.h);
    ink += m.ink;
    sizes.push(m.size);
  }
  sizes.sort((a, b) => a - b);
  const em = sizes[Math.floor(sizes.length / 2)];
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const across = vertical ? box.w : box.h;
  const along = vertical ? box.h : box.w;

  // One mark on its own is a speck — unless it is big, in which case it is
  // a lone kana in a small bubble, which is real text worth reading.
  if (members.length < 2 && em < maxSide * 0.025) return null;
  // A line is barely wider than its characters. Anything sprawling is a
  // trail through a drawing, not print.
  if (across > em * 2.0) return null;
  // And a line of several characters is longer than it is thick.
  if (members.length >= 3 && along < across * 1.2) return null;
  // Print covers a knowable share of its own box: much less is a couple of
  // specks that happen to line up, much more is a solid shape.
  const density = ink / Math.max(1, box.w * box.h);
  if (density < 0.12 || density > 0.72) return null;
  // A pair on its own is the easiest thing to find by accident, so a pair
  // has to look the part: two marks of the same size, and not tiny.
  if (members.length === 2) {
    const ratio = Math.max(members[0].size, members[1].size) / Math.max(1, Math.min(members[0].size, members[1].size));
    if (ratio > 1.7 || em < maxSide * 0.015) return null;
  }
  return { ...box, vertical, ink };
}

/** Does this line stand largely within lines already found? */
function insideAny(line: DetectedLine, held: DetectedLine[]): boolean {
  const area = Math.max(1, line.w * line.h);
  let covered = 0;
  for (const other of held) {
    const ox = Math.max(0, Math.min(other.x + other.w, line.x + line.w) - Math.max(other.x, line.x));
    const oy = Math.max(0, Math.min(other.y + other.h, line.y + line.h) - Math.max(other.y, line.y));
    covered += ox * oy;
  }
  return covered > area * 0.5;
}

/**
 * The same line found in both polarities (or twice over) counts once.
 * Overlap decides, not adjacency, so neighbouring columns of the same
 * bubble stay the separate lines they are.
 */
function dropDuplicates(lines: DetectedLine[]): DetectedLine[] {
  const kept: DetectedLine[] = [];
  for (const line of lines.slice().sort((a, b) => b.w * b.h - a.w * a.h)) {
    const area = line.w * line.h;
    const covered = kept.some((held) => {
      const ox = Math.max(0, Math.min(held.x + held.w, line.x + line.w) - Math.max(held.x, line.x));
      const oy = Math.max(0, Math.min(held.y + held.h, line.y + line.h) - Math.max(held.y, line.y));
      return ox * oy > area * 0.5;
    });
    if (!covered) kept.push(line);
  }
  return kept;
}

/**
 * Reading order, in place: lines gather into the bubbles they belong to,
 * bubbles run right to left and down the page the way manga is read, and
 * a bubble's own columns run right to left inside it. The order is what
 * the sentence around a tapped word is built from, so it is worth getting
 * right even though every line is tappable on its own.
 */
function ordered(lines: DetectedLine[]): void {
  const near = (a: DetectedLine, b: DetectedLine): boolean => {
    const gap = Math.max(a.vertical ? a.w : a.h, b.vertical ? b.w : b.h) * 1.6;
    const ox = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
    const oy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
    return ox < gap && oy < gap;
  };
  const group = new Int32Array(lines.length).map((_, i) => i);
  const find = (i: number): number => {
    while (group[i] !== i) i = group[i] = group[group[i]];
    return i;
  };
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[i].vertical === lines[j].vertical && near(lines[i], lines[j])) {
        const a = find(i);
        const b = find(j);
        if (a !== b) group[b] = a;
      }
    }
  }
  const bubbleOf = new Map<number, { right: number; top: number }>();
  lines.forEach((line, i) => {
    const root = find(i);
    const held = bubbleOf.get(root);
    if (held) {
      held.right = Math.max(held.right, line.x + line.w);
      held.top = Math.min(held.top, line.y);
    } else {
      bubbleOf.set(root, { right: line.x + line.w, top: line.y });
    }
  });
  const rank = new Map(lines.map((line, i) => [line, i]));
  lines.sort((a, b) => {
    const ba = bubbleOf.get(find(rank.get(a)!))!;
    const bb = bubbleOf.get(find(rank.get(b)!))!;
    if (ba !== bb) {
      // Right to left, but a bubble clearly higher up comes first.
      if (Math.abs(ba.top - bb.top) > 40 && Math.abs(ba.right - bb.right) < 60) return ba.top - bb.top;
      if (ba.right !== bb.right) return bb.right - ba.right;
      return ba.top - bb.top;
    }
    return a.vertical ? b.x + b.w - (a.x + a.w) : a.y - b.y;
  });
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
  image: AnyCanvas | Blob | string,
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
    void bookCloud()
      .then((books) => books?.publishOcr(shared.id, shared.page, words))
      .catch(() => undefined);
  };

  // Claude first: better print reading by far, and its boxes are this
  // device's own. A page it read and found no words on is finished — it is
  // artwork, and saying so once saves reading it again.
  //
  // Tesseract is for hosts with no key at all. It is emphatically NOT the
  // answer to a busy server: it would download fifteen megabytes of model
  // on a phone to do a worse job of a page that was only ever going to
  // need asking again, so a busy answer is passed up instead and the batch
  // waits.
  if (isCanvas(image)) {
    const viaClaude = await claudeOcr(image, onStatus);
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

/**
 * Forget everything this device has read of one book, here and in the
 * share. Returns how many pages were thrown away.
 *
 * The per-page Redo fixes a page that came out wrong; this is for when
 * the reader itself has improved and the whole book deserves another
 * pass — there is no point in a better OCR that only ever applies to
 * pages nobody has read yet.
 */
export async function clearBookOcr(bookId: string, sharedId?: string): Promise<number> {
  const { getMetaByPrefix, deleteMeta } = await import("./db.js");
  const prefix = `${CACHE_PREFIX}${bookId}:`;
  const held = await getMetaByPrefix(prefix).catch((): [string, unknown][] => []);
  const books = sharedId ? await bookCloud() : null;
  for (const [key] of held) {
    await deleteMeta(key).catch(() => undefined);
    const page = Number(key.slice(key.lastIndexOf(":") + 1));
    if (books && sharedId && Number.isFinite(page)) {
      await books.deleteSharedOcr(sharedId, page).catch(() => undefined);
    }
  }
  return held.length;
}

/** Forget a page's OCR, here and (permissions willing) in the share. */
export async function clearOcr(cacheKey: string, shared?: SharedOcrRef): Promise<void> {
  const { deleteMeta } = await import("./db.js");
  await deleteMeta(CACHE_PREFIX + cacheKey).catch(() => undefined);
  if (shared) {
    void bookCloud()
      .then((books) => books?.deleteSharedOcr(shared.id, shared.page))
      .catch(() => undefined);
  }
}
