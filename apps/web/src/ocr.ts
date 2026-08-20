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
  /**
   * The line's furigana, read separately from the ruby beside it. Kept
   * apart from `text` on purpose: mixed in, it would corrupt every
   * dictionary lookup on the line.
   */
  furigana?: string;
}

// Versioned: results from the old estimate-the-box pipeline are not worth
// keeping, so a prefix bump quietly retires them.
const CACHE_PREFIX = "bookOcr4:";
/** The revision this device holds of a page, for taking later corrections. */
const REV_PREFIX = "bookOcrRev:";
/** When the share was last asked about a page this device already holds. */
const SEEN_PREFIX = "bookOcrSeen:";
/** How long a held page trusts itself before glancing at the share again. */
const RECHECK_MS = 10 * 60 * 1000;

/** A page's result and its revision, cached together. */
async function stampLocal(cacheKey: string, words: OcrWord[], rev: number): Promise<void> {
  await setMeta(CACHE_PREFIX + cacheKey, words);
  await setMeta(REV_PREFIX + cacheKey, rev);
}

/** Only the entries a words array is supposed to contain. */
function cleanWords(value: unknown): OcrWord[] {
  if (!Array.isArray(value)) return [];
  return (value as OcrWord[]).filter(
    (w) => w && typeof w.text === "string" && w.text.trim() !== "" && Number.isFinite(w.x) && Number.isFinite(w.y),
  );
}

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
 *
 * A held page of a SHARED book still glances at the share now and then:
 * the book's owner can correct a page's text after this device cached
 * it, and a correction that only its author ever sees is not a
 * correction. The share's copy wins exactly when its revision is newer
 * than the one held here — including a copy with fewer boxes, since
 * removing a wrong box is as much a fix as retyping a line.
 */
