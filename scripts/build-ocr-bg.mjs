#!/usr/bin/env node
/**
 * Build the background batch reader that the service worker pulls in.
 *
 * "OCR all pages" is a job the app writes down, so shutting the tab must
 * not end it. The service worker finishes it — but a service worker is a
 * plain script, not part of the app bundle, so the reader is built here to
 * its own stable filename that `sw.js` can `importScripts`.
 *
 * It shares the app's real source, so there is exactly one detector and
 * one pipeline. What the worker cannot reach is marked external and left
 * as a dynamic import that simply fails out there, which the code expects:
 *
 *   - books.js drags in the whole Firebase SDK, and there is no sign-in in
 *     a worker anyway; pages read out here are swept into a shared book
 *     the next time the app runs.
 *   - tesseract.js is megabytes of fallback OCR for hosts with no key.
 *   - pdfjs-dist is only reachable through the app, which is why a PDF job
 *     waits for it rather than running here.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "apps/web");
const distDir = process.argv[2] ? resolve(process.argv[2]) : join(webDir, "dist");
const entry = join(webDir, "src/ocr-bg.ts");

if (!existsSync(distDir)) {
  console.error(`build-ocr-bg: ${distDir} not found (run the app build first)`);
  process.exit(1);
}

const result = await build({
  entryPoints: [entry],
  outfile: join(distDir, "ocr-bg.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  // A classic worker script cannot dynamic-import; these throw out there
  // and every call site treats that as "not available here".
  external: ["./books.js", "tesseract.js", "pdfjs-dist"],
  logOverride: { "unsupported-dynamic-import": "silent" },
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`build-ocr-bg: ocr-bg.js (${(bytes / 1024).toFixed(1)}kB)`);
