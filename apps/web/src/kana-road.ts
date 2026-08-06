/**
 * The kana road: the level ladder drawn as a map, with forks in it.
 *
 * The first seven stages are the original ladder, single file, the same in
 * every game. The road past them is rolled fresh each time a game starts:
 * the six later games are dealt into a random arrangement of forks — two
 * tiles here, a merge there, a three-way somewhere — so no two runs walk
 * the same map. The deal lives in the save, so reopening the app shows the
 * same road, not a new one.
 *
 * The map itself is scenery, not controls: it rides above the quiz,
 * scrolls itself to wherever the player stands, and takes no touches. The
 * choosing happens at the fork, on its own screen.
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

const DEFS: Record<Mechanic, { name: string; icon: string; detail: string }> = {
  learn: { name: "Learn", icon: "📖", detail: "Meet your kana, the ones you know least first." },
  choice: { name: "Multiple choice", icon: "🔤", detail: "Three options." },
  type: { name: "Type it", icon: "⌨️", detail: "Type the romaji yourself." },
  lives: { name: "Lives", icon: "❤️", detail: "Typing, five hearts. A miss costs one." },
  timed: { name: "Timed", icon: "⏱️", detail: "Hearts, and six seconds a question." },
  words: { name: "Real words", icon: "📚", detail: "Short dictionary words from your kana. No clock." },
  "words-timed": { name: "Words, timed", icon: "⚡", detail: "Different words, ten seconds each." },
  flash: { name: "Flash", icon: "👁️", detail: "The kana shows for a blink, then hides. Type it from the afterimage." },
  echo: { name: "Echo", icon: "🔊", detail: "Hear the sound, tap the kana. No reading — only listening." },
  sort: { name: "Sort race", icon: "🗂️", detail: "Three buckets, four seconds. Fling each kana where it belongs." },
  simon: { name: "Simon", icon: "🎶", detail: "A spoken sequence, growing longer. Tap it back in order." },
  sharpshooter: { name: "Sharpshooter", icon: "🎯", detail: "One sound, a wall of kana. Tap every tile that says it." },
  alien: { name: "Alien names", icon: "👾", detail: "Made-up words from your own kana. No vocabulary to lean on." },
};

/** The fixed opening stretch, one tile per stage. */
const BASE: Mechanic[] = ["learn", "choice", "type", "lives", "timed", "words", "words-timed"];
export const BASE_STAGES = BASE.length;

/** The games the random stretch is dealt from. */
const TAIL_POOL: Mechanic[] = ["flash", "echo", "sort", "simon", "sharpshooter", "alien"];

/**
 * The shapes the tail may take: how many tiles stand at each stage. Every
 * shape spends all six games, always holds at least one fork, and never
 * forks the same width twice running — a road that reads as a road.
 */
const TAIL_SHAPES: number[][] = [
  [2, 1, 3],
  [3, 1, 2],
  [1, 2, 3],
  [1, 3, 2],
  [2, 3, 1],
  [3, 2, 1],
  [2, 1, 2, 1],
  [1, 2, 1, 2],
];

/** A fresh deal of the road past the base stages. Rolled per game. */
export function generateTail(): Mechanic[][] {
  const shape = TAIL_SHAPES[Math.floor(Math.random() * TAIL_SHAPES.length)];
  const dealt = shuffle([...TAIL_POOL]);
  const tail: Mechanic[][] = [];
  let at = 0;
  for (const width of shape) {
    tail.push(dealt.slice(at, at + width));
    at += width;
  }
  return tail;
}

/** For saves from before the road was dealt: the layout those games had. */
const LEGACY_TAIL: Mechanic[][] = [["flash", "echo"], ["sort"], ["simon", "sharpshooter", "alien"]];

/** The whole road as drawable, playable nodes: fixed base plus this game's tail. */
export function buildRoad(tail: Mechanic[][] | undefined): RoadNode[][] {
  const nodeOf = (mechanic: Mechanic, id: string): RoadNode => ({ id, mechanic, ...DEFS[mechanic] });
  return [
    ...BASE.map((mechanic, stage) => [nodeOf(mechanic, String(stage))]),
    ...(tail ?? LEGACY_TAIL).map((mechanics, i) =>
      mechanics.map((mechanic, k) =>
        nodeOf(mechanic, mechanics.length === 1 ? String(BASE_STAGES + i) : `${BASE_STAGES + i}${"abc"[k]}`),
      ),
    ),
  ];
}

/** The tile the player took at this stage, or the only tile there was. */
export function chosenAt(road: RoadNode[][], stage: number, path: Record<string, string>): string | undefined {
  const nodes = road[stage];
  if (!nodes) return undefined;
  return nodes.length === 1 ? nodes[0].id : path[String(stage)];
}

