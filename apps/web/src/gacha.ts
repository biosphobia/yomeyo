import { levelState } from "./levels.js";
import { screenHeader } from "./screen.js";
import { toast } from "./toast.js";
import { earnYennies, formatYennies, levelReward, spendYennies, yennies } from "./yennies.js";
import { addOwned, equipSkin, equippedSkin, owned } from "./gacha-collection.js";
import {
  cutsceneLines,
  cutsceneTitle,
  drawPrize,
  prizeImageUrl,
  prizeTable,
  rarityOdds,
  type Prize,
  type PrizeTable,
} from "./gacha-data.js";
import { forgetReactions } from "./feedback.js";
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
    ${screenHeader("Gacha")}

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
      ${
        // Under a uniform draw there is nothing to weigh up, and printing a
        // rarity table would claim odds that do not exist.
        table.draw === "uniform"
          ? `<div class="purse-source">
               <span>Every prize, equally likely</span>
               <span class="purse-rate">${
                 table.prizes.length > 0 ? `1 in ${table.prizes.length}` : "—"
               }</span>
             </div>`
          : rarityOdds(table)
              .map(
                ({ info, chance }) => `<div class="purse-source">
                  <span style="color:${escapeAttr(info.color)}">${escapeHtml(info.label)}</span>
                  <span class="purse-rate">${(chance * 100).toFixed(1)}%</span>
                </div>`,
              )
              .join("")
      }
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

    ${free ? `<div class="card-panel" id="cutscene-list"></div>` : ""}
  `;

  // three.js and the models, fetched now rather than when the button is
  // pressed, so the film starts at once instead of after a wait.
  void import("./gacha-scene.js").then((mod) => mod.warmUpCutscene()).catch(() => undefined);

  // The films are what most of this tab is; an admin should be able to watch
  // one without opening a crate to see it. Same key as the free pulls.
  if (free) void drawCutscenes(main, table, isCurrent);

  drawCollection(main, table, have, wearing, () => void renderGacha(main, isCurrent));
  const open = main.querySelector<HTMLButtonElement>("#gacha-open");
  if (open) {
    open.disabled = open.disabled || opening;
    open.addEventListener("click", () => {
      if (opening) return;
      void pull(main, table, isCurrent);
    });
  }
}

/**
 * One crate at a time.
 *
 * A pull spends yennies and starts a film, and the button sits under the
 * cursor for the fifteen seconds that film runs. Without this, leaning on it
 * charges for a dozen crates and leaves a dozen half-built scenes fighting
 * over one canvas.
 */
let opening = false;

// ---------------- every film, for the admin ----------------

/**
 * The cutscenes, listed and playable.
 *
 * Nine films play at random, one per crate, so seeing a particular one has
 * meant opening crates until it came up — which is no way to check that the
 * one you just rewrote on GitHub reads right. Each is named by its title from
 * the prize file, so this list is also where you find out which id a title
 * belongs to.
 */
async function drawCutscenes(main: HTMLElement, table: PrizeTable, isCurrent: () => boolean): Promise<void> {
  const box = main.querySelector<HTMLDivElement>("#cutscene-list");
  if (!box) return;
  const { SCENARIOS } = await import("./gacha-scene.js");
  if (!isCurrent() || !box.isConnected) return;

  box.innerHTML = `
    <b>Cutscenes</b>
    <div class="glosses">Admin: play any of them, without a crate.</div>
    <div class="gram-levels" id="cutscene-chips">
      ${SCENARIOS.map(
        (scenario) => `<button class="gram-level-chip" data-id="${escapeAttr(scenario.id)}">
          ${escapeHtml(cutsceneTitle(table, scenario.id))}
          <span class="gram-level-count">${escapeHtml(scenario.id)} · ${scenario.seconds}s</span>
        </button>`,
      ).join("")}
    </div>
  `;

  for (const chip of box.querySelectorAll<HTMLButtonElement>("#cutscene-chips button")) {
    chip.addEventListener("click", () => void preview(main, table, chip.dataset.id!, isCurrent));
  }
}

/** Play one film in the stage, with a way out and nothing at stake. */
async function preview(
  main: HTMLElement,
  table: PrizeTable,
  scenario: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (opening) return;
  opening = true;
  const stage = main.querySelector<HTMLDivElement>("#gacha-stage")!;
  stage.innerHTML = `
    <div class="card-panel gacha-stage">
      <div class="scene" id="gacha-scene">
        <div class="scene-caption" id="scene-caption"></div>
      </div>
      <div class="row-actions" style="justify-content:center;margin-top:10px">
        <button id="preview-stop" class="secondary">Stop</button>
      </div>
    </div>
  `;
  const sceneBox = stage.querySelector<HTMLDivElement>("#gacha-scene")!;
  sceneBox.scrollIntoView({ behavior: "smooth", block: "center" });

  const { playCutscene } = await import("./gacha-scene.js");
  const film = playCutscene(sceneBox, { lines: cutsceneLines(table), scenario });
  void film.id.then((id) => {
    const caption = stage.querySelector("#scene-caption");
    if (caption && id) caption.textContent = cutsceneTitle(table, id);
  });
  stage.querySelector("#preview-stop")!.addEventListener("click", () => film.stop());

  try {
    await film.done;
  } finally {
    film.stop();
    opening = false;
  }
  if (!isCurrent() || !stage.isConnected) return;
  stage.innerHTML = "";
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
        <span class="prize-rarity">${
          table.draw === "uniform" ? (mine ? "&nbsp;" : "locked") : escapeHtml(rarity?.label ?? "")
        }</span>
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
  if (opening) return;
  opening = true;
  const openButton = main.querySelector<HTMLButtonElement>("#gacha-open");
  if (openButton) openButton.disabled = true;
  try {
    await openCrate(main, table, isCurrent);
  } finally {
    opening = false;
  }
}

async function openCrate(main: HTMLElement, table: PrizeTable, isCurrent: () => boolean): Promise<void> {
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
  // A won gif joins the drills' pool. Told now, so the next question can
  // show it rather than the one after the app is next opened.
  if (isNew && prize.type === "gif") forgetReactions();
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

  // The film, and the roll inside it. When the lid comes off the strip
  // starts over the top of the picture rather than replacing it, so the
  // pull happens in the scene rather than after it. Neither part skips.
  const { playCutscene } = await import("./gacha-scene.js");
  const { runRoll } = await import("./gacha-roll.js");
  const rollBox = stage.querySelector<HTMLDivElement>("#gacha-roll")!;

  let rolled: Promise<void> = Promise.resolve();
  const cutscene = playCutscene(sceneBox, {
    // Every word on screen comes from the prize file when it says so.
    lines: cutsceneLines(table),
    onOpen: (origin) => {
      // The strip unrolls out of wherever the crate ended up on screen,
      // rather than appearing from the bottom of an unrelated box.
      rollBox.style.setProperty("--from-x", `${(origin.x * 100).toFixed(1)}%`);
      rollBox.style.setProperty("--from-y", `${(origin.y * 100).toFixed(1)}%`);
      rollBox.classList.add("over-scene");
      rolled = runRoll(rollBox, prize, table);
    },
  });
  void cutscene.id.then((id) => {
    const caption = stage.querySelector("#scene-caption");
    if (caption && id) caption.textContent = cutsceneTitle(table, id);
  });

  await cutscene.done;
  await rolled;
  cutscene.stop();
  if (!isCurrent() || !stage.isConnected) return;

  const rarity = table.rarities[prize.rarity];
  stage.innerHTML = `
    <div class="card-panel gacha-won" style="--rarity:${escapeAttr(rarity?.color ?? "#94a3b8")}">
      <div class="won-rarity">${
        table.draw === "uniform" ? "New reaction" : escapeHtml(rarity?.label ?? "")
      }</div>
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
  const again = stage.querySelector<HTMLButtonElement>("#gacha-again")!;
  again.addEventListener("click", async () => {
    if (opening) return;
    const balance = await yennies();
    if (!unlockAllNow() && balance < table.cost) {
      toast("Not enough yennies.", "error");
      return;
    }
    again.disabled = true;
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
