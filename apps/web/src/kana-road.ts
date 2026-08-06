/**
 * The kana road: the level ladder drawn as a map, with forks in it.
 *
 * The first seven stages are the original ladder, single file, the same in
 * every game. The road past them — stages 7 through 19 — is rolled fresh
 * each time a game starts: eleven games dealt into a random arrangement of
 * forks, coming round more than once as the road runs on, harder each time
 * it does. Stage 20 waits at the end of the map, face down.
 *
 * Difficulty climbs two ways. Tiers, first: every stage past 10 plays a
 * little meaner than its mechanic did earlier — clocks tighter, sequences
 * longer, the flash briefer. Modifiers, second: from the second fork on,
 * every forked tile carries a rule-bend — lose a heart at the door, pay a
 * toll, names that fade as you read them — and the crueller the bend, the
 * rarer it is and the better it pays. The deal lives in the save, so
 * reopening the app shows the same road, not a new one.
 *
 * The map itself is scenery, not controls: it rides above the quiz,
 * scrolls itself to wherever the player stands, and takes no touches. The
 * choosing happens at the fork, on its own screen.
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
  | "alien"
  | "onebehind"
  | "dictation"
  | "missing"
  | "speed"
  | "whichmissing";

// ---------------- modifiers ----------------

/**
 * What a modifier does, in numbers the level engine reads. Everything is
 * optional; a modifier sets only what it bends.
 */
export interface ModEffects {
  /** Change to starting hearts (negative). Floor of one. */
  hearts?: number;
  /** One heart, full stop. */
  suddenDeath?: boolean;
  /** Yennies charged for stepping on the tile. */
  toll?: number;
  /** Multiplier on what the level pays out. */
  payout?: number;
  /** Multiply whatever clock the level runs. */
  timerScale?: number;
  /** Give a clock (seconds) to a level that had none. */
  addTimer?: number;
  /** Flash: how long the kana shows. */
  flashMs?: number;
  /** Simon: every sequence this much longer. */
  seqExtra?: number;
  /** Alien names: this much longer. */
  alienExtra?: number;
  /** The big text starts fading as soon as it appears. */
  fade?: boolean;
  /** Sound-first levels: it plays once. No replay button. */
  oneListen?: boolean;
  /** Sort: how many buckets stand ready. */
  buckets?: number;
  /** Sharpshooter: more targets in a fuller wall. */
  crowded?: boolean;
  /** Dictation: this many extra decoy tiles. */
  decoys?: number;
}

export interface Modifier {
  id: string;
  name: string;
  icon: string;
  detail: string;
  /** 1 stings, 2 hurts, 3 is cruel. Rarity and payout climb with it. */
  tier: 1 | 2 | 3;
  /** Mechanics it can land on; absent = any. */
  applies?: Mechanic[];
  effects: ModEffects;
}

/**
 * The modifier deck. Payout rises with tier on every one of them — a bent
 * tile is a wager, not a tax.
 */
