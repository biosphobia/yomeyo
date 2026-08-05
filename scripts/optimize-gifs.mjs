#!/usr/bin/env node
/**
 * Bring every reaction gif to the same weight.
 *
 * They arrive from wherever gifs come from: some 35 KB, some 1.6 MB, some
 * tall, some wide. On screen they are all drawn in one fixed box, so the
 * extra pixels in the big ones are never seen — they are just a slower first
 * showing on a phone. This squeezes each one until it fits the same budget:
 * the longest side no larger than MAX_SIDE, the file no larger than MAX_KB.
 *
 * Frames go first, because frame count is nearly always the weight; then the
 * palette, then quality. A gif already inside the budget is left alone.
 *
 *   node scripts/optimize-gifs.mjs                # every gacha gif
 *   node scripts/optimize-gifs.mjs path/to/a.gif  # just these
 *
 * Needs gifsicle: npx --yes gifsicle  (or npm i -D gifsicle)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, copyFileSync, unlinkSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The box a reaction is drawn in is 280x196 CSS px; this is comfortably 2x. */
const MAX_SIDE = 320;
const MAX_KB = 260;

function gifsicle() {
  for (const candidate of [
    join(root, "node_modules/gifsicle/vendor/gifsicle"),
    join(root, "node_modules/.bin/gifsicle"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    execFileSync("gifsicle", ["--version"], { stdio: "ignore" });
    return "gifsicle";
  } catch {
    console.error("gifsicle not found. Install it with:  npm i -D gifsicle");
    process.exit(1);
  }
}

const GS = gifsicle();

function info(file) {
  const out = execFileSync(GS, ["--info", file], { encoding: "utf8" });
  const frames = (out.match(/^\s*\+ image #/gm) ?? []).length;
  const screen = out.match(/logical screen (\d+)x(\d+)/);
  return {
    frames: frames || 1,
    width: Number(screen?.[1] ?? 0),
    height: Number(screen?.[2] ?? 0),
  };
}

const kb = (file) => Math.round(statSync(file).size / 1000);

/**
 * One attempt at a budget: keep every `step` frames (stretching the delay so
 * it still plays at the same speed), fit the longest side, requantise.
 */
function squeeze(src, out, { step, side, colours, lossy, frames, delay }) {
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
  execFileSync(GS, args, { stdio: ["ignore", "ignore", "ignore"] });
}

function optimize(file) {
  const before = kb(file);
  const meta = info(file);
  const longest = Math.max(meta.width, meta.height);
  if (before <= MAX_KB && longest <= MAX_SIDE) {
    console.log(`  ${file.split("/").pop()}: ${before} KB, ${meta.width}x${meta.height} — already within budget`);
    return;
  }

  // The frame delay, in hundredths, as gifsicle reports it for frame 0.
  const raw = execFileSync(GS, ["--info", file], { encoding: "utf8" });
  const delay = Number(raw.match(/delay ([\d.]+)s/)?.[1] ?? 0.07) * 100;

  const side =
    meta.height >= meta.width
      ? { axis: "height", px: Math.min(MAX_SIDE, meta.height) }
      : { axis: "width", px: Math.min(MAX_SIDE, meta.width) };

  const tmp = join(tmpdir(), `gifopt-${process.pid}-${Math.random().toString(36).slice(2)}.gif`);
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
      squeeze(file, tmp, { step, side: thisSide, colours, lossy, frames: meta.frames, delay });
      const size = kb(tmp);
      if (!best || size < best.size) best = { size, step, colours, lossy, side: thisSide };
      if (size <= MAX_KB) {
        copyFileSync(tmp, file);
        unlinkSync(tmp);
        const after = info(file);
        console.log(
          `  ${file.split("/").pop()}: ${before} KB -> ${size} KB ` +
            `(${meta.frames} -> ${after.frames} frames, ${after.width}x${after.height})`,
        );
        return;
      }
      }
    }
  }
  // Nothing fitted; keep the smallest we managed rather than the original.
  squeeze(file, tmp, { ...best, frames: meta.frames, delay });
  copyFileSync(tmp, file);
  unlinkSync(tmp);
  console.log(`  ${file.split("/").pop()}: ${before} KB -> ${kb(file)} KB (over budget, kept the smallest)`);
}

const targets =
  process.argv.length > 2
    ? process.argv.slice(2).map((p) => resolve(p))
    : readdirSync(join(root, "apps/web/public/gacha/gifs"))
        .filter((f) => extname(f).toLowerCase() === ".gif")
        .map((f) => join(root, "apps/web/public/gacha/gifs", f));

console.log(`Budget: longest side ${MAX_SIDE}px, ${MAX_KB} KB\n`);
for (const file of targets) optimize(file);
