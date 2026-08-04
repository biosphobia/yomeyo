import { lookup, type DictEntry } from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";
import { speak } from "./audio.js";
import { activeDictionary } from "./store.js";
import { carRow } from "./grammar-draw.js";
import { parseSentence, parserAvailable, roughParse, type Parsed, type ParsedChunk } from "./parse-ai.js";

/**
 * Parse: paste any Japanese sentence and see it taken apart.
 *
 * The drills teach the shape of a sentence on examples the course chose.
 * This is the same view turned on a sentence from anywhere — a subtitle, a
 * sign, a line from a book — because the point of learning the shape is to
 * use it on sentences nobody prepared for you.
 *
 * Three things come back: the pieces as wagons, each with what it means and
 * what job it does; what every word in it means, straight from the
 * dictionary already on the device; and the translation, natural and word
 * for word. The unsaid doer is drawn like everywhere else, because half of
 * reading Japanese is seeing what is not written.
 */

const LAST_KEY = "parseLast";

export async function renderParse(body: HTMLDivElement): Promise<void> {
  const last = (await getMeta<string>(LAST_KEY)) ?? "";

  body.innerHTML = `
    <div class="card-panel">
      <label for="parse-in">A Japanese sentence</label>
      <textarea id="parse-in" rows="2" lang="ja" placeholder="ねこが さかなを たべた。"
        spellcheck="false">${escapeHtml(last)}</textarea>
      <div class="row-actions">
        <button id="parse-go">Take it apart</button>
        <button id="parse-clear" class="ghost">Clear</button>
      </div>
      <div class="msg" id="parse-msg"></div>
    </div>
    <div id="parse-out"></div>
  `;

  const input = body.querySelector<HTMLTextAreaElement>("#parse-in")!;
  const out = body.querySelector<HTMLDivElement>("#parse-out")!;
  const msg = body.querySelector<HTMLDivElement>("#parse-msg")!;
  const go = body.querySelector<HTMLButtonElement>("#parse-go")!;

  body.querySelector<HTMLButtonElement>("#parse-clear")!.addEventListener("click", () => {
    input.value = "";
    out.innerHTML = "";
    msg.textContent = "";
    input.focus();
  });

  const run = async (): Promise<void> => {
    const text = input.value.trim();
    if (!text) return;
    await setMeta(LAST_KEY, text);
    go.disabled = true;
    msg.textContent = "Working through it…";
    out.innerHTML = "";

    const parsed = (await parseSentence(text)) ?? roughParse(text);
    msg.textContent = parsed.full
      ? ""
      : (await parserAvailable())
        ? "Could not work this one out — here is a rough split by the connecting words."
        : "This site has no parser configured, so here is a rough split by the connecting words.";
    go.disabled = false;
    await draw(out, parsed, text);
  };

  go.addEventListener("click", () => void run());
  input.addEventListener("keydown", (ev) => {
    // Enter parses; Shift+Enter is a newline, for a sentence worth wrapping.
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void run();
    }
  });
}

async function draw(out: HTMLDivElement, parsed: Parsed, original: string): Promise<void> {
  const said = parsed.chunks.filter((c) => c.role !== "ghost");
  out.innerHTML = `
    <div class="card-panel">
      <div class="parse-head">
        <div lang="ja" class="parse-source">${escapeHtml(original)}</div>
        <button class="speaker" id="parse-say" title="Read it out" aria-label="Read it out">🔊</button>
      </div>
      <div class="gram-train">${parsed.chunks.map((c) => pieceHtml(c)).join("")}</div>
      ${
        parsed.en
          ? `<div class="parse-en">${escapeHtml(parsed.en)}</div>
             ${parsed.lit ? `<div class="gram-lit">word for word: ${escapeHtml(parsed.lit)}</div>` : ""}`
          : ""
      }
      ${parsed.note ? `<div class="parse-note">${escapeHtml(parsed.note)}</div>` : ""}
    </div>
    <div class="card-panel">
      <b>The words</b>
      <div id="parse-words"><div class="glosses">Looking them up…</div></div>
    </div>
  `;
  out.querySelector("#parse-say")!.addEventListener("click", () => {
    void speak(said.map((c) => c.t).join(""), { rate: 0.85 }).catch(() => undefined);
  });
  await drawWords(out.querySelector<HTMLDivElement>("#parse-words")!, said);
}

/** One piece: the wagon, with its meaning and its job already open. */
function pieceHtml(chunk: ParsedChunk): string {
  const reading =
    chunk.k && chunk.k !== chunk.t ? `<span class="parse-reading" lang="ja">${escapeHtml(chunk.k)}</span>` : "";
  return `<span class="gram-car">
    ${carRow(chunk, Boolean(chunk.r), chunk.role, true)}
    ${reading}
    ${chunk.label ? `<span class="gram-label">${escapeHtml(chunk.label)}</span>` : ""}
  </span>`;
}

/**
 * What each word means, from the dictionary already on the device.
 *
 * Deliberately not asked of the parser: the dictionary is exact, works with
 * no connection, and is the same one the rest of the app looks words up in.
 * The parser says what a piece is doing here; the dictionary says what the
 * word is.
 */
async function drawWords(box: HTMLDivElement, chunks: ParsedChunk[]): Promise<void> {
  let dict;
  try {
    dict = await activeDictionary();
  } catch {
    box.innerHTML = `<div class="glosses">The dictionary is not on this device yet.</div>`;
    return;
  }

  const rows: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    // The connecting word is not a word to look up; it has its own job line.
    const word = chunk.p && chunk.t.endsWith(chunk.p) ? chunk.t.slice(0, -chunk.p.length) : chunk.t;
    const stem = chunk.tail && word.endsWith(chunk.tail) ? word.slice(0, -chunk.tail.length) : word;
    if (!stem || seen.has(stem)) continue;
    seen.add(stem);

    const match = lookup(dict, stem, 0)[0];
    if (!match) {
      rows.push(`
        <div class="parse-word">
          <div class="parse-word-jp" lang="ja">${escapeHtml(stem)}</div>
          <div class="glosses">Not in the dictionary — here it means “${escapeHtml(chunk.g)}”.</div>
        </div>`);
      continue;
    }
    rows.push(`
      <div class="parse-word">
        <div class="parse-word-jp" lang="ja">${escapeHtml(match.term)}${
          match.entries[0]?.reading && match.entries[0].reading !== match.term
            ? `<span class="parse-reading">${escapeHtml(match.entries[0].reading)}</span>`
            : ""
        }</div>
        ${
          match.reasons.length > 0
            ? `<div class="parse-from" lang="ja">from ${escapeHtml(match.matchedText)} · ${escapeHtml(match.reasons.join(" → "))}</div>`
            : ""
        }
        ${match.entries.slice(0, 2).map(entryHtml).join("")}
      </div>`);
  }

  box.innerHTML = rows.length > 0 ? rows.join("") : `<div class="glosses">No dictionary words in this one.</div>`;
}

function entryHtml(entry: DictEntry): string {
  return `<div class="parse-senses">
    ${entry.pos && entry.pos.length > 0 ? `<span class="pos">${escapeHtml(entry.pos.slice(0, 3).join(", "))}</span>` : ""}
    ${escapeHtml(entry.glosses.slice(0, 4).join("; "))}
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
