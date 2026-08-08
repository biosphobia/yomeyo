import { prizeImageUrl, type Prize, type PrizeTable } from "./gacha-data.js";

/**
 * The case-opening roll: a strip of prizes that flies past a marker and
 * slows onto the one that was won.
 *
 * The winner is already decided before a single frame is drawn — the strip
 * is built to land on it. Nothing here can change what was pulled. What it
 * is for is the moment of not-quite-knowing while the strip slows down,
 * which is worth building properly and worth nothing at all if it is also a
 * lie about where it stops.
 */

/** How many cards the strip holds, and where the winner sits in it. */
const STRIP = 56;
const WINNER_AT = 48;

const CARD_WIDTH = 116;
const CARD_GAP = 10;
const PITCH = CARD_WIDTH + CARD_GAP;

function cardHtml(prize: Prize, table: PrizeTable): string {
  const rarity = table.rarities[prize.rarity];
  const face =
    prize.type === "item"
      ? `<span class="roll-item">${escapeHtml(prize.icon)}</span>`
      : prize.type === "skin"
      ? `<span class="roll-swatch" style="background:${escapeAttr(prize.vars["--bg"] ?? "#000")};
           border-color:${escapeAttr(prize.vars["--accent"] ?? "#fff")}">
           <i style="background:${escapeAttr(prize.vars["--accent"] ?? "#fff")}"></i>
         </span>`
      : `<img class="roll-gif" src="${escapeAttr(prizeImageUrl(prize.image))}" alt="" loading="lazy" />`;
  return `<div class="roll-card" style="--rarity:${escapeAttr(rarity?.color ?? "#94a3b8")}">
    ${face}
    <span class="roll-name">${escapeHtml(prize.name)}</span>
  </div>`;
}

/**
 * Run the roll inside `box`, landing on `winner`. Resolves when it stops,
 * or as soon as it is skipped.
 */
export function runRoll(
  box: HTMLElement,
  winner: Prize,
  table: PrizeTable,
): Promise<void> {
  const pool = table.prizes.length > 0 ? table.prizes : [winner];
  const strip: Prize[] = Array.from({ length: STRIP }, (_, i) =>
    i === WINNER_AT ? winner : pool[Math.floor(Math.random() * pool.length)],
  );

  box.innerHTML = `
    <div class="roll">
      <div class="roll-window">
        <div class="roll-marker"></div>
        <div class="roll-strip" id="roll-strip">${strip.map((p) => cardHtml(p, table)).join("")}</div>
      </div>
    </div>
  `;

  const stripEl = box.querySelector<HTMLDivElement>("#roll-strip")!;
  const windowEl = box.querySelector<HTMLDivElement>(".roll-window")!;

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };

    // Where the winner has to end up: its middle under the marker, off by a
    // few pixels either way so it never stops suspiciously dead centre.
    const settle = (): void => {
      const centre = windowEl.clientWidth / 2;
      const jitter = (Math.random() - 0.5) * (CARD_WIDTH * 0.5);
      const target = -(WINNER_AT * PITCH + CARD_WIDTH / 2 - centre) + jitter;

      stripEl.style.transition = "none";
      stripEl.style.transform = "translate3d(0,0,0)";
      // A frame with the start position committed, or the browser folds the
      // two transforms together and nothing moves.
      requestAnimationFrame(() => {
        stripEl.style.transition = "transform 6.4s cubic-bezier(0.12, 0.72, 0.06, 1)";
        stripEl.style.transform = `translate3d(${target}px,0,0)`;
      });
      stripEl.addEventListener("transitionend", finish, { once: true });
      // Belt and braces: a dropped transitionend must not hang the pull.
      setTimeout(finish, 7200);
    };

    settle();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
