#!/usr/bin/env node
/** Encode the committed seed dictionary into the apps' public dirs when no
 * dictionary is present (fresh clone). `npm run build-dict` replaces these
 * with the full JMdict build.
 *
 * The apps read only the binary `yomeyo-dict-2` format, so the seed — which
 * is committed as readable JSON — is converted here rather than copied. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { binarySourceFromEntries, encodeBinaryDict } from "../packages/core/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  join(root, "apps/web/public/dict/dict.bin"),
  join(root, "apps/extension/public/dict/dict.bin"),
];

const missing = targets.filter((t) => !existsSync(t));
if (missing.length > 0) {
  const seed = JSON.parse(readFileSync(join(root, "data/seed-dict.json"), "utf8"));
  const bytes = encodeBinaryDict(
    binarySourceFromEntries(seed, { source: "Yomeyo seed dictionary", count: seed.length }),
  );
  for (const target of missing) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    console.log(`Seeded ${target} (${seed.length} entries)`);
  }
}
