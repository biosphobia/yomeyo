import { isJapaneseChar, lookup, openZip } from "@yomeyo/core";
import { activeDictionary } from "./store.js";
import { closePopup, showLookupPopup } from "./popup.js";
import { getBookFile, type BookInfo } from "./books.js";
import { getMeta, setMeta } from "./db.js";
import { cachedOcr, clearOcr, ocrPage, readRegion, saveOcr, type OcrWord, type SharedOcrRef } from "./ocr.js";
import { jobFor, onOcrJobs, pauseJob, restartJob, runJobs, startJob } from "./ocr-jobs.js";

/**
 * Reading one book, whatever it is made of.
 *
 * Text and EPUB render as tappable text — every character a span, exactly
 * like the paste Reader, so a tap looks the word up and offers to save it
 * with no extension anywhere in sight. PDFs render page by page with their
 * own text layer laid over the picture in place, so the words sit where
 * the page printed them. Pages with no text in them — manga, scans — go
 * through OCR instead, and the recognised words are overlaid at their
 * true positions, tappable like everything else.
 *
 * Zoom is everywhere: buttons, and pinch on anything with pages.
 */

interface Closeable {
  close: () => void;
}

const POS_PREFIX = "bookPos:";

// ---------------- the shared tap-to-look-up wiring ----------------

/**
 * One tap, one dictionary answer. `text` is the run the offset indexes
 * into; the popup offers the save, the same flow the paste Reader uses.
 */
async function lookUpAt(text: string, offset: number, status: HTMLElement | null): Promise<{ start: number; length: number } | null> {
  try {
    const dict = await activeDictionary();
    const matches = lookup(dict, text, offset);
    closePopup();
    if (matches.length === 0) {
      if (status) status.textContent = "No dictionary entry for that word.";
      return null;
    }
    if (status) status.textContent = "";
    const sentence = sentenceAround(text, offset);
    void showLookupPopup(matches, { sentence, source: "reader" });
    return { start: matches[0].start, length: matches[0].matchLength };
  } catch (err) {
    if (status) status.textContent = err instanceof Error ? err.message : "Could not load the dictionary.";
    return null;
  }
}

function sentenceAround(text: string, offset: number): string {
  const chars = [...text];
  const isBreak = (ch: string) => "。！？!?\n".includes(ch);
  let start = offset;
  while (start > 0 && !isBreak(chars[start - 1])) start--;
  let end = offset;
  while (end < chars.length && !isBreak(chars[end])) end++;
  if (end < chars.length) end++;
  return chars.slice(start, end).join("").trim();
}

/** Fill `view` with tappable text: every character a span, taps look up. */
function renderTappableText(view: HTMLElement, text: string, status: HTMLElement | null): void {
  view.innerHTML = "";
  const chars = [...text];
  const parts: string[] = [];
  chars.forEach((ch, i) => {
    if (ch === "\n") {
      parts.push("<br/>");
      return;
    }
    const safe = ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
    parts.push(`<span data-i="${i}"${isJapaneseChar(ch) ? ' class="jp-char"' : ""}>${safe}</span>`);
  });
  view.innerHTML = parts.join("");
  view.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    if (!target.dataset.i || !target.classList.contains("jp-char")) return;
    const offset = Number(target.dataset.i);
    void lookUpAt(text, offset, status).then((match) => {
      view.querySelectorAll(".hl").forEach((el) => el.classList.remove("hl"));
      if (!match) return;
      for (let i = match.start; i < match.start + match.length; i++) {
        view.querySelector(`[data-i="${i}"]`)?.classList.add("hl");
      }
    });
  });
}

/**
 * How wide to draw a page, given its shape.
 *
 * On a phone the answer is the panel's width: you read down the page and
 * scroll, which is how a phone reads anything. On a desktop there is
 * height to spare and no reason to make somebody scroll a picture at all,
 * so the page is drawn to whichever of width or height runs out first —
 * the whole page on screen, in one piece. Zoom multiplies whatever that
 * came to, and panning takes over from there.
 */
function pageWidthFor(stage: HTMLElement, aspect: number, zoom: number): number {
  const byWidth = stage.clientWidth || 640;
  if (window.innerWidth < 900) return Math.round(byWidth * zoom);
  const top = Math.max(0, stage.getBoundingClientRect().top);
  const room = Math.min(window.innerHeight, Math.max(360, window.innerHeight - top - 24));
  return Math.round(Math.min(byWidth, room * aspect) * zoom);
}

// ---------------- opening a book ----------------

