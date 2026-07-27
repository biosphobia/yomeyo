#!/usr/bin/env node
/** Report facts about a built dictionary, for the CI build summary.
 *
 *   node scripts/dict-info.mjs entries [path]
 *
 * Reads the file the same way the apps do, so a dictionary this cannot open
 * is one the apps could not have opened either. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BinaryDictionary } from "../packages/core/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [what = "entries", path = join(root, "apps/web/public/dict/dict.bin")] = process.argv.slice(2);
const file = readFileSync(path);
const dict = new BinaryDictionary(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

if (what === "entries") console.log(dict.size);
else if (what === "meta") console.log(JSON.stringify(dict.meta ?? {}));
else {
  console.error(`Unknown query "${what}" (expected: entries, meta)`);
  process.exit(1);
}
