import { isJapaneseChar, type DictEntry, type LookupMatch } from "@yomeyo/core";
import { ext, sendMessage, storageGet } from "./browser.js";

/**
 * Content script: tap-to-lookup on any page, Yomitan-style.
 *
 * Trigger, by device:
 *   Touch devices  a plain tap on a word (tap mode, on by default)
 *   Desktop        Alt/Option + click, so ordinary clicking still works
 *
 * Tap mode can be forced on or off from the toolbar popup. All UI lives in a
 * shadow root so page styles cannot bleed in or out.
 */

/** True on phones/tablets: coarse pointer and touch events available. */
const IS_TOUCH =
  typeof matchMedia === "function"
    ? matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0
    : navigator.maxTouchPoints > 0;

/** undefined = follow the device default (tap on touch, Alt+click on desktop). */
let tapModeSetting: boolean | undefined;

function tapModeActive(): boolean {
  return tapModeSetting ?? IS_TOUCH;
}

void storageGet<{ tapMode?: boolean | null }>("tapMode").then((data) => {
  if (typeof data?.tapMode === "boolean") tapModeSetting = data.tapMode;
});
ext.storage?.onChanged?.addListener((changes: any) => {
  if ("tapMode" in changes) {
    const value = changes.tapMode.newValue;
    tapModeSetting = typeof value === "boolean" ? value : undefined;
  }
});

// ---------- shadow-DOM popup ----------

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;