export async function openBook(host: HTMLElement, book: BookInfo, onBack: () => void): Promise<Closeable> {
  host.innerHTML = `
    <div class="card-panel">
      <div class="bk-head">
        <button id="bk-back" class="ghost" aria-label="Back">‹</button>
        <b class="bk-title">${escapeHtml(book.name)}</b>
        <span class="glosses" id="bk-where"></span>
      </div>
      <div class="row-actions bk-controls" id="bk-controls"></div>
      <div class="msg" id="bk-status"></div>
      <div id="bk-body"></div>
    </div>
  `;
  host.querySelector("#bk-back")!.addEventListener("click", () => {
    closePopup();
    onBack();
  });
  const body = host.querySelector<HTMLDivElement>("#bk-body")!;
  const status = host.querySelector<HTMLDivElement>("#bk-status")!;
  const controls = host.querySelector<HTMLDivElement>("#bk-controls")!;
  const where = host.querySelector<HTMLSpanElement>("#bk-where")!;

  // Warm the dictionary while the file opens.
  void activeDictionary().catch(() => undefined);

  const blob = await getBookFile(book.id);
  if (!blob || blob.size === 0) {
    body.innerHTML = `<div class="msg error">The file for this book is not on this device.</div>`;
    return { close: () => undefined };
  }

  try {
    if (book.kind === "text") return await openText(await blob.text(), { body, status, controls, where, book });
    if (book.kind === "epub") return await openEpub(blob, { body, status, controls, where, book });
    if (book.kind === "pdf") return await openPdf(blob, { body, status, controls, where, book });
    return await openPictures(blob, { body, status, controls, where, book });
  } catch (err) {
    body.innerHTML = `<div class="msg error">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
    return { close: () => undefined };
  }
}

interface Ui {
  body: HTMLDivElement;
  status: HTMLDivElement;
  controls: HTMLDivElement;
  where: HTMLSpanElement;
  book: BookInfo;
}

// ---------------- plain text ----------------

async function openText(text: string, ui: Ui): Promise<Closeable> {
  ui.body.innerHTML = `<div class="reader-text bk-textview" lang="ja"></div>`;
  renderTappableText(ui.body.firstElementChild as HTMLElement, cleanText(text), ui.status);
  return { close: () => undefined };
}

/** Subtitle files and HTML both reduce to their lines. */
function cleanText(raw: string): string {
  let text = raw;
  if (/<[a-z][\s\S]*>/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    doc.querySelectorAll("rt, script, style").forEach((el) => el.remove());
    text = doc.body?.innerText ?? doc.body?.textContent ?? text;
  }
  // Subtitle timestamps add nothing to reading practice.
  text = text.replace(/^\d+\s*$/gm, "").replace(/^[\d:,.>\- ]+-->\s*[\d:,.]+.*$/gm, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------- EPUB ----------------

async function openEpub(blob: Blob, ui: Ui): Promise<Closeable> {
  const zip = await openZip(new Uint8Array(await blob.arrayBuffer()));
  const decoder = new TextDecoder("utf-8");
  const read = async (name: string): Promise<string> => decoder.decode(await zip.read(name));

  // The spine, in order, from the OPF; failing any of that, every HTML
  // entry in archive order still reads.
  let chapterFiles: string[] = [];
  try {
    const container = new DOMParser().parseFromString(await read("META-INF/container.xml"), "text/xml");
    const opfPath = container.querySelector("rootfile")?.getAttribute("full-path") ?? "";
    const opfDir = opfPath.replace(/[^/]*$/, "");
    const opf = new DOMParser().parseFromString(await read(opfPath), "text/xml");
    const hrefOf = new Map<string, string>();
    opf.querySelectorAll("manifest > item").forEach((item) => {
      hrefOf.set(item.getAttribute("id") ?? "", item.getAttribute("href") ?? "");
    });
    opf.querySelectorAll("spine > itemref").forEach((ref) => {
      const href = hrefOf.get(ref.getAttribute("idref") ?? "");
      if (href) chapterFiles.push(decodeURIComponent(opfDir + href));
    });
  } catch {
    /* fall through to the plain listing */
  }
  if (chapterFiles.length === 0) {
    chapterFiles = zip.entries.filter((e) => /\.x?html?$/i.test(e.name)).map((e) => e.name);
  }
  if (chapterFiles.length === 0) throw new Error("This EPUB has no readable chapters.");

  let chapter = Math.min((await getMeta<number>(POS_PREFIX + ui.book.id)) ?? 0, chapterFiles.length - 1);
  ui.body.innerHTML = `<div class="reader-text bk-textview" lang="ja"></div>`;
  const view = ui.body.firstElementChild as HTMLElement;

  const draw = async (): Promise<void> => {
    ui.where.textContent = `${chapter + 1} / ${chapterFiles.length}`;
    await setMeta(POS_PREFIX + ui.book.id, chapter);
    let text = "";
    try {
      const doc = new DOMParser().parseFromString(await read(chapterFiles[chapter]), "text/html");
      doc.querySelectorAll("rt, script, style").forEach((el) => el.remove());
      text = (doc.body?.innerText ?? doc.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
    } catch {
      text = "";
    }
    renderTappableText(view, text || "(this chapter has no text)", ui.status);
    view.scrollIntoView({ block: "start" });
  };

  pager(ui.controls, () => chapter, chapterFiles.length, (next) => {
    chapter = next;
    void draw();
  });
  await draw();
  return { close: () => undefined };
}

// ---------------- PDF ----------------

async function openPdf(blob: Blob, ui: Ui): Promise<Closeable> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;

  let page = Math.min((await getMeta<number>(POS_PREFIX + ui.book.id)) ?? 1, doc.numPages);
  page = Math.max(1, page);
  let zoom = 1;
  let closed = false;

  ui.body.innerHTML = `
    <div class="bk-stage" id="bk-stage">
      <div class="bk-page" id="bk-page">
        <canvas id="bk-canvas"></canvas>
        <div class="bk-text-layer" id="bk-text"></div>
        <div class="bk-ocr" id="bk-ocr"></div>
      </div>
    </div>
  `;
  const stage = ui.body.querySelector<HTMLDivElement>("#bk-stage")!;
  const pageBox = ui.body.querySelector<HTMLDivElement>("#bk-page")!;
  const canvas = ui.body.querySelector<HTMLCanvasElement>("#bk-canvas")!;
  const textLayer = ui.body.querySelector<HTMLDivElement>("#bk-text")!;
  const ocrLayer = ui.body.querySelector<HTMLDivElement>("#bk-ocr")!;

  const draw = async (): Promise<void> => {
    if (closed) return;
    ui.where.textContent = `${page} / ${doc.numPages}`;
    await setMeta(POS_PREFIX + ui.book.id, page);
    const pdfPage = await doc.getPage(page);
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = pageWidthFor(stage, base.width / base.height, zoom) / base.width;
    const viewport = pdfPage.getViewport({ scale });
    canvas.width = Math.round(viewport.width * devicePixelRatio);
    canvas.height = Math.round(viewport.height * devicePixelRatio);
    canvas.style.width = `${Math.round(viewport.width)}px`;
    canvas.style.height = `${Math.round(viewport.height)}px`;
    pageBox.style.width = `${Math.round(viewport.width)}px`;
    pageBox.style.height = `${Math.round(viewport.height)}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    await pdfPage.render({ canvasContext: ctx, viewport } as never).promise;

    // The page's own words, standing exactly where they were printed.
    const content = await pdfPage.getTextContent();
    textLayer.innerHTML = "";
    ocrLayer.innerHTML = "";
    let pageText = "";
    const spans: { el: HTMLSpanElement; start: number; str: string }[] = [];
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str) continue;
      const tx = (pdfjs as unknown as { Util: { transform: (a: number[], b: number[]) => number[] } }).Util.transform(
        viewport.transform,
        item.transform,
      );
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const el = document.createElement("span");
      el.textContent = item.str;
      el.style.left = `${tx[4]}px`;
      el.style.top = `${tx[5] - fontHeight}px`;
      el.style.fontSize = `${fontHeight}px`;
      el.dataset.start = String([...pageText].length);
      textLayer.appendChild(el);
      spans.push({ el, start: [...pageText].length, str: item.str });
      pageText += item.str + (item.str.endsWith("\n") ? "" : "");
    }

    const japaneseChars = [...pageText].filter((ch) => isJapaneseChar(ch)).length;
    textLayer.style.display = japaneseChars > 0 ? "" : "none";
    textLayer.onclick = (ev) => {
      const target = ev.target as HTMLSpanElement;
      if (!target.dataset.start) return;
      const rect = target.getBoundingClientRect();
      const chars = [...(target.textContent ?? "")];
      const within = Math.min(
        chars.length - 1,
        Math.max(0, Math.floor(((ev.clientX - rect.left) / Math.max(1, rect.width)) * chars.length)),
      );
      void lookUpAt(pageText, Number(target.dataset.start) + within, ui.status).then((match) => {
        textLayer.querySelectorAll(".hl").forEach((el) => el.classList.remove("hl"));
        if (match) target.classList.add("hl");
      });
    };

    // A page with nothing readable on it is a picture: manga, a scan. OCR
    // is offered rather than forced, because it takes a moment.
    if (japaneseChars < 4) {
      offerOcr(
        ui,
        ocrLayer,
        `${ui.book.id}:${page}`,
        () => canvas,
        { width: canvas.width, height: canvas.height },
        ui.book.sharedId ? { id: ui.book.sharedId, page } : undefined,
      );
    } else {
      const old = ui.controls.querySelector("#bk-ocr-btn");
      old?.remove();
    }
  };

  pager(ui.controls, () => page - 1, doc.numPages, (next) => {
    page = next + 1;
    void draw();
  });
  zoomControls(ui.controls, stage, pageBox, (next) => {
    zoom = next;
    void draw();
  });
  let stopWatching: (() => void) | null = null;
  if (doc.numPages > 1) {
    stopWatching = offerBatchOcr(ui, doc.numPages, () => void draw());
  }
  await draw();
  return {
    close: () => {
      closed = true;
      stopWatching?.();
      void doc.destroy();
    },
  };
}