export const MODIFIERS: Modifier[] = [
  // ---- generic ----
  { id: "bruised", name: "Bruised", icon: "💔", tier: 1, detail: "One heart gone at the door. Pays a little extra.", effects: { hearts: -1, payout: 1.25 } },
  { id: "toll", name: "Toll road", icon: "💸", tier: 1, detail: "50 ¥ to step on this tile. Pays back with interest — if you clear it.", effects: { toll: 50, payout: 1.25 } },
  { id: "hasty", name: "Hasty", icon: "⏩", tier: 2, detail: "Every clock runs fast — and there IS a clock, even where there wasn't.", effects: { timerScale: 0.7, addTimer: 7, payout: 1.5 } },
  { id: "frail", name: "Frail", icon: "🩹", tier: 2, detail: "Two hearts gone at the door.", effects: { hearts: -2, payout: 1.5 } },
  { id: "sudden", name: "Sudden death", icon: "☠️", tier: 3, detail: "One heart. One. Double pay for the nerve.", effects: { suddenDeath: true, payout: 2 } },
  { id: "highstakes", name: "High stakes", icon: "🎰", tier: 3, detail: "150 ¥ on the table. Clear it and it pays two and a half times over.", effects: { toll: 150, payout: 2.5 } },
  // ---- game-specific ----
  { id: "longnames", name: "Long names", icon: "👽", tier: 1, applies: ["alien"], detail: "The names grow a sound longer.", effects: { alienExtra: 1, payout: 1.25 } },
  { id: "fading", name: "Fading ink", icon: "🌫️", tier: 2, applies: ["alien", "onebehind"], detail: "The name starts vanishing the moment it appears.", effects: { fade: true, payout: 1.5 } },
  { id: "epics", name: "Alien epics", icon: "📜", tier: 3, applies: ["alien"], detail: "Longer names, and they fade as you read.", effects: { alienExtra: 2, fade: true, payout: 2 } },
  { id: "onemorenote", name: "One more note", icon: "🎵", tier: 2, applies: ["simon"], detail: "Every sequence runs one sound longer.", effects: { seqExtra: 1, payout: 1.5 } },
  { id: "longsong", name: "Long song", icon: "🎼", tier: 3, applies: ["simon"], detail: "Every sequence runs two sounds longer.", effects: { seqExtra: 2, payout: 2 } },
  { id: "blink", name: "Blink", icon: "⚡", tier: 2, applies: ["flash"], detail: "The kana shows for half the time.", effects: { flashMs: 350, payout: 1.5 } },
  { id: "subliminal", name: "Subliminal", icon: "🌠", tier: 3, applies: ["flash"], detail: "The kana barely appears at all.", effects: { flashMs: 180, payout: 2 } },
  { id: "greased", name: "Greased buckets", icon: "🧈", tier: 2, applies: ["sort"], detail: "The clock runs a quarter faster.", effects: { timerScale: 0.75, payout: 1.5 } },
  { id: "fourbuckets", name: "Four buckets", icon: "🗃️", tier: 3, applies: ["sort"], detail: "A fourth bucket joins the line.", effects: { buckets: 4, payout: 2 } },
  { id: "crowded", name: "Crowded range", icon: "🎪", tier: 2, applies: ["sharpshooter"], detail: "More targets, hiding in a fuller wall.", effects: { crowded: true, payout: 1.5 } },
  { id: "onelisten", name: "One listen", icon: "👂", tier: 2, applies: ["echo", "simon", "dictation", "missing", "whichmissing"], detail: "It plays once. There is no replay button.", effects: { oneListen: true, payout: 1.5 } },
  { id: "noisy", name: "Noisy line", icon: "📢", tier: 2, applies: ["dictation"], detail: "Three extra decoy tiles muddy the board.", effects: { decoys: 3, payout: 1.5 } },
];

const MODIFIER_BY_ID = new Map(MODIFIERS.map((mod) => [mod.id, mod]));

export interface RoadNode {
  id: string;
  mechanic: Mechanic;
  name: string;
  detail: string;
  /** The map tile's face. */
  icon: string;
  /** The rule-bend this tile appeared with, when it appeared with one. */
  modifier?: Modifier;
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
  sort: { name: "Sort race", icon: "🗂️", detail: "Buckets on a clock. Drag each kana where it belongs." },
  simon: { name: "Simon", icon: "🎶", detail: "A spoken sequence, growing longer. Tap it back in order." },
  sharpshooter: { name: "Sharpshooter", icon: "🎯", detail: "One sound, a wall of kana. Tap every tile that says it." },
  alien: { name: "Alien names", icon: "👾", detail: "Made-up words from your own kana. No vocabulary to lean on." },
  onebehind: { name: "One behind", icon: "🪞", detail: "Answer the kana BEFORE the one you're looking at." },
  dictation: { name: "Dictation", icon: "✍️", detail: "Hear a word, rebuild it from tiles. Decoys included." },
  missing: { name: "Missing piece", icon: "🧩", detail: "A word with a hole in it. Hear it whole, tap what's missing." },
  speed: { name: "Speed ladder", icon: "🪜", detail: "The clock shrinks with every right answer. Find your limit." },
  whichmissing: { name: "The silent one", icon: "🤫", detail: "Three sounds play. Four tiles show. Tap the one that stayed quiet." },
};

