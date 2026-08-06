/**
 * The kana road: the level ladder drawn as a map, with forks in it.
 *
 * The first seven stages are the original ladder, single file. After that
 * the road forks — two tiles to choose between, then back to one, then a
 * three-way — and the choice is the player's. A stage is cleared by
 * clearing ANY of its tiles, and the tile taken is remembered so the map
 * can show the route actually walked.
 *
 * Every mechanic works over whatever kana pool the player picked: nothing
 * here assumes both scripts, particular rows, or a pool big enough for
 * dictionary words (the two word stages, which do, already know how to
 * bow out gracefully).
 *
 * Nodes carry an optional `modifier` slot on purpose. Rarely, a tile will
 * appear bent — easier or harder than its plain self. Nothing reads the
 * field yet; the shape is here so modifiers land without reshaping the map.
 */

export type Mechanic =
  | "learn"
  | "choice"
  | "type"
  | "lives"
  | "timed"
  | "words"
  | "words-timed"
  | "flash"
  | "echo"
  | "sort"
  | "simon"
  | "sharpshooter"
  | "alien";

export interface RoadNode {
  id: string;
  mechanic: Mechanic;
  name: string;
  detail: string;
  /** The map tile's face. */
  icon: string;
  /** Reserved: a rare rule-bend this tile appeared with. See above. */
  modifier?: string;
}

/** Each entry is one stage of the road; 2-3 nodes means the player chooses. */
export const ROAD: RoadNode[][] = [
  [{ id: "0", mechanic: "learn", name: "Learn", icon: "📖", detail: "Meet your kana, the ones you know least first." }],
  [{ id: "1", mechanic: "choice", name: "Multiple choice", icon: "🔤", detail: "Three options." }],
  [{ id: "2", mechanic: "type", name: "Type it", icon: "⌨️", detail: "Type the romaji yourself." }],
  [{ id: "3", mechanic: "lives", name: "Lives", icon: "❤️", detail: "Typing, five hearts. A miss costs one." }],
  [{ id: "4", mechanic: "timed", name: "Timed", icon: "⏱️", detail: "Hearts, and six seconds a question." }],
  [{ id: "5", mechanic: "words", name: "Real words", icon: "📚", detail: "Short dictionary words from your kana. No clock." }],
  [{ id: "6", mechanic: "words-timed", name: "Words, timed", icon: "⚡", detail: "Different words, ten seconds each." }],
  [
    { id: "7a", mechanic: "flash", name: "Flash", icon: "👁️", detail: "The kana shows for a blink, then hides. Type it from the afterimage." },
    { id: "7b", mechanic: "echo", name: "Echo", icon: "🔊", detail: "Hear the sound, tap the kana. No reading — only listening." },
  ],
  [{ id: "8", mechanic: "sort", name: "Sort race", icon: "🗂️", detail: "Three buckets, four seconds. Fling each kana where it belongs." }],
  [
    { id: "9a", mechanic: "simon", name: "Simon", icon: "🎶", detail: "A spoken sequence, growing longer. Tap it back in order." },
    { id: "9b", mechanic: "sharpshooter", name: "Sharpshooter", icon: "🎯", detail: "One sound, a wall of kana. Tap every tile that says it." },
    { id: "9c", mechanic: "alien", name: "Alien names", icon: "👾", detail: "Made-up words from your own kana. No vocabulary to lean on." },
  ],
];

/** The tile the player took at this stage, or the only tile there was. */
export function chosenAt(stage: number, path: Record<string, string>): string | undefined {
  const nodes = ROAD[stage];
  if (!nodes) return undefined;
  return nodes.length === 1 ? nodes[0].id : path[String(stage)];
}

export function nodeById(stage: number, id: string | undefined): RoadNode {
  const nodes = ROAD[stage];
  return nodes.find((node) => node.id === id) ?? nodes[0];
}

// ---------------- the map ----------------

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The road drawn as tiles: done stages behind, the open stage glowing, the
 * rest fogged. Scrolls sideways and keeps the open stage in view. Any tile
 * at or below the open stage can be tapped and played; locked ones say
 * nothing, which is what makes the glowing ones read as the choice.
 */
