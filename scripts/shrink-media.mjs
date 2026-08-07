#!/usr/bin/env node
/**
 * Bring every reaction image to the same weight, on the way out.
 *
 * Reactions arrive from wherever pictures come from: 35 KB or 12 MB, tall or
 * wide, an animation or a photograph — gif, webp, avif, png, jpeg. On screen
 * they are all drawn in one fixed box, so the extra pixels are never seen:
 * they are only a slower first showing on a phone, and the phone is where
 * this app lives.
 *
 * This runs as part of the web build, over `dist`, so the originals stay in
 * the repository exactly as they were uploaded and what gets deployed is the
 * squeezed copy. Nothing to remember, nothing to run: drop a picture into
 * `public/gacha/gifs/` on GitHub and the next deploy shrinks it.
 *
 *   node scripts/shrink-media.mjs dist          # a built site
 *   node scripts/shrink-media.mjs a.gif b.webp  # named files, in place
 *
 * Gifs go through gifsicle, everything else through sharp; both are dev
 * dependencies, so a plain `npm ci` has them. A file that cannot be shrunk is
 * left alone with a line saying so — a picture slightly too heavy is not
 * worth failing a deploy over.
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The box a reaction is drawn in is 280x196 CSS px; this is comfortably 2x. */
const MAX_SIDE = 320;
const MAX_KB = 260;

/** Where reactions live inside a built site. The models under `gacha/`
 *  are not images and are skipped by the extension filter below. */
const PLACES = ["gacha", "feedback"];
const KINDS = new Set([".gif", ".webp", ".avif", ".png", ".jpg", ".jpeg"]);

const kb = (file) => Math.round(statSync(file).size / 1000);
const name = (file) => file.split("/").pop();

/**
 * What a file actually is, read from its first bytes.
 *
 * Not from its name. Pictures arrive named after whatever the person who
 * saved them thought they were — an animated avif called `.gif` is a real
 * thing that turns up — and a name is not a format. Browsers have always
 * sniffed images rather than trusting the extension, so the file works
 * regardless; what a name gets wrong is which tool is handed the file, which
 * is how a perfectly good picture ends up reported as corrupt.
 */
function sniff(file) {
  const head = Buffer.alloc(32);
  const fd = openSync(file, "r");
  try {
    readSync(fd, head, 0, 32, 0);
  } finally {
    closeSync(fd);
  }
  const at = (from, to) => head.subarray(from, to).toString("latin1");
  if (at(0, 3) === "GIF") return "gif";
  if (at(0, 4) === "RIFF" && at(8, 12) === "WEBP") return "webp";
  if (at(4, 8) === "ftyp") {
    // `avis` marks an image *sequence* — an animated avif — and it can sit
    // anywhere in the brand list, not only first. Nothing here can write
    // one, so those are left exactly as they came.
    return at(8, 32).includes("avis") ? "avif-sequence" : "avif";
  }
  if (head[0] === 0x89 && at(1, 4) === "PNG") return "png";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  return "unknown";
}

// ---------------- gifs: gifsicle ----------------

let gifsiclePath;
function gifsicle() {
  if (gifsiclePath !== undefined) return gifsiclePath;
  for (const candidate of [
    join(root, "node_modules/gifsicle/vendor/gifsicle"),
    join(root, "node_modules/.bin/gifsicle"),
  ]) {
    if (existsSync(candidate)) return (gifsiclePath = candidate);
  }
  try {
    execFileSync("gifsicle", ["--version"], { stdio: "ignore" });
    return (gifsiclePath = "gifsicle");
  } catch {
    return (gifsiclePath = null);
  }
}