export async function cachedOcr(cacheKey: string, shared?: SharedOcrRef): Promise<OcrWord[] | null> {
  const held = await getMeta<OcrWord[]>(CACHE_PREFIX + cacheKey);
  if (Array.isArray(held)) {
    if (!shared) return held;
    const lastLook = (await getMeta<number>(SEEN_PREFIX + cacheKey)) ?? 0;
    if (Date.now() - lastLook < RECHECK_MS) return held;
    await setMeta(SEEN_PREFIX + cacheKey, Date.now());
    const books = await bookCloud();
    if (!books) return held;
    const remote = await books.fetchSharedOcr(shared.id, shared.page).catch(() => null);
    if (!remote) return held;
    const heldRev = (await getMeta<number>(REV_PREFIX + cacheKey)) ?? 0;
    if (remote.rev <= heldRev) return held;
    const words = cleanWords(remote.words);
    await stampLocal(cacheKey, words, remote.rev);
    return words;
  }
  if (!shared) return null;
  const books = await bookCloud();
  if (!books) return null;
  const remote = await books.fetchSharedOcr(shared.id, shared.page);
  if (!remote) return null;
  const words = cleanWords(remote.words);
  if (words.length === 0) return null;
  await stampLocal(cacheKey, words, remote.rev);
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
  // Every rectangle of text on the page — the lines, and each line's
  // furigana — so a crop can paint out everything that is not its own.
  const rects: Room[] = [];
  for (const box of boxes) {
    rects.push(box);
    if (box.furi) rects.push(box.furi);
  }

  /**
   * One rectangle, cropped clean. Every OTHER piece of text that reaches
   * into the crop is painted out.
   *
   * Furigana sits a hair away from the column it belongs to, so even a
   * few pixels of margin catch it — and a crop holding two columns is
   * read as one, which is where 「ここ家が」 came back as 「ここ家がしえ」.
   * The neighbours go white and this rectangle's own pixels are then
   * drawn back on top, so nothing of its own is lost to the erasing.
   */
  const cropOf = async (rect: Room): Promise<string> => {
    const pad = 4;
    const x = Math.max(0, rect.x - pad);
    const y = Math.max(0, rect.y - pad);
    const cw = Math.min(frame.width - x, rect.w + pad * 2);
    const ch = Math.min(frame.height - y, rect.h + pad * 2);
    // Tiny crops read badly; double them so the strokes survive JPEG.
    const up = Math.max(cw, ch) < 120 ? 2 : 1;
    const crop = newCanvas(Math.max(1, cw * up), Math.max(1, ch * up));
    const ctx = context2d(crop);
    ctx.drawImage(frame as CanvasImageSource, x, y, cw, ch, 0, 0, crop.width, crop.height);
    ctx.fillStyle = "#ffffff";
    for (const other of rects) {
      if (other === rect) continue;
      const ox = Math.max(x, other.x);
      const oy = Math.max(y, other.y);
      const ow = Math.min(x + cw, other.x + other.w) - ox;
      const oh = Math.min(y + ch, other.y + other.h) - oy;
      if (ow <= 0 || oh <= 0) continue;
      ctx.fillRect((ox - x) * up, (oy - y) * up, ow * up, oh * up);
    }
    ctx.drawImage(
      frame as CanvasImageSource,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      (rect.x - x) * up,
      (rect.y - y) * up,
      rect.w * up,
      rect.h * up,
    );
    return jpegBase64(crop, 0.85);
  };

  // The lines first, then the furigana — each furigana crop remembering
  // whose reading it is. Every crop says which way it reads, so a
  // horizontal row is never announced to the model as a column.
  const images: string[] = [];
  const verticals: boolean[] = [];
  for (const box of boxes) {
    images.push(await cropOf(box));
    verticals.push(box.vertical);
  }
  const furiOwners: number[] = [];
  for (let at = 0; at < boxes.length; at++) {
    const furi = boxes[at].furi;
    if (!furi) continue;
    // The server takes eighty crops at most; a page that somehow needs
    // more keeps its lines and lets the last readings go.
    if (images.length >= 80) break;
    furiOwners.push(at);
    images.push(await cropOf(furi));
    verticals.push(boxes[at].vertical);
  }

  // Hundreds of pages in a row will meet a rate limit. Wait the time the
  // server asks for (or a growing guess), and only give up after several
  // tries — and then say it was busy, which is not the same as unreadable.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(assetUrl("grammar.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "ocr", images, media: "image/jpeg", vertical: verticals }),
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
  const perBox: (OcrWord | null)[] = boxes.map((box, at) => {
    const text = textOf.get(at + 1) ?? "";
    // Crops that were artwork after all come back empty and vanish here.
    if (!text || !hasJapanese(text)) return null;
    return {
      text,
      x: box.x / frame.width,
      y: box.y / frame.height,
      w: box.w / frame.width,
      h: box.h / frame.height,
      vertical: box.vertical,
    };
  });
  // The furigana crops came after the lines, in owner order; each reading
  // joins its own line rather than standing anywhere as text of its own.
  furiOwners.forEach((ownerAt, k) => {
    const reading = textOf.get(boxes.length + k + 1) ?? "";
    const word = perBox[ownerAt];
    if (word && reading && hasJapanese(reading)) word.furigana = reading;
  });
  return perBox.filter((word): word is OcrWord => word !== null);
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
  /** The line's furigana, when a ruby line was found standing beside it. */
  furi?: Room;
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

  // Speech balloons first, because manga hands us the answer.
  //
  // Guessing which marks are characters is a losing game on a drawn page:
  // hatching, screentone and panel furniture all look enough like print
  // from close up, and no threshold separates them everywhere. But a
  // balloon is not a guess. It is a closed island of white paper with a
  // line drawn round it, unmistakable at a glance, and whatever ink sits
  // inside one IS text — there is nothing else it could be. So the ink in
  // a balloon is grouped into lines with the shape tests relaxed (they
  // exist to keep drawings out, and there are no drawings in here), which
  // is what finds the odd single kana and the loose lettering that strict
  // rules were throwing away.
  const rooms = balloons(luma, w, h);
  const inRooms: DetectedLine[] = [];
  for (const room of rooms) inRooms.push(...linesOfText(dark, w, h, room));

  // Everything else — sound effects, captions, signs, text laid straight
  // on the drawing — still has to be guessed at, and keeps the strict
  // rules. Anything inside a balloon has already been read properly.
  const outside = linesOfText(dark, w, h).filter((line) => !inAnyRoom(line, rooms));
  const reversed = linesOfText(light, w, h).filter(
    (line) => !insideAny(line, inRooms) && !insideAny(line, outside),
  );
  const kept = pairFurigana(dropDuplicates([...inRooms, ...outside, ...reversed]));
  ordered(kept);

  const inv = 1 / s;
  const grow = (box: Room): Room => ({
    x: Math.max(0, Math.round((box.x - 1) * inv)),
    y: Math.max(0, Math.round((box.y - 1) * inv)),
    w: Math.min(frame.width, Math.round((box.w + 2) * inv)),
    h: Math.min(frame.height, Math.round((box.h + 2) * inv)),
  });
  return kept.slice(0, 60).map((line) => ({
    ...grow(line),
    vertical: line.vertical,
    ink: line.ink,
    ...(line.furi ? { furi: grow(line.furi) } : {}),
  }));
}

