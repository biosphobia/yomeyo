#!/usr/bin/env node
/**
 * Build Yomeyo's dictionary from JMdict.
 *
 * Source: jmdict-simplified (https://github.com/scriptin/jmdict-simplified),
 * the maintained JSON conversion of the EDRDG JMdict project. Its schema is
 * documented at packages/jmdict-simplified-types/index.ts in that repo and
 * mirrored in the conversion below.
 *
 *   node scripts/build-dict.mjs                 # download the common-words build
 *   node scripts/build-dict.mjs --full          # download the complete JMdict
 *   node scripts/build-dict.mjs path/to.json    # convert an existing file
 *
 * Output is the compact `yomeyo-dict-1` format (positional tuples + interned
 * part-of-speech table), written into both apps' public/dict/ folders.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATHS = [
  join(root, "apps/web/public/dict/dict.json"),
  join(root, "apps/extension/public/dict/dict.json"),
];
const RELEASE_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

const args = process.argv.slice(2);
const wantFull = args.includes("--full");
const localPath = args.find((a) => !a.startsWith("--"));

/** Pick the right release asset and unpack it. */
async function downloadLatest() {
  console.log("Fetching latest jmdict-simplified release…");
  const headers = { "user-agent": "yomeyo-build-dict", accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(RELEASE_API, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  const release = await res.json();

  // Assets look like: jmdict-eng-3.6.1+20250101.json.zip
  //                   jmdict-eng-common-3.6.1+20250101.json.zip
  const common = release.assets.find((a) => /^jmdict-eng-common-.*\.json\.zip$/.test(a.name));
  const full = release.assets.find((a) => /^jmdict-eng-\d.*\.json\.zip$/.test(a.name));
  const chosen = wantFull ? (full ?? common) : (common ?? full);
  if (!chosen) {
    throw new Error(
      `No jmdict-eng asset in release ${release.tag_name}. Assets: ${release.assets.map((a) => a.name).join(", ")}`,
    );
  }

  console.log(`Downloading ${chosen.name} (${(chosen.size / 1e6).toFixed(1)} MB compressed)…`);
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const zipPath = join(dataDir, chosen.name);
  const dl = await fetch(chosen.browser_download_url);
  if (!dl.ok || !dl.body) throw new Error(`Download failed: ${dl.status} ${dl.statusText}`);
  await pipeline(dl.body, createWriteStream(zipPath));

  // The file inside the archive is not necessarily named after the archive,
  // so read the actual entry name rather than guessing it.
  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonEntry = listing.find((name) => name.endsWith(".json"));
  if (!jsonEntry) {
    throw new Error(`No .json file inside ${chosen.name}. Contents: ${listing.join(", ")}`);
  }

  execFileSync("unzip", ["-o", "-q", zipPath, "-d", dataDir], { stdio: "inherit" });
  const jsonPath = join(dataDir, jsonEntry);
  if (!existsSync(jsonPath)) {
    throw new Error(`Expected ${jsonPath} after unzip, but it is missing`);
  }
  console.log(`  extracted ${jsonEntry} (${(statSync(jsonPath).size / 1e6).toFixed(1)} MB)`);
  return jsonPath;
}

/**
 * Convert jmdict-simplified JSON to the compact Yomeyo format.
 *
 * Notes on the source schema:
 *  - `kanji[]` / `kana[]` carry a boolean `common` (JMdict's ichi/news/spec
 *    priority tags, already collapsed upstream). There are no finer-grained
 *    frequency ranks, so ranking here is "common first, then source order".
 *  - `kana[].appliesToKanji` is `["*"]` when the reading applies to every
 *    kanji form; otherwise it lists the specific forms. This matters for
 *    words like 早い/速い that share a headword group but not a reading.
 *  - `kanji[].tags` may include `rK` (rare) / `oK` (outdated) forms, which we
 *    skip when choosing a headword.
 */
export function convertJmdict(raw) {
  const words = raw.words ?? raw;
  if (!Array.isArray(words)) throw new Error("Unexpected JMdict JSON: no `words` array");

  const posTable = [];
  const posIndex = new Map();
  const internPos = (tag) => {
    let i = posIndex.get(tag);
    if (i === undefined) {
      i = posTable.length;
      posTable.push(tag);
      posIndex.set(tag, i);
    }
    return i;
  };

  const entries = [];
  let commonRank = 0;
  let rareRank = 0;

  for (const word of words) {
    const kanjiForms = word.kanji ?? [];
    const kanaForms = word.kana ?? [];
    if (kanaForms.length === 0) continue;

    // Flatten senses into one POS set and a short gloss list.
    const posIdx = [];
    const seenPos = new Set();
    const glosses = [];
    for (const sense of word.sense ?? []) {
      for (const tag of sense.partOfSpeech ?? []) {
        if (!seenPos.has(tag)) {
          seenPos.add(tag);
          posIdx.push(internPos(tag));
        }
      }
      const text = (sense.gloss ?? [])
        .filter((g) => !g.lang || g.lang === "eng")
        .map((g) => g.text)
        .join("; ");
      if (text) glosses.push(text);
    }
    if (glosses.length === 0) continue;
    const trimmedGlosses = glosses.slice(0, 5);

    /** Reading that goes with a given kanji form (or the primary reading). */
    const readingFor = (kanjiText) => {
      const match = kanaForms.find(
        (k) => !k.appliesToKanji?.length || k.appliesToKanji.includes("*") || k.appliesToKanji.includes(kanjiText),
      );
      return (match ?? kanaForms[0]).text;
    };

    const usableKanji = kanjiForms.filter((k) => !k.tags?.includes("rK") && !k.tags?.includes("oK"));
    const headwords = [];
    if (usableKanji.length > 0) {
      // Primary kanji form, plus any other *common* spellings so a tap on
      // either 早い or 速い resolves.
      headwords.push(usableKanji[0]);
      for (const alt of usableKanji.slice(1)) {
        if (alt.common) headwords.push(alt);
      }
    }

    if (headwords.length === 0) {
      // Kana-only word (ありがとう, これ, …)
      const kana = kanaForms[0];
      const freq = kana.common ? commonRank++ : 1_000_000 + rareRank++;
      entries.push([kana.text, kana.text, posIdx, trimmedGlosses, freq]);
      continue;
    }

    for (const form of headwords) {
      const isCommon = form.common || kanaForms.some((k) => k.common);
      const freq = isCommon ? commonRank++ : 1_000_000 + rareRank++;
      entries.push([form.text, readingFor(form.text), posIdx, trimmedGlosses, freq]);
    }
  }

  return {
    format: "yomeyo-dict-1",
    pos: posTable,
    entries,
    meta: {
      source: "JMdict (EDRDG) via jmdict-simplified",
      date: raw.dictDate ?? new Date().toISOString().slice(0, 10),
      count: entries.length,
    },
  };
}

/**
 * Guard against silently shipping a broken dictionary: the upstream schema
 * could change, or a download could truncate. Fail the build instead.
 */
export function verifyDict(dict, { minEntries = 10_000 } = {}) {
  const problems = [];
  if (dict.entries.length < minEntries) {
    problems.push(`only ${dict.entries.length} entries (expected ${minEntries}+)`);
  }

  const byTerm = new Map();
  for (const entry of dict.entries) {
    if (!byTerm.has(entry[0])) byTerm.set(entry[0], entry);
  }
  // Spot-check words a learner dictionary must contain, with the POS the
  // deinflector depends on being correct.
  const expectations = [
    ["食べる", "たべる", "v1"],
    ["読む", "よむ", "v5m"],
    ["高い", "たかい", "adj-i"],
    ["日本語", "にほんご", "n"],
    ["する", "する", null],
  ];
  for (const [term, reading, pos] of expectations) {
    const entry = byTerm.get(term);
    if (!entry) {
      problems.push(`missing entry: ${term}`);
      continue;
    }
    if (entry[1] !== reading) problems.push(`${term}: reading "${entry[1]}" != "${reading}"`);
    if (pos && !entry[2].map((i) => dict.pos[i]).some((p) => p === pos || p.startsWith(pos))) {
      problems.push(`${term}: POS ${JSON.stringify(entry[2].map((i) => dict.pos[i]))} lacks ${pos}`);
    }
    if (!entry[3]?.length) problems.push(`${term}: no glosses`);
  }

  if (problems.length > 0) {
    throw new Error(`Dictionary verification failed:\n  - ${problems.join("\n  - ")}`);
  }
}

async function main() {
  const jsonPath = localPath ? resolve(localPath) : await downloadLatest();
  console.log(`Converting ${jsonPath}…`);
  const dict = convertJmdict(JSON.parse(readFileSync(jsonPath, "utf8")));
  console.log(`  ${dict.entries.length} entries, ${dict.pos.length} distinct POS tags`);
  verifyDict(dict);
  console.log("  verification passed");

  const payload = JSON.stringify(dict);
  for (const outPath of OUT_PATHS) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, payload);
    console.log(`Wrote ${outPath} (${(statSync(outPath).size / 1e6).toFixed(1)} MB)`);
  }
}

// Only run the pipeline when invoked as a script, so tests can import the
// conversion and verification functions.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nbuild-dict failed: ${err.message ?? err}`);
    process.exit(1);
  });
}