export function nodeById(road: RoadNode[][], stage: number, id: string | undefined): RoadNode {
  const nodes = road[stage];
  return nodes.find((node) => node.id === id) ?? nodes[0];
}

// ---------------- the map ----------------

const SVG_NS = "http://www.w3.org/2000/svg";

export interface RoadMapView {
  unlocked: number;
  path: Record<string, string>;
  /** The stage being played right now; its tile gets the ring. */
  current?: { stage: number; id: string };
}

/**
 * The road drawn as tiles: done stages behind, the open stage glowing, the
 * rest fogged. Pure scenery — nothing here takes a tap, and the strip
 * scrolls itself to wherever matters: the tile being played, or the
 * frontier.
 */
export function renderRoadMap(host: HTMLElement, road: RoadNode[][], view: RoadMapView): void {
  const open = Math.min(view.unlocked, road.length - 1);
  const focus = view.current?.stage ?? open;

  host.innerHTML = `
    <div class="kmap">
      <div class="kmap-inner">
        ${road.map((nodes, stage) => {
          const tiles = nodes
            .map((node) => {
              const walked = stage < view.unlocked && chosenAt(road, stage, view.path) === node.id;
              const playing = view.current?.stage === stage && view.current.id === node.id;
              const state =
                stage < view.unlocked
                  ? walked
                    ? "done"
                    : "done-alt"
                  : stage === open && view.unlocked < road.length
                    ? "open"
                    : stage === open
                      ? "done-alt"
                      : "locked";
              return `
                <div class="kmap-node ${state}${playing ? " current" : ""}" data-stage="${stage}" data-id="${node.id}">
                  <span class="kmap-icon">${node.icon}</span>
                  <span class="kmap-num">${walked ? "✓" : stage}</span>
                  <span class="kmap-name">${node.name}</span>
                </div>`;
            })
            .join("");
          return `<div class="kmap-stage" data-stage="${stage}">${tiles}</div>`;
        }).join("")}
      </div>
    </div>
  `;

  const inner = host.querySelector<HTMLDivElement>(".kmap-inner")!;
  const scroller = host.querySelector<HTMLDivElement>(".kmap")!;

  // The connecting roads, drawn once the tiles have a size. Every tile links
  // to every tile of the next stage — any open tile is reachable — and the
  // route already walked is inked solid.
  requestAnimationFrame(() => {
    if (!inner.isConnected) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("kmap-links");
    svg.setAttribute("width", String(inner.scrollWidth));
    svg.setAttribute("height", String(inner.scrollHeight));
    const innerBox = inner.getBoundingClientRect();
    // Both rects move together under horizontal scroll, so their
    // difference is already scroll-proof.
    const center = (el: Element): { x: number; y: number } => {
      const box = el.getBoundingClientRect();
      return {
        x: box.left - innerBox.left + box.width / 2,
        y: box.top - innerBox.top + box.height / 2,
      };
    };
    for (let stage = 0; stage + 1 < road.length; stage++) {
      const from = [...inner.querySelectorAll(`.kmap-stage[data-stage="${stage}"] .kmap-node`)];
      const to = [...inner.querySelectorAll(`.kmap-stage[data-stage="${stage + 1}"] .kmap-node`)];
      for (const a of from) {
        for (const b of to) {
          const p1 = center(a);
          const p2 = center(b);
          const line = document.createElementNS(SVG_NS, "path");
          const midX = (p1.x + p2.x) / 2;
          line.setAttribute("d", `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`);
          const walked =
            stage + 1 < view.unlocked &&
            chosenAt(road, stage, view.path) === (a as HTMLElement).dataset.id &&
            chosenAt(road, stage + 1, view.path) === (b as HTMLElement).dataset.id;
          const leading =
            stage + 1 === view.unlocked &&
            view.unlocked < road.length &&
            chosenAt(road, stage, view.path) === (a as HTMLElement).dataset.id;
          line.setAttribute("class", walked ? "walked" : leading ? "leading" : "");
          svg.appendChild(line);
        }
      }
    }
    inner.prepend(svg);

    // Keep what matters in the window: the tile being played, or the choice
    // ahead. The strip does its own walking — it is not scrollable by hand.
    const target = inner.querySelector<HTMLElement>(`.kmap-stage[data-stage="${focus}"]`);
    if (target) {
      scroller.scrollTo({
        left: Math.max(0, target.offsetLeft - scroller.clientWidth / 2 + target.offsetWidth / 2),
        behavior: "smooth",
      });
    }
  });
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
