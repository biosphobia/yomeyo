import { assetUrl } from "./store.js";

/**
 * The reaction that pops up after an answer: an image and a line of text.
 *
 * Everything shown lives in `apps/web/public/feedback/` — a JSON file and the
 * images beside it — precisely so it can all be changed on GitHub without
 * touching any code: edit the file, push, and the next deploy shows it.
 *
 * Either side takes a list, and one is picked at random each time, so there
 * can be as many images and as many lines as you care to add:
 *
 *   {
 *     "correct": {
 *       "images": ["correct.gif", "yatta.gif"],
 *       "texts": ["good job!!", "nailed it"]
 *     },
 *     "wrong": { "images": ["wrong.gif"], "texts": ["nice try!"] }
 *   }
 *
 * The older single `"image"` / `"text"` form still works, and a list may be
 * left out entirely to keep the built-in one.
 */

export type ReactionKind = "correct" | "wrong";

interface Reaction {
  images: string[];
  texts: string[];
}

type Reactions = Record<ReactionKind, Reaction>;

/** What a `feedback.json` may say, in any of the shapes accepted. */
interface RawReaction {
  image?: unknown;
  images?: unknown;
  text?: unknown;
  texts?: unknown;
}

const DEFAULTS: Reactions = {
  correct: { images: ["correct.gif"], texts: ["good job"] },
  wrong: { images: ["wrong.gif"], texts: ["nice try!"] },
};

/** A list from either the plural or the singular key; empty when neither. */
function list(plural: unknown, single: unknown): string[] {
  const out = Array.isArray(plural) ? plural : [];
  const clean = out.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (clean.length > 0) return clean.map((v) => v.trim());
  return typeof single === "string" && single.trim() !== "" ? [single.trim()] : [];
}

function reaction(raw: RawReaction | undefined, fallback: Reaction): Reaction {
  const images = list(raw?.images, raw?.image);
  const texts = list(raw?.texts, raw?.text);
  return {
    images: images.length > 0 ? images : fallback.images,
    texts: texts.length > 0 ? texts : fallback.texts,
  };
}

let loaded: Promise<Reactions> | null = null;

function reactions(): Promise<Reactions> {
  loaded ??= fetch(assetUrl("feedback/feedback.json"))
    .then((res) => (res.ok ? res.json() : {}))
    .then((parsed: Partial<Record<ReactionKind, RawReaction>>) => ({
      correct: reaction(parsed?.correct, DEFAULTS.correct),
      wrong: reaction(parsed?.wrong, DEFAULTS.wrong),
    }))
    .catch(() => DEFAULTS);
  return loaded;
}

function reactionUrl(image: string): string {
  return /^(https?:|data:)/i.test(image) ? image : assetUrl(`feedback/${image}`);
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Warm the images so the first reaction of a run does not appear late.
 * Safe to call whenever a screen that shows reactions opens.
 */
export async function preloadReactions(): Promise<void> {
  const all = await reactions();
  for (const kind of ["correct", "wrong"] as const) {
    for (const image of all[kind].images) new Image().src = reactionUrl(image);
  }
}

/** The markup a screen drops in where reactions should appear. */
export function cheerBox(id: string): string {
  return `<div class="cheer" id="${id}"></div>`;
}

/** Pop a reaction into a `cheerBox`. Does nothing if the box has gone. */
export async function showReaction(box: HTMLElement | null, kind: ReactionKind): Promise<void> {
  if (!box) return;
  const all = await reactions();
  const image = pick(all[kind].images);
  const text = pick(all[kind].texts);
  if (!box.isConnected) return; // the screen was left while this loaded
  box.innerHTML = `
    <img src="${reactionUrl(image).replace(/"/g, "&quot;")}" alt="" />
    <div class="cheer-text">${escapeHtml(text)}</div>
  `;
  box.classList.remove("show");
  // Restart the animation even when the same box pops twice in a row.
  void box.offsetWidth;
  box.classList.add("show");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
