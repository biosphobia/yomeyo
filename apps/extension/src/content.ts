import { isJapaneseChar, type DictEntry, type LookupMatch } from "@yomeyo/core";

/**
 * Content script: tap-to-lookup on any page, Yomitan-style.
 *
 * Desktop: hold Alt (Option on macOS) and click a word.
 * Mobile (iOS Safari extension): enable "tap mode" from the toolbar popup,
 * then plain taps look words up. All UI lives in a closed shadow root so
 * page styles can't break it.
 */

declare const chrome: any;

let tapMode = false;

chrome.storage?.local.get("tapMode").then?.((data: any) => {
  tapMode = !!data?.tapMode;
});
chrome.storage?.onChanged?.addListener((changes: any) => {
  if ("tapMode" in changes) tapMode = !!changes.tapMode.newValue;
});

// ---------- shadow-DOM popup ----------

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;

const POPUP_CSS = `
  :host { all: initial; }
  .popup {
    position: fixed;
    z-index: 2147483647;
    left: 8px; right: 8px; bottom: 8px;
    max-width: 480px;
    margin: 0 auto;
    max-height: 45vh;
    overflow-y: auto;
    background: #1c1c2e;
    color: #eceaf4;
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
    font-size: 14px;
    line-height: 1.45;
  }
  .entry {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .entry:last-child { border-bottom: none; }
  .word { flex: 1; min-width: 0; }
  .term { font-size: 18px; font-weight: 700; }
  .reading { color: #a99df5; margin-left: 8px; font-size: 13px; }
  .reasons { color: #9a97b0; font-size: 11px; margin-top: 1px; }
  .glosses { margin-top: 3px; color: #eceaf4; overflow-wrap: anywhere; }
  .pos { color: #9a97b0; font-size: 10px; margin-top: 2px; }
  button {
    all: unset;
    background: #7c6cf0; color: #fff;
    padding: 7px 12px; border-radius: 9px;
    font-size: 13px; cursor: pointer; flex-shrink: 0;
    font-family: inherit;
  }
  button.saved { background: #4cc38a; }
  button:disabled { opacity: 0.5; }
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
  const popup = document.createElement("div");
  popup.className = "popup";

  for (const match of matches.slice(0, 6)) {
    for (const entry of match.entries.slice(0, 2)) {
      popup.appendChild(await buildEntryRow(match, entry, sentence));
    }
  }
  root.appendChild(popup);

  const dismiss = (ev: Event) => {
    if (ev.target !== host) {
      closePopup();
      document.removeEventListener("pointerdown", dismiss, true);
    }
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
  const saved = await sendMessage({ type: "isSaved", term: entry.term, reading: entry.reading });
  if (saved) {
    btn.textContent = "✓";
    btn.className = "saved";
    btn.disabled = true;
  } else {
    btn.textContent = "+ Save";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await sendMessage({ type: "save", entry, sentence, url: location.href });
      btn.textContent = "✓";
      btn.className = "saved";
    });
  }
  row.appendChild(btn);
  return row;
}

function sendMessage(message: unknown): Promise<any> {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// ---------- tap handling ----------

interface TapText {
  text: string;
  offset: number;
  node: Text;
  nodeOffset: number;
}

/** Resolve the character position under a point into (context text, offset). */
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
  // caret positions sit BETWEEN characters; when the caret lands after the
  // tapped char, step back so we scan from the char actually tapped.
  if (offset >= content.length) offset = content.length - 1;
  if (offset < 0) return null;
  if (!isJapaneseChar(content[offset]) && offset > 0 && isJapaneseChar(content[offset - 1])) {
    offset -= 1;
  }
  if (!isJapaneseChar(content[offset])) return null;

  return { text: content, offset, node: textNode, nodeOffset: offset };
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

async function handleLookupAt(x: number, y: number): Promise<void> {
  const tap = textAtPoint(x, y);
  if (!tap) return;

  const matches: LookupMatch[] = await sendMessage({
    type: "lookup",
    text: tap.text,
    offset: tap.offset,
  });
  if (!matches || matches.length === 0) return;

  // Highlight the matched run via the selection, Yomitan-style.
  try {
    const range = document.createRange();
    range.setStart(tap.node, tap.nodeOffset);
    range.setEnd(tap.node, Math.min(tap.nodeOffset + matches[0].matchLength, tap.node.data.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    // selection highlight is cosmetic
  }

  await showPopup(matches, sentenceAround(tap.text, tap.offset));
}

document.addEventListener(
  "click",
  (ev) => {
    if (host && ev.composedPath().includes(host)) return; // taps inside popup
    const trigger = ev.altKey || tapMode;
    if (!trigger) {
      closePopup();
      return;
    }
    void handleLookupAt(ev.clientX, ev.clientY);
  },
  true,
);
