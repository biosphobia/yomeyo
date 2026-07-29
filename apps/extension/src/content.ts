import { isJapaneseChar, onTap, type DictEntry, type LookupMatch } from "@yomeyo/core";
import { ext, sendMessage, storageGet } from "./browser.js";
import { handOverViaFrame } from "./frame-handoff.js";

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

// ---------- handing saved words to the app ----------

/**
 * True once this page has been recognised as the Yomeyo app itself.
 *
 * The app does its own lookups, so the extension's sheet must stay out of
 * the way there — two popups for one tap is worse than either.
 */
let isAppPage = false;

/**
 * Is this page the app the user configured?
 *
 * The check is against the app URL in the extension's own settings, not
 * against anything the page says about itself: a page claiming to be Yomeyo
 * would otherwise be handed the user's saved words.
 */
function pageIsApp(appUrl: string): boolean {
  try {
    const base = new URL(appUrl);
    if (location.origin !== base.origin) return false;
    const dir = base.pathname.replace(/[^/]*$/, ""); // drop any index.html
    return location.pathname.startsWith(dir);
  } catch {
    return false;
  }
}

/**
 * Give the app the words saved here, as soon as it is open.
 *
 * The alternative was the "Send to app" button in the toolbar popup, which
 * on Chrome for Android is buried deep enough that saved words did not, in
 * practice, ever reach the app.
 */
/**
 * Fetch on the app's behalf.
 *
 * Audio services written for Yomitan and Anki refuse web pages, so the app
 * cannot reach them itself. This listener is registered on every page rather
 * than only the app's own, so it works regardless of how the app URL happens
 * to be configured; the reply carries only what was asked for.
 */
window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const data: any = ev.data;
  if (data?.source !== "yomeyo-app" || data.type !== "fetch") return;
  if (typeof data.url !== "string" || typeof data.id !== "string") return;

  // Say we are on it, so the page knows an extension exists and can stop
  // waiting on its short "is anyone there" deadline.
  window.postMessage({ source: "yomeyo-extension", type: "fetching", id: data.id }, location.origin);

  void sendMessage<{ base64?: string; contentType?: string; error?: string }>({
    type: "fetchForApp",
    url: data.url,
  })
    .catch(() => ({ error: "the extension could not be reached" }))
    .then((res) => {
      window.postMessage(
        {
          source: "yomeyo-extension",
          type: "fetched",
          id: data.id,
          base64: res?.base64 ?? "",
          contentType: res?.contentType ?? "",
          error: res?.error ?? "",
        },
        location.origin,
      );
    });
});

/** Set on the app's own pages, so the background can push new words here. */
let offerToApp: (() => Promise<void>) | null = null;

async function offerSavedWordsToApp(appUrl: string): Promise<void> {
  if (!pageIsApp(appUrl)) return;
  isAppPage = true;
  removeHost();

  // Say hello whether or not there is anything to hand over, so the app can
  // tell "no extension here" apart from "an extension that saved nothing" —
  // otherwise an old build that cannot transfer looks exactly like a working
  // one with an empty deck.
  const greet = (): void => {
    window.postMessage(
      {
        source: "yomeyo-extension",
        type: "hello",
        version: ext.runtime?.getManifest?.().version ?? null,
      },
      location.origin,
    );
  };

  const offer = async (): Promise<void> => {
    greet();
    const cards = await sendMessage<any[]>({ type: "pendingForApp" }).catch(() => null);
    if (!cards?.length) return;
    window.postMessage({ source: "yomeyo-extension", type: "cards", cards }, location.origin);
  };
  offerToApp = offer;

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const data: any = ev.data;
    if (data?.source !== "yomeyo-app") return;
    // The app finished loading after this script did, and is asking.
    if (data.type === "ready") void offer();
    // The app has these words now; stop offering them.
    if (data.type === "imported") void sendMessage({ type: "handedOff", ids: data.ids });
    // The secret that lets words be delivered from other pages later.
    if (data.type === "token" && typeof data.token === "string") {
      void sendMessage({ type: "setHandoverToken", token: data.token });
    }

  });

  // Coming back to an app tab that was already open — from another tab, from
  // the background, or out of the back/forward cache — is the other moment
  // words might be waiting, and no message would otherwise arrive.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void offer();
  });
  window.addEventListener("pageshow", () => void offer());

  await offer();
}