// ---------------- pictures: CBZ and lone images ----------------

async function openPictures(blob: Blob, ui: Ui): Promise<Closeable> {
  // A CBZ is a zip of images in reading order; a lone image is one page.
  let pages: { name: string; bytes: () => Promise<Uint8Array> }[];
  if (ui.book.kind === "cbz") {
    const zip = await openZip(new Uint8Array(await blob.arrayBuffer()));
    pages = zip.entries
      .filter((entry) => /\.(png|jpe?g|webp|gif)$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((entry) => ({ name: entry.name, bytes: () => zip.read(entry.name) }));
    if (pages.length === 0) throw new Error("No images inside this archive.");
  } else {
    pages = [{ name: ui.book.name, bytes: async () => new Uint8Array(await blob.arrayBuffer()) }];
  }

  let page = Math.min((await getMeta<number>(POS_PREFIX + ui.book.id)) ?? 0, pages.length - 1);
  let zoom = 1;
  let url: string | null = null;

  ui.body.innerHTML = `
    <div class="bk-stage" id="bk-stage">
      <div class="bk-page" id="bk-page">
        <img id="bk-img" alt="" />
        <div class="bk-ocr" id="bk-ocr"></div>
      </div>
    </div>
  `;
  const stage = ui.body.querySelector<HTMLDivElement>("#bk-stage")!;
  const pageBox = ui.body.querySelector<HTMLDivElement>("#bk-page")!;
  const img = ui.body.querySelector<HTMLImageElement>("#bk-img")!;
  const ocrLayer = ui.body.querySelector<HTMLDivElement>("#bk-ocr")!;

  const draw = async (): Promise<void> => {
    ui.where.textContent = `${page + 1} / ${pages.length}`;
    await setMeta(POS_PREFIX + ui.book.id, page);
    ocrLayer.innerHTML = "";
    if (url) URL.revokeObjectURL(url);
    const bytes = await pages[page].bytes();
    url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]));
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url!;
    });
    const width = pageWidthFor(stage, (img.naturalWidth || 1) / (img.naturalHeight || 1), zoom);
    img.style.width = `${width}px`;
    pageBox.style.width = `${width}px`;
    pageBox.style.height = "auto";
    offerOcr(
      ui,
      ocrLayer,
      `${ui.book.id}:${page}`,
      () => img,
      { width: img.naturalWidth || 1, height: img.naturalHeight || 1 },
      ui.book.sharedId ? { id: ui.book.sharedId, page } : undefined,
    );
  };

  if (pages.length > 1) {
    pager(ui.controls, () => page, pages.length, (next) => {
      page = next;
      void draw();
    });
  }
  zoomControls(ui.controls, stage, pageBox, (next) => {
    zoom = next;
    void draw();
  });
  let stopWatching: (() => void) | null = null;
  if (pages.length > 1) {
    stopWatching = offerBatchOcr(ui, pages.length, () => void draw());
  }
  await draw();
  return {
    close: () => {
      stopWatching?.();
      if (url) URL.revokeObjectURL(url);
    },
  };
}

