import { assetUrl } from "./store.js";
import { createSfx, type Sfx } from "./gacha-audio.js";
import { buildLocation, type LocationId } from "./gacha-locations.js";
import { createDialogue, type Line } from "./gacha-dialogue.js";

/**
 * The cutscene a crate opening happens inside.
 *
 * A few places that used to be somewhere, two figures who have been walking
 * a long time, and a supply crate that arrives by some means neither of them
 * deserved. One scenario is drawn at random, so opening forty crates is not
 * watching the same film forty times, and they do not all begin the same
 * way: some walk in out of the fog, some are already sat at a counter, some
 * are already in the bath.
 *
 * Each scenario is a timeline of three things: what moves, where the camera
 * is, and who says what. The camera is a list of shots — cuts, pans, pushes,
 * a close-up on somebody's face — and the lines are drawn over the picture
 * in chunky pixels and can all be rewritten on GitHub.
 *
 * The pull happens inside the film. When the crate opens, the strip unrolls
 * out of it while the scene keeps playing underneath.
 *
 * Everything except the two characters is built in code, so the whole thing
 * costs two small model files and nothing else.
 */

const MODELS = ["gacha/models/yuuri.glb", "gacha/models/chito.glb"];

/**
 * The models face +Z at rest, which is towards the camera, so somebody
 * walking towards it needs no turn at all. Turning them by π — which is what
 * this used to do — walked them in backwards.
 */
const FACING = 0;

type Vec3 = [number, number, number];
type Where = Vec3 | ((s: Stage, t: number) => Vec3);

export interface CutsceneOptions {
  /**
   * Fired when the crate opens, with where it is on screen as a fraction of
   * the picture — so the roll can unroll out of it rather than appear.
   */
  onOpen?: (origin: { x: number; y: number }) => void;
  /** Lines from the prize file, which win over the ones written here. */
  lines?: Record<string, string>;
}

export interface Cutscene {
  done: Promise<void>;
  stop: () => void;
  id: Promise<string>;
}

// ---------------- the stage ----------------

interface Walker {
  root: any;
  model: any;
  mixer: any;
  bones: Record<string, any>;
  /** Cloned so tinting one of them cannot bleed into the other. */
  materials: any[];
  baseColours: any[];
  homeX: number;
}

interface Stage {
  THREE: any;
  sfx: Sfx;
  /** yuuri first, chito second — whoever loaded. May be shorter than two. */
  cast: Walker[];
  crate: any;
  lid: any;
  spares: any[];
  once: (key: string, at: number, fn: () => void) => void;
  walking: boolean;
  /** Set by a scenario when it wants the camera somewhere specific. */
  shot: { from: Vec3; look: Vec3; fov: number } | null;
}

export interface Shot {
  at: number;
  from: Where;
  look: Where;
  /** Where it ends up, if the shot moves. */
  to?: Where;
  lookTo?: Where;
  fov?: number;
  fovTo?: number;
  /** Seconds to blend out of the previous shot. 0, the default, is a cut. */
  blend?: number;
  /** Handheld, in metres. */
  shake?: number;
}

export interface Scenario {
  id: string;
  location: LocationId;
  seconds: number;
  /** When the crate opens, so the roll can be started against it. */
  opensAt: number;
  shots: Shot[];
  lines: Line[];
  run: (t: number, dt: number, s: Stage) => void;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const spring = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 13));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Roughly where somebody's face is, for a close-up. */
function head(walker: Walker | undefined, forward = 0.9): Where {
  return (s: Stage): Vec3 => {
    if (!walker) return [0, 1.2, 0];
    const p = walker.root.position;
    void s;
    return [p.x, p.y + 1.28, p.z + forward];
  };
}

/** Where somebody is standing, at chest height. */
function at(walker: Walker | undefined, dy = 1.0): Where {
  return (): Vec3 => {
    if (!walker) return [0, dy, 0];
    const p = walker.root.position;
    return [p.x, p.y + dy, p.z];
  };
}

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
    case "point":
      // Look at that. Whatever that is.
      set(b.RightArm, -1.7, 0, 0.5);
      set(b.RightForeArm, -0.2);
      set(b.Spine, 0, 0.2);
      break;
    case "reach":
      set(b.LeftArm, -1.5, 0, -0.35);
      set(b.RightArm, -1.5, 0, 0.35);
      set(b.Spine, -0.2);
      break;
    case "hungry":
      // Both hands on an empty stomach, folded over it.
      set(b.LeftArm, -0.5, 0, -0.9);
      set(b.RightArm, -0.5, 0, 0.9);
      set(b.LeftForeArm, -1.3);
      set(b.RightForeArm, -1.3);
      set(b.Spine, 0.35);
      set(b.Head, 0.3);
      break;
    case "swing":
      // The wind-up and the follow-through of a flat hand.
      set(b.RightArm, -2.4, 0, 0.6);
      set(b.RightForeArm, -0.8);
      set(b.Spine, 0, -0.35);
      break;
    case "hurt":
      // Both hands on the back of the head, regretting everything.
      set(b.LeftArm, -2.3, 0, -0.5);
      set(b.RightArm, -2.3, 0, 0.5);
      set(b.LeftForeArm, -1.9);
      set(b.RightForeArm, -1.9);
      set(b.Spine, 0.2);
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

