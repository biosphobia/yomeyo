import { getMeta, setMeta } from "./db.js";
import { earnYennies, formatYennies } from "./yennies.js";

/**
 * Chests on the kana road, and the bag that holds what was in them.
 *
 * A chest tile opens into one item, drawn by rarity — mostly commons, the
 * odd rare, epics worth a small grin, and a legendary seldom enough that
 * finding one is a story. Items sit in the bag (a drag-to-arrange grid on
 * the kana screen) until they are used: hearts back, shields against the
 * next miss, doubled pay on the next level, or plain yennies.
 *
 * Boosts are a note the next level reads and burns (`kanaBoost`); the
 * level engine consumes it, this module only writes it. The bag itself is
 * an ordered list of item ids, because an inventory you can rearrange is
 * an inventory that feels owned.
 */

export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface BagItem {
  id: string;
  name: string;
  icon: string;
  rarity: Rarity;
  detail: string;
  /** What using it does. "none" items are keepsakes. */
  use: "heart" | "hearts-all" | "shield" | "pay" | "yennies" | "none";
  /** For use "yennies". */
  amount?: number;
}

export const ITEMS: BagItem[] = [
  { id: "onigiri", name: "Onigiri", icon: "🍙", rarity: "common", detail: "Restores one heart, the moment you eat it.", use: "heart" },
  { id: "pouch", name: "Coin pouch", icon: "🪙", rarity: "common", detail: "50 ¥, straight into the purse.", use: "yennies", amount: 50 },
  { id: "daifuku", name: "Daifuku", icon: "🍡", rarity: "common", detail: "Restores one heart. Sweeter than the onigiri, does the same thing.", use: "heart" },
  { id: "omamori", name: "Omamori", icon: "🧿", rarity: "rare", detail: "A charm. Your next miss costs no heart.", use: "shield" },
  { id: "luckycat", name: "Lucky cat", icon: "🐱", rarity: "rare", detail: "Your next level pays double.", use: "pay" },
  { id: "purse", name: "Heavy pouch", icon: "💰", rarity: "epic", detail: "250 ¥. It clinks.", use: "yennies", amount: 250 },
  { id: "ticket", name: "Onsen ticket", icon: "🎫", rarity: "epic", detail: "Every heart back, right now, no spring required.", use: "hearts-all" },
  { id: "daruma", name: "Golden daruma", icon: "🪆", rarity: "legendary", detail: "Double pay AND a shield, both on your next level.", use: "pay" },
];

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

/** How the draw falls. Legendary earns its name. */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, rare: 27, epic: 10, legendary: 3 };

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "common",
  rare: "rare",
  epic: "epic",
  legendary: "LEGENDARY",
};

export function rollItem(): BagItem {
  const total = ITEMS.reduce((sum, item) => sum + RARITY_WEIGHT[item.rarity] / countOf(item.rarity), 0);
  let ticket = Math.random() * total;
  for (const item of ITEMS) {
    ticket -= RARITY_WEIGHT[item.rarity] / countOf(item.rarity);
    if (ticket <= 0) return item;
  }
  return ITEMS[0];
}

function countOf(rarity: Rarity): number {
  return ITEMS.filter((item) => item.rarity === rarity).length;
}

// ---------------- the bag ----------------

const BAG_KEY = "kanaBag";
const BAG_SLOTS = 20;
/** The note the next level reads and burns. */
const BOOST_KEY = "kanaBoost";
/** The kana game's own save; item effects reach into its hearts. */
const GAME_KEY = "kanaGame";
const MAX_HEALTH = 5; // mirrors kana.ts, which owns the rule

export async function bagContents(): Promise<string[]> {
  return (await getMeta<string[]>(BAG_KEY)) ?? [];
}

/** Store a found item. "full" means it didn't fit — the caller pays cash instead. */
export async function addToBag(id: string): Promise<"stored" | "full"> {
  const bag = await bagContents();
  if (bag.length >= BAG_SLOTS) return "full";
  bag.push(id);
  await setMeta(BAG_KEY, bag);
  return "stored";
}

// ---------------- the bag screen ----------------

let selected: number | null = null;

