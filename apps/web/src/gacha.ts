import { levelState } from "./levels.js";
import { toast } from "./toast.js";
import { earnYennies, formatYennies, levelReward, spendYennies, yennies } from "./yennies.js";
import { addOwned, equipSkin, equippedSkin, owned } from "./gacha-collection.js";
import { drawPrize, prizeImageUrl, prizeTable, rarityOdds, type Prize, type PrizeTable } from "./gacha-data.js";
import { applySkin } from "./skins.js";
import { unlockAll, unlockAllNow } from "./unlock.js";

/**
 * The Gacha tab: what yennies are for.
 *
 * A pull is decided the instant it is paid for. Everything after that — the
 * cutscene, the strip slowing down — is showing the learner something that
 * has already happened, which is the only honest way to build one of these.
 * Both parts are skippable, because the fortieth pull should not cost
 * fifteen seconds of anybody's evening.
 *
 * The prizes themselves live in `public/gacha/prizes.json`, editable on
 * GitHub: skins are a set of CSS variables, gifs join the pool the drills
 * draw their reactions from.
 */

export async function renderGacha(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const [balance, level, table, have, wearing] = await Promise.all([
    yennies(),
    levelState(),
    prizeTable(),
    owned(),
    equippedSkin(),
    unlockAll(),
  ]);
  if (!isCurrent()) return;

  // The admin's key opens crates as well as levels: testing a prize table
  // should not mean grinding for it first. On that device only, and it takes
  // nothing — so an admin's balance is whatever they actually earned.
  const free = unlockAllNow();
  const affordable = free || balance >= table.cost;
  main.innerHTML = `
    <h1>Gacha</h1>

    <div class="card-panel purse-panel">
      <div class="purse-amount">${formatYennies(balance)}</div>
      <div class="glosses">Yennies</div>
      <div class="row-actions" style="justify-content:center;margin-top:14px">
        <button id="gacha-open" ${affordable && table.prizes.length > 0 ? "" : "disabled"}>
          Open a crate · ${free ? "free" : `${table.cost.toLocaleString()} ¥`}
        </button>
      </div>
      ${
        table.prizes.length === 0
          ? `<div class="msg">No prizes are configured.</div>`
          : free
            ? `<div class="msg">Admin: pulls are free and cost you nothing.</div>`
            : affordable
              ? ""
              : `<div class="msg">${(table.cost - balance).toLocaleString()} ¥ to go.</div>`
      }
    </div>

    <div id="gacha-stage"></div>

    <div class="card-panel">
      <b>Collection</b>
      <div class="glosses">${have.size} of ${table.prizes.length}</div>
      <div class="prize-grid" id="prize-grid"></div>
    </div>

    <div class="card-panel">
      <b>Odds</b>
      ${rarityOdds(table)
        .map(
          ({ info, chance }) => `<div class="purse-source">
            <span style="color:${escapeAttr(info.color)}">${escapeHtml(info.label)}</span>
            <span class="purse-rate">${(chance * 100).toFixed(1)}%</span>
          </div>`,
        )
        .join("")}
      <div class="purse-source">
        <span>A pull you already own</span>
        <span class="purse-rate">${Math.round(table.cost * table.duplicateRefund).toLocaleString()} ¥ back</span>
      </div>
    </div>

    <div class="card-panel">
      <b>Where yennies come from</b>
      <div class="purse-source">
        <span>Every right answer</span>
        <span class="purse-rate">1 ¥</span>
      </div>
      <div class="purse-source">
        <span>Reaching level ${level.level + 1}</span>
        <span class="purse-rate">${levelReward(level.level + 1).toLocaleString()} ¥</span>
      </div>
    </div>
  `;

  drawCollection(main, table, have, wearing, () => void renderGacha(main, isCurrent));
  main.querySelector<HTMLButtonElement>("#gacha-open")?.addEventListener("click", () => {
    void pull(main, table, isCurrent);
  });
}

// ---------------- the collection ----------------

function drawCollection(
  main: HTMLElement,
  table: PrizeTable,
  have: Set<string>,
  wearing: string | null,
  refresh: () => void,
): void {
  const grid = main.querySelector<HTMLDivElement>("#prize-grid")!;
  if (table.prizes.length === 0) {
    grid.innerHTML = `<div class="glosses">Nothing to collect yet.</div>`;
    return;
  }

  grid.innerHTML = table.prizes
    .map((prize) => {
      const mine = have.has(prize.id);
      const rarity = table.rarities[prize.rarity];
      const worn = prize.type === "skin" && wearing === prize.id;
      return `<button class="prize${mine ? "" : " locked"}${worn ? " worn" : ""}"
          data-id="${escapeAttr(prize.id)}" style="--rarity:${escapeAttr(rarity?.color ?? "#94a3b8")}"
          ${mine && prize.type === "skin" ? "" : "disabled"}>
        ${mine ? prizeFace(prize) : `<span class="prize-locked">?</span>`}
        <span class="prize-name">${mine ? escapeHtml(prize.name) : "&nbsp;"}</span>
        <span class="prize-rarity">${escapeHtml(rarity?.label ?? "")}</span>
        ${worn ? `<span class="prize-worn">worn</span>` : ""}
      </button>`;
    })
    .join("");

  for (const button of grid.querySelectorAll<HTMLButtonElement>(".prize[data-id]")) {
    button.addEventListener("click", async () => {
      const id = button.dataset.id!;
      // Tapping the skin you are wearing takes it off.
      await equipSkin(wearing === id ? null : id);
      await applySkin();
      refresh();
    });
  }
}

