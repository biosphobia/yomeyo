#!/usr/bin/env node
/**
 * Generate the PNG app icons procedurally (no image libraries): a rounded
 * purple tile on a dark background, matching icon.svg's palette. Run once;
 * outputs are committed so builds don't depend on this.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0x1a, 0x1a, 0x2e];
const FG = [0x7c, 0x6c, 0xf0];
const DOT = [0xff, 0xff, 0xff];

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makeIcon(size) {
  const inset = Math.round(size * 0.09);
  const radius = Math.round(size * 0.17);
  const dotR = size * 0.14;
  const cx = size / 2;
  const cy = size / 2;

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // no filter
    for (let x = 0; x < size; x++) {
      let color = BG;
      // rounded inner tile
      const inTile = x >= inset && x < size - inset && y >= inset && y < size - inset;
      if (inTile) {
        const dx = Math.max(0, Math.max(inset + radius - x, x - (size - inset - radius)));
        const dy = Math.max(0, Math.max(inset + radius - y, y - (size - inset - radius)));
        if (dx * dx + dy * dy <= radius * radius) color = FG;
      }
      // white dot (a period, like a reading mark)
      const ddx = x - cx;
      const ddy = y - cy;
      if (ddx * ddx + ddy * ddy <= dotR * dotR) color = DOT;
      const off = 1 + x * 3;
      row[off] = color[0];
      row[off + 1] = color[1];
      row[off + 2] = color[2];
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDirs = [join(root, "apps/web/public/icons"), join(root, "apps/extension/public/icons")];
for (const dir of outDirs) {
  mkdirSync(dir, { recursive: true });
  for (const size of [48, 128, 192, 512]) {
    writeFileSync(join(dir, `icon-${size}.png`), makeIcon(size));
  }
  console.log(`Wrote icons to ${dir}`);
}
