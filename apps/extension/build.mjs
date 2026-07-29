#!/usr/bin/env node
/**
 * Bundle the extension once per engine.
 *
 *   dist/chromium/   loadable unpacked in Chrome/Edge and Chromium-based
 *                    Android browsers
 *   dist/firefox/    installable in Firefox (including Firefox for Android)
 *
 * `dist/` itself stays a copy of the Chromium build so existing "Load
 * unpacked → apps/extension/dist" instructions keep working.
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, manifestFor } from "./manifest.config.mjs";

const here = resolve(dirname(fileURLToPath(import.meta.url)));
const dist = join(here, "dist");

rmSync(dist, { recursive: true, force: true });

for (const target of TARGETS) {
  const outDir = join(dist, target);
  mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [
      join(here, "src/content.ts"),
      join(here, "src/background.ts"),
      join(here, "src/popup.ts"),
      join(here, "src/offscreen.ts"),
    ],
    bundle: true,
    format: "iife",
    target: target === "firefox" ? "firefox115" : "chrome110",
    outdir: outDir,
    logLevel: "warning",
    define: { __TARGET__: JSON.stringify(target) },
  });

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifestFor(target), null, 2));
  cpSync(join(here, "src/popup.html"), join(outDir, "popup.html"));
  cpSync(join(here, "src/offscreen.html"), join(outDir, "offscreen.html"));
  cpSync(join(here, "public"), outDir, { recursive: true });
  console.log(`  built dist/${target}`);
}

// Keep the plain dist/ path working as the Chromium build.
for (const entry of ["manifest.json", "popup.html", "offscreen.html", "content.js", "background.js", "popup.js", "offscreen.js"]) {
  cpSync(join(dist, "chromium", entry), join(dist, entry));
}
cpSync(join(dist, "chromium", "icons"), join(dist, "icons"), { recursive: true });
cpSync(join(dist, "chromium", "dict"), join(dist, "dict"), { recursive: true });

console.log("Extension assembled in apps/extension/dist (chromium/, firefox/)");
