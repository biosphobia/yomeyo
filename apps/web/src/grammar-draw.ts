import { PARTICLE_JOB, TAIL_JOB, type Chunk, type Sentence } from "./grammar-data.js";

/**
 * Drawing a sentence as its pieces.
 *
 * Shared by the practice drills and the parse tab so a sentence looks the
 * same wherever it is taken apart: the word, its connector as a small wagon
 * of its own behind it, and — once the answer is up — what each piece means
 * and what job it does, in ordinary words.
 */

/**
 * A word and its little connecting word. The particle is not part of the
 * word: it is a small block of its own, tucked close behind the word it
 * belongs to — ペン ｜ が ｜ あかい — so the sentence reads as pieces
 * joined by connectors, which is what it is.
 */
export function splitChunk(chunk: Chunk): {
  word: string;
  wordR: string;
  particle?: string;
  particleR?: string;
  /** だ or です, split off the same way — it is a word, not a word-ending. */
  tail?: string;
  tailR?: string;
} {
  const cut = chunk.p ?? chunk.tail;
  if (!cut || !chunk.t.endsWith(cut)) return { word: chunk.t, wordR: chunk.r };
  const word = chunk.t.slice(0, chunk.t.length - cut.length);
  const space = chunk.r.lastIndexOf(" ");
  const wordR = space > 0 ? chunk.r.slice(0, space) : chunk.r;
  const cutR = space > 0 ? chunk.r.slice(space + 1) : "";
  return chunk.p
    ? { word, wordR, particle: cut, particleR: cutR }
    : { word, wordR, tail: cut, tailR: cutR };
}

/**
 * One word block: the Japanese, its romaji, and — once the answer is shown
 * — what it means in English. The meaning is the whole point, so it sits
 * right under the word rather than off in a translation somewhere.
 */
export function wordBlock(
  text: string,
  romaji: string,
  showRomaji: boolean,
  role?: string,
  meaning?: string,
): string {
  return `<span class="gram-chunk${role ? ` role-${role}` : ""}"><span lang="ja">${escapeHtml(text)}</span>${
    showRomaji ? `<span class="gram-romaji">${escapeHtml(romaji)}</span>` : ""
  }${meaning ? `<span class="gram-mean">${escapeHtml(meaning)}</span>` : ""}</span>`;
}

/** A connecting word, with its job shown underneath once the answer is up. */
function particleBlock(
  text: string,
  romaji: string,
  showRomaji: boolean,
  ghost = false,
  flag = false,
  job?: string,
): string {
  return `<span class="gram-particle${ghost ? " role-ghost" : ""}${flag ? " flag" : ""}"><span lang="ja">${escapeHtml(
    text,
  )}</span>${showRomaji ? `<span class="gram-romaji">${escapeHtml(romaji)}</span>` : ""}${
    job ? `<span class="gram-job">${escapeHtml(job)}</span>` : ""
  }</span>`;
}

/**
 * The word with its connector beside it. An unsaid doer is drawn as a
 * dashed block holding the English it stands for — (I), (it) — because
 * that is the only thing a beginner can actually see about it.
 */
export function carRow(chunk: Chunk, showRomaji: boolean, role?: string, open = false): string {
  if (chunk.role === "ghost") {
    return `<span class="gram-car-row">${wordBlock(
      `(${chunk.g})`,
      "",
      false,
      "ghost",
      open ? "nobody said it" : undefined,
    )}</span>`;
  }
  const { word, wordR, particle, particleR, tail, tailR } = splitChunk(chunk);
  return `<span class="gram-car-row">${wordBlock(word, wordR, showRomaji, role, open ? chunk.g : undefined)}${
    particle !== undefined
      ? particleBlock(
          particle,
          particleR ?? "",
          showRomaji,
          false,
          particle === "は",
          open ? PARTICLE_JOB[particle] : undefined,
        )
      : ""
  }${tail !== undefined ? tailBlock(tail, tailR ?? "", showRomaji, open ? TAIL_JOB[tail] : undefined) : ""}</span>`;
}

/**
 * だ or です. Drawn like a connector because it is small and rides behind a
 * word, but never in a connector's colour: it is the ending, not a link.
 */
function tailBlock(text: string, romaji: string, showRomaji: boolean, job?: string): string {
  return `<span class="gram-tail"><span lang="ja">${escapeHtml(text)}</span>${
    showRomaji ? `<span class="gram-romaji">${escapeHtml(romaji)}</span>` : ""
  }${job ? `<span class="gram-job">${escapeHtml(job)}</span>` : ""}</span>`;
}

/** A piece in the opened-up sentence: meaning under the word, job under that. */
export function chunkHtml(chunk: Chunk, romaji: boolean, labelled: boolean, mark = ""): string {
  return `<span class="gram-car${mark}">
    ${carRow(chunk, romaji, chunk.role, true)}
    ${labelled ? `<span class="gram-label">${escapeHtml(chunk.label)}</span>` : ""}
  </span>`;
}

export function spoken(sentence: Sentence): string {
  return sentence.chunks
    .filter((c) => c.role !== "ghost")
    .map((c) => c.t)
    .join("");
}

export function romajiOf(sentence: Sentence): string {
  return sentence.chunks
    .filter((c) => c.role !== "ghost")
    .map((c) => c.r)
    .join(" ");
}


function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
