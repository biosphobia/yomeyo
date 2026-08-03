import {
  extractKanji,
  gradeLabel,
  isJoyo,
  parseKanjiFile,
  strokeBucket,
  type KanjiInfo,
} from "@yomeyo/core";
import { assetUrl, liveCards } from "./store.js";
import { strokeOrder } from "./strokes.js";
import { speakerButton } from "./audio.js";

/**
 * Kanji reference: the jōyō set, and the kanji that appear in words you have
 * actually saved — the second list being the one worth working through,
 * since those characters are already in your reading.
 */

let indexPromise: Promise<Map<string, KanjiInfo>> | null = null;
const strokeCache = new Map<string, Record<string, string[]>>();

export async function loadKanjiIndex(): Promise<Map<string, KanjiInfo>> {
  if (!indexPromise) {
    indexPromise = (async () => {
      const res = await fetch(assetUrl("kanji/index.json"));
      if (!res.ok) throw new Error(`Could not load kanji data (${res.status})`);
      const list = parseKanjiFile(await res.json());
      return new Map(list.map((k) => [k.char, k]));
    })().catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

/** Stroke paths for one kanji, fetching only that character's bucket. */
export async function loadStrokes(char: string): Promise<string[] | null> {
  const bucket = strokeBucket(char);
  if (!strokeCache.has(bucket)) {
    try {
      const res = await fetch(assetUrl(`kanji/strokes/${bucket}.json`));
      strokeCache.set(bucket, res.ok ? await res.json() : {});
    } catch {
      strokeCache.set(bucket, {});
    }
  }
  return strokeCache.get(bucket)?.[char] ?? null;
}

type Tab = "mine" | "joyo";
let activeTab: Tab = "mine";

export async function renderKanji(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  main.innerHTML = `
    <h1>Kanji</h1>
    <div class="seg" role="tablist">
      <button data-tab="mine" class="seg-btn">From my words</button>
      <button data-tab="joyo" class="seg-btn">Jōyō</button>
    </div>
    <div id="kanji-body"><div class="msg">Loading…</div></div>
  `;

  const body = main.querySelector<HTMLDivElement>("#kanji-body")!;
  main.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab as Tab;
      main.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      void renderList(body);
    });
  });

  if (!isCurrent()) return;
  await renderList(body);
}