/** The fixed opening stretch, one tile per stage. */
const BASE: Mechanic[] = ["learn", "choice", "type", "lives", "timed", "words", "words-timed"];
export const BASE_STAGES = BASE.length;

/** The road runs to here; the stage after it is the boss's, face down. */
export const LAST_STAGE = 19;

/** The games the random stretch is dealt from. */
const TAIL_POOL: Mechanic[] = [
  "flash",
  "echo",
  "sort",
  "simon",
  "sharpshooter",
  "alien",
  "onebehind",
  "dictation",
  "missing",
  "speed",
  "whichmissing",
];

/**
 * How mean a stage plays, from where it stands on the road. Tier 2 and 3
 * sharpen the mechanics themselves — tighter clocks, longer sequences —
 * before any modifier has its say.
 */
export function tierOf(stage: number): 1 | 2 | 3 {
  return stage <= 10 ? 1 : stage <= 15 ? 2 : 3;
}

/** One tile of the stored deal. */
export interface TailTile {
  m: Mechanic;
  mod?: string;
}

/** A stored tail: what lives in the save. Older saves stored bare names. */
export type StoredTail = (TailTile | Mechanic)[][];

/**
 * A fresh deal of the road past the base stages: stages 7..19, widths
 * random, always opening with a fork of two. Mechanics cycle through the
 * whole pool, reshuffled as it empties, so everything appears and the
 * repeats land later — where the tiers have turned crueller.
 *
 * Modifiers land on forked tiles only, and only from the SECOND fork on:
 * the first fork is a clean choice between games, learned safely. Deeper
 * forks deal harder bends more often, but the harder a bend is, the rarer
 * it stays.
 */
export function generateTail(): TailTile[][] {
  const stages = LAST_STAGE - BASE_STAGES + 1;
  const widths: number[] = [2];
  while (widths.length < stages) {
    const r = Math.random();
    widths.push(r < 0.4 ? 1 : r < 0.78 ? 2 : 3);
  }

  let bag: Mechanic[] = [];
  const take = (avoid: Set<Mechanic>): Mechanic => {
    for (let i = 0; i < 20; i++) {
      if (bag.length === 0) bag = shuffle([...TAIL_POOL]);
      if (avoid.has(bag[bag.length - 1])) {
        // Put it back underneath and try the next card.
        bag.unshift(bag.pop()!);
        continue;
      }
      return bag.pop()!;
    }
    return bag.pop()!;
  };

  let forksSeen = 0;
  const tail: TailTile[][] = [];
  let previous = new Set<Mechanic>();
  widths.forEach((width, i) => {
    const inStage = new Set<Mechanic>();
    const stageTiles: TailTile[] = [];
    for (let k = 0; k < width; k++) {
      const mechanic = take(new Set([...inStage, ...previous]));
      inStage.add(mechanic);
      stageTiles.push({ m: mechanic });
    }
    if (width > 1) {
      forksSeen++;
      if (forksSeen > 1) {
        for (const tile of stageTiles) {
          const mod = dealModifier(tile.m, BASE_STAGES + i);
          if (mod) tile.mod = mod.id;
        }
      }
    }
    tail.push(stageTiles);
    previous = inStage;
  });
  return tail;
}

/**
 * A bend for this tile: tier by depth — deeper forks deal harder bends more
 * often, but tier 3 stays the rarest everywhere — then a random modifier of
 * that tier that fits the mechanic, falling a tier when none does.
 */
function dealModifier(mechanic: Mechanic, stage: number): Modifier | null {
  const depth = Math.min(1, Math.max(0, (stage - BASE_STAGES) / (LAST_STAGE - BASE_STAGES)));
  const roll = Math.random();
  let tier: 1 | 2 | 3 = roll < 0.05 + 0.2 * depth ? 3 : roll < 0.35 + 0.35 * depth ? 2 : 1;
  while (tier >= 1) {
    const fits = MODIFIERS.filter(
      (mod) => mod.tier === tier && (!mod.applies || mod.applies.includes(mechanic)),
    );
    if (fits.length > 0) return fits[Math.floor(Math.random() * fits.length)];
    tier = (tier - 1) as 1 | 2 | 3;
    if (tier < 1) break;
  }
  return null;
}

