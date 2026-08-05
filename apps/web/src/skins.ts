import { equippedSkin } from "./gacha-collection.js";
import { prizeTable } from "./gacha-data.js";

/**
 * Wearing a skin.
 *
 * A skin is nothing but a set of CSS custom properties written onto the root
 * element, which is why one can be added on GitHub as a few lines of JSON:
 * every colour in the app already comes from a variable, so overriding them
 * repaints the whole site with no stylesheet to write and nothing to build.
 *
 * Applied on boot before the first screen draws, so a skinned app never
 * flashes the default palette on the way in.
 */

let applied: string[] = [];

export async function applySkin(): Promise<void> {
  const id = await equippedSkin();
  const root = document.documentElement;

  // Whatever the last skin set has to come off first, or a skin that leaves
  // a variable out would keep the previous skin's value for it.
  for (const name of applied) root.style.removeProperty(name);
  applied = [];
  if (!id) return;

  const table = await prizeTable();
  const skin = table.prizes.find((p) => p.id === id && p.type === "skin");
  if (!skin || skin.type !== "skin") return;
  for (const [name, value] of Object.entries(skin.vars)) {
    root.style.setProperty(name, value);
    applied.push(name);
  }
}