/**
 * Furigana, recognised as what it is and married to its line.
 *
 * A ruby is a line of half-size kana standing hard against the column it
 * explains — to its right in vertical text, above it in horizontal. Left
 * as a line of its own, it did two kinds of damage: its kana turned up in
 * the page's text as a stray "word" nobody printed, and any bleed into
 * the main line's crop corrupted the transcription. Recognised, it does
 * neither — it is removed from the lines and carried on its column as the
 * reading, transcribed from its own clean crop.
 *
 * The tests are all relative, so they hold at any page size: much thinner
 * than its base (real neighbouring columns are the same size and refuse
 * each other), standing just off the correct side, and running alongside
 * for at least half its own length.
 */
function pairFurigana(lines: DetectedLine[]): DetectedLine[] {
  const besides = (furi: DetectedLine, base: DetectedLine): number => {
    if (base.vertical) {
      if (furi.w > base.w * 0.72) return 0;
      const gap = furi.x - (base.x + base.w);
      if (gap < -furi.w * 0.6 || gap > base.w * 0.9) return 0;
      const along = Math.min(base.y + base.h, furi.y + furi.h) - Math.max(base.y, furi.y);
      return along >= Math.min(furi.h, base.h) * 0.5 ? along : 0;
    }
    if (furi.h > base.h * 0.72) return 0;
    const gap = base.y - (furi.y + furi.h);
    if (gap < -furi.h * 0.6 || gap > base.h * 0.9) return 0;
    const along = Math.min(base.x + base.w, furi.x + furi.w) - Math.max(base.x, furi.x);
    return along >= Math.min(furi.w, base.w) * 0.5 ? along : 0;
  };

  const owner = new Map<DetectedLine, DetectedLine>();
  for (const line of lines) {
    let best: DetectedLine | null = null;
    let bestAlong = 0;
    for (const base of lines) {
      if (base === line) continue;
      const along = besides(line, base);
      if (along > bestAlong) {
        bestAlong = along;
        best = base;
      }
    }
    if (best) owner.set(line, best);
  }
  // A ruby's base is a real line: anything claimed as furigana OF a
  // furigana was a false claim, and stays a line in its own right.
  for (const [line, base] of owner) {
    if (owner.has(base)) owner.delete(line);
  }

  for (const [line, base] of owner) {
    // Two runs of ruby along one column (one per word) join as their
    // union: a thin strip down the column's side, read top to bottom.
    const held = base.furi;
    base.furi = held
      ? {
          x: Math.min(held.x, line.x),
          y: Math.min(held.y, line.y),
          w: Math.max(held.x + held.w, line.x + line.w) - Math.min(held.x, line.x),
          h: Math.max(held.y + held.h, line.y + line.h) - Math.min(held.y, line.y),
        }
      : { x: line.x, y: line.y, w: line.w, h: line.h };
  }
  return lines.filter((line) => !owner.has(line));
}

/** A region of the page, in detection pixels. */
interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The speech balloons on this page.
 *
 * A balloon is an island of paper: bright, closed, and completely
 * surrounded by the drawing. That last part is what makes it findable
 * without any cleverness — the page's own white background is bright too,
 * but it runs off the edges, so anything bright that touches the border is
 * the page rather than a balloon. What remains is filtered to the size and
 * plumpness a balloon has: big enough to hold words, small enough not to
 * be a whole panel, and filling most of its own box (balloons are round;
 * the gaps between drawings are not).
 */
