import { getMeta, setMeta } from "./db.js";
import { assetUrl } from "./store.js";
import type { OcrWord } from "./ocr.js";

/**
 * The reading tutor: Claude looking at the same page as the learner.
 *
 * OCR turns the page into tappable words, and the dictionary answers what
 * one word means — but a beginner's real question is usually the whole
 * line: why is it だべ, what happened to the が, who is even speaking. So
 * the page image and its transcription go to the model together, and it
 * answers as a tutor: a walkthrough of every line, or a direct answer to
 * whatever the learner actually asked. The image matters as much as the
 * text — tone, speaker, and half the meaning live in the picture.
 */

/** One line of the tutor's page walkthrough. */
export interface ExplainedLine {
  jp: string;
  reading?: string;
  en: string;
  how: string;
}

export interface PageAnalysis {
  scene?: string;
  lines: ExplainedLine[];
}

/** A walkthrough is paid for once per page, then kept. */
const EXPLAIN_PREFIX = "bookAiExplain:";

/**
 * The page as a JPEG the tutor is shown: enough pixels to read print,
 * few enough to send from a phone.
 */
export function pageJpeg(source: HTMLCanvasElement): string {
  const MAX = 1100;
  const scale = Math.min(1, MAX / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.8);
  return url.slice(url.indexOf(",") + 1);
}

async function callReading(image: string, lines: OcrWord[], question?: string): Promise<unknown> {
  const res = await fetch(assetUrl("grammar.php"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "reading",
      image,
      media: "image/jpeg",
      text: lines.map((line) => line.text).join("\n"),
      ...(question ? { question } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 429 || res.status >= 500
        ? "The tutor is busy just now. Try again in a moment."
        : "The tutor could not look at this page.",
    );
  }
  const { raw } = (await res.json()) as { raw?: string };
  if (!raw) throw new Error("The tutor had nothing to say. Try again.");
  return JSON.parse(raw);
}

/** The walkthrough already paid for, if this page has one. */
export async function cachedAnalysis(cacheKey: string): Promise<PageAnalysis | null> {
  const held = await getMeta<PageAnalysis>(EXPLAIN_PREFIX + cacheKey);
  return held && Array.isArray(held.lines) ? held : null;
}

/**
 * The tutor walks the page: every line translated and taken apart, and
 * the scene read off the artwork. Cached per page; `force` pays again,
 * for after the page's text has been corrected.
 */
export async function explainPage(
  cacheKey: string,
  image: string,
  lines: OcrWord[],
  force = false,
): Promise<PageAnalysis> {
  if (!force) {
    const held = await cachedAnalysis(cacheKey);
    if (held) return held;
  }
  const parsed = callResult(await callReading(image, lines));
  await setMeta(EXPLAIN_PREFIX + cacheKey, parsed);
  return parsed;
}

function callResult(value: unknown): PageAnalysis {
  const raw = value as { scene?: unknown; lines?: unknown };
  if (!Array.isArray(raw.lines)) throw new Error("The tutor's answer came back in the wrong shape.");
  const lines: ExplainedLine[] = [];
  for (const entry of raw.lines as Partial<ExplainedLine>[]) {
    if (typeof entry?.jp !== "string" || typeof entry.en !== "string" || typeof entry.how !== "string") continue;
    lines.push({
      jp: entry.jp,
      en: entry.en,
      how: entry.how,
      ...(typeof entry.reading === "string" && entry.reading.trim() ? { reading: entry.reading } : {}),
    });
  }
  if (lines.length === 0) throw new Error("The tutor had nothing to say about this page.");
  return { lines, ...(typeof raw.scene === "string" && raw.scene.trim() ? { scene: raw.scene } : {}) };
}

/** The learner's own question about this page, answered in plain words. */
export async function askPage(image: string, lines: OcrWord[], question: string): Promise<string> {
  const parsed = (await callReading(image, lines, question)) as { answer?: unknown };
  if (typeof parsed.answer !== "string" || !parsed.answer.trim()) {
    throw new Error("The tutor had no answer. Ask another way.");
  }
  return parsed.answer.trim();
}
