import { isJapaneseChar, lookup } from "@yomeyo/core";
import { activeDictionary } from "./store.js";
import { closePopup, showLookupPopup } from "./popup.js";

/**
 * Reader page: paste (or share) Japanese text, tap any word to look it up
 * and save it. This is the primary mining flow on Android, where Chrome
 * has no extension support: select text on any page -> Share -> Yomeyo.
 */

const DEMO_TEXT =
  "昨日、面白い本を読んだ。日本語の勉強は難しいけど、毎日少しずつ新しい言葉を覚えている。" +
  "友達と話したり、映画を見たりすると、もっと楽しくなる。";

export function renderReader(main: HTMLElement, sharedText?: string): void {
  main.innerHTML = `
    <h1>Reader</h1>
    <p class="subtitle">Paste Japanese text, then tap any word to look it up and save it.</p>
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
