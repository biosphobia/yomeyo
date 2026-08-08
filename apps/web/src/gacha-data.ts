import { assetUrl } from "./store.js";
import { getMeta, setMeta } from "./db.js";

/**
 * What the gacha can give out, and how likely each is.
 *
 * All of it lives in `public/gacha/prizes.json` so the whole prize table —
 * new skins, new reaction gifs, the price of a pull, the odds — can be
 * changed on GitHub without touching any code. Nothing here is hard-coded
 * beyond the fallbacks that keep the tab working if that file goes missing.
 */

export type Rarity = string;

export interface RarityInfo {
  label: string;
  weight: number;
  color: string;
}

interface BasePrize {
  id: string;
  name: string;
  rarity: Rarity;
  note?: string;
}

/** A palette applied to the whole site. */
export interface SkinPrize extends BasePrize {
  type: "skin";
  vars: Record<string, string>;
}

/** A reaction that joins the pool the drills draw from. */
export interface GifPrize extends BasePrize {
  type: "gif";
  on: "correct" | "wrong";
  image: string;
  text: string;
}

export type Prize = SkinPrize | GifPrize;

/**
 * How a pull is decided.
 *
 * `uniform` — every prize equally likely, whatever its rarity says. Adding a
 * prize on GitHub then changes nothing about the others' chances, which is
 * what you want while the table is still being filled in.
 *
 * `rarity` — the weighted draw: a rarity is picked by weight, then a prize
 * within it, so a tenth legendary makes legendaries no commoner, only more
 * varied.
 */
export type DrawMode = "uniform" | "rarity";

export interface PrizeTable {
  cost: number;
  duplicateRefund: number;
  draw: DrawMode;
  rarities: Record<Rarity, RarityInfo>;
  prizes: Prize[];
  /** Scenario id to its caption and its lines, editable on GitHub. */
  cutscenes: Record<string, CutsceneEntry>;
}

/** A string is just the caption; an object can also rewrite what is said. */
export type CutsceneEntry = string | { title?: string; lines?: string[] };

/** What each cutscene is called when the file does not say. */
const CUTSCENE_TITLES: Record<string, string> = {
  green: "For an amazing reason",
  hungry: "Rations",
  airdrop: "Unscheduled delivery",
  kick: "Percussive maintenance",
  bowling: "Right of way",
  hail: "Adverse weather",
  order: "Table service",
  soak: "Something in the water",
  tank: "Feeding time",
};

/** The caption for a scenario: whatever the file says, or the default. */
export function cutsceneTitle(table: PrizeTable, id: string): string {
  const entry = table.cutscenes?.[id];
  const named = typeof entry === "string" ? entry : entry?.title;
  return typeof named === "string" && named.trim() ? named.trim() : (CUTSCENE_TITLES[id] ?? "");
}

/**
 * Every rewritten line, flattened to "scenario.index" so the scene can look
 * one up without knowing anything about the file's shape. A line left blank
 * or missing keeps the one written in the code.
 */
export function cutsceneLines(table: PrizeTable): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(table.cutscenes ?? {})) {
    if (typeof entry === "string" || !Array.isArray(entry?.lines)) continue;
    entry.lines.forEach((line, i) => {
      if (typeof line === "string" && line.trim()) out[`${id}.${i}`] = line.trim();
    });
  }
  return out;
}

const FALLBACK: PrizeTable = {
  cost: 120,
  duplicateRefund: 0.4,
  draw: "uniform",
  rarities: { common: { label: "Common", weight: 100, color: "#94a3b8" } },
  prizes: [],
  cutscenes: {},
};

/** Where a prize's image lives, given a filename in the gacha folder. */
export function prizeImageUrl(image: string): string {
  return /^(https?:|data:)/i.test(image) ? image : assetUrl(`gacha/${image}`);
}

function cleanPrize(raw: unknown, rarities: Record<string, RarityInfo>): Prize | null {
  const p = raw as Prize | null;
  if (!p || typeof p.id !== "string" || !p.id.trim()) return null;
  if (typeof p.name !== "string" || !p.name.trim()) return null;
  if (!(p.rarity in rarities)) return null;

  if (p.type === "skin") {
    if (!p.vars || typeof p.vars !== "object") return null;
    // Only custom properties, so a prize file cannot inject arbitrary CSS.
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(p.vars)) {
      if (/^--[a-z0-9-]+$/i.test(key) && typeof value === "string") vars[key] = value;
    }
    if (Object.keys(vars).length === 0) return null;
    return { ...p, vars };
  }
  if (p.type === "gif") {
    if (p.on !== "correct" && p.on !== "wrong") return null;
    if (typeof p.image !== "string" || !p.image.trim()) return null;
    if (typeof p.text !== "string" || !p.text.trim()) return null;
    return p;
  }
  return null;
}

let loaded: Promise<PrizeTable> | null = null;

/**
 * The admin's local edits: per-prize rarity, name and caption, laid over
 * whatever prizes.json says. Kept in meta on this device — prizes.json on
 * GitHub stays the source of truth for everyone else.
 */
export interface PrizeOverride {
  name?: string;
  text?: string;
  rarity?: string;
}

const OVERRIDES_KEY = "prizeOverrides";

export async function setPrizeOverride(id: string, patch: PrizeOverride | null): Promise<void> {
  const all = (await getMeta<Record<string, PrizeOverride>>(OVERRIDES_KEY)) ?? {};
  if (patch === null) delete all[id];
  else all[id] = patch;
  await setMeta(OVERRIDES_KEY, all);
  loaded = null; // the next prizeTable() folds the new overrides in
}

