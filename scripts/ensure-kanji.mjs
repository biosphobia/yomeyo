#!/usr/bin/env node
/** Seed a small sample kanji index when no built one is present, so the Kanji
 * section works on a fresh clone. `npm run build-kanji` replaces it with the
 * full KANJIDIC2 + KanjiVG data (including stroke order). */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = join(root, "data/seed-kanji.json");
const target = join(root, "apps/web/public/kanji/index.json");

if (!existsSync(target)) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(seed, target);
  console.log(`Seeded ${target}`);
}