/**
 * A recognised line, opened as tappable text beside its box: every
 * character a span, exactly like the text reader, so the lookup starts
 * from the word actually touched.
 *
 * Dividing the box itself into one cell per character was tried and is
 * not honest enough: it holds only while the transcription has exactly as
 * many characters as the line does, and a misread or a stray mark slides
 * every word after it along. Reading the characters out here costs one
 * tap and is always right.
 */
function openOcrStrip(layer: HTMLDivElement, line: OcrWord, status: HTMLElement | null): void {
  layer.querySelector(".bk-ocr-strip")?.remove();
  const strip = document.createElement("div");
  strip.className = "bk-ocr-strip";
  // Beside the box when there is room, under it when there is not.
  const below = line.y + line.h < 0.85;
  strip.style.left = `${Math.min(78, line.x * 100).toFixed(2)}%`;
  strip.style.top = below ? `${((line.y + line.h) * 100).toFixed(2)}%` : "auto";
  if (!below) strip.style.bottom = `${((1 - line.y) * 100).toFixed(2)}%`;
  const close = document.createElement("button");
  close.className = "bk-strip-close";
  close.textContent = "✕";
  close.addEventListener("click", (ev) => {
    ev.stopPropagation();
    strip.remove();
  });
  const text = document.createElement("div");
  text.className = "bk-strip-text";
  text.lang = "ja";
  renderTappableText(text, line.text, status);
  strip.append(close, text);
  strip.addEventListener("click", (ev) => ev.stopPropagation());
  layer.appendChild(strip);
}

