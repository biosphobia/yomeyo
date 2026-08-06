import { assetUrl } from "./store.js";

/**
 * The reaction that pops up after an answer: an image and a line of text.
 *
 * Everything shown lives in `apps/web/public/feedback/` — a JSON file and the
 * images beside it — precisely so it can all be changed on GitHub without
 * touching any code: edit the file, push, and the next deploy shows it.
 *
 * **A line belongs to its image.** They are listed in step, and the pair is
 * picked together, because a gif and a caption are one joke:
 *
 *   {
 *     "correct": {
 *       "images": ["yatta.gif", "thumbsup.gif"],
 *       "texts":  ["やった!!",   "nailed it"]
 *     },
 *     "wrong": { "images": ["oops.gif"], "texts": ["nice try!", "so close"] }
 *   }
 *
 * yatta.gif always says やった. Where an image has several lines to itself —
 * as oops.gif does above, having outlasted the images list — one of its own
 * lines is picked. One line and several images means every image says it.
 * The older single `"image"` / `"text"` form still works, and a list may be
 * left out entirely to keep the built-in one.
 *
 * Gifs won from the gacha bring their own line with them, from the prize
 * file, and join whichever side they were won for.
 */

export type ReactionKind = "correct" | "wrong";

/** One image and the line (or lines) that belong to it. */
interface Pop {
  image: string;
  texts: string[];
}

type Reactions = Record<ReactionKind, Pop[]>;

/** What a `feedback.json` may say, in any of the shapes accepted. */
interface RawReaction {
  image?: unknown;
  images?: unknown;
  text?: unknown;
  texts?: unknown;
}

const DEFAULTS: Reactions = {
  correct: [{ image: "correct.gif", texts: ["good job"] }],
  wrong: [{ image: "wrong.gif", texts: ["nice try!"] }],
};

/** A list from either the plural or the singular key; empty when neither. */
function list(plural: unknown, single: unknown): string[] {
  const out = Array.isArray(plural) ? plural : [];
  const clean = out.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (clean.length > 0) return clean.map((v) => v.trim());
  return typeof single === "string" && single.trim() !== "" ? [single.trim()] : [];
}

/**
 * Pair the two lists up.
 *
 * Image *i* takes line *i*. Lines past the end of the images wrap round, so
 * an image can end up with several of its own to choose between; an image
 * with none of its own falls back to the whole list, which is what makes one
 * line and five images mean all five say it.
 */
function reaction(raw: RawReaction | undefined, fallback: Pop[]): Pop[] {
  const images = list(raw?.images, raw?.image);
  const texts = list(raw?.texts, raw?.text);
  if (images.length === 0) return fallback;

  const pops: Pop[] = images.map((image) => ({ image, texts: [] }));
  texts.forEach((text, i) => pops[i % pops.length].texts.push(text));
  const spare = texts.length > 0 ? texts : fallback.flatMap((pop) => pop.texts);
  for (const pop of pops) if (pop.texts.length === 0) pop.texts = spare;
  return pops;
}

let fromFileCache: Promise<Reactions> | null = null;

function fromFile(): Promise<Reactions> {
  fromFileCache ??= fetch(assetUrl("feedback/feedback.json"))
    .then((res) => (res.ok ? res.json() : {}))
    .then((parsed: Partial<Record<ReactionKind, RawReaction>>) => ({
      correct: reaction(parsed?.correct, DEFAULTS.correct),
      wrong: reaction(parsed?.wrong, DEFAULTS.wrong),
    }))
    .catch(() => DEFAULTS);
  return fromFileCache;
}

/**
 * The file's reactions, plus every gif won from the gacha, held ready.
 *
 * Held, rather than rebuilt per answer, for a reason that shows: an answer
 * lands and the reaction has to be on screen *now*. Building it means a fetch,
 * two dynamic imports and a read of the collection, and while that is in
 * flight the learner can tap on — and does, because the screen is already
 * telling them to. The question that follows replaces the box the reaction
 * was going to be drawn into, and nothing ever pops.
 *
 * So it is built once when a drill opens and kept, and showing one after that
 * is a synchronous write to the DOM in the same tick as the answer.
 */
let ready: Reactions | null = null;
let building: Promise<Reactions> | null = null;

function build(): Promise<Reactions> {
  building ??= (async () => {
    const base = await fromFile();
    // Usable from here on. What follows is the gacha's contribution, which is
    // another fetch and is nobody's reaction until they have won one — the
    // drill must not wait on it to be able to show anything at all.
    ready ??= base;
    let merged = base;
    try {
      const { owned } = await import("./gacha-collection.js");
      const have = await owned();
      if (have.size === 0) return base;
      const { prizeTable, prizeImageUrl } = await import("./gacha-data.js");
      const table = await prizeTable();
      const won = table.prizes.filter((p) => p.type === "gif" && have.has(p.id));
      if (won.length > 0) {
        merged = { correct: [...base.correct], wrong: [...base.wrong] };
        for (const prize of won) {
          if (prize.type !== "gif") continue;
          // Its own line, and only its own: a won gif and the line written
          // under it in the prize file are one thing.
          merged[prize.on] = [
            ...merged[prize.on],
            { image: prizeImageUrl(prize.image), texts: [prize.text] },
          ];
        }
      }
    } catch {
      // The prize table is optional; the reactions are not.
    }
    ready = merged;
    return merged;
  })();
  return building;
}

/**
 * A gif has just been won: the pool it joins is now out of date.
 *
 * Called by the gacha, so the very next question can show what was won.
 */
export function forgetReactions(): void {
  ready = null;
  building = null;
}

function reactionUrl(image: string): string {
  return /^(https?:|data:)/i.test(image) ? image : assetUrl(`feedback/${image}`);
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Warm the reactions and their images, so the first one of a run is on screen
 * the instant it is asked for. Safe to call whenever a drill opens.
 */
export async function preloadReactions(): Promise<void> {
  const all = await build();
  for (const kind of ["correct", "wrong"] as const) {
    for (const pop of all[kind]) new Image().src = reactionUrl(pop.image);
  }
}

/** The markup a screen drops in where reactions should appear. */
export function cheerBox(id: string): string {
  return `<div class="cheer" id="${id}"></div>`;
}

/**
 * Pop a reaction into a `cheerBox`. Does nothing if the box has gone.
 *
 * Synchronous whenever the pool is warm, which after `preloadReactions` it
 * is — an answer and its reaction land in the same frame, and no amount of
 * tapping ahead can get between them.
 */
export function showReaction(box: HTMLElement | null, kind: ReactionKind): void {
  if (!box) return;
  if (ready) {
    paint(box, pick(ready[kind]));
    return;
  }
  void build().then((all) => {
    if (box.isConnected) paint(box, pick(all[kind]));
  });
}

function paint(box: HTMLElement, pop: Pop): void {
  box.innerHTML = `
    <img src="${reactionUrl(pop.image).replace(/"/g, "&quot;")}" alt="" />
    <div class="cheer-text">${escapeHtml(pick(pop.texts))}</div>
  `;
  // An image that will not load leaves a grey rectangle where the joke was;
  // the line under it still lands, so drop the frame and keep the line.
  const img = box.querySelector("img")!;
  img.addEventListener("error", () => img.remove(), { once: true });
  box.classList.remove("show");
  // Restart the animation even when the same box pops twice in a row.
  void box.offsetWidth;
  box.classList.add("show");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
