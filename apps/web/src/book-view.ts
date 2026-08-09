import { isJapaneseChar, lookup, openZip } from "@yomeyo/core";
import { activeDictionary } from "./store.js";
import { closePopup, showLookupPopup } from "./popup.js";
import { getBookFile, type BookInfo } from "./books.js";
import { getMeta, setMeta } from "./db.js";
import { cachedOcr, clearOcr, ocrPage, type OcrWord, type SharedOcrRef } from "./ocr.js";

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
    const scale = ((stage.clientWidth || 640) / base.width) * zoom;
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
  if (doc.numPages > 1) {
    offerBatchOcr(ui, {
      total: doc.numPages,
      keyOf: (i) => `${ui.book.id}:${i + 1}`,
      sharedOf: (i) => (ui.book.sharedId ? { id: ui.book.sharedId, page: i + 1 } : undefined),
      // A page that already carries real text needs no OCR.
      needed: async (i) => {
        const pdfPage = await doc.getPage(i + 1);
        const content = await pdfPage.getTextContent();
        let japanese = 0;
        for (const item of content.items as { str: string }[]) {
          for (const ch of item.str ?? "") if (isJapaneseChar(ch)) japanese++;
        }
        return japanese < 4;
      },
      render: async (i) => {
        const pdfPage = await doc.getPage(i + 1);
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: 1300 / base.width });
        const off = document.createElement("canvas");
        off.width = Math.round(viewport.width);
        off.height = Math.round(viewport.height);
        await pdfPage.render({ canvasContext: off.getContext("2d")!, viewport } as never).promise;
        return off;
      },
      refresh: () => void draw(),
    });
  }
  await draw();
  return {
    close: () => {
      closed = true;
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
    const width = Math.round((stage.clientWidth || 640) * zoom);
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
  if (pages.length > 1) {
    offerBatchOcr(ui, {
      total: pages.length,
      keyOf: (i) => `${ui.book.id}:${i}`,
      sharedOf: (i) => (ui.book.sharedId ? { id: ui.book.sharedId, page: i } : undefined),
      render: async (i) => {
        const bytes = await pages[i].bytes();
        const pageUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]));
        try {
          const picture = new Image();
          await new Promise<void>((resolve, reject) => {
            picture.onload = () => resolve();
            picture.onerror = () => reject(new Error("unreadable image"));
            picture.src = pageUrl;
          });
          const off = document.createElement("canvas");
          off.width = picture.naturalWidth || 1;
          off.height = picture.naturalHeight || 1;
          off.getContext("2d")!.drawImage(picture, 0, 0);
          return off;
        } finally {
          URL.revokeObjectURL(pageUrl);
        }
      },
      refresh: () => void draw(),
    });
  }
  await draw();
  return {
    close: () => {
      if (url) URL.revokeObjectURL(url);
    },
  };
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
  button.textContent = "🔍 Read this page (OCR)";
  ui.controls.appendChild(button);

  // Once a page has boxes, its OCR can be redone (a bad read replaced,
  // everywhere) or cleared outright.
  const showManage = (): void => {
    ui.controls.querySelector("#bk-ocr-manage")?.remove();
    const manage = document.createElement("div");
    manage.id = "bk-ocr-manage";
    manage.className = "row-actions bk-ocr-manage";
    manage.innerHTML = `
      <button class="secondary" id="bk-ocr-redo">↻ Re-OCR page</button>
      <button class="secondary" id="bk-ocr-clear">✕ Clear OCR</button>
    `;
    manage.querySelector("#bk-ocr-redo")!.addEventListener("click", () => void run(true));
    manage.querySelector("#bk-ocr-clear")!.addEventListener("click", () => {
      void clearOcr(cacheKey, shared).then(() => {
        layer.innerHTML = "";
        manage.remove();
        ui.controls.appendChild(button);
        button.disabled = false;
        button.textContent = "🔍 Read this page (OCR)";
        ui.status.textContent = "OCR cleared for this page.";
      });
    });
    ui.controls.appendChild(manage);
  };

  const overlay = (words: OcrWord[], quiet = false): void => {
    layer.innerHTML = "";
    const pageText = words.map((w) => w.text).join("");
    let offset = 0;
    for (const word of words) {
      const start = offset;
      offset += [...word.text].length;
      const el = document.createElement("span");
      el.className = "bk-ocr-word";
      el.style.left = `${(word.x * 100).toFixed(2)}%`;
      el.style.top = `${(word.y * 100).toFixed(2)}%`;
      el.style.width = `${(word.w * 100).toFixed(2)}%`;
      el.style.height = `${(word.h * 100).toFixed(2)}%`;
      el.title = word.text;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        layer.querySelectorAll(".hl").forEach((e) => e.classList.remove("hl"));
        // A short block is one word: look it up straight away. A whole
        // bubble opens as tappable text beside its box, so the finger
        // picks the exact word rather than the popup guessing one.
        if ([...word.text].length <= 4) {
          void lookUpAt(pageText, start, ui.status).then((match) => {
            if (match) el.classList.add("hl");
          });
        } else {
          el.classList.add("hl");
          openOcrStrip(layer, word, ui.status);
        }
      });
      layer.appendChild(el);
    }
    if (!quiet) ui.status.textContent = words.length === 0 ? "OCR found no Japanese on this page." : "";
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
      button.textContent = "🔍 Read this page (OCR)";
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
interface BatchOcrSpec {
  /** How many pages, iterated 0..total-1. */
  total: number;
  keyOf: (page: number) => string;
  sharedOf: (page: number) => SharedOcrRef | undefined;
  /** Does this page even need OCR? Text PDF pages do not. */
  needed?: (page: number) => Promise<boolean>;
  /** The page's pixels, rendered offscreen at reading size. */
  render: (page: number) => Promise<HTMLCanvasElement>;
  /** Redraw the page on screen, so a fresh overlay appears at once. */
  refresh: () => void;
}