const POPUP_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .sheet {
    position: fixed;
    z-index: 2147483647;
    left: 0; right: 0; bottom: 0;
    margin: 0 auto;
    max-width: 560px;
    max-height: 55vh;
    display: flex;
    flex-direction: column;
    background: #1c1c2e;
    color: #eceaf4;
    border: 1px solid rgba(255,255,255,0.14);
    border-bottom: none;
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -6px 40px rgba(0,0,0,0.55);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
    font-size: 15px;
    line-height: 1.45;
    padding-bottom: env(safe-area-inset-bottom);
    animation: rise 140ms ease-out;
  }
  @keyframes rise { from { transform: translateY(12px); opacity: 0 } to { transform: none; opacity: 1 } }
  @media (min-width: 700px) {
    .sheet { left: auto; right: 16px; bottom: 16px; border-radius: 14px; border-bottom: 1px solid rgba(255,255,255,0.14); width: 420px; }
  }
  .grip {
    flex: none;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px 6px;
  }
  .grip .bar { width: 36px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.25); margin: 0 auto; }
  .grip .close {
    all: unset;
    width: 34px; height: 34px;
    display: grid; place-items: center;
    border-radius: 50%;
    color: #9a97b0; font-size: 20px; cursor: pointer;
    flex: none;
  }
  .grip .spacer { width: 34px; flex: none; }
  .list { overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 6px; }
  .entry {
    display: flex; gap: 12px; align-items: center;
    padding: 12px 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
  }
  .word { flex: 1; min-width: 0; }
  .term { font-size: 20px; font-weight: 700; }
  .reading { color: #a99df5; margin-left: 8px; font-size: 14px; }
  .reasons { color: #9a97b0; font-size: 12px; margin-top: 2px; }
  .glosses { margin-top: 4px; color: #eceaf4; overflow-wrap: anywhere; }
  .pos { color: #9a97b0; font-size: 11px; margin-top: 3px; }
  button.save {
    all: unset;
    background: #7c6cf0; color: #fff;
    min-width: 76px; min-height: 44px;
    padding: 0 16px;
    border-radius: 12px;
    text-align: center;
    font-size: 15px; font-weight: 600;
    cursor: pointer; flex: none;
    font-family: inherit;
    touch-action: manipulation;
  }
  button.save.saved { background: #4cc38a; }
  button.save[disabled] { opacity: 0.6; }
  .empty { padding: 14px; color: #9a97b0; }
`;

function closePopup(): void {
  host?.remove();
  host = null;
  shadow = null;
}

function ensureHost(): ShadowRoot {
  if (shadow) return shadow;
  host = document.createElement("div");
  host.id = "yomeyo-popup-host";
  // `all: initial` stops page styles leaking in; the rest takes the host out
  // of the page's layout entirely (an inline host would add a stray line box
  // to the document). The sheet inside is position: fixed, so it still
  // positions against the viewport — a fixed ancestor does not become its
  // containing block.
  host.style.cssText =
    "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
  shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = POPUP_CSS;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
  return shadow;
}

async function showPopup(matches: LookupMatch[], sentence: string): Promise<void> {
  closePopup();
  const root = ensureHost();

  const sheet = document.createElement("div");
  sheet.className = "sheet";

  const grip = document.createElement("div");
  grip.className = "grip";
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  const bar = document.createElement("div");
  bar.className = "bar";
  const close = document.createElement("button");
  close.className = "close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closePopup);
  grip.append(spacer, bar, close);
  sheet.appendChild(grip);

  const list = document.createElement("div");
  list.className = "list";
  sheet.appendChild(list);
  root.appendChild(sheet);

  // Taps inside the sheet must never reach the page or re-trigger lookup.
  for (const type of ["click", "pointerdown", "touchstart"]) {
    sheet.addEventListener(type, (ev) => ev.stopPropagation(), true);
  }

  let shown = 0;
  for (const match of matches.slice(0, 6)) {
    for (const entry of match.entries.slice(0, 2)) {
      list.appendChild(await buildEntryRow(match, entry, sentence));
      shown++;
    }
  }
  if (shown === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No dictionary entry found.";
    list.appendChild(empty);
  }

  const dismiss = (ev: Event) => {
    if (!host || ev.composedPath().includes(sheet)) return;
    closePopup();
    document.removeEventListener("pointerdown", dismiss, true);
  };
  setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
}

async function buildEntryRow(match: LookupMatch, entry: DictEntry, sentence: string): Promise<HTMLElement> {
  const row = document.createElement("div");
  row.className = "entry";

  const word = document.createElement("div");
  word.className = "word";

  const title = document.createElement("div");
  const term = document.createElement("span");
  term.className = "term";
  term.textContent = entry.term;
  title.appendChild(term);
  if (entry.reading && entry.reading !== entry.term) {
    const reading = document.createElement("span");
    reading.className = "reading";
    reading.textContent = entry.reading;
    title.appendChild(reading);
  }
  word.appendChild(title);

  if (match.reasons.length > 0) {
    const reasons = document.createElement("div");
    reasons.className = "reasons";
    reasons.textContent = `${match.matchedText} ← ${match.reasons.join(" ← ")}`;
    word.appendChild(reasons);
  }

  const glosses = document.createElement("div");
  glosses.className = "glosses";
  glosses.textContent = entry.glosses.join(" · ");
  word.appendChild(glosses);

  if (entry.pos.length > 0) {
    const pos = document.createElement("div");
    pos.className = "pos";
    pos.textContent = entry.pos.join(", ");
    word.appendChild(pos);
  }

  row.appendChild(word);

  const btn = document.createElement("button");
  btn.className = "save";
  const saved = await sendMessage<boolean>({
    type: "isSaved",
    term: entry.term,
    reading: entry.reading,
  });
  if (saved) {
    btn.textContent = "Saved";
    btn.classList.add("saved");
    btn.disabled = true;
  } else {
    btn.textContent = "+ Save";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await sendMessage({ type: "save", entry, sentence, url: location.href });
      btn.textContent = "Saved";
      btn.classList.add("saved");
    });
  }
  row.appendChild(btn);
  return row;
}

// ---------- resolving a tap into text ----------

interface TapText {
  text: string;
  offset: number;
  node: Text;
}

function textAtPoint(x: number, y: number): TapText | null {
  let node: Node | null = null;
  let offset = 0;

  const doc = document as any;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const textNode = node as Text;
  const content = textNode.data;
  if (content.length === 0) return null;
  // Caret positions sit between characters; when the caret lands after the
  // tapped character, step back so scanning starts on the character touched.
  if (offset >= content.length) offset = content.length - 1;
  if (offset < 0) return null;
  if (!isJapaneseChar(content[offset]) && offset > 0 && isJapaneseChar(content[offset - 1])) {
    offset -= 1;
  }
  if (!isJapaneseChar(content[offset])) return null;

  return { text: content, offset, node: textNode };
}

function sentenceAround(text: string, offset: number): string {
  const isBreak = (ch: string) => "。！？!?\n".includes(ch);
  let start = offset;
  while (start > 0 && !isBreak(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && !isBreak(text[end])) end++;
  if (end < text.length) end++;
  return text.slice(start, end).trim();
}

async function handleLookupAt(x: number, y: number): Promise<boolean> {
  const tap = textAtPoint(x, y);
  if (!tap) return false;

  const matches = await sendMessage<LookupMatch[]>({
    type: "lookup",
    text: tap.text,
    offset: tap.offset,
  });
  if (!matches || matches.length === 0) return false;

  // Highlight the matched run, Yomitan-style.
  try {
    const range = document.createRange();
    range.setStart(tap.node, tap.offset);
    range.setEnd(tap.node, Math.min(tap.offset + matches[0].matchLength, tap.node.data.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    /* the highlight is cosmetic */
  }

  await showPopup(matches, sentenceAround(tap.text, tap.offset));
  return true;
}

// ---------- input handling ----------

/**
 * On touch devices a tap fires pointerdown/up then click. Lookup runs on
 * `click` so that scrolling, pinch-zoom and link drags are unaffected: a
 * click only arrives when the finger did not travel.
 *
 * A tap that resolves to a word calls preventDefault so the page does not
 * also navigate — but only then, so taps on ordinary links still work.
 */
let lastTouchStart = { x: 0, y: 0, t: 0 };
let moved = false;

document.addEventListener(
  "touchstart",
  (ev) => {
    const touch = ev.touches[0];
    if (!touch) return;
    lastTouchStart = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    moved = false;
  },
  { capture: true, passive: true },
);

document.addEventListener(
  "touchmove",
  (ev) => {
    const touch = ev.touches[0];
    if (!touch) return;
    if (Math.hypot(touch.clientX - lastTouchStart.x, touch.clientY - lastTouchStart.y) > 10) {
      moved = true;
    }
  },
  { capture: true, passive: true },
);

document.addEventListener(
  "click",
  (ev) => {
    if (host && ev.composedPath().includes(host)) return;

    const wantsLookup = ev.altKey || tapModeActive();
    if (!wantsLookup) {
      closePopup();
      return;
    }
    // Ignore taps that were really scroll gestures or long presses meant
    // for text selection.
    if (moved || (lastTouchStart.t && Date.now() - lastTouchStart.t > 700)) {
      moved = false;
      return;
    }

    const x = ev.clientX;
    const y = ev.clientY;
    // Look up first; only swallow the event if a word was actually found,
    // so taps on links and buttons behave normally.
    const target = ev.target as HTMLElement | null;
    const interactive = target?.closest?.("a,button,input,textarea,select,[contenteditable]");

    void handleLookupAt(x, y).then((found) => {
      if (!found) closePopup();
    });

    if (interactive) {
      // A tap on a link that contains Japanese should show the definition
      // rather than navigate; the user can tap again to follow the link.
      ev.preventDefault();
      ev.stopPropagation();
    }
  },
  true,
);

ext.runtime.onMessage?.addListener((message: any, _sender: any, sendResponse: (r: any) => void) => {
  // The toolbar popup asks the page it is sitting over what will actually
  // happen here, rather than guessing the device from its own context.
  if (message?.type === "getTapState") {
    sendResponse({ active: tapModeActive(), isTouch: IS_TOUCH, explicit: tapModeSetting });
    return true;
  }
  if (message?.type === "lookupSelection") {
    const text = window.getSelection()?.toString() ?? "";
    if (text.trim()) {
      void sendMessage<LookupMatch[]>({ type: "lookup", text, offset: 0 }).then((matches) => {
        if (matches?.length) void showPopup(matches, text);
      });
    }
    sendResponse({ ok: true });
    return true;
  }
  return undefined;
});
