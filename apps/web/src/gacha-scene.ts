import { assetUrl } from "./store.js";
import { createSfx, type Sfx } from "./gacha-audio.js";
import { buildLocation, type LocationId } from "./gacha-locations.js";

/**
 * The cutscene a crate opening happens inside.
 *
 * A few places that used to be somewhere, two figures, and a supply crate
 * that arrives by some means neither of them deserved. One scenario is drawn
 * at random, so opening forty crates is not watching the same film forty
 * times, and they do not all begin the same way: some walk in out of the
 * fog, some are already sitting at a counter, some are already in the bath.
 *
 * The pull happens here rather than afterwards: when the lid comes off the
 * scene says so, and the strip rolls over the top of it while the film keeps
 * playing underneath.
 *
 * Everything except the two characters is built in code — see
 * `gacha-locations.ts` — so the whole thing costs two small model files and
 * nothing else. three.js is large, so it is fetched when the Gacha tab opens
 * rather than when the button is pressed. If any of it fails, `done`
 * resolves at once and the roll happens without a film.
 */

const MODELS = ["gacha/models/yuuri.glb", "gacha/models/chito.glb"];

/**
 * The models face +Z at rest, which is towards the camera, so somebody
 * walking towards it needs no turn at all. Turning them by π — which is what
 * this used to do — walked them in backwards.
 */
const FACING = 0;

export interface CutsceneOptions {
  /** Fired the moment the lid comes off, for the roll to start over the top. */
  onOpen?: () => void;
}

export interface Cutscene {
  /** Resolves when the film has run its course. */
  done: Promise<void>;
  /** Tear it down. For finishing the pull, not for skipping the film. */
  stop: () => void;
  /** Which scenario was drawn, so the caption can name it. */
  id: Promise<string>;
}

// ---------------- the stage ----------------

interface Walker {
  root: any;
  mixer: any;
  bones: Record<string, any>;
  homeX: number;
}

interface Stage {
  sfx: Sfx;
  /** Whoever loaded, in file order. May be shorter than two. */
  cast: Walker[];
  crate: any;
  lid: any;
  spares: any[];
  once: (key: string, at: number, fn: () => void) => void;
  /** Set true on any frame the walk cycle should be running. */
  walking: boolean;
  /** Where the camera looks. */
  look: { x: number; y: number; z: number };
  /** How far the camera has pushed in, 0..1, when a scenario wants to say. */
  dolly: number | null;
}

export interface Scenario {
  id: string;
  location: LocationId;
  seconds: number;
  /** When the lid comes off, so the roll can be started against it. */
  opensAt: number;
  run: (t: number, dt: number, s: Stage) => void;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const spring = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 13));

/**
 * Bend a character into a shape the one walk cycle cannot make.
 *
 * The rig is a plain humanoid with named joints, so a sit is hips and knees,
 * a wave is one arm and a panic is both — no extra clips and nothing more to
 * download. `amount` fades the pose in so a scenario can ease into it.
 */
function pose(walker: Walker | undefined, name: string, amount: number, t = 0): void {
  if (!walker) return;
  const b = walker.bones;
  const a = clamp01(amount);
  const set = (bone: any, x = 0, y = 0, z = 0): void => {
    if (bone) bone.rotation.set(x * a, y * a, z * a);
  };
  switch (name) {
    case "sit":
      set(b.LeftUpLeg, -1.5);
      set(b.RightUpLeg, -1.5);
      set(b.LeftLeg, 1.5);
      set(b.RightLeg, 1.5);
      set(b.Spine, 0.12);
      break;
    case "soak":
      // Sunk to the shoulders, arms out along the rim.
      set(b.LeftUpLeg, -1.35);
      set(b.RightUpLeg, -1.35);
      set(b.LeftLeg, 1.2);
      set(b.RightLeg, 1.2);
      set(b.LeftArm, 0, 0, -1.15);
      set(b.RightArm, 0, 0, 1.15);
      set(b.Head, Math.sin(t * 1.1) * 0.12);
      break;
    case "wave":
      set(b.RightArm, 0, 0, 2.1 + Math.sin(t * 9) * 0.35);
      set(b.RightForeArm, 0, 0, 0.5);
      break;
    case "reach":
      set(b.LeftArm, -1.5, 0, -0.35);
      set(b.RightArm, -1.5, 0, 0.35);
      set(b.Spine, -0.2);
      break;
    case "panic":
      set(b.LeftArm, 0, 0, -2.3 + Math.sin(t * 14) * 0.6);
      set(b.RightArm, 0, 0, 2.3 + Math.sin(t * 14 + 1) * 0.6);
      set(b.Head, Math.sin(t * 11) * 0.3);
      break;
    case "flat":
      set(b.LeftArm, 0, 0, -1.9);
      set(b.RightArm, 0, 0, 1.9);
      set(b.Spine, 0.25);
      break;
    case "clear":
      for (const bone of Object.values(b)) bone?.rotation.set(0, 0, 0);
      break;
  }
}

