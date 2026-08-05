import { assetUrl } from "./store.js";

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

export interface PrizeTable {
  cost: number;
  duplicateRefund: number;
  rarities: Record<Rarity, RarityInfo>;
  prizes: Prize[];
}

const FALLBACK: PrizeTable = {
  cost: 120,
  duplicateRefund: 0.4,
  rarities: { common: { label: "Common", weight: 100, color: "#94a3b8" } },
  prizes: [],
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

export function prizeTable(): Promise<PrizeTable> {
  loaded ??= fetch(assetUrl("gacha/prizes.json"))
    .then((res) => (res.ok ? res.json() : {}))
    .then((raw: Partial<PrizeTable>) => {
      const rarities =
        raw.rarities && typeof raw.rarities === "object" && Object.keys(raw.rarities).length > 0
          ? raw.rarities
          : FALLBACK.rarities;
      const prizes = Array.isArray(raw.prizes)
        ? raw.prizes.map((p) => cleanPrize(p, rarities)).filter((p): p is Prize => p !== null)
        : [];
      return {
        cost: typeof raw.cost === "number" && raw.cost > 0 ? Math.floor(raw.cost) : FALLBACK.cost,
        duplicateRefund:
          typeof raw.duplicateRefund === "number" && raw.duplicateRefund >= 0 && raw.duplicateRefund <= 1
            ? raw.duplicateRefund
            : FALLBACK.duplicateRefund,
        rarities,
        prizes,
      };
    })
    .catch(() => FALLBACK);
  return loaded;
}

/**
 * Draw one prize.
 *
 * The rarity is picked first, by weight, and then a prize of that rarity at
 * random — so adding a tenth legendary makes legendaries no commoner, only
 * more varied. A rarity nobody has written a prize for is skipped rather
 * than swallowing its share of the odds.
 */
export function drawPrize(table: PrizeTable): Prize | null {
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

/** The odds each rarity actually carries, for showing them honestly. */
export function rarityOdds(table: PrizeTable): { key: string; info: RarityInfo; chance: number }[] {
  const buckets = Object.entries(table.rarities)
    .map(([key, info]) => ({ key, info, count: table.prizes.filter((p) => p.rarity === key).length }))
    .filter((b) => b.count > 0 && b.info.weight > 0);
  const total = buckets.reduce((sum, b) => sum + b.info.weight, 0) || 1;
  return buckets.map(({ key, info }) => ({ key, info, chance: info.weight / total }));
}
