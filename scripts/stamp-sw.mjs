#!/usr/bin/env node
/**
 * Replace the service worker's __BUILD_ID__ placeholder so each deploy gets
 * its own cache name and clients stop serving a stale dictionary.
 * Uses $GITHUB_SHA in CI, otherwise a local timestamp.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const swPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, "apps/web/dist/sw.js");

if (!existsSync(swPath)) {
  console.error(`stamp-sw: ${swPath} not found`);
  process.exit(1);
}

const buildId = (process.env.GITHUB_SHA ?? `local-${Date.now()}`).slice(0, 12);
const source = readFileSync(swPath, "utf8");
writeFileSync(swPath, source.replaceAll("__BUILD_ID__", buildId));
console.log(`stamp-sw: cache version ${buildId}`);