/** Face the camera, optionally turned by `turn` radians. */
function face(walker: Walker | undefined, turn = 0): void {
  if (walker) walker.root.rotation.y = FACING + turn;
}

/** The opening the city scenarios share: two figures out of the fog. */
function walkIn(s: Stage, t: number, seconds: number, from = -26): number {
  const walk = clamp01(t / seconds);
  s.walking = walk < 1;
  s.cast.forEach((person, i) => {
    const start = from - i * 1.5;
    const to = -0.2 - i * 0.35;
    person.root.position.set(person.homeX, 0, start + (to - start) * smooth(walk));
    face(person);
  });
  for (let n = 0; n < Math.floor(walk * seconds * 2.4); n++) {
    s.once(`step${n}`, n / 2.4, () => s.sfx.step());
  }
  return walk;
}

/** Put them somewhere and leave them there. */
function place(s: Stage, spots: [number, number][], turn = 0, y = 0): void {
  s.cast.forEach((person, i) => {
    const spot = spots[i] ?? spots[0];
    person.root.position.set(spot[0], y, spot[1]);
    face(person, turn * (i === 0 ? 1 : -1));
  });
}

function showCrate(s: Stage, x: number, y: number, z: number): void {
  s.crate.visible = true;
  s.crate.position.set(x, y, z);
}

function popLid(s: Stage, p: number): void {
  const open = smooth(clamp01(p));
  s.lid.position.y = 0.43 + open * 1.9;
  s.lid.rotation.z = open * 1.4;
  s.lid.rotation.x = open * 0.8;
}

// ---------------- the scenarios ----------------

