#!/usr/bin/env node
/**
 * Build a full dictionary for Yomeyo from JMdict.
 *
 * Downloads jmdict-simplified (https://github.com/scriptin/jmdict-simplified)
 * English JSON, converts it to Yomeyo's flat DictFile format, and writes it
 * to the web app and extension public dirs (replacing the bundled seed
 * dictionary). Run with:
 *
 *   npm run build-dict                 # download latest and convert
 *   npm run build-dict -- path.json    # convert an already-downloaded file
 *
 * Without arguments this needs network access to github.com.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATHS = [
  join(root, "apps/web/public/dict/dict.json"),
  join(root, "apps/extension/public/dict/dict.json"),
];

const RELEASE_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

async function downloadLatest() {
  console.log("Fetching latest jmdict-simplified release info...");
  const res = await fetch(RELEASE_API, { headers: { "user-agent": "yomeyo-build-dict" } });
  if (!res.ok) throw new Error(`GitHub API: ${res.status} ${res.statusText}`);
  const release = await res.json();
  const asset = release.assets.find((a) => /^jmdict-eng-\d.*\.json\.zip$/.test(a.name) && !a.name.includes("common"));
  const common = release.assets.find((a) => /^jmdict-eng-common-.*\.json\.zip$/.test(a.name));
  const chosen = common ?? asset; // prefer the "common words only" build: much smaller, plenty for learners
  if (!chosen) throw new Error("No jmdict-eng asset found in latest release");
  console.log(`Downloading ${chosen.name} (${(chosen.size / 1e6).toFixed(1)} MB)...`);
  const zipPath = join(root, "data", chosen.name);
  const dl = await fetch(chosen.browser_download_url);
  if (!dl.ok || !dl.body) throw new Error(`Download failed: ${dl.status}`);
  await pipeline(dl.body, createWriteStream(zipPath));

  // Unzip via node: use the built-in zlib only handles gzip; JSON.zip is a
  // zip archive, so shell out to `unzip` which is present on most systems.
  const { execFileSync } = await import("node:child_process");
  execFileSync("unzip", ["-o", zipPath, "-d", join(root, "data")], { stdio: "inherit" });
  const jsonName = chosen.name.replace(/\.zip$/, "");
  return join(root, "data", jsonName);
}

function convert(jmdictPath) {
  console.log(`Converting ${jmdictPath} ...`);
  const raw = JSON.parse(readFileSync(jmdictPath, "utf8"));
  const words = raw.words ?? raw;
  const out = [];
  let rank = 0;

  for (const word of words) {
    const kanji = word.kanji ?? [];
    const kana = word.kana ?? [];
    const isCommon = kanji.some((k) => k.common) || kana.some((k) => k.common);

    // Headword: first non-rare kanji form, else first kana form.
    const headKanji = kanji.find((k) => !k.tags?.includes("rK") && !k.tags?.includes("oK"));
    const headKana = kana[0];
    if (!headKana) continue;
    const term = headKanji?.text ?? headKana.text;
    const reading = headKana.text;

    // Merge all senses' POS and glosses (keep it flat and small).
    const pos = new Set();
    const glosses = [];
    for (const sense of word.sense ?? []) {
      for (const p of sense.partOfSpeech ?? []) pos.add(p);
      const senseGlosses = (sense.gloss ?? [])
        .filter((g) => !g.lang || g.lang === "eng")
        .map((g) => g.text);
      if (senseGlosses.length > 0) glosses.push(senseGlosses.join("; "));
    }
    if (glosses.length === 0) continue;

    rank += 1;
    const entry = {
      term,
      reading,
      pos: [...pos],
      glosses: glosses.slice(0, 5),
    };
    if (isCommon) entry.freq = rank;
    out.push(entry);

    // Also index common alternate kanji spellings as separate entries so
    // taps on e.g. 早い vs 速い both resolve.
    for (const alt of kanji.slice(1)) {
      if (!alt.common || alt.text === term) continue;
      out.push({ ...entry, term: alt.text });
    }
  }

  console.log(`${out.length} entries`);
  return out;
}

async function main() {
  const argPath = process.argv[2];
  const jsonPath = argPath ? resolve(argPath) : await downloadLatest();
  if (!existsSync(jsonPath)) throw new Error(`Not found: ${jsonPath}`);
  const dict = convert(jsonPath);
  const payload = JSON.stringify(dict);
  for (const outPath of OUT_PATHS) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, payload);
    console.log(`Wrote ${outPath} (${(payload.length / 1e6).toFixed(1)} MB)`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