// ---------------- OCR overlay ----------------

/**
 * The button, and what it earns: the page read by OCR, each recognised
 * word overlaid at its true position and tappable like printed text.
 */
function offerOcr(
  ui: Ui,
  layer: HTMLDivElement,
  cacheKey: string,
  source: () => HTMLCanvasElement | HTMLImageElement,
  size: { width: number; height: number },
  shared?: SharedOcrRef,
): void {
  ui.controls.querySelector("#bk-ocr-btn")?.remove();
  ui.controls.querySelector("#bk-ocr-manage")?.remove();
  const button = document.createElement("button");
  button.id = "bk-ocr-btn";
  button.className = "secondary";
  button.textContent = "🔍 OCR page";
  ui.controls.appendChild(button);

  // The boxes are invisible by default so the page looks untouched; a
  // remembered toggle draws the outlines for anyone who wants to see
  // exactly what was recognised where.
  void getMeta<boolean>("ocrShowBoxes").then((held) => {
    layer.classList.toggle("show-boxes", held === true);
  });

  // Once a page has boxes, its OCR can be redone (a bad read replaced,
  // everywhere) or cleared outright.
  const showManage = (): void => {
    ui.controls.querySelector("#bk-ocr-manage")?.remove();
    const manage = document.createElement("div");
    manage.id = "bk-ocr-manage";
    manage.className = "row-actions bk-ocr-manage";
    manage.innerHTML = `
      <button class="secondary" id="bk-ocr-boxes"></button>
      <button class="secondary" id="bk-ocr-edit" title="Move, resize, remove or add boxes by hand">✎ Edit boxes</button>
      <button class="secondary" id="bk-ocr-redo" title="Read this page again, replacing its OCR">↻ Redo</button>
      <button class="secondary" id="bk-ocr-clear" title="Forget this page's OCR">✕ Clear</button>
    `;
    const editButton = manage.querySelector<HTMLButtonElement>("#bk-ocr-edit")!;
    editButton.addEventListener("click", () => {
      const on = !layer.classList.contains("editing");
      setEditing(on);
      editButton.textContent = on ? "✓ Done editing" : "✎ Edit boxes";
      editButton.classList.toggle("on", on);
    });
    const boxesButton = manage.querySelector<HTMLButtonElement>("#bk-ocr-boxes")!;
    boxesButton.title = "Show or hide the recognised boxes";
    const labelBoxes = (): void => {
      boxesButton.textContent = layer.classList.contains("show-boxes") ? "◼ Boxes" : "◻ Boxes";
    };
    labelBoxes();
    boxesButton.addEventListener("click", () => {
      const on = !layer.classList.contains("show-boxes");
      layer.classList.toggle("show-boxes", on);
      labelBoxes();
      void setMeta("ocrShowBoxes", on);
    });
    manage.querySelector("#bk-ocr-redo")!.addEventListener("click", () => void run(true));
    manage.querySelector("#bk-ocr-clear")!.addEventListener("click", () => {
      void clearOcr(cacheKey, shared).then(() => {
        layer.innerHTML = "";
        manage.remove();
        ui.controls.appendChild(button);
        button.disabled = false;
        button.textContent = "🔍 OCR page";
        ui.status.textContent = "OCR cleared for this page.";
      });
    });
    ui.controls.appendChild(manage);
  };

  /** The page's lines as they stand, which editing changes in place. */
  let lines: OcrWord[] = [];
  let editing = false;

  const place = (el: HTMLElement, line: OcrWord): void => {
    el.style.left = `${(line.x * 100).toFixed(2)}%`;
    el.style.top = `${(line.y * 100).toFixed(2)}%`;
    el.style.width = `${(line.w * 100).toFixed(2)}%`;
    el.style.height = `${(line.h * 100).toFixed(2)}%`;
  };

  const persist = (): void => {
    void saveOcr(cacheKey, lines, shared).catch(() => undefined);
  };

  /**
   * Dragging a box, or its corner.
   *
   * Everything is in fractions of the page, so a box dragged at one zoom
   * is in the same place at every other — and on the phone, where this is
   * most needed, a finger moves it exactly as far as it looks.
   */
  const grab = (ev: PointerEvent, line: OcrWord, el: HTMLElement, mode: "move" | "size"): void => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = layer.getBoundingClientRect();
    const fromX = ev.clientX;
    const fromY = ev.clientY;
    const was = { ...line };
    const onMove = (m: PointerEvent): void => {
      const dx = (m.clientX - fromX) / Math.max(1, rect.width);
      const dy = (m.clientY - fromY) / Math.max(1, rect.height);
      if (mode === "move") {
        line.x = Math.min(1 - line.w, Math.max(0, was.x + dx));
        line.y = Math.min(1 - line.h, Math.max(0, was.y + dy));
      } else {
        line.w = Math.min(1 - line.x, Math.max(0.008, was.w + dx));
        line.h = Math.min(1 - line.y, Math.max(0.008, was.h + dy));
      }
      place(el, line);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      persist();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const overlay = (next: OcrWord[], quiet = false): void => {
    lines = next;
    layer.innerHTML = "";
    layer.classList.toggle("editing", editing);
    // The page as one run of text, with a break between lines, so a tap
    // gets a sentence for its card rather than the whole page glued up.
    const pageText = lines.map((w) => w.text).join("\n");
    let offset = 0;
    for (const line of lines) {
      const start = offset;
      offset += [...line.text].length + 1; // the newline counts
      const el = document.createElement("span");
      el.className = "bk-ocr-word";
      place(el, line);
      el.title = line.text;

      if (editing) {
        // Drag the box to move it, its corner to resize it, its cross to
        // be rid of it. Nothing looks anything up while editing.
        const handle = document.createElement("b");
        handle.className = "bk-ocr-handle";
        handle.addEventListener("pointerdown", (ev) => grab(ev, line, el, "size"));
        const drop = document.createElement("button");
        drop.className = "bk-ocr-drop";
        drop.textContent = "✕";
        drop.title = "Remove this box";
        drop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        drop.addEventListener("click", (ev) => {
          ev.stopPropagation();
          overlay(lines.filter((held) => held !== line), true);
          persist();
        });
        el.addEventListener("pointerdown", (ev) => grab(ev, line, el, "move"));
        el.append(handle, drop);
      } else {
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          layer.querySelectorAll(".hl").forEach((e) => e.classList.remove("hl"));
          // A line of one or two characters is a word already; anything
          // longer opens beside its box as tappable text, so the finger
          // picks the exact word instead of the box guessing at one. The
          // characters there are the line's own, in order, which is the
          // only way to be sure a tap means what it looks like.
          if ([...line.text].length <= 2) {
            void lookUpAt(pageText, start, ui.status).then((match) => {
              if (match) el.classList.add("hl");
            });
          } else {
            el.classList.add("hl");
            openOcrStrip(layer, line, ui.status);
          }
        });
      }
      layer.appendChild(el);
    }
    if (!quiet) ui.status.textContent = lines.length === 0 ? "OCR found no Japanese on this page." : "";
  };

  /** The page's own pixels, for reading a hand-drawn box. */
  const sourceCanvas = (): HTMLCanvasElement => {
    const el = source();
    if (el instanceof HTMLCanvasElement) return el;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")!.drawImage(el, 0, 0, size.width, size.height);
    return canvas;
  };

  /**
   * Drawing a box by hand, for a line the detector never found. What is
   * inside it is read on release, and if there is nothing printed in
   * there the box is dropped rather than left empty on the page.
   */
  const drawNewBox = (ev: PointerEvent): void => {
    if (!editing || (ev.target as HTMLElement) !== layer) return;
    ev.preventDefault();
    const rect = layer.getBoundingClientRect();
    const fromX = (ev.clientX - rect.left) / Math.max(1, rect.width);
    const fromY = (ev.clientY - rect.top) / Math.max(1, rect.height);
    const box: OcrWord = { text: "", x: fromX, y: fromY, w: 0, h: 0 };
    const el = document.createElement("span");
    el.className = "bk-ocr-word drawing";
    layer.appendChild(el);
    const onMove = (m: PointerEvent): void => {
      const toX = (m.clientX - rect.left) / Math.max(1, rect.width);
      const toY = (m.clientY - rect.top) / Math.max(1, rect.height);
      box.x = Math.min(fromX, toX);
      box.y = Math.min(fromY, toY);
      box.w = Math.abs(toX - fromX);
      box.h = Math.abs(toY - fromY);
      place(el, box);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.remove();
      if (box.w < 0.01 || box.h < 0.01) return;
      box.vertical = box.h >= box.w;
      ui.status.textContent = "Reading that box…";
      void readRegion(sourceCanvas(), box)
        .then((text) => {
          if (!text) {
            ui.status.textContent = "Nothing readable in that box.";
            return;
          }
          box.text = text;
          overlay([...lines, box], true);
          persist();
          ui.status.textContent = `Added: ${text}`;
        })
        .catch((err) => {
          ui.status.textContent = err instanceof Error ? err.message : "That box could not be read.";
        });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  layer.addEventListener("pointerdown", drawNewBox);

  /** Turn editing on or off, and say what it is for. */
  const setEditing = (on: boolean): void => {
    editing = on;
    // Boxes have to be visible to be moved.
    if (on) layer.classList.add("show-boxes");
    overlay(lines, true);
    ui.status.textContent = on
      ? "Drag a box to move it, its corner to resize, ✕ to remove. Drag on empty space to add one."
      : "";
  };

  // One reader for both the button and the redo: a forced run ignores
  // every cache and replaces the page's result for everyone.
  const run = async (force: boolean): Promise<void> => {
    button.disabled = true;
    button.textContent = "Reading…";
    ui.status.textContent = force ? "Reading the page again…" : "Reading…";
    try {
      const el = source();
      const image =
        el instanceof HTMLCanvasElement
          ? el
          : await (async () => {
              // OCR the original pixels, not the shrunken layout size.
              const canvas = document.createElement("canvas");
              canvas.width = size.width;
              canvas.height = size.height;
              canvas.getContext("2d")!.drawImage(el, 0, 0, size.width, size.height);
              return canvas;
            })();
      const words = await ocrPage(
        image,
        cacheKey,
        { width: image.width, height: image.height },
        (line) => {
          ui.status.textContent = line;
        },
        shared,
        { force },
      );
      overlay(words);
      button.remove();
      showManage();
    } catch (err) {
      button.disabled = false;
      button.textContent = "🔍 OCR page";
      ui.status.textContent = err instanceof Error ? err.message : "OCR failed.";
    }
  };
  button.addEventListener("click", () => void run(false));

  // A page read before — on this device, or by anyone who read this
  // shared book — draws its words immediately, no button needed.
  void cachedOcr(cacheKey, shared).then((held) => {
    if (held) {
      overlay(held, true);
      button.remove();
      showManage();
    }
  });
}

/** What a whole-book OCR run needs to know about its pages. */
/**
 * The whole book, read in the background.
 *
 * This used to be a loop living inside the open book: leaving the page
 * ended it. It is a job now (see ocr-jobs.ts) — it keeps going while you
 * read something else, picks itself up when the app is opened again, and
 * carries on in the service worker after the tab is closed. All this
 * button does is start it, stop it, and show where it has got to.
 */
function offerBatchOcr(ui: Ui, total: number, refresh: () => void): () => void {
  ui.controls.querySelector("#bk-ocr-all")?.remove();
  ui.controls.querySelector("#bk-ocr-redo-all")?.remove();
  ui.controls.querySelector("#bk-ocr-progress")?.remove();
  const button = document.createElement("button");
  button.id = "bk-ocr-all";
  button.className = "secondary";
  button.textContent = "📚 OCR all";
  ui.controls.appendChild(button);

  // Re-reading the whole book, for when the reader itself has improved:
  // "OCR all" deliberately skips pages that are already read, so without
  // this there is no way to get a better pass onto the pages that matter.
  const redoAll = document.createElement("button");
  redoAll.id = "bk-ocr-redo-all";
  redoAll.className = "secondary";
  redoAll.textContent = "↻ Redo all";
  redoAll.title = "Throw away every page's OCR for this book and read it again";
  redoAll.addEventListener("click", () => {
    if (!confirm(`Read all ${total} pages of “${ui.book.name}” again from scratch? Everything read so far is discarded.`)) {
      return;
    }
    redoAll.disabled = true;
    void restartJob({ id: ui.book.id, name: ui.book.name, sharedId: ui.book.sharedId }, total)
      .then(() => {
        redoAll.disabled = false;
        refresh();
        void paint();
        void runJobs().catch(() => undefined);
      })
      .catch(() => {
        redoAll.disabled = false;
      });
  });
  ui.controls.appendChild(redoAll);

  const bar = document.createElement("div");
  bar.id = "bk-ocr-progress";
  bar.className = "bk-ocr-progress";
  bar.style.display = "none";
  bar.innerHTML = `<div class="bk-ocr-progress-fill"></div><span class="bk-ocr-progress-text"></span>`;
  ui.controls.insertAdjacentElement("afterend", bar);
  const fill = bar.querySelector<HTMLDivElement>(".bk-ocr-progress-fill")!;
  const text = bar.querySelector<HTMLSpanElement>(".bk-ocr-progress-text")!;

  let seen = -1;
  const paint = async (): Promise<void> => {
    const job = await jobFor(ui.book.id);
    if (!bar.isConnected) return;
    if (!job || job.state === "done") {
      bar.style.display = job?.state === "done" ? "" : "none";
      button.textContent = "📚 OCR all";
      if (job?.state === "done") {
        const missed = job.failed.length;
        fill.style.width = "100%";
        text.textContent = missed
          ? `Read ${job.done.length} of ${job.total} pages. ${missed} would not read${
              job.lastError ? `: ${job.lastError}` : ""
            } — run it again to retry those.`
          : `All ${job.total} pages read.`;
        // A page finished while this one was open deserves its boxes now.
        if (seen !== job.done.length) {
          seen = job.done.length;
          refresh();
        }
      }
      return;
    }
    bar.style.display = "";
    const percent = job.total > 0 ? Math.round((job.done.length / job.total) * 100) : 0;
    fill.style.width = `${percent}%`;
    const running = job.state === "running";
    const waiting = running && job.waitUntil !== undefined && job.waitUntil > Date.now();
    button.textContent = running ? "⏸ Pause OCR" : "▶ Resume OCR";
    text.textContent = waiting
      ? `${job.done.length} of ${job.total} read. ${job.lastError ?? "Waiting to carry on."}`
      : job.note
        ? job.note
        : running
          ? `Reading page ${Math.min(job.total, job.done.length + 1)} of ${job.total}. This keeps going if you leave.`
          : `Paused at ${job.done.length} of ${job.total}.`;
    if (seen !== job.done.length) {
      seen = job.done.length;
      refresh();
    }
  };

  button.addEventListener("click", () => {
    void (async () => {
      const job = await jobFor(ui.book.id);
      if (job && job.state === "running") {
        await pauseJob(ui.book.id);
      } else {
        await startJob({ id: ui.book.id, name: ui.book.name }, total);
        void runJobs().catch(() => undefined);
      }
      void paint();
    })();
  });

  // Progress can come from anywhere: this tab, another tab, or the worker
  // that carried on after this one was closed. Watch the record itself.
  const stopListening = onOcrJobs(() => void paint());
  const timer = window.setInterval(() => void paint(), 2000);
  void paint();
  return () => {
    stopListening();
    window.clearInterval(timer);
    redoAll.remove();
  };
}

function pager(controls: HTMLElement, current: () => number, total: number, go: (index: number) => void): void {
  const wrap = document.createElement("div");
  wrap.className = "row-actions bk-pager";
  wrap.innerHTML = `
    <button class="secondary" data-step="-1" title="Previous page" aria-label="Previous page">‹</button>
    <button class="secondary" data-step="1" title="Next page" aria-label="Next page">›</button>
  `;
  for (const button of wrap.querySelectorAll<HTMLButtonElement>("[data-step]")) {
    button.addEventListener("click", () => {
      closePopup();
      const next = current() + Number(button.dataset.step);
      if (next >= 0 && next < total) go(next);
    });
  }
  controls.appendChild(wrap);
}

/** Zoom: buttons, and pinch on the stage for the manga hand. */
function zoomControls(
  controls: HTMLElement,
  stage: HTMLDivElement,
  pageBox: HTMLDivElement,
  apply: (zoom: number) => void,
): void {
  let zoom = 1;
  const wrap = document.createElement("div");
  wrap.className = "row-actions bk-zoom";
  wrap.innerHTML = `
    <button class="secondary" data-z="out">−</button>
    <span class="glosses" id="bk-zoom-label">100%</span>
    <button class="secondary" data-z="in">＋</button>
    <button class="secondary" data-z="fit">fit</button>
  `;
  const label = wrap.querySelector<HTMLSpanElement>("#bk-zoom-label")!;
  const set = (next: number): void => {
    zoom = Math.min(4, Math.max(0.5, next));
    label.textContent = `${Math.round(zoom * 100)}%`;
    apply(zoom);
  };
  wrap.querySelector('[data-z="out"]')!.addEventListener("click", () => set(zoom / 1.25));
  wrap.querySelector('[data-z="in"]')!.addEventListener("click", () => set(zoom * 1.25));
  wrap.querySelector('[data-z="fit"]')!.addEventListener("click", () => set(1));
  controls.appendChild(wrap);

  // Pinch: live CSS scale while the fingers move, committed as a real
  // re-layout when they lift, so the page ends up crisp, not stretched.
  const touches = new Map<number, { x: number; y: number }>();
  let startSpan = 0;
  let liveScale = 1;
  stage.addEventListener("pointerdown", (ev) => {
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      startSpan = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  stage.addEventListener("pointermove", (ev) => {
    if (!touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size === 2 && startSpan > 0) {
      const [a, b] = [...touches.values()];
      liveScale = Math.hypot(a.x - b.x, a.y - b.y) / startSpan;
      pageBox.style.transformOrigin = "0 0";
      pageBox.style.transform = `scale(${liveScale})`;
      ev.preventDefault();
    }
  });
  const release = (ev: PointerEvent): void => {
    if (touches.delete(ev.pointerId) && touches.size < 2 && liveScale !== 1) {
      pageBox.style.transform = "";
      set(zoom * liveScale);
      liveScale = 1;
      startSpan = 0;
    }
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