/** For saves from before the road was dealt: the layout those games had. */
const LEGACY_TAIL: StoredTail = [["flash", "echo"], ["sort"], ["simon", "sharpshooter", "alien"]];

/** The whole road as drawable, playable nodes: fixed base plus this game's tail. */
export function buildRoad(tail: StoredTail | undefined): RoadNode[][] {
  const nodeOf = (mechanic: Mechanic, id: string, mod?: string): RoadNode => ({
    id,
    mechanic,
    ...DEFS[mechanic],
    ...(mod && MODIFIER_BY_ID.has(mod) ? { modifier: MODIFIER_BY_ID.get(mod) } : {}),
  });
  return [
    ...BASE.map((mechanic, stage) => [nodeOf(mechanic, String(stage))]),
    ...(tail ?? LEGACY_TAIL).map((tiles, i) =>
      tiles.map((tile, k) => {
        const mechanic = typeof tile === "string" ? tile : tile.m;
        const mod = typeof tile === "string" ? undefined : tile.mod;
        return nodeOf(mechanic, tiles.length === 1 ? String(BASE_STAGES + i) : `${BASE_STAGES + i}${"abc"[k]}`, mod);
      }),
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
 * rest fogged, a face-down tile waiting past the end. Pure scenery —
 * nothing here takes a tap, and the strip scrolls itself to wherever
 * matters: the tile being played, or the frontier.
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
                  ${node.modifier ? `<span class="kmap-mod tier-${node.modifier.tier}" title="${escapeAttr(node.modifier.name)}">${node.modifier.icon}</span>` : ""}
                  <span class="kmap-icon">${node.icon}</span>
                  <span class="kmap-num">${walked ? "✓" : stage}</span>
                  <span class="kmap-name">${node.name}</span>
                </div>`;
            })
            .join("");
          return `<div class="kmap-stage" data-stage="${stage}">${tiles}</div>`;
        }).join("")}
        <div class="kmap-stage kmap-boss-stage">
          <div class="kmap-node locked kmap-boss">
            <span class="kmap-icon">👹</span>
            <span class="kmap-num">${road.length}</span>
            <span class="kmap-name">???</span>
          </div>
        </div>
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
    const link = (a: Element, b: Element, cls: string): void => {
      const p1 = center(a);
      const p2 = center(b);
      const line = document.createElementNS(SVG_NS, "path");
      const midX = (p1.x + p2.x) / 2;
      line.setAttribute("d", `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`);
      line.setAttribute("class", cls);
      svg.appendChild(line);
    };
    for (let stage = 0; stage + 1 < road.length; stage++) {
      const from = [...inner.querySelectorAll(`.kmap-stage[data-stage="${stage}"] .kmap-node`)];
      const to = [...inner.querySelectorAll(`.kmap-stage[data-stage="${stage + 1}"] .kmap-node`)];
      for (const a of from) {
        for (const b of to) {
          const walked =
            stage + 1 < view.unlocked &&
            chosenAt(road, stage, view.path) === (a as HTMLElement).dataset.id &&
            chosenAt(road, stage + 1, view.path) === (b as HTMLElement).dataset.id;
          const leading =
            stage + 1 === view.unlocked &&
            view.unlocked < road.length &&
            chosenAt(road, stage, view.path) === (a as HTMLElement).dataset.id;
          link(a, b, walked ? "walked" : leading ? "leading" : "");
        }
      }
    }
    // The road runs on towards the face-down tile, faintly.
    const last = [...inner.querySelectorAll(`.kmap-stage[data-stage="${road.length - 1}"] .kmap-node`)];
    const boss = inner.querySelector(".kmap-boss");
    if (boss) for (const a of last) link(a, boss, "");
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