/**
 * Wash a character in a colour.
 *
 * Their materials are cloned per pull, so tinting one of them here cannot
 * follow the model into the next crate or across into the other character.
 */
function tint(walker: Walker | undefined, THREE: any, colour: number, amount: number): void {
  if (!walker) return;
  const a = clamp01(amount);
  const target = new THREE.Color(colour);
  for (const material of walker.materials) {
    if (!material) continue;
    // Through `emissive` rather than `color`: these models are lit almost
    // entirely by their own texture, and multiplying that by a colour barely
    // moves it. Emissive is added on top, so it actually shows.
    if (material.emissive) {
      material.emissive.copy(target);
      material.emissiveIntensity = a * 0.85;
    }
    if (material.color) material.color.copy(walker.baseColours[0]).lerp(target, a * 0.6);
  }
}

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

/**
 * The gag, in one call: a flat hand to the back of a head.
 *
 * `p` runs 0 to 1 across the whole thing — wind-up, contact at a third of
 * the way through, then one of them holding her head and the other entirely
 * unrepentant.
 */
function smackGag(s: Stage, hitter: Walker | undefined, victim: Walker | undefined, p: number): void {
  const swing = clamp01(p / 0.34);
  const after = clamp01((p - 0.34) / 0.66);
  pose(hitter, "swing", p < 0.34 ? swing : 1 - after * 0.85);
  if (victim) {
    if (p < 0.34) {
      pose(victim, "clear", 1);
    } else {
      pose(victim, "hurt", clamp01(after * 3));
      // The head snaps forward and comes back.
      victim.root.rotation.x = -Math.sin(clamp01(after * 2.4) * Math.PI) * 0.5;
    }
  }
}

// ---------------- the scenarios ----------------

