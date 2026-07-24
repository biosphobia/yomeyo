#!/usr/bin/env node
/**
 * Yomeyo sync server — zero-dependency Node HTTP server.
 *
 * Offline-first, last-write-wins card sync shared by the web app and the
 * browser extension. Self-host it anywhere Node runs (a VPS, a Raspberry
 * Pi, a free-tier container) and point both clients at it in Settings.
 *
 * Usage:
 *   YOMEYO_TOKEN=some-secret node server.mjs
 *
 * Env:
 *   PORT          listen port           (default 8787)
 *   YOMEYO_TOKEN  shared auth secret    (required)
 *   YOMEYO_DATA   path to the JSON db   (default ./yomeyo-data.json)
 *
 * Protocol:
 *   POST /sync   { since: number, changes: Card[] }
 *             -> { now: number, changes: Card[] }
 *   `since` is the `now` from the previous response (0 on first sync).
 *   The response contains every card another device changed after `since`.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.YOMEYO_TOKEN;
const DATA_PATH = process.env.YOMEYO_DATA ?? "./yomeyo-data.json";

if (!TOKEN) {
  console.error("Set YOMEYO_TOKEN to a shared secret before starting.");
  process.exit(1);
}

/** id -> { card, serverAt } */
let store = new Map();

function load() {
  if (!existsSync(DATA_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(DATA_PATH, "utf8"));
    store = new Map(raw.map((row) => [row.card.id, row]));
    console.log(`Loaded ${store.size} cards from ${DATA_PATH}`);
  } catch (err) {
    console.error(`Could not read ${DATA_PATH}: ${err.message}`);
    process.exit(1);
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DATA_PATH + ".tmp";
    writeFileSync(tmp, JSON.stringify([...store.values()]));
    renameSync(tmp, DATA_PATH);
  }, 250);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, GET, OPTIONS",
      "access-control-max-age": "86400",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true, cards: store.size });
    return;
  }

  if (req.method === "POST" && url.pathname === "/sync") {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${TOKEN}`) {
      send(res, 401, { error: "unauthorized" });
      return;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      send(res, 400, { error: "invalid JSON" });
      return;
    }
    const since = Number(body.since ?? 0);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    const now = Date.now();

    // Merge client changes, last-write-wins on the card's updatedAt.
    let accepted = 0;
    for (const card of changes) {
      if (!card || typeof card.id !== "string" || typeof card.updatedAt !== "number") continue;
      const existing = store.get(card.id);
      if (!existing || card.updatedAt > existing.card.updatedAt) {
        store.set(card.id, { card, serverAt: now });
        accepted += 1;
      }
    }
    if (accepted > 0) scheduleSave();

    // Everything other devices changed since the client's last sync.
    // (serverAt === now rows are the client's own writes from this request;
    // exclude them by identity, not by timestamp, in case of collisions.)
    const ownIds = new Set(changes.map((c) => c?.id));
    const outgoing = [];
    for (const { card, serverAt } of store.values()) {
      if (serverAt > since && !(ownIds.has(card.id) && serverAt === now)) {
        outgoing.push(card);
      }
    }

    send(res, 200, { now, changes: outgoing, accepted });
    return;
  }

  send(res, 404, { error: "not found" });
});

load();
server.listen(PORT, () => {
  console.log(`Yomeyo sync server listening on :${PORT}, data at ${DATA_PATH}`);
});
