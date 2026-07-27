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
    <div id="reader-view" class="card-panel reader-text" style="display:none" lang="ja"></div>
  `;

  const input = main.querySelector<HTMLTextAreaElement>("#reader-input")!;
  const view = main.querySelector<HTMLDivElement>("#reader-view")!;
  const goBtn = main.querySelector<HTMLButtonElement>("#reader-go")!;
  const demoBtn = main.querySelector<HTMLButtonElement>("#reader-demo")!;

  async function show(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
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

    const dict = await activeDictionary();

    view.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      if (!target.dataset.i || !target.classList.contains("jp-char")) return;
      const offset = Number(target.dataset.i);
      const matches = lookup(dict, trimmed, offset);
      closePopup();

      // Clear old highlight, highlight the best match's span range.
      view.querySelectorAll(".hl").forEach((el) => el.classList.remove("hl"));
      if (matches.length > 0) {
        const len = matches[0].matchLength;
        for (let i = offset; i < offset + len; i++) {
          view.querySelector(`[data-i="${i}"]`)?.classList.add("hl");
        }
        const sentence = extractSentence(trimmed, offset);
        void showLookupPopup(matches, { sentence, source: "reader" });
      }
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