async function renderList(body: HTMLElement): Promise<void> {
  let index: Map<string, KanjiInfo>;
  try {
    index = await loadKanjiIndex();
  } catch (err) {
    body.innerHTML = `<div class="msg error">${escapeHtml(
      err instanceof Error ? err.message : String(err),
    )}</div><div class="msg">Kanji data is built alongside the dictionary. If this is a fresh deployment, it appears after the next build.</div>`;
    return;
  }

  const cards = await liveCards();
  const mineChars = extractKanji(cards.map((c) => c.term).join(""));

  let list: KanjiInfo[];
  let empty = "";
  if (activeTab === "mine") {
    list = mineChars.map((c) => index.get(c)).filter((k): k is KanjiInfo => !!k);
    empty = "No kanji yet — save some words and the kanji in them show up here.";
  } else {
    list = [...index.values()].filter(isJoyo).sort((a, b) => a.grade - b.grade || (a.freq || 9999) - (b.freq || 9999));
    empty = "No jōyō data available yet.";
  }

  if (list.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="big">漢</div>${escapeHtml(empty)}</div>`;
    return;
  }

  const known = new Set(mineChars);
  body.innerHTML = `
    <div class="msg">${list.length} kanji${
      activeTab === "joyo" ? ` · ${known.size} seen in your words` : ""
    }</div>
    <div class="kanji-grid" id="grid"></div>
  `;
  const grid = body.querySelector<HTMLDivElement>("#grid")!;

  for (const info of list) {
    const cell = document.createElement("button");
    cell.className = "kanji-cell";
    if (activeTab === "joyo" && known.has(info.char)) cell.classList.add("seen");
    cell.innerHTML = `
      <span class="ch" lang="ja">${escapeHtml(info.char)}</span>
      <span class="gloss">${escapeHtml(info.meanings[0] ?? "")}</span>
    `;
    cell.addEventListener("click", () => void showDetail(info, cards));
    grid.appendChild(cell);
  }
}

async function showDetail(info: KanjiInfo, cards: Awaited<ReturnType<typeof liveCards>>): Promise<void> {
  document.querySelector(".kanji-sheet")?.remove();

  const sheet = document.createElement("div");
  sheet.className = "kanji-sheet";
  sheet.innerHTML = `
    <div class="kanji-sheet-inner">
      <button class="kanji-close" aria-label="Close">✕</button>
      <div class="kanji-head">
        <div class="kanji-big" lang="ja">${escapeHtml(info.char)}</div>
        <div class="kanji-facts">
          <div><b>${escapeHtml(gradeLabel(info.grade))}</b></div>
          <div>${info.strokes} stroke${info.strokes === 1 ? "" : "s"}</div>
          ${info.jlpt ? `<div>Old JLPT N${info.jlpt}</div>` : ""}
          ${info.freq ? `<div>#${info.freq} most common</div>` : ""}
        </div>
      </div>
      <div class="kanji-meanings">${escapeHtml(info.meanings.join(", "))}</div>
      <div class="kanji-readings">
        ${info.on.length ? `<div><span class="tag">On</span> <span lang="ja">${escapeHtml(info.on.join("・"))}</span></div>` : ""}
        ${info.kun.length ? `<div><span class="tag">Kun</span> <span lang="ja">${escapeHtml(info.kun.join("・"))}</span></div>` : ""}
      </div>
      <div class="kanji-strokes" id="strokes"><div class="msg">Loading stroke order…</div></div>
      <div class="kanji-words" id="kanji-words"></div>
    </div>
  `;
  document.body.appendChild(sheet);

  sheet.querySelector(".kanji-close")!.addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (ev) => {
    if (ev.target === sheet) sheet.remove();
  });

  // Audio for the character itself, using its most common reading.
  const spoken = info.kun[0]?.split(".")[0] || info.on[0] || info.char;
  sheet.querySelector(".kanji-head")!.appendChild(speakerButton(info.char, spoken));

  // Words in the deck that use this kanji: the reason to learn it.
  const using = cards.filter((c) => c.term.includes(info.char)).slice(0, 12);
  const wordsBox = sheet.querySelector<HTMLDivElement>("#kanji-words")!;
  if (using.length > 0) {
    wordsBox.innerHTML = `<div class="kanji-words-title">In your words</div>`;
    for (const card of using) {
      const row = document.createElement("div");
      row.className = "kanji-word";
      row.innerHTML = `<b lang="ja">${escapeHtml(card.term)}</b> <span lang="ja">${escapeHtml(
        card.reading,
      )}</span> <span class="g">${escapeHtml(card.glosses[0] ?? "")}</span>`;
      wordsBox.appendChild(row);
    }
  }

  const strokesBox = sheet.querySelector<HTMLDivElement>("#strokes")!;
  const paths = await loadStrokes(info.char);
  strokesBox.replaceChildren();
  if (!paths || paths.length === 0) {
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent =
      "Stroke order isn't available for this kanji yet — it is built alongside the dictionary.";
    strokesBox.appendChild(msg);
    return;
  }

  const handle = strokeOrder(paths, { size: 190, numbers: true });
  strokesBox.appendChild(handle.element);

  const controls = document.createElement("div");
  controls.className = "row-actions";
  const replay = document.createElement("button");
  replay.className = "secondary";
  replay.textContent = "▶ Replay";
  replay.addEventListener("click", () => handle.play());
  const whole = document.createElement("button");
  whole.className = "ghost";
  whole.textContent = "Show finished";
  whole.addEventListener("click", () => handle.showComplete());
  controls.append(replay, whole);
  strokesBox.appendChild(controls);

  // Appended and laid out, so path lengths are measurable.
  handle.play();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
