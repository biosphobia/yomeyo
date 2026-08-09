import { isJapaneseChar, lookup } from "@yomeyo/core";
import { screenHeader } from "./screen.js";
import { activeDictionary } from "./store.js";
import { closePopup, showLookupPopup } from "./popup.js";
import { SHARE_LIMIT_BYTES } from "./books.js";

/**
 * Reader page: paste (or share) Japanese text, tap any word to look it up
 * and save it. This is the primary mining flow on Android, where Chrome
 * has no extension support: select text on any page -> Share -> Yomeyo.
 */

const DEMO_TEXT =
  "昨日、面白い本を読んだ。日本語の勉強は難しいけど、毎日少しずつ新しい言葉を覚えている。" +
  "友達と話したり、映画を見たりすると、もっと楽しくなる。";

type ReaderTab = "paste" | "books" | "shared";
let readerTab: ReaderTab = "paste";
/** The book open right now, so a redraw returns to it. */
let openBookId: string | null = null;

export function renderReader(main: HTMLElement, sharedText?: string): void {
  if (sharedText) {
    readerTab = "paste";
    openBookId = null;
  }
  main.innerHTML = `
    ${screenHeader("Reading")}
    <div class="segmented" id="reader-tabs" ${openBookId ? 'style="display:none"' : ""}>
      <button data-tab="paste" class="${readerTab === "paste" ? "on" : ""}">Paste</button>
      <button data-tab="books" class="${readerTab === "books" ? "on" : ""}">My books</button>
      <button data-tab="shared" class="${readerTab === "shared" ? "on" : ""}">Shared</button>
    </div>
    <div id="reader-body"></div>
  `;
  for (const button of main.querySelectorAll<HTMLButtonElement>("#reader-tabs button")) {
    button.addEventListener("click", () => {
      readerTab = button.dataset.tab as ReaderTab;
      openBookId = null;
      renderReader(main);
    });
  }
  const bodyBox = main.querySelector<HTMLDivElement>("#reader-body")!;
  if (openBookId) {
    void openShelfBook(main, bodyBox, openBookId);
    return;
  }
  if (readerTab === "books") {
    void renderShelf(main, bodyBox);
    return;
  }
  if (readerTab === "shared") {
    void renderSharedShelf(main, bodyBox);
    return;
  }
  renderPaste(bodyBox, sharedText);
}

/** A book from the shelf, opened full-width in place of the tabs. */
async function openShelfBook(main: HTMLElement, body: HTMLElement, id: string): Promise<void> {
  const { listBooks } = await import("./books.js");
  const book = (await listBooks()).find((b) => b.id === id);
  if (!book) {
    openBookId = null;
    renderReader(main);
    return;
  }
  const { openBook } = await import("./book-view.js");
  await openBook(body, book, () => {
    openBookId = null;
    readerTab = "books";
    renderReader(main);
  });
}

// ---------------- my books ----------------