/** undefined = follow the device default (tap on touch, Alt+click on desktop). */
let tapModeSetting: boolean | undefined;
/** Whether the small on-page toggle is shown at all. */
let showToggle = true;

function tapModeActive(): boolean {
  if (isAppPage) return false; // the app has its own lookup UI
  return tapModeSetting ?? IS_TOUCH;
}

void storageGet<{ tapMode?: boolean | null; showToggle?: boolean }>(["tapMode", "showToggle"]).then(
  (data) => {
    if (typeof data?.tapMode === "boolean") tapModeSetting = data.tapMode;
    if (typeof data?.showToggle === "boolean") showToggle = data.showToggle;
    renderToggle();
    // Start the dictionary as soon as the page is up. The background is a
    // service worker and is torn down whenever it goes idle, so on a freshly
    // loaded page it would otherwise begin loading only on the tap the user
    // is waiting for — and that wait is the whole delay they see.
    if (tapModeActive()) void sendMessage({ type: "warm" }).catch(() => {});
  },
);

void sendMessage<{ settings?: { appUrl?: string } }>({ type: "getSettings" })
  .then((data) => {
    const appUrl = data?.settings?.appUrl?.trim();
    if (appUrl) return offerSavedWordsToApp(appUrl);
    return undefined;
  })
  .catch(() => {
    /* nothing to hand over if the background is unreachable */
  });
ext.storage?.onChanged?.addListener((changes: any) => {
  if ("tapMode" in changes) {
    const value = changes.tapMode.newValue;
    tapModeSetting = typeof value === "boolean" ? value : undefined;
  }
  if ("showToggle" in changes) showToggle = changes.showToggle.newValue !== false;
  renderToggle();
});

/** Flip lookups on/off and remember the choice across pages. */
async function setTapMode(enabled: boolean): Promise<void> {
  tapModeSetting = enabled;
  renderToggle();
  if (!enabled) closePopup();
  await sendMessage({ type: "setTapMode", enabled });
}

// ---------- shadow-DOM popup ----------

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;

