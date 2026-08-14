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
 *
 * A multi-pull runs one lane per crate, all at once: the strips fly
 * together and settle one after another, left to right down the stack,
 * because five separate suspenses in a row is four too many and a single
 * strip showing one prize of five is a film about the wrong thing.
 */

/** How many cards a strip holds, and where the winner sits in it. */
const STRIP = 56;
const WINNER_AT = 48;

/**
 * Lane geometry, by how many lanes there are. One lane gets the full-size
 * cards; a stack of them shrinks so five crates still fit on a phone
 * screen. The strip maths reads these same numbers, so the landing spot
 * cannot drift from what the stylesheet draws.
 */
const SIZES = {
  single: { cardW: 116, gap: 10 },
  multi: { cardW: 72, gap: 8 },
};

function cardHtml(prize: Prize, table: PrizeTable, compact: boolean): string {
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
  // The compact card is the face alone: at five lanes the names would be
  // four-point type, and the results screen right after names everything.
  return `<div class="roll-card" style="--rarity:${escapeAttr(rarity?.color ?? "#94a3b8")}">
    ${face}
    ${compact ? "" : `<span class="roll-name">${escapeHtml(prize.name)}</span>`}
  </div>`;
}

/**
 * Run the roll inside `box`, one lane per winner, all landing at once.
 * Resolves when the last lane stops.
 */
export function runRoll(
  box: HTMLElement,
  winners: Prize | Prize[],
  table: PrizeTable,
): Promise<void> {
  const landing = Array.isArray(winners) ? winners : [winners];
  if (landing.length === 0) return Promise.resolve();
  const compact = landing.length > 1;
  const { cardW, gap } = compact ? SIZES.multi : SIZES.single;
  const pitch = cardW + gap;

  const pool = table.prizes.length > 0 ? table.prizes : landing;
  const laneHtml = (winner: Prize): string => {
    const strip: Prize[] = Array.from({ length: STRIP }, (_, i) =>
      i === WINNER_AT ? winner : pool[Math.floor(Math.random() * pool.length)],
    );
    return `<div class="roll-strip">${strip.map((p) => cardHtml(p, table, compact)).join("")}</div>`;
  };

  box.innerHTML = `
    <div class="roll${compact ? " roll-multi" : ""}">
      <div class="roll-window">
        <div class="roll-marker"></div>
        ${landing.map(laneHtml).join("")}
      </div>
    </div>
  `;

  const windowEl = box.querySelector<HTMLDivElement>(".roll-window")!;
  const lanes = [...box.querySelectorAll<HTMLDivElement>(".roll-strip")];

  const settled = lanes.map(
    (lane, i) =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };

        // Where this lane's winner has to end up: its middle under the
        // marker, off by a few pixels either way so it never stops
        // suspiciously dead centre.
        const centre = windowEl.clientWidth / 2;
        const jitter = (Math.random() - 0.5) * (cardW * 0.5);
        const target = -(WINNER_AT * pitch + cardW / 2 - centre) + jitter;

        // Everyone launches together; the lanes come to rest in order down
        // the stack, a beat apart, so the reveal reads top to bottom
        // instead of as one thud.
        const seconds = (compact ? 5.2 : 6.4) + i * 0.45 + Math.random() * 0.25;

        lane.style.transition = "none";
        lane.style.transform = "translate3d(0,0,0)";
        // A frame with the start position committed, or the browser folds
        // the two transforms together and nothing moves.
        requestAnimationFrame(() => {
          lane.style.transition = `transform ${seconds.toFixed(2)}s cubic-bezier(0.12, 0.72, 0.06, 1)`;
          lane.style.transform = `translate3d(${target}px,0,0)`;
        });
        lane.addEventListener("transitionend", finish, { once: true });
        // Belt and braces: a dropped transitionend must not hang the pull.
        setTimeout(finish, seconds * 1000 + 800);
      }),
  );

  return Promise.all(settled).then(() => undefined);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