function gifInfo(file) {
  const out = execFileSync(gifsicle(), ["--info", file], { encoding: "utf8" });
  const frames = (out.match(/^\s*\+ image #/gm) ?? []).length;
  const screen = out.match(/logical screen (\d+)x(\d+)/);
  return {
    frames: frames || 1,
    width: Number(screen?.[1] ?? 0),
    height: Number(screen?.[2] ?? 0),
    delay: Number(out.match(/delay ([\d.]+)s/)?.[1] ?? 0.07) * 100,
  };
}

/**
 * One attempt at the budget: keep every `step` frames (stretching the delay
 * so it still plays at the same speed), fit the longest side, requantise.
 */
function squeezeGif(src, out, { step, side, colours, lossy, frames, delay }) {
  const keep = [];
  for (let i = 0; i < frames; i += step) keep.push(`#${i}`);
  const args = ["--unoptimize", src, ...keep];
  if (step > 1) args.push(`--delay=${Math.max(2, Math.round(delay * step))}`);
  args.push(
    side.axis === "width" ? `--resize-width=${side.px}` : `--resize-height=${side.px}`,
    `--lossy=${lossy}`,
    "--colors",
    String(colours),
    "-O3",
    "-o",
    out,
  );
  execFileSync(gifsicle(), args, { stdio: ["ignore", "ignore", "ignore"] });
}

function shrinkGif(file) {
  if (!gifsicle()) return `${name(file)}: gifsicle not installed, left alone`;
  const before = kb(file);
  const meta = gifInfo(file);
  if (before <= MAX_KB && Math.max(meta.width, meta.height) <= MAX_SIDE) return null;

  const side =
    meta.height >= meta.width
      ? { axis: "height", px: Math.min(MAX_SIDE, meta.height) }
      : { axis: "width", px: Math.min(MAX_SIDE, meta.width) };

  const tmp = join(tmpdir(), `shrink-${process.pid}-${Math.random().toString(36).slice(2)}.gif`);
  let best = null;
  // Gentlest first, and frames last of all: a gif with half its frames
  // removed is visibly worse than one drawn slightly smaller, so shrink and
  // requantise as far as they will go before touching the animation.
  const steps = meta.frames > 1 ? [1, 2, 3] : [1];
  for (const step of steps) {
    for (const px of [side.px, Math.round(side.px * 0.8), Math.round(side.px * 0.65)]) {
      for (const [colours, lossy] of [
        [128, 40],
        [64, 90],
        [64, 160],
        [48, 200],
      ]) {
        const thisSide = { axis: side.axis, px };
        squeezeGif(file, tmp, { step, side: thisSide, colours, lossy, frames: meta.frames, delay: meta.delay });
        const size = kb(tmp);
        if (!best || size < best.size) best = { size, step, colours, lossy, side: thisSide };
        if (size <= MAX_KB) {
          copyFileSync(tmp, file);
          unlinkSync(tmp);
          const after = gifInfo(file);
          return `${name(file)}: ${before} -> ${size} KB (${meta.frames} -> ${after.frames} frames, ${after.width}x${after.height})`;
        }
      }
    }
  }
  squeezeGif(file, tmp, { ...best, frames: meta.frames, delay: meta.delay });
  copyFileSync(tmp, file);
  unlinkSync(tmp);
  return `${name(file)}: ${before} -> ${kb(file)} KB (over budget, kept the smallest)`;
}

// ---------------- everything else: sharp ----------------

let sharpLib;
async function sharp() {
  if (sharpLib !== undefined) return sharpLib;
  try {
    sharpLib = (await import("sharp")).default;
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

/** Each format keeps its own container: the bytes go back as what they were. */
function encode(pipeline, kind, quality, loop) {
  switch (kind) {
    case "png":
      return pipeline.png({ compressionLevel: 9, palette: true, quality });
    case "jpeg":
      return pipeline.jpeg({ quality, mozjpeg: true });
    case "avif":
      // Slower to encode than the rest and worth it: for a photograph avif is
      // routinely half the size of jpeg at the same quality.
      return pipeline.avif({ quality, effort: 4 });
    default:
      return pipeline.webp({ quality, effort: 4, loop });
  }
}

/**
 * Shrink anything that is not a gif: webp, avif, png, jpeg — a drawing, an
 * animation, or a photograph straight off a phone.
 *
 * Two things are done for photographs in particular. They are turned the
 * right way up, because a photo carries its rotation as a note in its
 * metadata rather than in its pixels, and the notes are dropped here — which
 * is the second thing, and why: a photo taken on a phone carries the place
 * and time it was taken, and a reaction gif has no business telling anyone
 * where the person who made it was standing.
 *
 * Resizing is by width alone, never height. An animated webp is one tall
 * strip of frames, and asking for a height resizes the strip rather than the
 * picture; width scales the frames and lets the strip follow, which is the
 * same thing said safely.
 */
async function shrinkRaster(file, kind) {
  const lib = await sharp();
  if (!lib) return `${name(file)}: sharp not installed, left alone`;
  const before = kb(file);
  const meta = await lib(file, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  // A quarter-turn in the metadata swaps what "wide" means.
  const turned = (meta.orientation ?? 1) >= 5;
  const height = (turned ? meta.width : meta.pageHeight ?? meta.height) ?? 0;
  const width = (turned ? meta.pageHeight ?? meta.height : meta.width) ?? 0;
  if (before <= MAX_KB && Math.max(width, height) <= MAX_SIDE) return null;

  // The width that brings the longest side down to the budget.
  // An avif that turns out to be a sequence after all: sharp would keep
  // only its first frame, which is how an animation stops animating.
  if (kind === "avif" && pages > 1) return `${name(file)}: animated avif, left alone (${before} KB)`;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height, 1));
  let best = null;
  // Smaller beats blurrier. The picture is drawn in a box a phone can cover
  // with a thumb, so a few hundred fewer pixels across costs nothing anyone
  // can see, while quality 30 is visible on any screen — so the ladder gives
  // up size first and only leans on quality once size has nothing left.
  for (const [shrink, quality] of [
    [1, 80],
    [1, 65],
    [0.8, 65],
    [0.8, 50],
    [0.65, 50],
    [0.65, 40],
    [0.5, 40],
    [0.5, 30],
  ]) {
    const px = Math.max(48, Math.round(width * scale * shrink));
    // `rotate()` with no angle means "however the metadata says"; it cannot be
    // asked of a strip of frames, which has no orientation note anyway.
    const pipeline = lib(file, { animated: pages > 1 });
    const buffer = await encode(
      (pages > 1 ? pipeline : pipeline.rotate()).resize({ width: px, withoutEnlargement: true }),
      kind,
      quality,
      meta.loop ?? 0,
    ).toBuffer();
    if (!best || buffer.length < best.buffer.length) best = { buffer, px, quality };
    if (buffer.length / 1000 <= MAX_KB) return writeShrunk(file, { buffer, px, quality }, before, pages);
  }
  return `${writeShrunk(file, best, before, pages)} (over budget, kept the smallest)`;
}

function writeShrunk(file, { buffer, px, quality }, before, pages) {
  const tmp = `${file}.shrinking`;
  writeFileSync(tmp, buffer);
  renameSync(tmp, file);
  return `${name(file)}: ${before} -> ${kb(file)} KB (${px}px wide, quality ${quality}${
    pages > 1 ? `, ${pages} frames` : ""
  })`;
}

// ---------------- walking the build ----------------

function filesUnder(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (KINDS.has(extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const targets = [];
  if (args.length === 0) {
    for (const place of PLACES) targets.push(...filesUnder(join(root, "apps/web/public", place)));
  }
  for (const arg of args) {
    const path = resolve(arg);
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) {
      // A built site: only the places reactions live in, so the icons and the
      // kanji stroke files are not touched.
      for (const place of PLACES) targets.push(...filesUnder(join(path, place)));
    } else if (KINDS.has(extname(path).toLowerCase())) {
      targets.push(path);
    }
  }
  if (targets.length === 0) return;

  let saved = 0;
  const lines = [];
  for (const file of targets) {
    const before = statSync(file).size;
    try {
      const kind = sniff(file);
      let line;
      if (kind === "gif") {
        line = shrinkGif(file);
      } else if (kind === "avif-sequence" || kind === "unknown") {
        // An animated avif cannot be rewritten by anything here, and an
        // unrecognised file is not ours to guess at. Said out loud only when
        // it is over budget, since there is nothing to be done about it.
        line = kb(file) > MAX_KB ? `${name(file)}: ${kind === "unknown" ? "unrecognised" : "animated avif"}, left alone (${kb(file)} KB)` : null;
      } else {
        line = await shrinkRaster(file, kind);
      }
      // A name that lies about the format is worth saying, shrunk or not:
      // browsers sniff and cope, but a person reading the folder will not,
      // and neither would anything else that trusts the extension.
      const named = extname(file).toLowerCase().slice(1).replace("jpg", "jpeg");
      if (named !== kind && !(kind === "avif-sequence" && named === "avif")) {
        line = `${line ?? `${name(file)}: ${kb(file)} KB, within budget`} — really ${kind}, not ${named}`;
      }
      if (line) lines.push(line);
    } catch (err) {
      lines.push(`${name(file)}: left alone (${err instanceof Error ? err.message : err})`);
      continue;
    }
    saved += before - statSync(file).size;
  }
  if (lines.length === 0) {
    console.log(`shrink-media: ${targets.length} reactions, all within budget`);
    return;
  }
  console.log(`shrink-media: budget ${MAX_SIDE}px, ${MAX_KB} KB`);
  for (const line of lines) console.log(`  ${line}`);
  if (saved > 0) console.log(`  saved ${Math.round(saved / 1000)} KB in total`);
}

await main();