const POPUP_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .sheet {
    position: fixed;
    /* One below the toggle: the on/off control must never be covered by a
       definition, or there is no way to dismiss lookups while one is open. */
    z-index: 2147483646;
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

  /* The always-available on/off pill. Deliberately small and translucent:
     it must never be the thing you accidentally tap while reading. */
  .toggle {
    position: fixed;
    z-index: 2147483647;
    right: 10px;
    bottom: calc(16px + env(safe-area-inset-bottom));
    transition: bottom 140ms ease, opacity 120ms ease, background 120ms ease;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 11px;
    border-radius: 999px;
    background: rgba(28, 28, 46, 0.72);
    border: 1px solid rgba(255,255,255,0.16);
    color: #eceaf4;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    opacity: 0.5;
    transition: opacity 120ms ease, background 120ms ease;
    backdrop-filter: blur(6px);
    touch-action: manipulation;
  }
  .toggle:hover, .toggle:active { opacity: 1; }
  .toggle .dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: #6b6880;
  }
  .toggle.on { opacity: 0.72; }
  .toggle.on .dot { background: #7c6cf0; box-shadow: 0 0 6px #7c6cf0; }
  .toggle .label { letter-spacing: 0.02em; min-width: 46px; }
`;

/**
 * Dismiss the lookup sheet. The shadow host itself stays, because the on/off
 * toggle lives in it and must survive closing a definition.
 */
function closePopup(): void {
  shadow?.querySelector(".sheet")?.remove();
  liftToggleAbove(0);
}

/** How far above the bottom edge the pill currently sits. */
let toggleLift = 0;

/**
 * Keep the on/off pill clear of the definition sheet, which fills the bottom
 * of the screen — exactly where the pill sits.
 */
function liftToggleAbove(sheetHeight: number): void {
  toggleLift = sheetHeight > 0 ? Math.round(sheetHeight) + 12 : 0;
  positionToggle();
}

/**
 * Place the pill against the *visible* part of the page.
 *
 * `position: fixed` resolves against the layout viewport, which on a page
 * without a `<meta name="viewport">` is 980px wide regardless of the phone's
 * screen — so a plain bottom/right anchor puts the pill off-screen on any
 * non-responsive site, and pinch-zooming moves it out of reach on the rest.
 * visualViewport describes what the user can actually see, so anchor to that
 * and follow it as they scroll and zoom.
 */
function positionToggle(): void {
  if (!toggleEl) return;
  const gap = 10;
  const bottom = 16 + toggleLift;
  const vv = window.visualViewport;

  if (!vv) {
    toggleEl.style.left = "auto";
    toggleEl.style.top = "auto";
    toggleEl.style.right = `${gap}px`;
    toggleEl.style.bottom = `calc(${bottom}px + env(safe-area-inset-bottom))`;
    return;
  }

  const rect = toggleEl.getBoundingClientRect();
  const width = rect.width || 108;
  const height = rect.height || 29;
  toggleEl.style.right = "auto";
  toggleEl.style.bottom = "auto";
  toggleEl.style.left = `${Math.round(vv.offsetLeft + vv.width - width - gap)}px`;
  toggleEl.style.top = `${Math.round(vv.offsetTop + vv.height - height - bottom)}px`;
}

// Follow the visible area as the user scrolls, zooms or rotates.
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", positionToggle);
  window.visualViewport.addEventListener("scroll", positionToggle);
} else {
  window.addEventListener("resize", positionToggle);
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

/** Take all of the extension's UI back off the page. */
function removeHost(): void {
  host?.remove();
  host = null;
  shadow = null;
  toggleEl = null;
}

/**
 * The on-page lookup toggle.
 *
 * Turning lookups off from the toolbar takes several taps, which is too slow
 * when you just want to tap a link. This sits in the corner, dimmed until
 * touched, and flips lookups with one tap. Its own '×' hides it for people
 * who would rather use the toolbar.
 */
let toggleEl: HTMLElement | null = null;

function renderToggle(): void {
  // The app has its own lookup UI and its own settings; the extension should
  // be invisible there.
  if (isAppPage) {
    removeHost();
    return;
  }
  if (!showToggle) {
    toggleEl?.remove();
    toggleEl = null;
    return;
  }
  const root = ensureHost();
  if (!toggleEl) {
    toggleEl = document.createElement("div");
    toggleEl.className = "toggle";
    toggleEl.setAttribute("role", "switch");

    const dot = document.createElement("span");
    dot.className = "dot";
    const label = document.createElement("span");
    label.className = "label";
    toggleEl.append(dot, label);

    // The whole pill is one target. An inline "hide" button used to sit here,
    // but it was a small neighbour of the main action — easy to hit by
    // accident, and hiding the control is the last thing you want to do by
    // accident. Hiding now lives in the toolbar popup instead.
    onTap(toggleEl, (ev: Event) => {
      ev.stopPropagation?.();
      ev.preventDefault?.();
      void setTapMode(!tapModeActive());
    });
    // Never let a tap on the pill reach the page underneath. Bubble phase,
    // for the same reason as the sheet above.
    for (const type of ["pointerdown", "pointerup", "touchstart", "mousedown", "click"]) {
      toggleEl.addEventListener(type, (ev) => ev.stopPropagation());
    }
    root.appendChild(toggleEl);
  }

  positionToggle();

  const on = tapModeActive();
  toggleEl.classList.toggle("on", on);
  toggleEl.setAttribute("aria-checked", String(on));
  toggleEl.querySelector(".label")!.textContent = on ? "Tap: on" : "Tap: off";
  toggleEl.title = on
    ? "Yomeyo lookups are on — tap to turn off and use the page normally"
    : "Yomeyo lookups are off — tap to turn on";
}

/** Show a plain message in the sheet, for when there is no lookup to show. */
function showMessageSheet(text: string): void {
  closePopup();
  const root = ensureHost();
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const note = document.createElement("div");
  note.className = "empty";
  note.textContent = text;
  sheet.appendChild(note);
  root.appendChild(sheet);
  for (const type of ["click", "pointerdown", "pointerup", "touchstart"]) {
    sheet.addEventListener(type, (ev) => ev.stopPropagation());
  }
  const dismiss = (ev: Event) => {
    if (host && ev.composedPath().includes(host)) return;
    closePopup();
    document.removeEventListener("pointerdown", dismiss, true);
  };
  setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
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
  onTap(close, closePopup);
  grip.append(spacer, bar, close);
  sheet.appendChild(grip);

  const list = document.createElement("div");
  list.className = "list";
  sheet.appendChild(list);
  root.appendChild(sheet);

  // Taps inside the sheet must never reach the page or re-trigger lookup.
  //
  // These listeners are deliberately NOT on the capture phase. Capturing runs
  // from the document down, so stopping propagation there stopped the event
  // before it ever reached the Save and close buttons inside — they could not
  // be pressed at all. Stopping on the way back up lets the buttons handle
  // the tap first and still keeps it away from the page.
  for (const type of ["click", "pointerdown", "pointerup", "touchstart"]) {
    sheet.addEventListener(type, (ev) => ev.stopPropagation());
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

  liftToggleAbove(sheet.getBoundingClientRect().height);

  // Test against the host, not the sheet. This listener sits outside a
  // *closed* shadow root, and composedPath() stops at the host for those — it
  // never contains the sheet, so checking for the sheet dismissed the popup
  // on the very press that was meant to save a word.
  const dismiss = (ev: Event) => {
    if (host && ev.composedPath().includes(host)) return;
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
    // onTap rather than a click listener: this list scrolls, and a finger
    // that drifts a few pixels while pressing produces no click at all.
    onTap(btn, async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const res = await sendMessage<{ ok: boolean; outcome?: string }>({
        type: "save",
        entry,
        sentence,
        url: location.href,
      });
      btn.textContent = res?.outcome === "duplicate" ? "Already saved" : "Saved";
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

/** Resolve a screen point to the character actually under it, or null. */
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

  // caretPositionFromPoint snaps to the *nearest* character, so a tap on a
  // margin, a blank area or the padding around a paragraph still resolves to
  // some text. Without this check, tapping empty space pops up a definition —
  // exactly the kind of interruption the lookup should never cause. Require
  // the point to actually fall on the character's box.
  try {
    const glyph = document.createRange();
    glyph.setStart(textNode, offset);
    glyph.setEnd(textNode, offset + 1);
    const box = glyph.getBoundingClientRect();
    const slack = 4; // forgiving for fingers, not for empty space
    if (x < box.left - slack || x > box.right + slack || y < box.top - slack || y > box.bottom + slack) {
      return null;
    }
  } catch {
    return null;
  }

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
  }).catch(() => undefined);

  // No answer at all is different from "no such word". The first means the
  // background is not running, and a tap that does nothing whatsoever is the
  // least useful way to report that.
  if (!matches) {
    showMessageSheet(
      "Could not reach Yomeyo's dictionary. Reload the page; if that does not help, remove the extension and install it again.",
    );
    return true;
  }
  if (matches.length === 0) return false;

  // Highlight the matched run, Yomitan-style. It can begin before the tapped
  // character: on a phone a tap lands inside a word as often as at its start.
  try {
    const range = document.createRange();
    const from = Math.max(0, Math.min(matches[0].start, tap.node.data.length));
    range.setStart(tap.node, from);
    range.setEnd(tap.node, Math.min(from + matches[0].matchLength, tap.node.data.length));
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
  // The background has words for the app and needs a page with a DOM to
  // hand them over from. This content script is that page: it loads the
  // app's drop box in a hidden frame, which writes straight into the app's
  // deck — so the app does not have to be open anywhere.
  if (message?.type === "deliverViaFrame") {
    handOverViaFrame(message.frameUrl, message.cards, message.token).then(
      (ids) => sendResponse({ ids }),
      (err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  }
  // A word was just saved on another tab and the app is open here.
  if (message?.type === "appHasNewWords") {
    void offerToApp?.();
    sendResponse({ ok: true });
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
