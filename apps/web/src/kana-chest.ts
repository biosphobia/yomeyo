/**
 * Chests on the kana road, and what they hold.
 *
 * A chest tile opens into one item, drawn by rarity — mostly commons, the
 * odd rare, epics worth a small grin, and a legendary seldom enough that
 * finding one is a story. Items travel in the run's own pack (five slots,
 * shown as a strip over the quiz) and are gone when the road is: nothing
 * here persists past the run, on purpose — a fresh road is a fresh start.
 *
 * This module is only the deck: definitions and the draw. Carrying,
 * showing and spending the items is the level engine's business, because
 * the effects reach into a live run's hearts and payouts.
 */

export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface PackItem {
  id: string;
  name: string;
  icon: string;
  rarity: Rarity;
  detail: string;
  /** What using it does, applied by the level engine on the spot. */
  use: "heart" | "hearts-all" | "shield" | "pay" | "yennies" | "bomb";
  /** For use "yennies". */
  amount?: number;
}

export const ITEMS: PackItem[] = [
  { id: "onigiri", name: "Onigiri", icon: "🍙", rarity: "common", detail: "Restores one heart, the moment you eat it.", use: "heart" },
  { id: "pouch", name: "Coin pouch", icon: "🪙", rarity: "common", detail: "50 ¥, straight into the purse.", use: "yennies", amount: 50 },
  { id: "daifuku", name: "Daifuku", icon: "🍡", rarity: "common", detail: "Restores one heart. Sweeter than the onigiri, does the same thing.", use: "heart" },
  { id: "omamori", name: "Omamori", icon: "🧿", rarity: "rare", detail: "A charm. Your next miss costs no heart.", use: "shield" },
  { id: "luckycat", name: "Lucky cat", icon: "🐱", rarity: "rare", detail: "This level pays double.", use: "pay" },
  { id: "purse", name: "Heavy pouch", icon: "💰", rarity: "epic", detail: "250 ¥. It clinks.", use: "yennies", amount: 250 },
  { id: "bomb", name: "Bend bomb", icon: "💣", rarity: "epic", detail: "Drag it onto a bend's banner to blow the modifier off the level. Loud.", use: "bomb" },
  { id: "ticket", name: "Onsen ticket", icon: "🎫", rarity: "epic", detail: "Every heart back, right now, no spring required.", use: "hearts-all" },
  { id: "daruma", name: "Golden daruma", icon: "🪆", rarity: "legendary", detail: "Double pay AND a shield, on the spot.", use: "pay" },
];

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

export function itemById(id: string): PackItem | undefined {
  return BY_ID.get(id);
}

/** The pack is worn, not warehoused: five slots, no more. */
export const PACK_MAX = 5;

/** How the draw falls. Legendary earns its name. */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, rare: 27, epic: 10, legendary: 3 };

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "common",
  rare: "rare",
  epic: "epic",
  legendary: "LEGENDARY",
};

export function rollItem(): PackItem {
  const weightOf = (item: PackItem): number => RARITY_WEIGHT[item.rarity] / countOf(item.rarity);
  const total = ITEMS.reduce((sum, item) => sum + weightOf(item), 0);
  let ticket = Math.random() * total;
  for (const item of ITEMS) {
    ticket -= weightOf(item);
    if (ticket <= 0) return item;
  }
  return ITEMS[0];
}

function countOf(rarity: Rarity): number {
  return ITEMS.filter((item) => item.rarity === rarity).length;
}