function balloons(luma: Uint8Array, w: number, h: number): Room[] {
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < luma.length; i++) paper[i] = luma[i] > 186 ? 1 : 0;

  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const rooms: Room[] = [];
  const pageArea = w * h;
  for (let start = 0; start < w * h; start++) {
    if (!paper[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    let area = 0;
    let touchesEdge = false;
    while (head < tail) {
      const p = queue[head++];
      const px = p % w;
      const py = (p / w) | 0;
      area++;
      if (px === 0 || py === 0 || px === w - 1 || py === h - 1) touchesEdge = true;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      if (px > 0 && paper[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        queue[tail++] = p - 1;
      }
      if (px < w - 1 && paper[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        queue[tail++] = p + 1;
      }
      if (py > 0 && paper[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        queue[tail++] = p - w;
      }
      if (py < h - 1 && paper[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        queue[tail++] = p + w;
      }
    }
    // The page itself, and the white gutters between panels, run off the
    // edge. A balloon never does.
    if (touchesEdge) continue;
    const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    if (area < pageArea * 0.0012 || area > pageArea * 0.12) continue;
    if (Math.min(box.w, box.h) < Math.max(w, h) * 0.03) continue;
    // A panel is also a closed island of paper, and letting one count as a
    // balloon would stand the strict rules down over half the page. A
    // balloon is a good deal smaller than the frame it sits in.
    if (box.w > w * 0.6 || box.h > h * 0.6) continue;
    // Round and solid, the way a balloon is: a jagged sliver of leftover
    // white between two drawings fills its own box far less completely.
    if (area < box.w * box.h * 0.55) continue;
    rooms.push(box);
  }
  return rooms;
}

/** Is this line standing inside one of the balloons? */
function inAnyRoom(line: DetectedLine, rooms: Room[]): boolean {
  const cx = line.x + line.w / 2;
  const cy = line.y + line.h / 2;
  return rooms.some((room) => cx >= room.x && cx <= room.x + room.w && cy >= room.y && cy <= room.y + room.h);
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
function linesOfText(mask: Uint8Array, w: number, h: number, room?: Room): DetectedLine[] {
  const maxSide = Math.max(w, h);
  const minChar = room ? Math.max(3, maxSide * 0.007) : Math.max(5, maxSide * 0.011);
  // Printed characters are small. Body text runs three to five percent of
  // a page and even a shouted sound effect rarely passes nine, so this was
  // far too generous at seventeen: it let window frames, hair and panel
  // furniture in as "characters", and two of those in a line is a box
  // straight through a drawing.
  const maxChar = maxSide * 0.09;
  const marks: Mark[] = [];
  for (const c of blobs(mask, mask, w, h)) {
    const size = Math.max(c.w, c.h);
    const thin = Math.max(1, Math.min(c.w, c.h));
    const fill = c.ink / (c.w * c.h);
    if (size < minChar || size > maxChar) continue;
    // Inside a balloon, only the balloon's own ink counts — and it is all
    // text, so the shape tests below stand down. Outside, they are the
    // only thing between a box and a lock of hair.
    if (room) {
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      if (cx < room.x || cx > room.x + room.w || cy < room.y || cy > room.y + room.h) continue;
      marks.push({ x: c.x, y: c.y, w: c.w, h: c.h, ink: c.ink, size });
      continue;
    }
    // Small marks are allowed to be strokes: the bar of 一 and the stems
    // of 川 are long, thin and nearly solid, and throwing them away costs
    // whole characters — and the column they stood in, since a line ends
    // at a gap. A BIG mark has no such excuse. Anything approaching the
    // size of a whole character has to be shaped like one: reasonably
    // compact, and not a filled-in slab.
    const big = size >= maxSide * 0.045;
    if (size / thin > (big ? 3.5 : 8)) continue;
    if (fill < 0.12 || (big && fill > 0.82)) continue;
    marks.push({ x: c.x, y: c.y, w: c.w, h: c.h, ink: c.ink, size });
  }
  if (marks.length === 0) return [];

  const whole = fuseParts(marks, maxChar);
  const candidates = [...runsAlong(whole, true, w, maxChar), ...runsAlong(whole, false, w, maxChar)];
  // Longest first, so the real line wins the marks it shares with a
  // chance alignment crossing it.
  candidates.sort((a, b) => b.members.length - a.members.length || b.ink - a.ink);

  const taken = new Set<number>();
  const lines: DetectedLine[] = [];
  for (const run of candidates) {
    const free = run.members.filter((i) => !taken.has(i));
    if (free.length < run.members.length * 0.6) continue;
    const line = measure(free.map((i) => whole[i]), run.vertical, maxSide, !!room);
    if (!line) continue;
    for (const i of free) taken.add(i);
    lines.push(line);
  }
  return lines;
}

/**
 * Put the pieces of a character back together.
 *
 * Plenty of characters are drawn as separate strokes — い, り, 川 — and a
 * character crossed by a hatched drawing behind it can come apart into a
 * couple of slivers as well. Left as pieces, a column of them reads as a
 * hairline (which is refused, rightly) or as a row of one-character lines
 * running the wrong way. Marks that touch, and that together are still no
 * bigger than one character, are therefore treated as one before any line
 * is drawn.
 *
 * The whole test is the size of the union, which is also why no separate
 * check on the gap between them is wanted: two pieces whose union is no
 * bigger than one character were near each other by definition, while two
 * characters side by side make a union twice the size of either and are
 * left alone.
 */
function fuseParts(marks: Mark[], maxChar: number): Mark[] {
  // Groups, merged a pair at a time — and the test is always applied to
  // what the merge WOULD produce, never to the two pieces alone. Checking
  // only the pair lets a chain form (this piece touches that one, which
  // touches the next) until a whole column has been swallowed into a
  // single "character", which is exactly as wrong as it sounds.
  interface Part {
    x: number;
    y: number;
    w: number;
    h: number;
    ink: number;
    /** The biggest single mark inside, which is what "one character" means. */
    largest: number;
    alive: boolean;
  }
  const parts: Part[] = marks.map((m) => ({
    x: m.x,
    y: m.y,
    w: m.w,
    h: m.h,
    ink: m.ink,
    largest: m.size,
    alive: true,
  }));

  for (let pass = 0; pass < 4; pass++) {
    let merged = false;
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i].alive) continue;
      for (let j = i + 1; j < parts.length; j++) {
        if (!parts[j].alive) continue;
        const a = parts[i];
        const b = parts[j];
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.max(a.x + a.w, b.x + b.w) - x;
        const h = Math.max(a.y + a.h, b.y + b.h) - y;
        const side = Math.max(w, h);
        const largest = Math.max(a.largest, b.largest);
        // One character's worth, and not appreciably more than the bigger
        // piece already was. Two characters side by side make a union
        // twice the size of either, and are left where they are.
        if (side > maxChar || side > largest * 1.35) continue;
        parts[i] = { x, y, w, h, ink: a.ink + b.ink, largest, alive: true };
        parts[j].alive = false;
        merged = true;
      }
    }
    if (!merged) break;
  }

  return parts
    .filter((p) => p.alive)
    .map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, ink: p.ink, size: Math.max(p.w, p.h) }));
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
function measure(members: Mark[], vertical: boolean, maxSide: number, inRoom = false): DetectedLine | null {
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

  // A line is barely wider than its characters. Anything sprawling is a
  // trail through a drawing, not print. (In a balloon it is a little more
  // generous: the whole thing is text, and a line of mixed sizes there is
  // still a line.)
  if (across > em * (inRoom ? 2.4 : 1.7)) return null;
  // And a line of several characters is longer than it is thick.
  if (members.length >= 3 && along < across * 1.2) return null;
  // A column is about as thick as the characters standing in it. A line
  // far thinner than that is a stroke, or a run of strokes belonging to
  // characters that merged with the drawing behind them — a sliver, not a
  // column, and a box on it is worse than no box.
  if (!inRoom && across < em * 0.45) return null;
  // Print covers a knowable share of its own box: much less is a couple of
  // specks that happen to line up, much more is a solid shape.
  const density = ink / Math.max(1, box.w * box.h);
  if (!inRoom && (density < 0.12 || density > 0.72)) return null;

  // Everything below is about keeping drawings out, which is not a
  // question that arises inside a balloon.
  if (inRoom) return { ...box, vertical: readsDown(box, vertical), ink };

  // The short runs are where false lines come from, so they have to earn
  // it. Two marks must be the same size as each other and of ordinary
  // printed size; one mark on its own must additionally be square, which
  // is what a lone kana in a small bubble looks like and what a fragment
  // of a drawing generally does not.
  if (members.length <= 2 && em > maxSide * 0.07) return null;
  if (members.length === 2) {
    const ratio = Math.max(members[0].size, members[1].size) / Math.max(1, Math.min(members[0].size, members[1].size));
    if (ratio > 1.6) return null;
  }
  if (members.length === 1) {
    // A lone kana in a small bubble is worth having, and it looks like
    // this: printed size, and about as tall as it is wide. Density is
    // left to the general band above — a boxy character like 回 fills
    // most of its square, and refusing those loses real text.
    const only = members[0];
    const squareness = Math.max(only.w, only.h) / Math.max(1, Math.min(only.w, only.h));
    if (em < maxSide * 0.025 || squareness > 1.6) return null;
  }
  return { ...box, vertical: readsDown(box, vertical), ink };
}

/**
 * Which way a line reads, decided by the shape of the box the model will
 * actually be shown rather than by which axis its marks were joined on.
 *
 * A crop that is plainly tall is read downwards and a plainly wide one
 * across, whatever the grouping thought — telling the model otherwise
 * invites it to read a column as a row and hand back a jumble. Only a
 * near-square box, which is one character and reads the same either way,
 * falls back to how it was found.
 */
function readsDown(box: { w: number; h: number }, joinedVertically: boolean): boolean {
  if (box.h >= box.w * 1.15) return true;
  if (box.w >= box.h * 1.15) return false;
  return joinedVertically;
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

  /** A fresh result also joins the shared book, for everyone after — under
   * the same revision cached here, so this device never mistakes its own
   * contribution for somebody's later correction. */
  const contribute = (words: OcrWord[], rev: number): void => {
    if (!shared || words.length === 0) return;
    void bookCloud()
      .then((books) => books?.publishOcr(shared.id, shared.page, words, rev))
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
      const rev = Date.now();
      await stampLocal(cacheKey, viaClaude, rev);
      contribute(viaClaude, rev);
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
  const rev = Date.now();
  await stampLocal(cacheKey, words, rev);
  contribute(words, rev);
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
    const cacheKey = key.slice(CACHE_PREFIX.length);
    await deleteMeta(REV_PREFIX + cacheKey).catch(() => undefined);
    await deleteMeta(SEEN_PREFIX + cacheKey).catch(() => undefined);
    const page = Number(key.slice(key.lastIndexOf(":") + 1));
    if (books && sharedId && Number.isFinite(page)) {
      await books.deleteSharedOcr(sharedId, page).catch(() => undefined);
    }
  }
  return held.length;
}

/**
 * Write a page's boxes back, here and in the share.
 *
 * Detection gets a page nearly right and occasionally not, and the reader
 * looking at it can see exactly what is wrong — so they are allowed to
 * move a box, resize it, throw it away or draw a new one, and what they
 * settle on is what everybody downstream gets.
 */
export async function saveOcr(cacheKey: string, words: OcrWord[], shared?: SharedOcrRef): Promise<void> {
  const rev = Date.now();
  await stampLocal(cacheKey, words, rev);
  if (!shared) return;
  const books = await bookCloud();
  await books?.publishOcr(shared.id, shared.page, words, rev).catch(() => false);
}

/**
 * Read one region of a page, given as fractions of it: what a hand-drawn
 * box asks for. Comes back as the line's text, or empty if there is
 * nothing printed in there.
 */
export async function readRegion(
  canvas: AnyCanvas,
  box: { x: number; y: number; w: number; h: number },
): Promise<string> {
  if (!(await claudeAvailable())) throw new Error("Reading needs the server, which is not set up here.");
  const pad = 4;
  const x = Math.max(0, Math.round(box.x * canvas.width) - pad);
  const y = Math.max(0, Math.round(box.y * canvas.height) - pad);
  const w = Math.min(canvas.width - x, Math.round(box.w * canvas.width) + pad * 2);
  const h = Math.min(canvas.height - y, Math.round(box.h * canvas.height) + pad * 2);
  if (w < 4 || h < 4) return "";
  const up = Math.max(w, h) < 120 ? 2 : 1;
  const crop = newCanvas(Math.max(1, w * up), Math.max(1, h * up));
  context2d(crop).drawImage(canvas as CanvasImageSource, x, y, w, h, 0, 0, crop.width, crop.height);
  const image = await jpegBase64(crop, 0.85);

  const res = await fetch(assetUrl("grammar.php"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "ocr", images: [image], media: "image/jpeg", vertical: [h >= w] }),
  });
  if (!res.ok) throw new OcrBusyError("The reading service is busy.");
  const { raw } = (await res.json()) as { raw?: string };
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { blocks?: { text?: unknown }[] };
    const text = typeof parsed.blocks?.[0]?.text === "string" ? parsed.blocks[0].text.trim() : "";
    return hasJapanese(text) ? text : "";
  } catch {
    return "";
  }
}

/** Forget a page's OCR, here and (permissions willing) in the share. */
export async function clearOcr(cacheKey: string, shared?: SharedOcrRef): Promise<void> {
  const { deleteMeta } = await import("./db.js");
  await deleteMeta(CACHE_PREFIX + cacheKey).catch(() => undefined);
  await deleteMeta(REV_PREFIX + cacheKey).catch(() => undefined);
  await deleteMeta(SEEN_PREFIX + cacheKey).catch(() => undefined);
  if (shared) {
    void bookCloud()
      .then((books) => books?.deleteSharedOcr(shared.id, shared.page))
      .catch(() => undefined);
  }
}