export const SCENARIOS: Scenario[] = [
  {
    id: "airdrop",
    location: "city",
    seconds: 12,
    opensAt: 10.6,
    run(t, _dt, s) {
      const [victim, other] = s.cast;
      walkIn(s, t, 5.4);
      s.once("look", 5.9, () => face(other, -0.4));
      s.once("whistle", 6.8, () => s.sfx.falling(1.4));
      if (t >= 6.8 && victim) {
        const fall = clamp01((t - 6.8) / 1.4);
        showCrate(s, victim.root.position.x, 13 - 12.6 * fall * fall, victim.root.position.z);
        s.crate.rotation.y = fall * 4;
      }
      s.once("impact", 8.2, () => s.sfx.thud());
      if (t >= 8.2 && victim) {
        const down = clamp01((t - 8.2) / 0.4);
        pose(victim, "flat", down);
        victim.root.rotation.x = -smooth(down) * 1.5;
        face(other, smooth(down) * 0.7);
      }
      if (t >= 8.9 && other && victim) {
        const over = clamp01((t - 8.9) / 1.3);
        other.root.position.x = other.homeX + (victim.root.position.x + 0.8 - other.homeX) * smooth(over);
        s.walking = over < 1;
        if (over >= 1) pose(other, "reach", clamp01((t - 10.2) / 0.4));
      }
      s.once("poke", 10.2, () => s.sfx.creak());
      s.once("pop", 10.6, () => s.sfx.open());
      if (t >= 10.6) popLid(s, (t - 10.6) / 1.2);
    },
  },

  {
    id: "kick",
    location: "city",
    seconds: 13,
    opensAt: 11.4,
    run(t, _dt, s) {
      const [kicker, other] = s.cast;
      walkIn(s, t, 4.6);
      showCrate(s, 0, 0.3, -1.2);
      const kicks = [
        { at: 5.4, who: kicker },
        { at: 6.6, who: other },
        { at: 7.8, who: kicker },
      ];
      kicks.forEach((kick, i) => {
        s.once(`kick${i}`, kick.at, () => (i < 2 ? s.sfx.thud() : s.sfx.boing()));
        if (kick.who && t >= kick.at - 0.45 && t < kick.at + 0.6) {
          const lean = Math.sin(clamp01((t - (kick.at - 0.45)) / 1.05) * Math.PI);
          kick.who.root.rotation.x = -lean * 0.5;
          kick.who.root.position.z = (kick.who === kicker ? -0.2 : -0.55) - lean * 0.45;
        }
      });
      if (t >= 7.8 && t < 10.2) {
        const up = (t - 7.8) / 2.4;
        showCrate(s, 0, 0.3 + Math.sin(up * Math.PI) * 22, -1.2);
        s.crate.rotation.set(up * 9, up * 6, up * 4);
      }
      s.once("gone", 8.5, () => s.sfx.whoosh());
      // Both of them look up and wait, which is the funny part.
      if (t >= 8.6 && t < 10.2) {
        for (const who of s.cast) pose(who, "clear", 1);
        s.look.y = 4.5;
      }
      s.once("coming", 9.6, () => s.sfx.falling(0.6));
      s.once("land", 10.2, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 10.2) {
        showCrate(s, 0, 0.36 * spring(clamp01((t - 10.2) / 0.9)), -1.2);
        s.crate.rotation.set(0, 0, 0);
        face(kicker, -0.3);
        face(other, 0.3);
      }
      s.once("pop", 11.4, () => s.sfx.open());
      if (t >= 11.4) popLid(s, (t - 11.4) / 1.2);
    },
  },

  {
    id: "bowling",
    location: "city",
    seconds: 12.5,
    opensAt: 10.9,
    run(t, _dt, s) {
      const [a, b] = s.cast;
      walkIn(s, t, 4.6);
      s.once("rumble", 5.0, () => s.sfx.whoosh());
      if (t >= 5.0 && t < 6.4) {
        const roll = (t - 5.0) / 1.4;
        showCrate(s, -12 + 24 * roll, 0.4, -0.6);
        s.crate.rotation.z = -roll * 26;
      }
      s.once("strike", 5.75, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 5.75) {
        const spun = clamp01((t - 5.75) / 1.0);
        if (a) {
          a.root.rotation.set(-smooth(spun) * 1.3, FACING + smooth(spun) * 7, 0);
          pose(a, "flat", spun);
        }
        if (b) {
          b.root.rotation.set(-smooth(spun) * 1.1, FACING - smooth(spun) * 6, 0);
          pose(b, "flat", spun);
        }
      }
      s.once("crash", 7.1, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 7.1 && t < 9.4) {
        const back = (t - 7.1) / 2.3;
        showCrate(s, 12 - 12 * smooth(back), 0.4, -0.6);
        s.crate.rotation.z = back * 14;
      }
      s.once("settle", 9.4, () => s.sfx.thud());
      if (t >= 9.4) {
        showCrate(s, 0, 0.36, -0.6);
        s.crate.rotation.set(0, 0, 0);
        const up = clamp01((t - 9.6) / 1.1);
        for (const who of [a, b]) {
          if (!who) continue;
          who.root.rotation.set(-1.2 * (1 - smooth(up)), FACING, 0);
          pose(who, "flat", 1 - smooth(up));
        }
      }
      s.once("pop", 10.9, () => s.sfx.open());
      if (t >= 10.9) popLid(s, (t - 10.9) / 1.2);
    },
  },

  {
    id: "hail",
    location: "city",
    seconds: 13,
    opensAt: 11.4,
    run(t, _dt, s) {
      const [a, b] = s.cast;
      walkIn(s, t, 4.2);
      for (let i = 0; i < s.spares.length; i++) {
        const at = 4.8 + i * 0.34;
        const one = s.spares[i];
        s.once(`hail${i}`, at, () => s.sfx.falling(0.5));
        s.once(`hit${i}`, at + 0.5, () => s.sfx.thud());
        if (t >= at) {
          const fall = clamp01((t - at) / 0.5);
          one.visible = true;
          one.position.set(
            (i % 2 === 0 ? -1 : 1) * (1.5 + (i % 3) * 0.9),
            Math.max(0.34, 14 - 14 * fall * fall),
            -2.4 + (i % 4) * 0.7,
          );
          one.rotation.set(fall * 5, fall * 3 + i, 0);
          if (t > at + 1.2) one.position.y = 0.34 - Math.min(0.8, (t - at - 1.2) * 0.9);
          if (t > at + 2.1) one.visible = false;
        }
      }
      if (t >= 4.6 && t < 10.4) {
        const panic = t - 4.6;
        s.walking = true;
        if (a) {
          a.root.position.x = a.homeX + Math.sin(panic * 4.1) * 0.7;
          face(a, Math.sin(panic * 4.1) * 0.5);
          pose(a, "panic", 1, panic);
        }
        if (b) {
          b.root.position.x = b.homeX + Math.sin(panic * 3.3 + 1.6) * 0.7;
          face(b, Math.sin(panic * 3.3 + 1.6) * 0.5);
          pose(b, "panic", 1, panic + 0.8);
        }
      }
      s.once("last", 10.5, () => s.sfx.falling(0.9));
      if (t >= 10.5 && t < 11.4) {
        const fall = clamp01((t - 10.5) / 0.9);
        showCrate(s, 0, 9 - 8.64 * smooth(fall), -1.0);
        s.crate.rotation.y = fall * 2;
      }
      s.once("gentle", 11.4, () => {
        s.sfx.creak();
        s.sfx.open();
      });
      if (t >= 11.4) {
        showCrate(s, 0, 0.36, -1.0);
        s.crate.rotation.set(0, 0, 0);
        for (const who of s.cast) pose(who, "clear", 1);
        place(s, [
          [-0.75, -0.2],
          [0.75, -0.2],
        ]);
        popLid(s, (t - 11.4) / 1.2);
      }
    },
  },

  {
    id: "order",
    location: "cafe",
    seconds: 12,
    opensAt: 10.4,
    run(t, _dt, s) {
      // Opens already sat at the counter, waiting for service that stopped
      // some years ago.
      const [a, b] = s.cast;
      place(
        s,
        [
          [-0.8, -2.1],
          [0.8, -2.1],
        ],
        -0.12,
        0.38,
      );
      pose(a, "sit", 1);
      pose(b, "sit", 1);
      s.look = { x: 0, y: 1.15, z: -2.6 };
      s.dolly = clamp01((t - 1) / 6) * 0.5;

      // One of them rings the bell. Nothing. Rings it again.
      [3.2, 4.4, 5.6].forEach((at, i) => {
        s.once(`bell${i}`, at, () => s.sfx.clatter());
        if (a && t >= at && t < at + 0.3) pose(a, "reach", Math.sin(((t - at) / 0.3) * Math.PI));
      });
      s.once("sigh", 6.4, () => s.sfx.creak());
      if (b && t >= 6.4 && t < 7.6) pose(b, "wave", clamp01((t - 6.4) / 0.5), t);

      // Then something slides down the counter, the way a drink would.
      s.once("slide", 7.6, () => s.sfx.whoosh());
      if (t >= 7.6 && t < 9.6) {
        const slide = clamp01((t - 7.6) / 2);
        showCrate(s, -4.6 + 4.6 * smooth(slide), 1.55, -3.3);
        s.crate.rotation.y = slide * 0.6;
      }
      s.once("arrive", 9.6, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 9.6) {
        showCrate(s, 0, 1.55, -3.3);
        s.crate.rotation.y = 0.6;
        pose(a, "sit", 1);
        pose(b, "sit", 1);
      }
      s.once("pop", 10.4, () => s.sfx.open());
      if (t >= 10.4) popLid(s, (t - 10.4) / 1.2);
    },
  },

  {
    id: "soak",
    location: "bath",
    seconds: 12.5,
    opensAt: 10.8,
    run(t, _dt, s) {
      // Opens already in the water, up to the shoulders.
      const [a, b] = s.cast;
      place(
        s,
        [
          [-0.9, -1],
          [0.9, -1],
        ],
        -0.15,
        -0.62,
      );
      pose(a, "soak", 1, t);
      pose(b, "soak", 1, t + 1.4);
      s.look = { x: 0, y: 0.75, z: -1 };
      s.dolly = clamp01((t - 0.5) / 7) * 0.45;

      // Something is under the water, and it is coming up.
      s.once("bubble", 5.2, () => s.sfx.creak());
      s.once("bubble2", 6.4, () => s.sfx.clatter());
      if (t >= 5.2 && t < 8.2) {
        const rise = clamp01((t - 5.2) / 3);
        showCrate(s, 0, -1.2 + 1.6 * smooth(rise), -1);
        s.crate.rotation.y = rise * 1.2;
        s.crate.rotation.z = Math.sin(t * 3) * 0.06 * rise;
      }
      s.once("surface", 8.2, () => {
        s.sfx.whoosh();
        s.sfx.thud();
      });
      if (t >= 8.2) {
        // Bobbing, like a very large duck.
        showCrate(s, 0, 0.4 + Math.sin((t - 8.2) * 3.2) * 0.06, -1);
        s.crate.rotation.z = Math.sin(t * 2.4) * 0.05;
        // Both of them lean away from it, then back.
        const lean = Math.sin(clamp01((t - 8.2) / 1.4) * Math.PI) * 0.5;
        if (a) a.root.position.x = -0.9 - lean;
        if (b) b.root.position.x = 0.9 + lean;
      }
      s.once("pop", 10.8, () => s.sfx.open());
      if (t >= 10.8) popLid(s, (t - 10.8) / 1.2);
    },
  },

  {
    id: "tank",
    location: "aquarium",
    seconds: 13,
    opensAt: 11.2,
    run(t, _dt, s) {
      // Opens stood at the glass, watching the fish.
      const [a, b] = s.cast;
      place(
        s,
        [
          [-0.9, -3.4],
          [0.9, -3.4],
        ],
        0,
      );
      // Facing the tank rather than the camera, until it gives them a reason.
      for (const who of s.cast) if (who) who.root.rotation.y = FACING + Math.PI;
      s.look = { x: 0, y: 2.2, z: -6.5 };
      s.dolly = clamp01((t - 0.6) / 6.5) * 0.4;

      // A crate drifts past inside the tank, among the fish, as though it
      // lives there.
      if (t >= 2.4 && t < 7.4) {
        const swim = (t - 2.4) / 5;
        showCrate(s, -7 + 14 * swim, 3.2 + Math.sin(swim * 6) * 0.5, -7.4);
        s.crate.rotation.set(Math.sin(swim * 5) * 0.2, swim * 2, Math.sin(swim * 4) * 0.15);
      }
      s.once("notice", 4.2, () => s.sfx.creak());
      if (t >= 4.2 && t < 6) pose(a, "reach", clamp01((t - 4.2) / 0.6));

      // It leaves through the glass.
      s.once("crack", 7.4, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 7.4 && t < 9.2) {
        const out = clamp01((t - 7.4) / 1.8);
        showCrate(s, 7 - 7 * smooth(out), 3.2 - 2.84 * smooth(out), -7.4 + 4 * smooth(out));
        s.crate.rotation.set(out * 3, out * 4, 0);
        for (const who of s.cast) pose(who, "panic", clamp01((t - 7.4) / 0.4), t);
      }
      s.once("beached", 9.2, () => s.sfx.thud());
      if (t >= 9.2) {
        showCrate(s, 0, 0.36 * spring(clamp01((t - 9.2) / 0.8)), -3.4);
        s.crate.rotation.set(0, 0.4, 0);
        for (const who of s.cast) pose(who, "clear", 1);
        // They turn round to look at what the sea has brought them.
        const turn = clamp01((t - 9.4) / 0.9);
        if (a) a.root.rotation.y = FACING + Math.PI * (1 - smooth(turn)) + 0.25 * smooth(turn);
        if (b) b.root.rotation.y = FACING + Math.PI * (1 - smooth(turn)) - 0.25 * smooth(turn);
      }
      s.once("pop", 11.2, () => s.sfx.open());
      if (t >= 11.2) popLid(s, (t - 11.2) / 1.2);
    },
  },
];

