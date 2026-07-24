#!/usr/bin/env node
/** Bundle the extension with esbuild and assemble dist/ (loadable unpacked). */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)));
const dist = join(here, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [
    join(here, "src/content.ts"),
    join(here, "src/background.ts"),
    join(here, "src/popup.ts"),
  ],
  bundle: true,
  format: "iife",
  target: "es2022",
  outdir: dist,
  logLevel: "info",
});

cpSync(join(here, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(here, "src/popup.html"), join(dist, "popup.html"));
cpSync(join(here, "public"), dist, { recursive: true });
console.log("Extension assembled in apps/extension/dist");