export function renderRoadMap(
  host: HTMLElement,
  unlocked: number,
  path: Record<string, string>,
  onPick: (stage: number, node: RoadNode) => void,
): void {
  const open = Math.min(unlocked, ROAD.length - 1);

  host.innerHTML = `
    <div class="kmap">
      <div class="kmap-inner">
        ${ROAD.map((nodes, stage) => {
          const tiles = nodes
            .map((node) => {
              const walked = stage < unlocked && chosenAt(stage, path) === node.id;
              const state =
                stage < unlocked ? (walked ? "done" : "done-alt") : stage === open && unlocked < ROAD.length ? "open" : stage === open ? "done-alt" : "locked";
              return `
                <button class="kmap-node ${state}" data-stage="${stage}" data-id="${node.id}"
                  ${state === "locked" ? "disabled" : ""} title="${escapeAttr(node.detail)}">
                  <span class="kmap-icon">${node.icon}</span>
                  <span class="kmap-num">${walked ? "✓" : stage}</span>
                  <span class="kmap-name">${node.name}</span>
                </button>`;
            })
            .join("");
          return `<div class="kmap-stage" data-stage="${stage}">${tiles}</div>`;
        }).join("")}
      </div>
    </div>
  `;

  const inner = host.querySelector<HTMLDivElement>(".kmap-inner")!;
  const scroller = host.querySelector<HTMLDivElement>(".kmap")!;

  for (const tile of host.querySelectorAll<HTMLButtonElement>(".kmap-node:not(.locked)")) {
    tile.addEventListener("click", () => {
      const stage = Number(tile.dataset.stage);
      onPick(stage, nodeById(stage, tile.dataset.id));
    });
  }

  // The connecting roads, drawn once the tiles have a size. Every tile links
  // to every tile of the next stage — that is the promise the map makes: any
  // glowing tile is reachable from where you stand. The route already walked
  // is inked solid.
  requestAnimationFrame(() => {
    if (!inner.isConnected) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("kmap-links");
    svg.setAttribute("width", String(inner.scrollWidth));
    svg.setAttribute("height", String(inner.scrollHeight));
    const innerBox = inner.getBoundingClientRect();
    const center = (el: Element): { x: number; y: number } => {
      const box = el.getBoundingClientRect();
      // Both rects move together under horizontal scroll, so their
      // difference is already scroll-proof.
      return {
        x: box.left - innerBox.left + box.width / 2,
        y: box.top - innerBox.top + box.height / 2,
      };
    };
    for (let stage = 0; stage + 1 < ROAD.length; stage++) {
      const from = [...inner.querySelectorAll(`.kmap-stage[data-stage="${stage}"] .kmap-node`)];
      const to = [...inner.querySelectorAll(`.kmap-stage[data-stage="${stage + 1}"] .kmap-node`)];
      for (const a of from) {
        for (const b of to) {
          const p1 = center(a);
          const p2 = center(b);
          const line = document.createElementNS(SVG_NS, "path");
          const midX = (p1.x + p2.x) / 2;
          line.setAttribute(
            "d",
            `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`,
          );
          const walked =
            stage + 1 < unlocked &&
            chosenAt(stage, path) === (a as HTMLElement).dataset.id &&
            chosenAt(stage + 1, path) === (b as HTMLElement).dataset.id;
          const leading =
            stage + 1 === unlocked && unlocked < ROAD.length && chosenAt(stage, path) === (a as HTMLElement).dataset.id;
          line.setAttribute("class", walked ? "walked" : leading ? "leading" : "");
          svg.appendChild(line);
        }
      }
    }
    inner.prepend(svg);

    // Keep the frontier in the window: the road behind matters less than
    // the choice ahead.
    const target = inner.querySelector<HTMLElement>(`.kmap-stage[data-stage="${open}"]`);
    if (target) {
      scroller.scrollLeft = Math.max(0, target.offsetLeft - scroller.clientWidth / 2 + target.offsetWidth / 2);
    }
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
