#!/usr/bin/env node
/**
 * Post-process the built service worker:
 *
 *  - __BUILD_ID__ becomes the commit sha (or a local timestamp), so each
 *    deploy gets its own cache and clients stop serving a stale dictionary.
 *  - __PRECACHE__ becomes the real list of app-shell URLs from the build.
 *    Vite content-hashes asset filenames, so this list can only be produced
 *    after the build. Precaching matters because the worker starts
 *    controlling the page only after the first load — assets fetched during
 *    that first load never pass through it, so without an explicit precache
 *    the first offline launch has no JS or CSS and renders blank.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.argv[2] ? resolve(process.argv[2]) : join(root, "apps/web/dist");
const swPath = join(distDir, "sw.js");

if (!existsSync(swPath)) {
  console.error(`stamp-sw: ${swPath} not found`);
  process.exit(1);
}

/** Files that should never be precached: too large, or not part of the shell. */
function isExcluded(relPath) {
  const base = relPath.split("/").pop() ?? "";
  return (
    relPath === "sw.js" ||
    relPath === ".nojekyll" ||
    relPath === ".htaccess" || // server configuration, not a page resource
    // The audio endpoint is server-side code, not shell; fetching it at
    // install time would execute it (or cache its source on a static host).
    relPath === "audio.php" ||
    relPath === "audio-key.php" ||
    relPath === "grammar.php" ||
    relPath === "grammar-key.php" ||
    relPath.startsWith("dict/") || // megabytes; cached on first use instead
    // The reaction gifs, which are hundreds of kilobytes each and arrive on
    // first sight. Their JSON is the exception: it is a few hundred bytes and
    // decides what a drill can show, and a drill that has to wait for the
    // network to find that out shows nothing for its first answer.
    (relPath.startsWith("feedback/") && base !== "feedback.json") ||
    // The gacha's character models, and the gifs it hands out. A megabyte of
    // cutscene is not the shell, and someone who never opens a crate should
    // never download it.
    relPath.startsWith("gacha/models/") ||
    relPath.startsWith("gacha/gifs/") ||
    // The exam's theme: ten megabytes that only the exam plays, streamed
    // when it starts. Precaching it would bloat every install.
    relPath.startsWith("audio/") ||
    relPath.endsWith(".zip") || // the packaged extension
    // The Firebase SDK is loaded only when cloud sync is configured; a user
    // who never signs in should never download it, let alone at install time.
    base.startsWith("firebase-") ||
    // three.js, for the same reason: it arrives when a crate is opened.
    base.startsWith("three.module") ||
    base.startsWith("GLTFLoader")
  );
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(distDir)
  .map((f) => relative(distDir, f).split("\\").join("/"))
  .filter((f) => !isExcluded(f))
  .sort();

// "./" covers index.html at whatever path the app is deployed under.
const precache = ["./", ...files.filter((f) => f !== "index.html").map((f) => `./${f}`)];

const buildId = (process.env.GITHUB_SHA ?? `local-${Date.now()}`).slice(0, 12);

const source = readFileSync(swPath, "utf8");
const stamped = source
  .replaceAll("__BUILD_ID__", buildId)
  .replace("__PRECACHE__", JSON.stringify(precache, null, 2));

if (stamped.includes("__PRECACHE__") || stamped.includes("__BUILD_ID__")) {
  console.error("stamp-sw: placeholders were not fully replaced");
  process.exit(1);
}

writeFileSync(swPath, stamped);
console.log(`stamp-sw: cache ${buildId}, ${precache.length} precached files`);