async function renderShelf(main: HTMLElement, body: HTMLElement): Promise<void> {
  const { listBooks, addBookFromFiles, forgetBook, publishBook, unpublishBook, unshareBook, renameBook, shelfAccount } =
    await import("./books.js");
  const books = await listBooks();
  const account = await shelfAccount();

  body.innerHTML = `
    <div class="card-panel">
      <b>Add something to read</b>
      <div class="glosses">PDF, EPUB, CBZ (manga), plain text, HTML, subtitles, or images.
        Select many page images at once and they become one book, ordered by filename.
        Pages the computer cannot read get OCR, so even manga is tappable.</div>
      <div class="row-actions" style="margin-top:10px">
        <button id="bk-upload">Upload files…</button>
        <input type="file" id="bk-file" style="display:none" multiple
          accept=".pdf,.epub,.cbz,.zip,.txt,.md,.html,.htm,.srt,.ass,.png,.jpg,.jpeg,.webp,.gif" />
      </div>
    </div>
    <div class="card-panel" style="padding:6px 14px" id="bk-list">
      ${books.length === 0 ? `<div class="empty-state"><div class="big">📖</div>Nothing on the shelf yet.</div>` : ""}
    </div>
  `;
  const fileInput = body.querySelector<HTMLInputElement>("#bk-file")!;
  body.querySelector("#bk-upload")!.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files ?? [])];
    if (files.length === 0) return;
    try {
      const book = await addBookFromFiles(files);
      openBookId = book.id;
      renderReader(main);
    } catch (err) {
      const status = document.createElement("div");
      status.className = "msg error";
      status.textContent = err instanceof Error ? err.message : String(err);
      body.prepend(status);
    }
  });

  const { allJobs } = await import("./ocr-jobs.js");
  const jobs = await allJobs();

  const list = body.querySelector<HTMLDivElement>("#bk-list")!;
  const KIND_ICON: Record<string, string> = { pdf: "📄", epub: "📕", cbz: "📚", image: "🖼", text: "📝" };
  for (const book of books) {
    const row = document.createElement("div");
    row.className = "word-row";
    row.innerHTML = `
      <div class="word">
        <div><b>${escapeHtml(book.name)}</b>${book.sharedId ? ` <span class="glosses">· shared</span>` : ""}</div>
        <div class="glosses">${KIND_ICON[book.kind] ?? "📄"} ${book.kind} · ${formatSize(book.size)}</div>
        ${ocrLine(jobs[book.id])}
        <div class="row-actions" style="margin-top:6px">
          <button class="bk-open">Read</button>
          <button class="secondary bk-rename">✎ Rename</button>
          ${shareButton(book, account)}
        </div>
      </div>
      <button class="ghost bk-remove" title="Remove">✕</button>
    `;
    row.querySelector(".bk-open")!.addEventListener("click", () => {
      openBookId = book.id;
      renderReader(main);
    });
    row.querySelector(".bk-rename")!.addEventListener("click", async () => {
      const name = prompt("New name for this book:", book.name)?.trim();
      if (!name || name === book.name) return;
      await renameBook(book.id, name.slice(0, 160));
      renderReader(main);
    });
    row.querySelector(".bk-share")?.addEventListener("click", async (ev) => {
      const button = ev.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "Sharing…";
      // Tens of megabytes over a phone's uplink takes minutes, so it says
      // how much has actually gone — a percentage alone, moving once per
      // block, reads as stuck — and there is a way to call it off.
      const signal = { stopped: false };
      const stop = document.createElement("button");
      stop.className = "ghost";
      stop.textContent = "Stop";
      stop.addEventListener("click", () => {
        signal.stopped = true;
        stop.disabled = true;
        button.textContent = "Stopping…";
      });
      button.after(stop);
      try {
        const { ensureProfile } = await import("./profile.js");
        const ownerName = (await ensureProfile()).name;
        await publishBook(
          account!,
          book,
          ownerName,
          (done, total, bytesSent) => {
            button.textContent = `Sharing ${formatSize(bytesSent)} of ${formatSize(book.size)} · ${Math.round(
              (done / total) * 100,
            )}%`;
          },
          signal,
        );
        renderReader(main);
      } catch (err) {
        stop.remove();
        button.disabled = false;
        button.textContent = "Share with everyone";
        const status = document.createElement("div");
        status.className = "msg error";
        status.textContent = err instanceof Error ? err.message : String(err);
        row.appendChild(status);
      }
    });
    row.querySelector(".bk-unshare")?.addEventListener("click", async (ev) => {
      if (!confirm(`Take “${book.name}” out of the shared library? Your own copy stays here.`)) return;
      const button = ev.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "Removing…";
      await unshareBook(book.id).catch(() => undefined);
      renderReader(main);
    });
    row.querySelector(".bk-remove")!.addEventListener("click", async () => {
      if (!confirm(`Remove “${book.name}” from this device?`)) return;
      if (book.sharedId && account && book.sharedId.startsWith(account.uid)) {
        if (confirm("Also take it out of the shared library?")) {
          const blocks = Math.ceil(book.size / 480000);
          await unpublishBook(book.sharedId, blocks).catch(() => undefined);
        }
      }
      await forgetBook(book.id);
      renderReader(main);
    });
    list.appendChild(row);
  }
}

