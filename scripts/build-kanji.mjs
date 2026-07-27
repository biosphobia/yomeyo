#!/usr/bin/env node
/**
 * Build Yomeyo's kanji data.
 *
 * Two sources, both from the same family of freely-licensed projects already
 * used for the vocabulary dictionary:
 *
 *  - KANJIDIC2 (EDRDG, CC BY-SA) via jmdict-simplified's JSON conversion:
 *    meanings, on/kun readings, grade, stroke count, JLPT level, frequency.
 *  - KanjiVG (CC BY-SA 3.0): the stroke paths, in stroke order, which is what
 *    makes an animation possible rather than a static picture.
 *
 *   node scripts/build-kanji.mjs                      # download both
 *   node scripts/build-kanji.mjs kanjidic.json vg.zip # convert local copies
 *
 * Output:
 *   kanji/index.json        one compact record per kanji (grade, readings, …)
 *   kanji/strokes/<bb>.json stroke paths, bucketed by codepoint so a detail
 *                           view fetches ~100 KB instead of the whole set
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIRS = [join(root, "apps/web/public/kanji")];

const KANJIDIC_RELEASES = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";
const KANJIVG_RELEASES = "https://api.github.com/repos/KanjiVG/kanjivg/releases/latest";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function apiHeaders() {
  const headers = { "user-agent": "yomeyo-build-kanji", accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function download(url, destination) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  await pipeline(res.body, createWriteStream(destination));
  return destination;
}

/** Unzip and return the path of the single entry matching a predicate. */
function unzipEntry(zipPath, dir, matches) {
  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const entry = listing.find(matches);
  if (!entry) throw new Error(`No matching entry in ${zipPath}. Contents: ${listing.slice(0, 10).join(", ")}`);
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir], { stdio: "inherit" });
  return join(dir, entry);
}