export async function renderBag(body: HTMLDivElement): Promise<void> {
  const bag = await bagContents();
  if (selected !== null && selected >= bag.length) selected = null;

  body.innerHTML = `
    <div class="bag-head">
      <b>The bag</b>
      <span class="glosses">${bag.length} / ${BAG_SLOTS} · drag to arrange · tap to use</span>
    </div>
    <div class="bag-grid" id="bag-grid">
      ${Array.from({ length: BAG_SLOTS }, (_, i) => {
        const item = bag[i] !== undefined ? BY_ID.get(bag[i]) : undefined;
        return `<div class="bag-slot${item ? "" : " empty"}${selected === i ? " on" : ""}" data-i="${i}">
          ${item ? `<span class="bag-item rarity-${item.rarity}" data-i="${i}">${item.icon}</span>` : ""}
        </div>`;
      }).join("")}
    </div>
    <div id="bag-detail"></div>
    ${bag.length === 0 ? `<div class="empty-state"><div class="big">🧰</div>Chests on the kana road drop items here.</div>` : ""}
  `;

  const grid = body.querySelector<HTMLDivElement>("#bag-grid")!;
  const detail = body.querySelector<HTMLDivElement>("#bag-detail")!;

  const drawDetail = async (): Promise<void> => {
    if (selected === null || !bag[selected]) {
      detail.innerHTML = "";
      return;
    }
    const item = BY_ID.get(bag[selected])!;
    detail.innerHTML = `
      <div class="card-panel bag-card rarity-${item.rarity}">
        <div class="bag-card-head">
          <span class="bag-card-icon">${item.icon}</span>
          <div>
            <div class="bag-card-name">${item.name}</div>
            <div class="bag-rarity rarity-${item.rarity}">${RARITY_LABEL[item.rarity]}</div>
          </div>
        </div>
        <div class="glosses">${item.detail}</div>
        ${item.use !== "none" ? `<div class="row-actions" style="margin-top:10px"><button id="bag-use">Use it</button></div>` : ""}
        <div class="msg" id="bag-msg"></div>
      </div>`;
    detail.querySelector("#bag-use")?.addEventListener("click", async () => {
      const note = await useItem(item);
      bag.splice(selected!, 1);
      selected = null;
      await setMeta(BAG_KEY, bag);
      await renderBag(body);
      const message = body.querySelector("#bag-after");
      if (!message) {
        const line = document.createElement("div");
        line.id = "bag-after";
        line.className = "msg ok-text";
        line.textContent = note;
        body.querySelector(".bag-head")?.after(line);
      }
    });
  };

  // Tap selects; drag rearranges. Same pointer grammar as everywhere else
  // in the app: a press that never moves is a tap.
  let drag: { from: number; float: HTMLElement; moved: boolean } | null = null;
  grid.addEventListener("pointerdown", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".bag-item");
    if (!el) return;
    ev.preventDefault();
    const box = el.getBoundingClientRect();
    const float = el.cloneNode(true) as HTMLElement;
    float.className = `${el.className} bag-item-float`;
    float.style.left = `${box.left}px`;
    float.style.top = `${box.top}px`;
    document.body.appendChild(float);
    drag = { from: Number(el.dataset.i), float, moved: false };
    el.setPointerCapture?.(ev.pointerId);
  });
  grid.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    ev.preventDefault();
    drag.moved = true;
    drag.float.style.left = `${ev.clientX - 18}px`;
    drag.float.style.top = `${ev.clientY - 18}px`;
    const over = slotAt(grid, ev.clientX, ev.clientY);
    for (const slot of grid.querySelectorAll(".bag-slot")) {
      slot.classList.toggle("is-target", slot === over);
    }
  });
  const finishDrag = async (ev: PointerEvent): Promise<void> => {
    if (!drag) return;
    const { from, float, moved } = drag;
    drag = null;
    float.remove();
    const over = slotAt(grid, ev.clientX, ev.clientY);
    for (const slot of grid.querySelectorAll(".bag-slot")) slot.classList.remove("is-target");
    if (!moved) {
      selected = selected === from ? null : from;
      for (const slot of grid.querySelectorAll<HTMLElement>(".bag-slot")) {
        slot.classList.toggle("on", Number(slot.dataset.i) === selected);
      }
      await drawDetail();
      return;
    }
    if (!over) return;
    const to = Math.min(bag.length - 1, Number((over as HTMLElement).dataset.i));
    if (to === from || to < 0) return;
    const [taken] = bag.splice(from, 1);
    bag.splice(to, 0, taken);
    selected = null;
    await setMeta(BAG_KEY, bag);
    await renderBag(body);
  };
  grid.addEventListener("pointerup", (ev) => void finishDrag(ev));
  grid.addEventListener("pointercancel", (ev) => void finishDrag(ev));

  await drawDetail();
}

function slotAt(grid: HTMLElement, x: number, y: number): Element | null {
  for (const slot of grid.querySelectorAll(".bag-slot")) {
    const box = slot.getBoundingClientRect();
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return slot;
  }
  return null;
}

/** Apply an item. Returns the line the bag shows for it. */
async function useItem(item: BagItem): Promise<string> {
  switch (item.use) {
    case "heart": {
      const game = await getMeta<{ health?: number }>(GAME_KEY);
      if (game) {
        game.health = Math.min(MAX_HEALTH, (game.health ?? MAX_HEALTH) + 1);
        await setMeta(GAME_KEY, game);
      }
      return "One heart back. 🍙";
    }
    case "hearts-all": {
      const game = await getMeta<{ health?: number }>(GAME_KEY);
      if (game) {
        game.health = MAX_HEALTH;
        await setMeta(GAME_KEY, game);
      }
      return "Every heart back. ♨️";
    }
    case "shield": {
      const boost = (await getMeta<{ pay?: boolean; shield?: boolean }>(BOOST_KEY)) ?? {};
      await setMeta(BOOST_KEY, { ...boost, shield: true });
      return "Charm armed: your next miss costs no heart.";
    }
    case "pay": {
      const boost = (await getMeta<{ pay?: boolean; shield?: boolean }>(BOOST_KEY)) ?? {};
      // The daruma is the pay item that also shields.
      await setMeta(BOOST_KEY, { ...boost, pay: true, ...(item.id === "daruma" ? { shield: true } : {}) });
      return item.id === "daruma" ? "The daruma glows: double pay and a shield, next level." : "Double pay armed for your next level.";
    }
    case "yennies": {
      const balance = await earnYennies(item.amount ?? 0);
      return `+${(item.amount ?? 0).toLocaleString()} · ${formatYennies(balance)}`;
    }
    default:
      return "It sits in your hand, being itself.";
  }
}
