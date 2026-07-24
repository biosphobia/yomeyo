#!/usr/bin/env node
/** Copy the committed seed dictionary into app public dirs when no
 * dictionary is present (fresh clone). `npm run build-dict` replaces these
 * with the full JMdict build. */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = join(root, "data/seed-dict.json");
for (const target of [
  join(root, "apps/web/public/dict/dict.json"),
  join(root, "apps/extension/public/dict/dict.json"),
]) {
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(seed, target);
    console.log(`Seeded ${target}`);
  }
}