async function fetchKanjidic() {
  console.log("Fetching KANJIDIC2…");
  const res = await fetch(KANJIDIC_RELEASES, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const release = await res.json();
  const asset = release.assets.find((a) => /^kanjidic2-en-.*\.json\.zip$/.test(a.name));
  if (!asset) {
    throw new Error(`No kanjidic2-en asset. Assets: ${release.assets.map((a) => a.name).join(", ")}`);
  }
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const zip = await download(asset.browser_download_url, join(dataDir, asset.name));
  return unzipEntry(zip, dataDir, (n) => n.endsWith(".json"));
}

async function fetchKanjiVG() {
  console.log("Fetching KanjiVG…");
  const res = await fetch(KANJIVG_RELEASES, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const release = await res.json();
  // Prefer the plain "main" archive: one SVG per kanji, no variants.
  const asset =
    release.assets.find((a) => /kanjivg-.*-main\.zip$/.test(a.name)) ??
    release.assets.find((a) => a.name.endsWith(".zip"));
  if (!asset) throw new Error("No KanjiVG zip asset found");
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const zip = await download(asset.browser_download_url, join(dataDir, asset.name));
  execFileSync("unzip", ["-o", "-q", zip, "-d", join(dataDir, "kanjivg")], { stdio: "inherit" });
  return join(dataDir, "kanjivg");
}

/**
 * Convert KANJIDIC2 JSON into one compact record per kanji.
 *
 * Schema notes (verified against jmdict-simplified's published types):
 *  - `misc.grade` 1-6 are taught in elementary school, 8 is the rest of the
 *    jōyō set, 9/10 are jinmeiyō (names only) — so jōyō is grade <= 8.
 *  - readings live in `readingMeaning.groups[].readings[]` tagged `ja_on` /
 *    `ja_kun`; meanings alongside them, tagged by 2-letter language.
 */
export function convertKanjidic(raw) {
  const characters = raw.characters ?? raw;
  if (!Array.isArray(characters)) throw new Error("Unexpected KANJIDIC2 JSON: no `characters` array");

  const kanji = [];
  for (const entry of characters) {
    const literal = entry.literal;
    if (!literal || [...literal].length !== 1) continue;

    const on = [];
    const kun = [];
    const meanings = [];
    for (const group of entry.readingMeaning?.groups ?? []) {
      for (const reading of group.readings ?? []) {
        if (reading.type === "ja_on" && !on.includes(reading.value)) on.push(reading.value);
        if (reading.type === "ja_kun" && !kun.includes(reading.value)) kun.push(reading.value);
      }
      for (const meaning of group.meanings ?? []) {
        // KANJIDIC2 uses 2-letter codes and omits the tag for English.
        if ((!meaning.lang || meaning.lang === "en") && !meanings.includes(meaning.value)) {
          meanings.push(meaning.value);
        }
      }
    }
    if (meanings.length === 0 && on.length === 0 && kun.length === 0) continue;

    kanji.push([
      literal,
      entry.misc?.grade ?? 0,
      entry.misc?.strokeCounts?.[0] ?? 0,
      entry.misc?.jlptLevel ?? 0,
      entry.misc?.frequency ?? 0,
      on.slice(0, 8),
      kun.slice(0, 8),
      meanings.slice(0, 6),
    ]);
  }

  return {
    format: "yomeyo-kanji-1",
    kanji,
    meta: {
      source: "KANJIDIC2 (EDRDG) via jmdict-simplified",
      date: raw.dictDate ?? new Date().toISOString().slice(0, 10),
      count: kanji.length,
    },
  };
}

/** Stroke paths for one kanji, in stroke order, from a KanjiVG SVG. */
export function extractStrokes(svg) {
  const paths = [];
  // KanjiVG marks each stroke with an id like "kvg:05b66-s3"; other <path>
  // elements (radical groups) have no such id and must not be included.
  const re = /<path\b[^>]*\bid="[^"]*-s\d+"[^>]*\bd="([^"]+)"[^>]*\/?>/g;
  let match;
  while ((match = re.exec(svg)) !== null) paths.push(match[1]);
  if (paths.length === 0) {
    // Some files order the attributes the other way round.
    const alt = /<path\b[^>]*\bd="([^"]+)"[^>]*\bid="[^"]*-s\d+"[^>]*\/?>/g;
    while ((match = alt.exec(svg)) !== null) paths.push(match[1]);
  }
  return paths;
}

/** Group strokes into buckets so a detail view fetches only what it needs. */
export function bucketFor(character) {
  const cp = character.codePointAt(0);
  return Math.floor(cp / 256)
    .toString(16)
    .padStart(2, "0");
}

function collectStrokes(kanjivgDir, characters) {
  const buckets = new Map();
  let found = 0;
  for (const character of characters) {
    const hex = character.codePointAt(0).toString(16).padStart(5, "0");
    const file = join(kanjivgDir, "kanji", `${hex}.svg`);
    if (!existsSync(file)) continue;
    const strokes = extractStrokes(readFileSync(file, "utf8"));
    if (strokes.length === 0) continue;
    const bucket = bucketFor(character);
    if (!buckets.has(bucket)) buckets.set(bucket, {});
    buckets.get(bucket)[character] = strokes;
    found++;
  }
  return { buckets, found };
}

export function verifyKanji(index, { minKanji = 5000, requireJoyo = true } = {}) {
  const problems = [];
  if (index.kanji.length < minKanji) {
    problems.push(`only ${index.kanji.length} kanji (expected ${minKanji}+)`);
  }
  const byChar = new Map(index.kanji.map((k) => [k[0], k]));

  // Spot-checks: a grade-1 kanji, a compound-heavy one, and one whose
  // readings matter for the vocabulary side.
  const expectations = [
    { char: "一", grade: 1, strokes: 1, meaning: /one/i },
    { char: "日", grade: 1, strokes: 4, meaning: /day|sun/i },
    { char: "語", grade: 2, strokes: 14, meaning: /language|word/i },
  ];
  for (const { char, grade, strokes, meaning } of expectations) {
    const record = byChar.get(char);
    if (!record) {
      problems.push(`missing kanji: ${char}`);
      continue;
    }
    if (record[1] !== grade) problems.push(`${char}: grade ${record[1]} != ${grade}`);
    if (record[2] !== strokes) problems.push(`${char}: ${record[2]} strokes != ${strokes}`);
    if (!record[7].some((m) => meaning.test(m))) {
      problems.push(`${char}: meanings ${JSON.stringify(record[7])} lack ${meaning}`);
    }
    if (record[5].length === 0 && record[6].length === 0) problems.push(`${char}: no readings`);
  }

  if (requireJoyo) {
    const joyo = index.kanji.filter((k) => k[1] >= 1 && k[1] <= 8);
    // The jōyō list is 2136 characters; allow slack for revisions.
    if (joyo.length < 2000 || joyo.length > 2300) {
      problems.push(`jōyō count looks wrong: ${joyo.length} (expected ~2136)`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Kanji verification failed:\n  - ${problems.join("\n  - ")}`);
  }
}

async function main() {
  const kanjidicPath = args[0] ?? (await fetchKanjidic());
  console.log(`Converting ${kanjidicPath}…`);
  const index = convertKanjidic(JSON.parse(readFileSync(kanjidicPath, "utf8")));
  console.log(`  ${index.kanji.length} kanji`);
  verifyKanji(index);
  console.log("  verification passed");

  const kanjivgDir = args[1]
    ? args[1].endsWith(".zip")
      ? (() => {
          const dir = join(root, "data/kanjivg");
          execFileSync("unzip", ["-o", "-q", args[1], "-d", dir], { stdio: "inherit" });
          return dir;
        })()
      : args[1]
    : await fetchKanjiVG();

  const { buckets, found } = collectStrokes(
    kanjivgDir,
    index.kanji.map((k) => k[0]),
  );
  console.log(`  stroke data for ${found} kanji in ${buckets.size} buckets`);
  if (found < 5000) throw new Error(`Only ${found} kanji have stroke data; expected 5000+`);

  for (const outDir of OUT_DIRS) {
    mkdirSync(join(outDir, "strokes"), { recursive: true });
    const indexPath = join(outDir, "index.json");
    writeFileSync(indexPath, JSON.stringify(index));
    for (const [bucket, data] of buckets) {
      writeFileSync(join(outDir, "strokes", `${bucket}.json`), JSON.stringify(data));
    }
    console.log(`Wrote ${indexPath} (${(statSync(indexPath).size / 1e6).toFixed(1)} MB) + strokes/`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nbuild-kanji failed: ${err.message ?? err}`);
    process.exit(1);
  });
}