/**
 * One button that reads the whole book: every page not already read goes
 * through OCR in order, and the button becomes a stop while it runs.
 * Already-read pages cost nothing, so the run resumes wherever it left off.
 */
function offerBatchOcr(ui: Ui, spec: BatchOcrSpec): void {
  ui.controls.querySelector("#bk-ocr-all")?.remove();
  const button = document.createElement("button");
  button.id = "bk-ocr-all";
  button.className = "secondary";
  button.textContent = "📚 OCR all pages";
  ui.controls.appendChild(button);

  let running = false;
  button.addEventListener("click", () => {
    if (running) {
      running = false;
      button.textContent = "Stopping…";
      return;
    }
    running = true;
    void (async () => {
      let read = 0;
      let failed = 0;
      for (let page = 0; page < spec.total; page++) {
        if (!running) break;
        button.textContent = `⏹ Stop (${page + 1} / ${spec.total})`;
        const key = spec.keyOf(page);
        const shared = spec.sharedOf(page);
        try {
          if (await cachedOcr(key, shared)) continue;
          if (spec.needed && !(await spec.needed(page))) continue;
          ui.status.textContent = `Reading page ${page + 1} of ${spec.total}…`;
          const canvas = await spec.render(page);
          await ocrPage(canvas, key, { width: canvas.width, height: canvas.height }, undefined, shared);
          read++;
        } catch {
          failed++;
        }
      }
      const stopped = !running;
      running = false;
      button.textContent = "📚 OCR all pages";
      ui.status.textContent = stopped
        ? `Stopped. ${read} page${read === 1 ? "" : "s"} read this run.`
        : failed > 0
          ? `Done: ${read} read, ${failed} failed. Run again to retry the failed ones.`
          : read > 0
            ? `Done: every page is read. (${read} new)`
            : "Every page was already read.";
      spec.refresh();
    })();
  });
}

/**
 * A recognised bubble, opened as tappable text beside its box: every
 * character a span, exactly like the text reader, so the lookup starts
 * from the word actually touched.
 */
function openOcrStrip(layer: HTMLDivElement, word: OcrWord, status: HTMLElement | null): void {
  layer.querySelector(".bk-ocr-strip")?.remove();
  const strip = document.createElement("div");
  strip.className = "bk-ocr-strip";
  // Beside the box when there is room, under it when there is not.
  const below = word.y + word.h < 0.85;
  strip.style.left = `${Math.min(78, word.x * 100).toFixed(2)}%`;
  strip.style.top = below ? `${((word.y + word.h) * 100).toFixed(2)}%` : "auto";
  if (!below) strip.style.bottom = `${((1 - word.y) * 100).toFixed(2)}%`;
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
  renderTappableText(text, word.text, status);
  strip.append(close, text);
  strip.addEventListener("click", (ev) => ev.stopPropagation());
  layer.appendChild(strip);
}

// ---------------- shared controls ----------------

/** Prev / next page (or chapter), with the count kept in the header. */
function pager(controls: HTMLElement, current: () => number, total: number, go: (index: number) => void): void {
  const wrap = document.createElement("div");
  wrap.className = "row-actions bk-pager";
  wrap.innerHTML = `
    <button class="secondary" data-step="-1">‹ prev</button>
    <button class="secondary" data-step="1">next ›</button>
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