function prizeFace(prize: Prize): string {
  if (prize.type === "skin") {
    return `<span class="prize-swatch" style="background:${escapeAttr(prize.vars["--bg"] ?? "#000")};
      border-color:${escapeAttr(prize.vars["--accent"] ?? "#fff")}">
      <i style="background:${escapeAttr(prize.vars["--accent"] ?? "#fff")}"></i>
      <i style="background:${escapeAttr(prize.vars["--panel-2"] ?? "#333")}"></i>
    </span>`;
  }
  return `<img class="prize-gif" src="${escapeAttr(prizeImageUrl(prize.image))}" alt="" loading="lazy" />`;
}

// ---------------- opening one ----------------

async function pull(main: HTMLElement, table: PrizeTable, isCurrent: () => boolean): Promise<void> {
  const free = unlockAllNow();
  if (!free && !(await spendYennies(table.cost))) {
    toast("Not enough yennies.", "error");
    return;
  }
  // Decided here, before anything is drawn. Nothing below can change it.
  const prize = drawPrize(table);
  if (!prize) {
    if (!free) await earnYennies(table.cost);
    toast("No prizes are configured.", "error");
    return;
  }
  const isNew = await addOwned(prize.id);
  // A free pull refunds nothing, because it took nothing.
  const refund = isNew || free ? 0 : Math.round(table.cost * table.duplicateRefund);
  if (refund > 0) await earnYennies(refund);

  const stage = main.querySelector<HTMLDivElement>("#gacha-stage")!;
  stage.innerHTML = `
    <div class="card-panel gacha-stage">
      <div class="scene" id="gacha-scene">
        <div class="scene-caption" id="scene-caption"></div>
      </div>
      <div id="gacha-roll"></div>
    </div>
  `;
  const sceneBox = stage.querySelector<HTMLDivElement>("#gacha-scene")!;
  sceneBox.scrollIntoView({ behavior: "smooth", block: "center" });

  // The cutscene, if this device will have it. Tapping it skips.
  const { playCutscene } = await import("./gacha-scene.js");
  const cutscene = playCutscene(sceneBox);
  sceneBox.addEventListener("click", cutscene.stop);
  void cutscene.name.then((title) => {
    const caption = stage.querySelector("#scene-caption");
    if (caption && title) caption.textContent = title;
  });
  await cutscene.done;
  if (!isCurrent() || !stage.isConnected) {
    cutscene.stop();
    return;
  }
  cutscene.stop();
  sceneBox.remove();

  const { runRoll } = await import("./gacha-roll.js");
  await runRoll(stage.querySelector<HTMLDivElement>("#gacha-roll")!, prize, table);
  if (!isCurrent() || !stage.isConnected) return;

  const rarity = table.rarities[prize.rarity];
  stage.innerHTML = `
    <div class="card-panel gacha-won" style="--rarity:${escapeAttr(rarity?.color ?? "#94a3b8")}">
      <div class="won-rarity">${escapeHtml(rarity?.label ?? "")}</div>
      <div class="won-face">${prizeFace(prize)}</div>
      <div class="won-name">${escapeHtml(prize.name)}</div>
      ${prize.note ? `<div class="glosses">${escapeHtml(prize.note)}</div>` : ""}
      <div class="msg">${
        isNew
          ? prize.type === "skin"
            ? "A new skin. Tap it in your collection to wear it."
            : "A new reaction. It will turn up in the drills from now on."
          : `Already yours — ${refund.toLocaleString()} ¥ back.`
      }</div>
      <div class="row-actions" style="justify-content:center;margin-top:12px">
        <button id="gacha-again">Open another</button>
        <button id="gacha-done" class="secondary">Done</button>
      </div>
    </div>
  `;
  stage.querySelector("#gacha-again")!.addEventListener("click", async () => {
    const balance = await yennies();
    if (!unlockAllNow() && balance < table.cost) {
      toast("Not enough yennies.", "error");
      return;
    }
    void pull(main, table, isCurrent);
  });
  stage.querySelector("#gacha-done")!.addEventListener("click", () => void renderGacha(main, isCurrent));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