/**
 * Is the publish endpoint deployed and holding a key? Same probe pattern
 * as the audio endpoint: only a 204 counts, because a static host serves
 * the PHP source as a 200.
 */
let publishReady: Promise<boolean> | null = null;

export function publishAvailable(): Promise<boolean> {
  publishReady ??= fetch(assetUrl("prizes-admin.php?probe=1"), { cache: "no-store" })
    .then((res) => res.status === 204)
    .catch(() => false);
  return publishReady;
}

/**
 * Publish one prize's edit for everyone, via the server's overrides file.
 * "denied" means the key was wrong; anything else that goes wrong is
 * "error". On success the table cache is dropped so the next load shows it.
 */
export async function publishPrizeOverride(
  id: string,
  patch: PrizeOverride | null,
  key: string,
): Promise<"ok" | "denied" | "error"> {
  try {
    const res = await fetch(assetUrl("prizes-admin.php"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, id, patch }),
    });
    if (res.status === 204) {
      loaded = null;
      return "ok";
    }
    return res.status === 403 ? "denied" : "error";
  } catch {
    return "error";
  }
}

export function prizeTable(): Promise<PrizeTable> {
  loaded ??= fetch(assetUrl("gacha/prizes.json"))
    .then((res) => (res.ok ? res.json() : {}))
    .then(async (raw: Partial<PrizeTable>) => {
      const rarities =
        raw.rarities && typeof raw.rarities === "object" && Object.keys(raw.rarities).length > 0
          ? raw.rarities
          : FALLBACK.rarities;
      // Two layers of edits over the file: the published overrides from the
      // server (everyone sees those), then this device's own local ones.
      const global = await fetch(assetUrl("gacha/prizes-overrides.json"), { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : {}))
        .catch((): Record<string, PrizeOverride> => ({}));
      const local =
        (await getMeta<Record<string, PrizeOverride>>(OVERRIDES_KEY).catch(
          (): Record<string, PrizeOverride> => ({}),
        )) ?? {};
      const apply = (prize: Prize, edit: PrizeOverride | undefined): Prize => {
        if (!edit || typeof edit !== "object") return prize;
        const merged = { ...prize };
        if (typeof edit.name === "string" && edit.name.trim()) merged.name = edit.name.trim();
        if (typeof edit.rarity === "string" && edit.rarity in rarities) merged.rarity = edit.rarity;
        if (merged.type === "gif" && typeof edit.text === "string" && edit.text.trim()) merged.text = edit.text.trim();
        return merged;
      };
      const prizes = (
        Array.isArray(raw.prizes)
          ? raw.prizes.map((p) => cleanPrize(p, rarities)).filter((p): p is Prize => p !== null)
          : []
      ).map((prize) => apply(apply(prize, (global as Record<string, PrizeOverride>)[prize.id]), local[prize.id]));
      return {
        cost: typeof raw.cost === "number" && raw.cost > 0 ? Math.floor(raw.cost) : FALLBACK.cost,
        draw: (raw.draw === "rarity" ? "rarity" : "uniform") as DrawMode,
        duplicateRefund:
          typeof raw.duplicateRefund === "number" && raw.duplicateRefund >= 0 && raw.duplicateRefund <= 1
            ? raw.duplicateRefund
            : FALLBACK.duplicateRefund,
        rarities,
        prizes,
        cutscenes:
          raw.cutscenes && typeof raw.cutscenes === "object"
            ? (raw.cutscenes as Record<string, CutsceneEntry>)
            : {},
      };
    })
    .catch(() => FALLBACK);
  return loaded;
}

/**
 * Draw one prize.
 *
 * Under `uniform` every prize has the same chance, so the table can be
 * filled in over time without any addition quietly changing what everything
 * else was worth.
 *
 * Under `rarity` the rarity is picked first, by weight, and then a prize of
 * that rarity at random — so adding a tenth legendary makes legendaries no
 * commoner, only more varied. A rarity nobody has written a prize for is
 * skipped rather than swallowing its share of the odds.
 */
export function drawPrize(table: PrizeTable): Prize | null {
  if (table.prizes.length === 0) return null;
  if (table.draw === "uniform") {
    return table.prizes[Math.floor(Math.random() * table.prizes.length)];
  }

  const buckets = Object.entries(table.rarities)
    .map(([key, info]) => ({ key, info, prizes: table.prizes.filter((p) => p.rarity === key) }))
    .filter((b) => b.prizes.length > 0 && b.info.weight > 0);
  if (buckets.length === 0) return null;

  const total = buckets.reduce((sum, b) => sum + b.info.weight, 0);
  let roll = Math.random() * total;
  for (const bucket of buckets) {
    roll -= bucket.info.weight;
    if (roll <= 0) return bucket.prizes[Math.floor(Math.random() * bucket.prizes.length)];
  }
  const last = buckets[buckets.length - 1];
  return last.prizes[Math.floor(Math.random() * last.prizes.length)];
}

/**
 * The odds each rarity actually carries, for showing them honestly. Empty
 * under a uniform draw, where rarity decides nothing and saying otherwise
 * on screen would be a lie.
 */
export function rarityOdds(table: PrizeTable): { key: string; info: RarityInfo; chance: number }[] {
  if (table.draw === "uniform") return [];
  const buckets = Object.entries(table.rarities)
    .map(([key, info]) => ({ key, info, count: table.prizes.filter((p) => p.rarity === key).length }))
    .filter((b) => b.count > 0 && b.info.weight > 0);
  const total = buckets.reduce((sum, b) => sum + b.info.weight, 0) || 1;
  return buckets.map(({ key, info }) => ({ key, info, chance: info.weight / total }));
}