export const SCENARIOS: Scenario[] = [
  {
    id: "green",
    location: "city",
    seconds: 19,
    opensAt: 16.4,
    shots: [
      // Wide, both of them, walking.
      { at: 0, from: [0, 1.55, 7.2], look: [0, 0.95, -1], to: [0, 1.5, 5.4], lookTo: [0, 0.95, -0.4] },
      // Cut to chito, who has been asked to look at something.
      { at: 6.2, from: [1.5, 1.35, 1.8], look: (s) => posOf(s.cast[1], 1.2), fov: 30 },
      // Whip round to yuuri, who is green.
      { at: 8.0, from: [-2.4, 1.5, 2.6], look: (s) => posOf(s.cast[0], 1.1), to: [-1.1, 1.3, 1.5], fov: 34, blend: 0.5 },
      // In. Further in.
      { at: 10.4, from: head(undefined, 2.2), look: (s) => posOf(s.cast[0], 1.28), fov: 34, fovTo: 9, to: head(undefined, 0.62), shake: 0.03 },
      // Back out, in time to see what happens to her.
      { at: 14.2, from: [0, 2.2, 5.2], look: [0, 1.0, -0.4], to: [0, 1.7, 4.2], lookTo: [0, 0.7, -0.4] },
      { at: 16.4, from: [0, 1.5, 3.6], look: [0, 0.6, -0.4], to: [0, 1.35, 3.0], lookTo: [0, 0.5, -0.4] },
    ],
    lines: [
      { at: 5.4, seconds: 2.4, who: "Yuuri", text: "Chi-chan, look" },
      { at: 8.0, seconds: 2.4, who: "Chito", text: "...why are you green" },
      { at: 10.8, seconds: 3.2, who: "Yuuri", text: "For an amazing reason", loud: true },
      { at: 14.6, seconds: 1.6, who: "Chito", text: "That's not a reason" },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      walkIn(s, t, 5.6);
      if (t >= 5.6) {
        place(s, [
          [-0.7, -0.3],
          [0.7, -0.5],
        ]);
      }
      // She has been green for some time and is only now mentioning it.
      tint(yuuri, s.THREE, 0x3ddc55, clamp01((t - 4.6) / 1.2));
      if (t >= 5.2 && t < 8.0) pose(yuuri, "point", clamp01((t - 5.2) / 0.4));
      s.once("turn", 8.0, () => {
        face(chito, -0.5);
        s.sfx.creak();
      });
      if (t >= 8.4 && t < 10.4) pose(chito, "reach", clamp01((t - 8.4) / 0.5) * 0.4);

      // The zoom, and the noise that comes with it.
      s.once("menace", 10.4, () => s.sfx.menace(3.6));
      if (t >= 10.4 && t < 14.2) {
        pose(yuuri, "clear", 1);
        face(yuuri, Math.sin(t * 1.4) * 0.04);
        // Deepening green, and she leans in as the camera does.
        tint(yuuri, s.THREE, 0x1f9c33, clamp01((t - 10.4) / 2.2));
        yuuri?.root.position.setZ(-0.3 + smooth(clamp01((t - 10.4) / 3)) * 0.5);
      }

      // The reason turns out to be gravity.
      s.once("whistle", 14.2, () => s.sfx.falling(1.2));
      if (t >= 14.2 && yuuri) {
        const fall = clamp01((t - 14.2) / 1.2);
        showCrate(s, yuuri.root.position.x, 13 - 12.64 * fall * fall, yuuri.root.position.z);
        s.crate.rotation.y = fall * 4;
      }
      s.once("impact", 15.4, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 15.4 && yuuri) {
        const down = clamp01((t - 15.4) / 0.35);
        pose(yuuri, "flat", down);
        yuuri.root.rotation.x = -smooth(down) * 1.5;
        tint(yuuri, s.THREE, 0x1f9c33, 1 - smooth(down) * 0.5);
        face(chito, smooth(down) * 0.6);
      }
      s.once("pop", 16.4, () => s.sfx.open());
      if (t >= 16.4) popLid(s, (t - 16.4) / 1.2);
    },
  },

  {
    id: "hungry",
    location: "city",
    seconds: 17,
    opensAt: 14.6,
    shots: [
      { at: 0, from: [0, 1.55, 7.0], look: [0, 0.95, -1], to: [0, 1.5, 5.6], lookTo: [0, 0.95, -0.4] },
      // Down at stomach height, which is where the problem is.
      { at: 4.4, from: [-1.8, 0.75, 2.2], look: (s) => posOf(s.cast[0], 0.75), fov: 32 },
      { at: 7.0, from: [0.4, 1.45, 2.6], look: (s) => posOf(s.cast[1], 1.15), fov: 30 },
      // Wide again for the smack, because it deserves to be seen in full.
      { at: 9.0, from: [0, 1.4, 4.2], look: [0, 1.0, -0.4], shake: 0.02 },
      { at: 12.4, from: [0, 2.6, 4.6], look: [0, 0.9, -0.4], to: [0, 1.6, 3.4], lookTo: [0, 0.8, -0.4] },
    ],
    lines: [
      { at: 4.6, seconds: 2.2, who: "Yuuri", text: "Chi-chan. I'm hungry" },
      { at: 7.0, seconds: 1.9, who: "Chito", text: "You ate the last ration" },
      { at: 9.2, seconds: 2.0, who: "Yuuri", text: "That was ages ago" },
      { at: 11.4, seconds: 1.4, who: "", text: "(smack)" },
      { at: 13.0, seconds: 2.2, who: "Yuuri", text: "...food?", loud: true },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      walkIn(s, t, 4.4);
      if (t >= 4.4) {
        place(s, [
          [-0.7, -0.2],
          [0.7, -0.5],
        ]);
      }
      s.once("growl", 4.4, () => s.sfx.growl());
      s.once("growl2", 8.8, () => s.sfx.growl());
      if (t >= 4.4 && t < 9.6) pose(yuuri, "hungry", clamp01((t - 4.4) / 0.6));
      if (t >= 7.0 && t < 9.4) face(chito, -0.45);

      // The smack.
      s.once("smack", 11.4, () => s.sfx.smack());
      if (t >= 10.8 && t < 13.4) {
        smackGag(s, chito, yuuri, clamp01((t - 10.8) / 2.6));
        face(chito, -0.5);
      }

      // And then, because the world is like this, a crate.
      s.once("whistle", 12.6, () => s.sfx.falling(1.0));
      if (t >= 12.6 && t < 13.6) {
        const fall = clamp01((t - 12.6) / 1.0);
        showCrate(s, 0, 11 - 10.64 * fall * fall, -1.1);
        s.crate.rotation.y = fall * 3;
      }
      s.once("land", 13.6, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 13.6) {
        showCrate(s, 0, 0.36 * spring(clamp01((t - 13.6) / 0.8)), -1.1);
        s.crate.rotation.set(0, 0.3, 0);
        pose(yuuri, "reach", clamp01((t - 13.9) / 0.4));
        face(yuuri, -0.2);
        face(chito, 0.2);
      }
      s.once("pop", 14.6, () => s.sfx.open());
      if (t >= 14.6) popLid(s, (t - 14.6) / 1.2);
    },
  },

  {
    id: "airdrop",
    location: "city",
    seconds: 13,
    opensAt: 11.2,
    shots: [
      { at: 0, from: [0, 1.55, 7.2], look: [0, 0.95, -1], to: [0, 1.5, 5.6], lookTo: [0, 0.95, -0.4] },
      // Looking up at the sky a moment before either of them does.
      { at: 6.6, from: [0.9, 0.6, 3.2], look: [0, 6, -2], fov: 46 },
      { at: 8.0, from: [0, 1.8, 4.6], look: [0, 1.0, -0.4], shake: 0.03 },
      { at: 9.4, from: [-1.6, 1.1, 2.4], look: [0, 0.5, -0.4], to: [-0.9, 1.0, 1.9] },
    ],
    lines: [
      { at: 5.6, seconds: 1.8, who: "Chito", text: "Did you hear something" },
      { at: 8.6, seconds: 1.8, who: "Yuuri", text: "no" },
      { at: 10.6, seconds: 1.8, who: "Chito", text: "It's on top of you" },
    ],
    run(t, _dt, s) {
      const [victim, other] = s.cast;
      walkIn(s, t, 5.4);
      s.once("look", 5.9, () => face(other, -0.4));
      s.once("whistle", 6.9, () => s.sfx.falling(1.3));
      if (t >= 6.9 && victim) {
        const fall = clamp01((t - 6.9) / 1.3);
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
      if (t >= 9.0 && other && victim) {
        const over = clamp01((t - 9.0) / 1.3);
        other.root.position.x = other.homeX + (victim.root.position.x + 0.8 - other.homeX) * smooth(over);
        s.walking = over < 1;
        if (over >= 1) pose(other, "reach", clamp01((t - 10.4) / 0.4));
      }
      s.once("poke", 10.6, () => s.sfx.creak());
      s.once("pop", 11.2, () => s.sfx.open());
      if (t >= 11.2) popLid(s, (t - 11.2) / 1.2);
    },
  },

  {
    id: "kick",
    location: "city",
    seconds: 14,
    opensAt: 12.2,
    shots: [
      { at: 0, from: [0, 1.55, 7.0], look: [0, 0.95, -1], to: [0, 1.5, 5.2], lookTo: [0, 0.9, -1] },
      // Low and close on the crate for the kicking.
      { at: 5.0, from: [-1.9, 0.5, 1.4], look: [0, 0.4, -1.2], fov: 40 },
      // Straight up, following it out of frame.
      { at: 8.4, from: [1.2, 0.9, 2.6], look: [0, 8, -1.2], fov: 44 },
      { at: 10.6, from: [0, 1.9, 4.4], look: [0, 0.9, -1.2], shake: 0.03 },
      { at: 12.2, from: [0, 1.2, 3.0], look: [0, 0.55, -1.2], to: [0, 1.1, 2.5] },
    ],
    lines: [
      { at: 5.2, seconds: 1.8, who: "Yuuri", text: "It's stuck" },
      { at: 7.4, seconds: 1.6, who: "Chito", text: "Don't—" },
      { at: 9.0, seconds: 2.0, who: "Yuuri", text: "where'd it go" },
      { at: 11.0, seconds: 1.6, who: "Chito", text: "Move." , loud: true },
    ],
    run(t, _dt, s) {
      const [kicker, other] = s.cast;
      walkIn(s, t, 4.6);
      showCrate(s, 0, 0.3, -1.2);
      const kicks = [
        { at: 5.6, who: kicker },
        { at: 6.8, who: other },
        { at: 8.2, who: kicker },
      ];
      kicks.forEach((kick, i) => {
        s.once(`kick${i}`, kick.at, () => (i < 2 ? s.sfx.thud() : s.sfx.boing()));
        if (kick.who && t >= kick.at - 0.45 && t < kick.at + 0.6) {
          const lean = Math.sin(clamp01((t - (kick.at - 0.45)) / 1.05) * Math.PI);
          kick.who.root.rotation.x = -lean * 0.5;
          kick.who.root.position.z = (kick.who === kicker ? -0.2 : -0.55) - lean * 0.45;
        }
      });
      if (t >= 8.2 && t < 11.0) {
        const up = (t - 8.2) / 2.8;
        showCrate(s, 0, 0.3 + Math.sin(up * Math.PI) * 24, -1.2);
        s.crate.rotation.set(up * 9, up * 6, up * 4);
      }
      s.once("gone", 8.9, () => s.sfx.whoosh());
      if (t >= 9.0 && t < 11.0) for (const who of s.cast) pose(who, "clear", 1);
      s.once("coming", 10.4, () => s.sfx.falling(0.6));
      s.once("land", 11.0, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 11.0) {
        showCrate(s, 0, 0.36 * spring(clamp01((t - 11.0) / 0.9)), -1.2);
        s.crate.rotation.set(0, 0, 0);
        face(kicker, -0.3);
        face(other, 0.3);
      }
      s.once("pop", 12.2, () => s.sfx.open());
      if (t >= 12.2) popLid(s, (t - 12.2) / 1.2);
    },
  },

  {
    id: "bowling",
    location: "city",
    seconds: 13,
    opensAt: 11.3,
    shots: [
      { at: 0, from: [0, 1.55, 7.0], look: [0, 0.95, -1], to: [0, 1.5, 5.6], lookTo: [0, 0.95, -0.6] },
      // Side on, so it arrives from off the edge of the frame.
      { at: 4.9, from: [3.4, 1.0, 3.2], look: [-1, 0.7, -0.6], fov: 42 },
      { at: 6.2, from: [0, 1.6, 4.2], look: [0, 0.7, -0.6], shake: 0.05 },
      { at: 7.6, from: [-2.6, 2.2, 3.0], look: [1, 0.6, -0.6] },
      { at: 9.8, from: [0, 1.3, 3.6], look: [0, 0.6, -0.6], to: [0, 1.2, 3.0] },
    ],
    lines: [
      { at: 5.0, seconds: 1.5, who: "Chito", text: "Something's coming" },
      { at: 6.6, seconds: 1.6, who: "Yuuri", text: "ow" },
      { at: 10.0, seconds: 2.0, who: "Chito", text: "It came back" },
    ],
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
      s.once("pop", 11.3, () => s.sfx.open());
      if (t >= 11.3) popLid(s, (t - 11.3) / 1.2);
    },
  },

  {
    id: "hail",
    location: "city",
    seconds: 14,
    opensAt: 12.2,
    shots: [
      { at: 0, from: [0, 1.55, 7.0], look: [0, 0.95, -1], to: [0, 1.5, 5.6], lookTo: [0, 0.95, -0.6] },
      { at: 4.6, from: [0, 0.7, 3.0], look: [0, 9, -2], fov: 48 },
      { at: 6.0, from: [-3.2, 1.6, 3.4], look: [0.6, 0.9, -1], shake: 0.05 },
      { at: 8.6, from: [3.0, 1.4, 3.0], look: [-0.6, 0.9, -1], shake: 0.05 },
      { at: 11.0, from: [0, 1.8, 4.4], look: [0, 0.8, -1], to: [0, 1.3, 3.2] },
    ],
    lines: [
      { at: 4.8, seconds: 1.6, who: "Chito", text: "Run" },
      { at: 6.6, seconds: 1.6, who: "Yuuri", text: "which way", loud: true },
      { at: 11.4, seconds: 2.0, who: "Chito", text: "...that one was polite" },
    ],
    run(t, _dt, s) {
      const [a, b] = s.cast;
      walkIn(s, t, 4.2);
      for (let i = 0; i < s.spares.length; i++) {
        const at2 = 4.8 + i * 0.34;
        const one = s.spares[i];
        s.once(`hail${i}`, at2, () => s.sfx.falling(0.5));
        s.once(`hit${i}`, at2 + 0.5, () => s.sfx.thud());
        if (t >= at2) {
          const fall = clamp01((t - at2) / 0.5);
          one.visible = true;
          one.position.set(
            (i % 2 === 0 ? -1 : 1) * (1.5 + (i % 3) * 0.9),
            Math.max(0.34, 14 - 14 * fall * fall),
            -2.4 + (i % 4) * 0.7,
          );
          one.rotation.set(fall * 5, fall * 3 + i, 0);
          if (t > at2 + 1.2) one.position.y = 0.34 - Math.min(0.8, (t - at2 - 1.2) * 0.9);
          if (t > at2 + 2.1) one.visible = false;
        }
      }
      if (t >= 4.6 && t < 11.2) {
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
      s.once("last", 11.3, () => s.sfx.falling(0.9));
      if (t >= 11.3 && t < 12.2) {
        const fall = clamp01((t - 11.3) / 0.9);
        showCrate(s, 0, 9 - 8.64 * smooth(fall), -1.0);
        s.crate.rotation.y = fall * 2;
      }
      s.once("gentle", 12.2, () => {
        s.sfx.creak();
        s.sfx.open();
      });
      if (t >= 12.2) {
        showCrate(s, 0, 0.36, -1.0);
        s.crate.rotation.set(0, 0, 0);
        for (const who of s.cast) pose(who, "clear", 1);
        place(s, [
          [-0.75, -0.2],
          [0.75, -0.2],
        ]);
        popLid(s, (t - 12.2) / 1.2);
      }
    },
  },

  {
    id: "order",
    location: "cafe",
    seconds: 13,
    opensAt: 11.2,
    shots: [
      // Along the counter, so the length of it does the work.
      { at: 0, from: [-3.6, 1.5, -0.4], look: [1.2, 1.2, -2.6], fov: 34, to: [-2.4, 1.45, -0.9] },
      { at: 3.0, from: [0, 1.5, 0.6], look: [0, 1.15, -2.8], to: [0, 1.4, -0.4] },
      // Down on the bell, which is doing nothing.
      { at: 5.6, from: [-0.9, 1.35, -1.2], look: [-0.6, 1.05, -2.6], fov: 28 },
      { at: 7.4, from: [-4.4, 1.6, -1.6], look: [0, 1.4, -3.3], fov: 32, to: [-2.2, 1.55, -1.4] },
      { at: 9.8, from: [0, 1.55, -0.2], look: [0, 1.45, -3.3], to: [0, 1.5, -1.0] },
    ],
    lines: [
      { at: 2.6, seconds: 2.2, who: "Yuuri", text: "Is anyone here" },
      { at: 5.2, seconds: 2.0, who: "Chito", text: "Nobody's been here for years" },
      { at: 7.6, seconds: 2.0, who: "Yuuri", text: "Then who's that" },
      { at: 11.0, seconds: 2.0, who: "Chito", text: "Don't ask" },
    ],
    run(t, _dt, s) {
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
      [3.4, 4.6, 5.8].forEach((at2, i) => {
        s.once(`bell${i}`, at2, () => s.sfx.bell());
        if (a && t >= at2 && t < at2 + 0.3) pose(a, "reach", Math.sin(((t - at2) / 0.3) * Math.PI));
      });
      s.once("sigh", 6.6, () => s.sfx.creak());
      if (b && t >= 6.6 && t < 7.6) pose(b, "wave", clamp01((t - 6.6) / 0.5), t);

      s.once("slide", 7.8, () => s.sfx.whoosh());
      if (t >= 7.8 && t < 10.2) {
        const slide = clamp01((t - 7.8) / 2.4);
        showCrate(s, -4.6 + 4.6 * smooth(slide), 1.55, -3.3);
        s.crate.rotation.y = slide * 0.6;
      }
      s.once("arrive", 10.2, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 10.2) {
        showCrate(s, 0, 1.55, -3.3);
        s.crate.rotation.y = 0.6;
        pose(a, "sit", 1);
        pose(b, "sit", 1);
      }
      s.once("pop", 11.2, () => s.sfx.open());
      if (t >= 11.2) popLid(s, (t - 11.2) / 1.2);
    },
  },

  {
    id: "soak",
    location: "bath",
    seconds: 13.5,
    opensAt: 11.6,
    shots: [
      { at: 0, from: [0, 1.6, 4.4], look: [0, 0.5, -1], fov: 36, to: [0, 1.2, 3.4] },
      // Just above the water, which is where the trouble is.
      { at: 4.6, from: [-1.9, 0.55, 1.4], look: [0.4, 0.4, -1], fov: 34 },
      { at: 7.0, from: [0, 0.45, 2.4], look: [0, 0.45, -1], to: [0, 0.6, 1.6], shake: 0.02 },
      { at: 9.0, from: [2.2, 1.5, 2.2], look: [0, 0.6, -1] },
      { at: 11.0, from: [0, 1.2, 3.0], look: [0, 0.55, -1], to: [0, 1.05, 2.4] },
    ],
    lines: [
      { at: 1.6, seconds: 2.2, who: "Yuuri", text: "This was a good idea" },
      { at: 4.8, seconds: 2.0, who: "Chito", text: "Something touched my foot" },
      { at: 7.2, seconds: 1.6, who: "Yuuri", text: "wasn't me" },
      { at: 9.2, seconds: 2.0, who: "Chito", text: "I know. That's the problem" },
    ],
    run(t, _dt, s) {
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
      s.once("bubble", 5.4, () => s.sfx.creak());
      s.once("bubble2", 6.6, () => s.sfx.clatter());
      if (t >= 5.4 && t < 8.6) {
        const rise = clamp01((t - 5.4) / 3.2);
        showCrate(s, 0, -1.2 + 1.6 * smooth(rise), -1);
        s.crate.rotation.y = rise * 1.2;
        s.crate.rotation.z = Math.sin(t * 3) * 0.06 * rise;
      }
      s.once("surface", 8.6, () => {
        s.sfx.splash();
        s.sfx.thud();
      });
      if (t >= 8.6) {
        showCrate(s, 0, 0.4 + Math.sin((t - 8.6) * 3.2) * 0.06, -1);
        s.crate.rotation.z = Math.sin(t * 2.4) * 0.05;
        const lean = Math.sin(clamp01((t - 8.6) / 1.4) * Math.PI) * 0.5;
        if (a) a.root.position.x = -0.9 - lean;
        if (b) b.root.position.x = 0.9 + lean;
      }
      s.once("pop", 11.6, () => s.sfx.open());
      if (t >= 11.6) popLid(s, (t - 11.6) / 1.2);
    },
  },

  {
    id: "tank",
    location: "aquarium",
    seconds: 14,
    opensAt: 12.0,
    shots: [
      // Behind them, so the tank fills the frame over their shoulders.
      { at: 0, from: [0, 1.9, 1.4], look: [0, 2.6, -7], fov: 40, to: [0, 1.8, -0.4] },
      { at: 3.6, from: [-3.4, 2.8, -2.0], look: [1, 3.0, -7.2], fov: 32, to: [-1.6, 2.6, -2.4] },
      // Their faces, lit blue.
      { at: 6.2, from: [0, 1.5, -5.4], look: [0, 1.35, -3.4], fov: 30 },
      { at: 8.0, from: [2.6, 2.2, -1.4], look: [-0.6, 2.0, -6.4], shake: 0.04 },
      { at: 9.6, from: [0, 1.6, 1.6], look: [0, 0.9, -3.4], to: [0, 1.3, 0.4], shake: 0.02 },
      { at: 12.0, from: [0, 1.2, -0.6], look: [0, 0.55, -3.4], to: [0, 1.1, -1.2] },
    ],
    lines: [
      { at: 1.4, seconds: 2.2, who: "Yuuri", text: "They're still alive" },
      { at: 4.0, seconds: 2.0, who: "Chito", text: "Somebody's feeding them" },
      { at: 6.4, seconds: 1.6, who: "Yuuri", text: "can we eat them" },
      { at: 8.2, seconds: 1.8, who: "Chito", text: "No—", loud: true },
      { at: 10.0, seconds: 2.0, who: "", text: "(the tank disagrees)" },
    ],
    run(t, _dt, s) {
      const [a, b] = s.cast;
      place(
        s,
        [
          [-0.9, -3.4],
          [0.9, -3.4],
        ],
        0,
      );
      for (const who of s.cast) if (who) who.root.rotation.y = FACING + Math.PI;
      if (t >= 2.4 && t < 8.0) {
        const swim = (t - 2.4) / 5.6;
        showCrate(s, -7 + 14 * swim, 3.2 + Math.sin(swim * 6) * 0.5, -7.4);
        s.crate.rotation.set(Math.sin(swim * 5) * 0.2, swim * 2, Math.sin(swim * 4) * 0.15);
      }
      s.once("notice", 4.4, () => s.sfx.creak());
      if (t >= 6.2 && t < 8.0) pose(a, "point", clamp01((t - 6.2) / 0.5));
      s.once("crack", 8.0, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 8.0 && t < 9.8) {
        const out = clamp01((t - 8.0) / 1.8);
        showCrate(s, 7 - 7 * smooth(out), 3.2 - 2.84 * smooth(out), -7.4 + 4 * smooth(out));
        s.crate.rotation.set(out * 3, out * 4, 0);
        for (const who of s.cast) pose(who, "panic", clamp01((t - 8.0) / 0.4), t);
      }
      s.once("beached", 9.8, () => {
        s.sfx.splash();
        s.sfx.thud();
      });
      if (t >= 9.8) {
        showCrate(s, 0, 0.36 * spring(clamp01((t - 9.8) / 0.8)), -3.4);
        s.crate.rotation.set(0, 0.4, 0);
        for (const who of s.cast) pose(who, "clear", 1);
        const turn = clamp01((t - 10.0) / 0.9);
        if (a) a.root.rotation.y = FACING + Math.PI * (1 - smooth(turn)) + 0.25 * smooth(turn);
        if (b) b.root.rotation.y = FACING + Math.PI * (1 - smooth(turn)) - 0.25 * smooth(turn);
      }
      s.once("pop", 12.0, () => s.sfx.open());
      if (t >= 12.0) popLid(s, (t - 12.0) / 1.2);
    },
  },
];

/** Where somebody is, plus a height — used by the shot definitions. */
function posOf(walker: Walker | undefined, dy: number): Vec3 {
  if (!walker) return [0, dy, 0];
  const p = walker.root.position;
  return [p.x, p.y + dy, p.z];
}

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

    // Whatever the prize file says wins over the line written here, so every
    // word on screen can be changed on GitHub.
    const said: Line[] = scenario.lines.map((line, i) => {
      const override = options.lines?.[`${scenario.id}.${i}`];
      return typeof override === "string" && override.trim() ? { ...line, text: override.trim() } : line;
    });
    const dialogue = createDialogue(host, said);

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
      const bounds = new THREE.Box3().setFromObject(model);
      const height = Math.max(0.001, bounds.max.y - bounds.min.y);
      const scale = 1.5 / height;
      model.scale.setScalar(scale);
      // The offset lives on the model inside a holder rather than on the
      // thing scenarios move, so `position.y = 0` means feet on the floor
      // whatever the exporter thought the origin was — and a fall pivots
      // around the feet instead of around the navel.
      model.position.y = -bounds.min.y * scale;

      // Materials are shared with the cached model, so they are cloned here:
      // tinting somebody green must not follow them into the next crate.
      const materials: any[] = [];
      const baseColours: any[] = [];
      model.traverse((node: any) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        const copy = Array.isArray(node.material)
          ? node.material.map((m: any) => m.clone())
          : node.material.clone();
        node.material = copy;
        for (const m of Array.isArray(copy) ? copy : [copy]) {
          materials.push(m);
          baseColours.push(m.color?.clone?.() ?? new THREE.Color(0xffffff));
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
        action.time = i * walkClip.duration * 0.5;
      }
      cast.push({ root, model, mixer, bones, materials, baseColours, homeX: i === 0 ? -0.62 : 0.62 });
    });

    let elapsed = 0;
    let frame = 0;
    const shakes: number[] = [];
    const fired = new Set<string>();

    const stage: Stage = {
      THREE,
      sfx,
      cast,
      crate,
      lid,
      spares,
      walking: false,
      shot: null,
      once: (key, at2, fn) => {
        if (fired.has(key) || elapsed < at2) return;
        fired.add(key);
        fn();
        if (/impact|land|strike|crash|settle|hit|kick|gone|arrive|beached|surface|smack/.test(key)) {
          shakes.push(elapsed);
        }
      },
    };

    const clock = new THREE.Clock();
    sfx.wind(true);
    let announced = false;

    const bump = (now: number): number => {
      let offset = 0;
      for (const at2 of shakes) {
        const since = now - at2;
        if (since >= 0 && since < 0.45) offset += Math.sin(since * 62) * 0.1 * (1 - since / 0.45);
      }
      return offset;
    };

    const resolve = (where: Where, t: number): Vec3 =>
      typeof where === "function" ? where(stage, t) : where;

    /** The camera for this instant: which shot, how far into it, and blends. */
    const aim = (t: number): { pos: Vec3; look: Vec3; fov: number; shake: number } => {
      const shots = scenario.shots;
      let index = 0;
      for (let i = 0; i < shots.length; i++) if (t >= shots[i].at) index = i;
      const shot = shots[index];
      const ends = shots[index + 1]?.at ?? scenario.seconds;
      const p = clamp01((t - shot.at) / Math.max(0.001, ends - shot.at));

      const from = resolve(shot.from, t);
      const to = shot.to ? resolve(shot.to, t) : from;
      const look = resolve(shot.look, t);
      const lookTo = shot.lookTo ? resolve(shot.lookTo, t) : look;
      const eased = smooth(p);
      let pos = mix3(from, to, eased);
      let aimAt = mix3(look, lookTo, eased);
      const fov = mix(shot.fov ?? 38, shot.fovTo ?? shot.fov ?? 38, eased);

      // A shot can ease out of the one before it instead of cutting.
      const blend = shot.blend ?? 0;
      if (blend > 0 && index > 0 && t - shot.at < blend) {
        const previous = shots[index - 1];
        const pEnds = shot.at;
        const pp = clamp01((t - previous.at) / Math.max(0.001, pEnds - previous.at));
        const pFrom = resolve(previous.from, t);
        const pTo = previous.to ? resolve(previous.to, t) : pFrom;
        const pLook = resolve(previous.look, t);
        const pLookTo = previous.lookTo ? resolve(previous.lookTo, t) : pLook;
        const k = smooth(clamp01((t - shot.at) / blend));
        pos = mix3(mix3(pFrom, pTo, smooth(pp)), pos, k);
        aimAt = mix3(mix3(pLook, pLookTo, smooth(pp)), aimAt, k);
      }
      return { pos, look: aimAt, fov, shake: shot.shake ?? 0 };
    };

    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;
      location.ambient(dt, elapsed);

      stage.walking = false;
      const t = Math.min(elapsed, scenario.seconds);
      scenario.run(t, dt, stage);
      for (const person of cast) if (stage.walking) person.mixer.update(dt);

      const { pos, look, fov, shake } = aim(t);
      const wobble = shake > 0 ? shake : 0;
      camera.position.set(
        pos[0] + bump(elapsed) + Math.sin(elapsed * 11) * wobble,
        pos[1] + Math.sin(elapsed * 8.3) * wobble,
        pos[2],
      );
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(look[0], look[1], look[2]);

      dialogue.update(t);
      renderer.render(scene, camera);

      // The pull starts against the film rather than after it, and unrolls
      // from wherever the crate happens to be on screen.
      if (!announced && elapsed >= scenario.opensAt) {
        announced = true;
        const point = crate.position.clone().project(camera);
        options.onOpen?.({
          x: clamp01((point.x + 1) / 2),
          y: clamp01((1 - point.y) / 2),
        });
      }

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
      dialogue.dispose();
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
    sfx.stop();
    options.onOpen?.({ x: 0.5, y: 0.5 });
    finish();
    return cleanup;
  }
}