// ---------------- loading, before anybody presses the button ----------------

let warmed: Promise<{ THREE: any; models: any[] }> | null = null;

/**
 * Fetch three.js and the models when the Gacha tab opens.
 *
 * A megabyte or so has then usually landed by the time a crate is actually
 * opened, and the film starts at once rather than after a wait on an empty
 * box. Called again, it hands back what it already has.
 */
export function warmUpCutscene(): Promise<unknown> {
  warmed ??= (async () => {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const models = await Promise.all(MODELS.map((path) => loader.loadAsync(assetUrl(path)).catch(() => null)));
    return { THREE, models };
  })().catch((err) => {
    warmed = null; // a failed warm-up must not poison the next attempt
    throw err;
  });
  return warmed;
}

export function playCutscene(host: HTMLElement, options: CutsceneOptions = {}): Cutscene {
  let stop = (): void => undefined;
  let tellId: (id: string) => void = () => undefined;
  const id = new Promise<string>((resolve) => {
    tellId = resolve;
  });

  const done = new Promise<void>((resolve) => {
    let finished = false;
    let teardown: (() => void) | null = null;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      tellId("");
      resolve();
    };
    stop = () => {
      finish();
      teardown?.();
    };

    void build(host, finish, tellId, options).then((undo) => {
      teardown = undo;
    });
  });
  return { done, stop, id };
}