/**
 * The share control for one book — always present, and honest when it
 * cannot be used.
 *
 * It used to be rendered only when every condition was met, which meant
 * the commonest case (a book over the size cap) showed nothing at all:
 * no button, no reason, nothing to act on. A control that explains itself
 * beats a control that disappears.
 */
function shareButton(book: { name: string; size: number; sharedId?: string }, account: unknown): string {
  if (book.sharedId) {
    return `<button class="secondary bk-unshare">Stop sharing</button>`;
  }
  if (!account) {
    return `<button class="secondary" disabled title="Sign in under Settings to share">Share (sign in first)</button>`;
  }
  if (book.size > SHARE_LIMIT_BYTES) {
    const cap = Math.round(SHARE_LIMIT_BYTES / 1024 / 1024);
    return `<button class="secondary" disabled title="This book is ${formatSize(book.size)}; the cap is ${cap}MB">
      Too big to share (${cap}MB cap)</button>`;
  }
  return `<button class="secondary bk-share">Share with everyone</button>`;
}

/** Where a book's whole-book OCR has got to, if it was ever started. */
function ocrLine(job: { done: unknown[]; total: number; state: string } | undefined): string {
  if (!job) return "";
  const done = job.done.length;
  if (job.state === "done") {
    return `<div class="glosses">🔍 read: ${done} of ${job.total} pages</div>`;
  }
  const percent = job.total > 0 ? Math.round((done / job.total) * 100) : 0;
  const label = job.state === "running" ? "reading" : "paused";
  return `<div class="glosses bk-row-ocr">🔍 ${label}: ${done} / ${job.total}
    <span class="bk-ocr-progress mini"><span class="bk-ocr-progress-fill" style="width:${percent}%"></span></span></div>`;
}

// ---------------- the shared shelf ----------------