async function build(
  host: HTMLElement,
  finish: () => void,
  tellId: (id: string) => void,
  options: CutsceneOptions,
): Promise<() => void> {
  let cleanup = (): void => undefined;
  const sfx = createSfx();
  try {
    const { THREE, models } = (await warmUpCutscene()) as { THREE: any; models: any[] };
    const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.insertBefore(renderer.domElement, host.firstChild);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 200);
    camera.position.set(0, 1.55, 6.4);

    const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    tellId(scenario.id);
    const location = buildLocation(scenario.location, THREE, scene);

    // ---- crates ----
    const makeCrate = (): any => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.72, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x9a6b3a, roughness: 0.8 }),
      );
      body.castShadow = true;
      group.add(body);
      for (const dx of [-0.58, 0.58]) {
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.78, 1.18),
          new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.9 }),
        );
        band.position.x = dx;
        group.add(band);
      }
      group.visible = false;
      scene.add(group);
      return group;
    };
    const crate = makeCrate();
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.14, 1.16),
      new THREE.MeshStandardMaterial({ color: 0xb07d45, roughness: 0.8 }),
    );
    lid.position.y = 0.43;
    lid.castShadow = true;
    crate.add(lid);
    const spares = Array.from({ length: 9 }, makeCrate);

    // ---- the cast ----
    //
    // Cloned from the warmed-up models, so a second pull neither re-downloads
    // them nor shares one scene graph with the first.
    const clips = models.flatMap((gltf: any) => gltf?.animations ?? []);
    const walkClip = clips.filter((c: any) => c.duration > 0.1).sort((a: any, b: any) => b.duration - a.duration)[0];

    const cast: Walker[] = [];
    models.forEach((gltf: any, i: number) => {
      if (!gltf) return;
      const model = clone(gltf.scene);
      // A fresh clone carries no world matrices, and measuring one without
      // them reports a model a hundredth of its real size — which then gets
      // scaled up by the same factor until the camera is inside its head.
      model.updateMatrixWorld(true);
      // Exports arrive at wildly different scales and origins; normalise on
      // the measured box so a replacement model needs no code change.
      const bounds = new THREE.Box3().setFromObject(model);
      const height = Math.max(0.001, bounds.max.y - bounds.min.y);
      const scale = 1.5 / height;
      model.scale.setScalar(scale);
      // The offset lives on the model inside a holder rather than on the
      // thing scenarios move, so `position.y = 0` means feet on the floor
      // whatever the exporter thought the origin was — and a fall pivots
      // around the feet instead of around the navel.
      model.position.y = -bounds.min.y * scale;
      model.traverse((node: any) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      const root = new THREE.Group();
      root.add(model);
      root.rotation.y = FACING;
      scene.add(root);

      const bones: Record<string, any> = {};
      model.traverse((node: any) => {
        if (node.isBone) bones[node.name] = node;
      });

      const mixer = new THREE.AnimationMixer(model);
      if (walkClip) {
        const action = mixer.clipAction(walkClip);
        action.play();
        // Out of step, or two people walking together look like one person
        // rendered twice.
        action.time = i * walkClip.duration * 0.5;
      }
      cast.push({ root, mixer, bones, homeX: i === 0 ? -0.62 : 0.62 });
    });

    let elapsed = 0;
    let frame = 0;
    const shakes: number[] = [];
    const fired = new Set<string>();

    const stage: Stage = {
      sfx,
      cast,
      crate,
      lid,
      spares,
      walking: false,
      look: { x: 0, y: location.focusY, z: 0 },
      dolly: null,
      once: (key, at, fn) => {
        if (fired.has(key) || elapsed < at) return;
        fired.add(key);
        fn();
        if (/impact|land|strike|crash|settle|hit|kick|gone|arrive|beached|surface/.test(key)) shakes.push(elapsed);
      },
    };

    const clock = new THREE.Clock();
    sfx.wind(true);
    let announced = false;

    const shake = (now: number): number => {
      let offset = 0;
      for (const at of shakes) {
        const since = now - at;
        if (since >= 0 && since < 0.45) offset += Math.sin(since * 62) * 0.1 * (1 - since / 0.45);
      }
      return offset;
    };

    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;
      location.ambient(dt, elapsed);

      // The scenario owns these every frame, so they are reset before asking.
      stage.walking = false;
      stage.look = { x: 0, y: location.focusY, z: 0 };
      stage.dolly = null;
      scenario.run(Math.min(elapsed, scenario.seconds), dt, stage);
      for (const person of cast) if (stage.walking) person.mixer.update(dt);

      // The pull starts against the film rather than after it.
      if (!announced && elapsed >= scenario.opensAt) {
        announced = true;
        options.onOpen?.();
      }

      const push = stage.dolly ?? smooth(clamp01(elapsed / scenario.seconds)) * 0.34;
      camera.position.set(shake(elapsed), 1.55 - push * 0.7, 6.4 - push * 6.4);
      camera.lookAt(stage.look.x, stage.look.y, stage.look.z);

      renderer.render(scene, camera);
      // The film finishes but the picture stays: the roll is over the top of
      // it, and tearing the canvas down mid-roll would be a black hole.
      if (elapsed >= scenario.seconds) finish();
    };
    tick();

    const onResize = (): void => {
      if (host.clientWidth === 0) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    addEventListener("resize", onResize);

    cleanup = () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", onResize);
      sfx.stop();
      // dispose() frees three's own objects but leaves the WebGL context
      // alive, and a browser only allows a handful at once — so without this
      // the fifth crate opened in a sitting gets no picture at all.
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
      scene.traverse((node: any) => {
        node.geometry?.dispose?.();
        const material = node.material;
        for (const m of Array.isArray(material) ? material : [material]) m?.dispose?.();
      });
    };
    return cleanup;
  } catch {
    // No WebGL, no models, no three — the pull still happens, without a film.
    sfx.stop();
    options.onOpen?.();
    finish();
    return cleanup;
  }
}