async function renderSharedShelf(main: HTMLElement, body: HTMLElement): Promise<void> {
  body.innerHTML = `<div class="card-panel"><div class="msg">Loading the shared shelf…</div></div>`;
  try {
    const { browseBooks, downloadBook, listBooks } = await import("./books.js");
    const [shared, mine] = await Promise.all([browseBooks(), listBooks()]);
    const held = new Set(mine.map((book) => book.sharedId).filter(Boolean));
    if (shared.length === 0) {
      body.innerHTML = `<div class="card-panel"><div class="empty-state"><div class="big">📚</div>
        Nothing shared yet. Share a book from My books.</div></div>`;
      return;
    }
    body.innerHTML = `<div class="card-panel" style="padding:6px 14px" id="bk-shared"></div>`;
    const list = body.querySelector<HTMLDivElement>("#bk-shared")!;
    for (const book of shared) {
      const row = document.createElement("div");
      row.className = "word-row";
      row.innerHTML = `
        <div class="word">
          <div><b>${escapeHtml(book.name)}</b></div>
          <div class="glosses">${book.kind} · ${formatSize(book.size)}${
            book.ownerName ? ` · shared by ${escapeHtml(book.ownerName)}` : ""
          }</div>
        </div>
        <button class="add-btn${held.has(book.id) ? " secondary" : ""}">${held.has(book.id) ? "Added" : "Add"}</button>
      `;
      const button = row.querySelector<HTMLButtonElement>(".add-btn")!;
      button.disabled = held.has(book.id);
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Adding…";
        try {
          const local = await downloadBook(book);
          openBookId = local.id;
          renderReader(main);
        } catch (err) {
          button.disabled = false;
          button.textContent = "Add";
          const status = document.createElement("div");
          status.className = "msg error";
          status.textContent = err instanceof Error ? err.message : String(err);
          row.appendChild(status);
        }
      });
      list.appendChild(row);
    }
  } catch (err) {
    body.innerHTML = `<div class="card-panel"><div class="msg error">${escapeHtml(
      err instanceof Error ? err.message : String(err),
    )}</div>
    <div class="msg">The shared shelf needs cloud sync — Settings → Account.</div></div>`;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------- paste ----------------

function renderPaste(main: HTMLElement, sharedText?: string): void {
  main.innerHTML = `
    <div class="card-panel">
      <textarea id="reader-input" placeholder="ここに日本語のテキストを貼り付けてください…" lang="ja"></textarea>
      <div class="row-actions">
        <button id="reader-go">Read</button>
        <button id="reader-demo" class="secondary">Try demo text</button>
      </div>
    </div>
    <div class="msg" id="reader-status"></div>
    <div id="reader-view" class="card-panel reader-text" style="display:none" lang="ja"></div>
  `;

  const input = main.querySelector<HTMLTextAreaElement>("#reader-input")!;
  const view = main.querySelector<HTMLDivElement>("#reader-view")!;
  const goBtn = main.querySelector<HTMLButtonElement>("#reader-go")!;
  const demoBtn = main.querySelector<HTMLButtonElement>("#reader-demo")!;
  const status = main.querySelector<HTMLDivElement>("#reader-status")!;

  // Warm the dictionary as soon as the Reader opens, so it is usually ready
  // by the time the first word is tapped.
  void activeDictionary().catch(() => {
    /* reported when a lookup is attempted */
  });

  async function show(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Put the on-screen keyboard away. It covers the bottom half of the
    // screen, which is exactly where the lookup popup appears.
    input.blur();
    view.style.display = "";
    view.innerHTML = "";

    // Wrap every character in a span so taps map to exact text offsets.
    const chars = [...trimmed];
    chars.forEach((ch, i) => {
      if (ch === "\n") {
        view.appendChild(document.createElement("br"));
        return;
      }
      const span = document.createElement("span");
      span.textContent = ch;
      span.dataset.i = String(i);
      if (isJapaneseChar(ch)) span.className = "jp-char";
      view.appendChild(span);
    });

    // Start the dictionary download now, but do NOT wait for it before
    // listening for taps. Attaching the handler after the await silently
    // dropped every tap made while the dictionary was still loading — on a
    // phone that is a multi-second window in which the app looks dead.
    const dictionaryReady = activeDictionary();
    let ready = false;
    void dictionaryReady.then(
      () => {
        ready = true;
        status.textContent = "";
      },
      (err) => {
        status.textContent = err instanceof Error ? err.message : "Could not load the dictionary.";
        status.className = "msg error";
      },
    );
    status.textContent = "Loading dictionary…";
    status.className = "msg";

    view.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      if (!target.dataset.i || !target.classList.contains("jp-char")) return;
      const offset = Number(target.dataset.i);

      // A tap before the dictionary is ready is honoured once it arrives,
      // rather than thrown away.
      if (!ready) {
        status.textContent = "Loading dictionary…";
        status.className = "msg";
      }

      void dictionaryReady.then((dict) => {
        const matches = lookup(dict, trimmed, offset);
        closePopup();

        // Clear old highlight, highlight the best match's span range.
        view.querySelectorAll(".hl").forEach((el) => el.classList.remove("hl"));
        if (matches.length === 0) {
          status.textContent = "No dictionary entry for that word.";
          status.className = "msg";
          return;
        }
        status.textContent = "";
        // The word may well have started before the character tapped, so
        // highlight where the match actually begins.
        const { start, matchLength } = matches[0];
        for (let i = start; i < start + matchLength; i++) {
          view.querySelector(`[data-i="${i}"]`)?.classList.add("hl");
        }
        const sentence = extractSentence(trimmed, offset);
        void showLookupPopup(matches, { sentence, source: "reader" });
      });
    });
  }

  goBtn.addEventListener("click", () => void show(input.value));
  demoBtn.addEventListener("click", () => {
    input.value = DEMO_TEXT;
    void show(DEMO_TEXT);
  });

  if (sharedText) {
    input.value = sharedText;
    void show(sharedText);
  }
}

/** Pull out the sentence containing the tapped offset, for the card back. */
function extractSentence(text: string, offset: number): string {
  const chars = [...text];
  const isBreak = (ch: string) => "。！？!?\n".includes(ch);
  let start = offset;
  while (start > 0 && !isBreak(chars[start - 1])) start--;
  let end = offset;
  while (end < chars.length && !isBreak(chars[end])) end++;
  if (end < chars.length) end++; // include the punctuation
  return chars.slice(start, end).join("").trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
