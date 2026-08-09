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
  /**
   * Play this one rather than a random one. For the admin's preview: a film
   * you cannot choose is a film you cannot check.
   */
  scenario?: string;
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
  /** When the prize reveals, so the roll can be started against it. */
  opensAt: number;
  /**
   * Where the roll unrolls FROM, for a scenario with no crate in it — a
   * whiteboard, a fish tank, whatever the story made the prize come out
   * of. Absent, the crate's position is used, as ever.
   */
  reveal?: (s: Stage) => Vec3;
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
    case "gaze":
      // Looking up at something taking its time.
      set(b.Head, -0.62);
      set(b.Spine, -0.14);
      break;
    case "read":
      // Both forearms up, holding a book that matters. Head down in it.
      set(b.LeftArm, -1.05, 0, -0.3);
      set(b.RightArm, -1.05, 0, 0.3);
      set(b.LeftForeArm, -1.15);
      set(b.RightForeArm, -1.15);
      set(b.Head, 0.45);
      set(b.Spine, 0.1);
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
    /**
     * The staircase that is most of the journey. They give up climbing it
     * at exactly the moment the climb becomes unnecessary: the crate takes
     * the stairs, one thud per step, and parks at their feet.
     */
    id: "stairs",
    location: "stairwell",
    seconds: 15,
    opensAt: 13.0,
    shots: [
      // Low at the bottom, the steps running up out of the light.
      { at: 0, from: [0, 1.1, 3.6], look: [0, 3.4, -9], fov: 44, to: [0, 1.3, 2.6] },
      // Their faces, craned back, doing the arithmetic.
      { at: 3.4, from: [0, 1.6, 0.6], look: [0, 1.5, -1.6], fov: 30 },
      // The sit, in sympathy.
      { at: 6.4, from: [-2.2, 1.0, 1.8], look: [0, 0.7, -1.2], fov: 36 },
      // Up the steps for the descent, following it down.
      { at: 8.6, from: [1.8, 2.6, -1.4], look: [0, 3.4, -8], to: [1.6, 1.6, 0.2], lookTo: [0, 0.6, -1.6], shake: 0.03 },
      // At their feet, where it ends up.
      { at: 12.4, from: [0, 1.2, 1.6], look: [0, 0.5, -1.5], to: [0, 1.05, 1.1] },
    ],
    lines: [
      { at: 1.2, seconds: 2.2, who: "Yuuri", text: "How far up does up go" },
      { at: 3.8, seconds: 1.8, who: "Chito", text: "All the way" },
      { at: 6.6, seconds: 2.0, who: "Yuuri", text: "Then we live here now" },
      { at: 9.2, seconds: 1.4, who: "", text: "(something takes the stairs)" },
      { at: 12.6, seconds: 2.2, who: "Chito", text: "...it used the handrail" },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      place(s, [
        [-0.7, -1.0],
        [0.7, -1.2],
      ]);
      // Necks back, counting floors.
      if (t >= 0.8 && t < 6.2) {
        pose(yuuri, "gaze", clamp01((t - 0.8) / 0.6));
        pose(chito, "gaze", clamp01((t - 1.2) / 0.6));
      }
      // The surrender: both of them sit on the bottom step.
      if (t >= 6.2) {
        pose(yuuri, "sit", clamp01((t - 6.2) / 0.5));
        pose(chito, "sit", clamp01((t - 6.5) / 0.5));
        if (yuuri) yuuri.root.position.set(-0.7, 0.28, -1.9);
        if (chito) chito.root.position.set(0.7, 0.28, -1.9);
      }
      // The descent: one step at a time, one thud at a time.
      const BOUNCES = 7;
      if (t >= 8.8 && t < 12.2) {
        const p = clamp01((t - 8.8) / 3.4);
        const step = Math.min(BOUNCES - 1, Math.floor(p * BOUNCES));
        const within = p * BOUNCES - step;
        const fromStep = 14 - step * 2;
        const toStep = Math.max(0, fromStep - 2);
        const y = 0.13 + (fromStep + (toStep - fromStep) * within) * 0.26 + Math.sin(within * Math.PI) * 0.5;
        const z = -2.2 - (fromStep + (toStep - fromStep) * within) * 0.72 + 0.4;
        showCrate(s, 0.3 * Math.sin(step * 2.4), y + 0.3, z);
        s.crate.rotation.x = p * 8;
        s.crate.rotation.y = step * 0.9;
      }
      for (let n = 0; n < BOUNCES; n++) {
        s.once(`thud${n}`, 8.8 + ((n + 1) / BOUNCES) * 3.4 - 0.1, () => s.sfx.thud());
      }
      s.once("arrive", 12.2, () => s.sfx.clatter());
      if (t >= 12.2) {
        showCrate(s, 0, 0.36 * spring(clamp01((t - 12.2) / 0.7)), -1.0);
        s.crate.rotation.set(0, 0.4, 0);
        if (t >= 12.4) {
          pose(yuuri, "reach", clamp01((t - 12.4) / 0.4));
        }
      }
      s.once("pop", 13.0, () => s.sfx.open());
      if (t >= 13.0) popLid(s, (t - 13.0) / 1.2);
    },
  },

  {
    /**
     * Dusk on a roof, and a crate coming down the sky on a parachute
     * nobody sent — slowly enough for a full negotiation about who owns
     * it, and politely enough to land exactly between them.
     */
    id: "parachute",
    location: "rooftop",
    seconds: 16,
    opensAt: 14.0,
    shots: [
      // The dusk, the parapet, two silhouettes looking out.
      { at: 0, from: [0, 1.7, 4.6], look: [0, 1.2, -4], to: [0, 1.6, 3.4] },
      // Up at the sky, where something is taking its time.
      { at: 3.2, from: [-0.8, 1.1, 1.2], look: [1.5, 9, -8], fov: 46 },
      // Their heads, tracking it together like a slow tennis match.
      { at: 6.2, from: [0, 1.6, 1.2], look: [0, 1.55, -1.4], fov: 28 },
      // Side-on for the argument, city behind.
      { at: 9.2, from: [3.4, 1.5, 1.6], look: [-0.8, 1.2, -1.2], fov: 34 },
      // The landing, gentle as a snowflake with paperwork.
      { at: 12.6, from: [0, 1.9, 3.0], look: [0, 0.8, -1.2], to: [0, 1.3, 2.2] },
    ],
    lines: [
      { at: 1.4, seconds: 2.0, who: "Yuuri", text: "It's taking its time" },
      { at: 3.8, seconds: 2.0, who: "Chito", text: "It has a parachute" },
      { at: 6.4, seconds: 1.8, who: "Yuuri", text: "I want a parachute" },
      { at: 8.6, seconds: 1.8, who: "Chito", text: "You'd eat it" },
      { at: 10.8, seconds: 1.8, who: "Yuuri", text: "...only a bit", loud: true },
      { at: 13.4, seconds: 1.8, who: "", text: "(it lands exactly between them)" },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      place(s, [
        [-0.8, -2.6],
        [0.8, -2.6],
      ]);
      // The whole descent: high and far left, down to the roof between
      // them, swinging under its canopy the entire way.
      const drop = smooth(clamp01(t / 13.2));
      const sway = Math.sin(t * 1.7) * (1 - drop) * 1.1;
      showCrate(s, -6 + 6 * drop + sway, 11.5 - 11.1 * drop, -6 + 4.8 * drop);
      s.crate.rotation.z = Math.sin(t * 1.7 + 0.6) * 0.25 * (1 - drop);
      s.crate.rotation.y = t * 0.3;
      // Two heads following one slow object.
      if (t >= 2.4 && t < 12.6) {
        pose(yuuri, "gaze", 0.8);
        pose(chito, "gaze", 0.7);
        const track = Math.atan2(s.crate.position.x, 4);
        face(yuuri, track * 0.8);
        face(chito, track * 0.8);
      }
      s.once("breeze", 3.0, () => s.sfx.whoosh());
      s.once("settle", 13.2, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 13.2) {
        showCrate(s, 0, 0.36, -1.2);
        s.crate.rotation.set(0, 0.2, 0);
        pose(yuuri, "reach", clamp01((t - 13.4) / 0.4));
        pose(chito, "clear", 1);
        face(yuuri, -0.3);
        face(chito, 0.3);
      }
      s.once("pop", 14.0, () => s.sfx.open());
      if (t >= 14.0) popLid(s, (t - 14.0) / 1.2);
    },
  },

  {
    /**
     * Night, a fire, one ration on a stick, and the fire's opinion of it.
     * Crate-free: whatever the fire took, the fire gives back with
     * interest — the prize reveals out of the flames.
     */
    id: "campfire",
    location: "campfire",
    seconds: 16,
    opensAt: 13.8,
    reveal: () => [0, 0.8, -1.3],
    shots: [
      // The one warm thing in the world, and two people around it.
      { at: 0, from: [0, 1.5, 2.8], look: [0, 0.7, -1.4], to: [0, 1.3, 2.2] },
      // Low over the flames: the stick, the ration, the mistake.
      { at: 3.6, from: [-1.5, 0.6, -0.2], look: [0.3, 0.55, -1.4], fov: 30 },
      // Firelit faces, one trusting, one doing risk assessment.
      { at: 6.6, from: [0, 1.1, -0.2], look: [-0.9, 1.0, 0.6], fov: 30 },
      // The fire takes the ration.
      { at: 9.6, from: [0.9, 0.8, 0.2], look: [0, 0.6, -1.4], fov: 34, shake: 0.03 },
      // Push into the flames for the apology.
      { at: 12.6, from: [0, 1.0, 0.8], look: [0, 0.7, -1.4], to: [0, 0.85, 0.1] },
    ],
    lines: [
      { at: 1.4, seconds: 2.4, who: "Chito", text: "Last ration. Cook it carefully" },
      { at: 4.2, seconds: 1.8, who: "Yuuri", text: "I'm the careful one" },
      { at: 7.0, seconds: 1.6, who: "Chito", text: "You are not" },
      { at: 9.8, seconds: 1.4, who: "", text: "(the fire eats it)" },
      { at: 11.4, seconds: 1.8, who: "Yuuri", text: "the fire was hungrier" },
      { at: 13.6, seconds: 2.0, who: "Yuuri", text: "look — it's sorry", loud: true },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      place(s, [
        [-0.9, 0.4],
        [0.9, 0.4],
      ]);
      // Both sat at the fire, facing it — which is towards the camera's
      // side of the flames, so faces stay lit and visible.
      pose(yuuri, "sit", 1);
      pose(chito, "sit", 1);
      if (yuuri) {
        yuuri.root.position.y = 0.28;
        face(yuuri, 0.5);
      }
      if (chito) {
        chito.root.position.y = 0.28;
        face(chito, -0.5);
      }
      // The stick over the fire: one arm out, holding dinner's future.
      if (t >= 1.0 && t < 10.4) pose(yuuri, "point", clamp01((t - 1.0) / 0.6));
      s.once("sizzle", 5.2, () => s.sfx.creak());
      s.once("sizzle2", 8.0, () => s.sfx.creak());
      // The fire takes it: a pop, a flare, an empty stick.
      s.once("gone", 9.6, () => {
        s.sfx.clatter();
        s.sfx.growl();
      });
      if (t >= 10.4 && t < 12.6) {
        pose(yuuri, "sit", 1);
        pose(yuuri, "hurt", clamp01((t - 10.4) / 0.8) * 0.6);
      }
      if (t >= 12.6) {
        pose(yuuri, "sit", 1);
        pose(yuuri, "reach", clamp01((t - 12.6) / 0.6));
        pose(chito, "sit", 1);
        pose(chito, "gaze", 0.4);
      }
      // The flames make amends.
      s.once("hum", 13.0, () => s.sfx.menace(1.4));
      s.once("pop", 13.8, () => s.sfx.open());
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

  {
    /**
     * School is in session, attendance: one. Chito teaches; Yuuri finds
     * the curriculum delicious. No crate anywhere — the prize comes out
     * of the whiteboard, which by then has earned it.
     */
    id: "lesson",
    location: "classroom",
    seconds: 18,
    opensAt: 15.8,
    reveal: () => [0, 1.75, -3.9],
    shots: [
      // The whole ruined room, dust in the light, teacher at the board.
      { at: 0, from: [0, 1.75, 5.2], look: [0, 1.3, -3], to: [0, 1.6, 3.6], lookTo: [0, 1.35, -3.4] },
      // Over the student's shoulder: the board, and today's enormous ゆ.
      { at: 3.4, from: [-0.7, 1.35, -0.9], look: [0.1, 1.72, -4.2], fov: 30, to: [-0.4, 1.45, -1.8] },
      // The teacher, mid-lesson, believing in the lesson.
      { at: 6.6, from: [-1.7, 1.4, -1.6], look: (s) => posOf(s.cast[1], 1.25), fov: 32 },
      // The student. In. All the way in.
      { at: 9.0, from: [-0.6, 1.3, 0.9], look: (s) => posOf(s.cast[0], 1.2), fov: 36, fovTo: 12, to: [-0.6, 1.25, -0.3], shake: 0.02 },
      // Two-shot from the broken wall, for the verdict.
      { at: 13.0, from: [3.2, 1.5, 0.6], look: [-0.3, 1.25, -1.8], fov: 34 },
      // The board takes the last word.
      { at: 15.6, from: [0, 1.5, -0.4], look: [0, 1.72, -4.2], to: [0, 1.62, -1.5] },
    ],
    lines: [
      { at: 1.2, seconds: 2.6, who: "Chito", text: "Today: this one. It reads yu" },
      { at: 4.2, seconds: 1.6, who: "Yuuri", text: "Chi-chan" },
      { at: 6.0, seconds: 1.8, who: "Yuuri", text: "that's a fish" },
      { at: 7.8, seconds: 1.6, who: "Chito", text: "It's a letter" },
      { at: 9.8, seconds: 2.2, who: "Yuuri", text: "a tasty fish...", loud: true },
      { at: 12.0, seconds: 1.2, who: "", text: "(drooling)" },
      { at: 13.4, seconds: 2.2, who: "Chito", text: "Please don't eat the alphabet" },
      { at: 16.0, seconds: 1.8, who: "Yuuri", text: "the fish is glowing" },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      // Teacher at the board, student at the one desk still standing.
      place(s, [
        [-0.6, -1.3],
        [1.15, -3.1],
      ]);
      pose(yuuri, "sit", 1);
      face(chito, 0.45); // half to the board, half to the class
      // The lesson: pointing at the board, with conviction.
      if (t >= 1.0 && t < 6.4) pose(chito, "point", clamp01((t - 1.0) / 0.5));
      s.once("tap", 2.2, () => s.sfx.creak());
      s.once("tap2", 3.1, () => s.sfx.creak());

      // The stomach files its counter-argument.
      s.once("growl", 9.6, () => s.sfx.growl());
      s.once("growl2", 11.8, () => s.sfx.growl());
      if (t >= 9.0 && yuuri) {
        // She leans towards the board, hypnotised, chair and all.
        const lean = smooth(clamp01((t - 9.0) / 3.4));
        pose(yuuri, "sit", 1);
        pose(yuuri, "reach", clamp01((t - 10.6) / 1.2) * 0.6);
        yuuri.root.position.z = -1.3 - lean * 0.55;
        yuuri.root.rotation.x = -lean * 0.22;
      }
      if (t >= 13.0 && chito) {
        pose(chito, "clear", 1);
        face(chito, -0.15); // turns from the board to look at her student
      }
      // The board decides the lesson is over and pays out.
      s.once("hum", 15.0, () => s.sfx.menace(1.6));
      s.once("pop", 15.8, () => s.sfx.open());
    },
  },

  {
    /**
     * Fishing, in a place with the only fish left anywhere, using no rod,
     * no line and no bait. It works, which is the worst possible outcome
     * for everyone who owns a rod. Crate-free: the tank hands it over.
     */
    id: "fisher",
    location: "aquarium",
    seconds: 15,
    opensAt: 12.8,
    reveal: () => [0, 2.3, -6.6],
    shots: [
      // The tank over their shoulders, one of them dangling an arm in.
      { at: 0, from: [0, 1.9, 1.6], look: [0, 2.5, -7], fov: 40, to: [0, 1.8, 0.2] },
      // The technique, such as it is.
      { at: 3.2, from: [-2.6, 2.0, -2.2], look: (s) => posOf(s.cast[0], 1.35), fov: 30 },
      // The commentary, delivered without looking up.
      { at: 6.8, from: [2.2, 1.5, -1.6], look: (s) => posOf(s.cast[1], 1.1), fov: 28 },
      // The bite.
      { at: 9.8, from: [0, 1.7, -0.6], look: [0, 2.2, -6.8], shake: 0.05 },
      // The catch, such as it is.
      { at: 12.4, from: [0, 1.4, -0.8], look: [0, 2.2, -6.8], to: [0, 1.6, -1.8] },
    ],
    lines: [
      { at: 1.4, seconds: 1.8, who: "Yuuri", text: "I'm fishing" },
      { at: 3.6, seconds: 2.0, who: "Chito", text: "You don't have a rod" },
      { at: 6.0, seconds: 1.8, who: "Yuuri", text: "I have patience" },
      { at: 8.0, seconds: 1.8, who: "Chito", text: "You have neither" },
      { at: 10.0, seconds: 1.4, who: "", text: "(something bites)" },
      { at: 11.6, seconds: 2.2, who: "Yuuri", text: "PATIENCE WORKED", loud: true },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      place(s, [
        [-0.5, -3.6],
        [1.3, -2.6],
      ]);
      // She fishes facing the tank; the sceptic sits facing away, reading.
      if (yuuri) yuuri.root.rotation.y = FACING + Math.PI;
      pose(chito, "sit", 1);
      if (t < 9.8) pose(yuuri, "point", 0.8);

      s.once("drip", 4.6, () => s.sfx.creak());
      s.once("bite", 10.0, () => s.sfx.splash());
      // The strike: a full-body yank on nothing at all.
      if (t >= 10.0 && t < 12.0 && yuuri) {
        const yank = Math.sin(clamp01((t - 10.0) / 2.0) * Math.PI);
        pose(yuuri, "swing", yank);
        yuuri.root.rotation.x = yank * 0.35;
        yuuri.root.position.z = -3.6 + yank * 0.5;
      }
      if (t >= 10.4 && chito) {
        pose(chito, "clear", 1);
        const turn = clamp01((t - 10.4) / 0.8);
        chito.root.rotation.y = FACING + smooth(turn) * Math.PI;
        s.walking = false;
      }
      // The tank concedes.
      s.once("surface", 12.4, () => s.sfx.splash());
      s.once("pop", 12.8, () => s.sfx.open());
    },
  },

  {
    /**
     * A library survived, and Chito is going to read all of it, in order.
     * The one hazard in the entire building is her own to-read pile,
     * parked in the middle of the aisle — and Yuuri browses with her eyes
     * on the shelves and nothing at all on the floor. Crate-free: the
     * prize is under the landslide.
     */
    id: "books",
    location: "library",
    seconds: 16.5,
    opensAt: 14.2,
    reveal: () => [0, 0.35, -0.3],
    shots: [
      // Down the aisle: shelves into the fog, the reader in her nook.
      { at: 0, from: [0, 1.55, 5.2], look: [0, 1.7, -8], to: [0, 1.45, 4.0] },
      // The reader, close, mid-sentence of a very long book.
      { at: 3.2, from: [0.1, 1.15, 0.8], look: (s) => posOf(s.cast[1], 1.05), fov: 28 },
      // Tracking the browser, whose eyes are anywhere but down.
      {
        at: 5.2,
        from: (s) => {
          const p = s.cast[0]?.root.position;
          return [(p?.x ?? 0) - 1.7, 1.4, (p?.z ?? 0) + 1.9];
        },
        look: (s) => posOf(s.cast[0], 1.35),
        fov: 34,
      },
      // The pile, waiting, in the exact centre of the aisle.
      { at: 7.2, from: [0.6, 0.4, 0.3], look: [-0.55, 0.3, -1.1], fov: 26 },
      // Wide for the landslide.
      { at: 8.1, from: [-2.6, 1.5, 3.0], look: [0, 0.55, -0.7], shake: 0.05 },
      // The librarian's verdict.
      { at: 10.9, from: [0.4, 1.35, 0.6], look: (s) => posOf(s.cast[1], 1.15), fov: 26 },
      // Down at the wreckage, in for the glow.
      { at: 13.2, from: [0, 1.6, 2.8], look: [0, 0.35, -0.3], to: [0, 1.15, 1.7] },
    ],
    lines: [
      { at: 1.0, seconds: 2.4, who: "Chito", text: "A whole floor of books survived" },
      { at: 3.8, seconds: 2.0, who: "Chito", text: "I'm reading them in order" },
      { at: 5.6, seconds: 2.0, who: "Yuuri", text: "do they taste different?" },
      { at: 7.0, seconds: 1.1, who: "", text: "(she is not watching the floor)" },
      { at: 8.5, seconds: 1.4, who: "", text: "(the to-read pile fights back)" },
      { at: 10.3, seconds: 2.2, who: "Yuuri", text: "...the floor wanted them more" },
      { at: 12.6, seconds: 2.0, who: "Chito", text: "You tripped on human history" },
      { at: 14.6, seconds: 1.8, who: "Yuuri", text: "history is glowing", loud: true },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      // The reader, installed on her seat of thicker books.
      if (chito) {
        chito.root.position.set(1.35, 0.36, -0.6);
        face(chito, -0.7);
      }
      if (t < 8.1) {
        pose(chito, "sit", 1);
        pose(chito, "read", 1);
      }
      // Her current volume, resting in the crook of the pose.
      const held = s.spares[8];
      if (held) {
        held.visible = true;
        held.scale.set(0.42, 0.2, 0.3);
        held.position.set(1.08, 0.62, -0.32);
        held.rotation.set(-0.5, -0.7, 0);
      }

      // The to-read pile: six volumes of pure ambush.
      const PILE_X = -0.5;
      const PILE_Z = -1.05;
      for (let i = 0; i < 6; i++) {
        const book = s.spares[i];
        if (!book) continue;
        book.visible = true;
        book.scale.set(0.46 - (i % 3) * 0.04, 0.2, 0.34);
        if (t < 8.0) {
          book.position.set(PILE_X + Math.sin(i * 2.1) * 0.05, 0.075 + i * 0.145, PILE_Z);
          book.rotation.set(0, i * 0.5, 0);
        } else {
          // The landslide: every book gets its own arc out of the pile.
          const p = smooth(clamp01((t - 8.0) / 0.7));
          book.position.set(
            PILE_X + Math.sin(i * 2.7) * 1.1 * p,
            mix(0.075 + i * 0.145, 0.08, p) + Math.sin(p * Math.PI) * (0.45 + (i % 2) * 0.3),
            PILE_Z + (0.5 + (i % 3) * 0.45) * p,
          );
          book.rotation.set(p * Math.PI * (1 + (i % 2)), i * 0.5 + p * 2.5, 0);
        }
      }

      // The browser: eyes on the shelves, feet on autopilot.
      const walk = clamp01(t / 7.9);
      if (yuuri && t < 7.9) {
        s.walking = true;
        yuuri.root.position.set(-0.5, 0, -13.5 + 12.35 * walk);
        face(yuuri, Math.sin(t * 1.3) * 0.3);
        pose(yuuri, "gaze", 0.8);
      }
      for (let n = 0; n < Math.floor(walk * 7.9 * 2.2); n++) {
        s.once(`step${n}`, n / 2.2, () => s.sfx.step());
      }

      // The trip. Physics files no complaint; the pile had right of way.
      s.once("clip", 7.9, () => s.sfx.whoosh());
      s.once("crash", 8.15, () => s.sfx.clatter());
      s.once("flop", 8.45, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 7.9 && yuuri) {
        s.walking = false;
        const p = clamp01((t - 7.9) / 0.6);
        pose(yuuri, "flat", p);
        yuuri.root.rotation.x = -smooth(p) * 1.5;
        yuuri.root.position.set(-0.5, 0, -1.15 + smooth(p) * 0.75);
        face(yuuri, (1 - p) * 0.3);
      }

      // The librarian: horror first, then her own book clutched to safety.
      if (t >= 8.1 && t < 11.2) {
        pose(chito, "clear", 1);
        pose(chito, "sit", 1);
        pose(chito, "hurt", clamp01((t - 8.1) / 0.5) * 0.9);
      }
      if (t >= 11.2) {
        pose(chito, "clear", 1);
        pose(chito, "sit", 1);
        pose(chito, "hungry", clamp01((t - 11.2) / 0.7) * 0.75);
        if (held) held.position.set(1.19, 0.78, -0.42);
      }

      // Something under the wreckage picks up where the lesson left off.
      s.once("hum", 13.4, () => s.sfx.menace(1.4));
      s.once("pop", 14.2, () => s.sfx.open());
    },
  },

  /**
   * Kaiju. Yuuri, five storeys of her, washed faintly green and coming up
   * the avenue one building at a time. Chito, regular size, running for
   * both their lives. Every stomp lands through the camera; the buildings
   * are spare crates worn sideways; the last warehouse coughs up the prize.
   */
  {
    id: "kaiju",
    location: "city",
    seconds: 18,
    opensAt: 15.2,
    shots: [
      // Street level, looking up the avenue into fog: a silhouette too big.
      { at: 0, from: [0.9, 0.5, 4.6], look: [0, 6.5, -20], to: [0.7, 0.7, 4.2], shake: 0.03 },
      // The one running: close, low, terror at a steady jog.
      {
        at: 3.2,
        from: (s) => {
          const p = s.cast[1]?.root.position;
          return [(p?.x ?? 0) + 1.25, 1.3, (p?.z ?? 0) + 2.3];
        },
        look: (s) => posOf(s.cast[1], 1.15),
        fov: 30,
        shake: 0.05,
      },
      // The whole of her, framed like the poster.
      {
        at: 6.0,
        from: [-2.6, 1.0, 2.4],
        look: (s) => posOf(s.cast[0], 5.6),
        fov: 46,
        shake: 0.06,
      },
      // Wide for the demolition.
      { at: 8.6, from: [3.5, 2.3, 3.2], look: [-1.2, 4.2, -10], shake: 0.08 },
      // Down the giant's shoulder at the snack refusing to stop.
      {
        at: 11.4,
        from: (s) => {
          const p = s.cast[0]?.root.position;
          return [(p?.x ?? 0) + 1.4, 8.4, (p?.z ?? 0) + 1.2];
        },
        look: (s) => posOf(s.cast[1], 0.9),
        fov: 34,
        shake: 0.05,
      },
      // Street level for the crate's arrival.
      { at: 13.2, from: [1.7, 0.9, 4.8], look: [0.3, 0.6, 2.2], shake: 0.04 },
      // In for the glow.
      { at: 15.0, from: [0.3, 1.5, 4.7], look: [0.3, 0.45, 2.2], to: [0.3, 1.1, 3.6] },
    ],
    lines: [
      { at: 0.8, seconds: 2.0, who: "Chito", text: "Yuuri? You seem taller" },
      { at: 2.7, seconds: 1.6, who: "Yuuri", text: "GAO.", loud: true },
      { at: 4.5, seconds: 2.0, who: "Chito", text: "That is not a word you know" },
      { at: 6.6, seconds: 1.4, who: "", text: "(a building files no complaint)" },
      { at: 8.7, seconds: 1.8, who: "Yuuri", text: "the city is crunchy" },
      { at: 10.5, seconds: 1.8, who: "Chito", text: "I am NOT rations!", loud: true },
      { at: 12.4, seconds: 1.6, who: "Yuuri", text: "everything is rations" },
      { at: 13.9, seconds: 1.4, who: "", text: "(a warehouse surrenders its last crate)" },
      { at: 15.5, seconds: 1.8, who: "Yuuri", text: "it dropped a snack", loud: true },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;

      // The buildings: spare crates stood up five storeys, lining the
      // avenue. [x, z, height]. Painted once, the first frame they exist.
      const BUILDINGS: [number, number, number][] = [
        [-4.4, -22, 7.5],
        [4.6, -19, 9],
        [-4.2, -15.5, 8],
        [4.4, -12, 7.5],
        [-4.5, -9, 9],
        [4.3, -6.2, 8],
      ];
      // The giant's march: from deep fog to looming, at one speed, so each
      // building's demolition time falls straight out of her position.
      const MARCH_FROM = -26;
      const MARCH_TO = -4.5;
      const MARCH_SECONDS = 14;
      const giantZ = MARCH_FROM + (MARCH_TO - MARCH_FROM) * clamp01(t / MARCH_SECONDS);
      const smashTime = (z: number): number => ((z - MARCH_FROM) / (MARCH_TO - MARCH_FROM)) * MARCH_SECONDS + 0.3;

      BUILDINGS.forEach(([x, z, h], i) => {
        const building = s.spares[i];
        if (!building) return;
        building.visible = true;
        if (t < 0.1) {
          building.traverse((node: any) => {
            if (node.isMesh) node.material.color.setHex(i % 2 === 0 ? 0x525a66 : 0x464e5a);
          });
        }
        building.scale.set(3.2, h / 0.72, 3.2);
        const falls = smashTime(z);
        if (t < falls) {
          building.position.set(x, h / 2, z);
          building.rotation.set(0, 0, 0);
        } else {
          // Swatted: it leans away from the street, sinks, and stays down.
          const p = smooth(clamp01((t - falls) / 0.9));
          building.rotation.z = -Math.sign(x) * p * 1.35;
          building.position.set(x + Math.sign(x) * p * 2.2, h / 2 - p * (h * 0.42), z);
          s.once(`crash${i}`, falls, () => {
            s.sfx.clatter();
            s.sfx.thud();
          });
        }
      });

      // The kaiju herself: five times anybody's size, faintly reactor-green,
      // little arms out front, one slow stomp after another.
      if (yuuri) {
        yuuri.root.scale.setScalar(5);
        tint(yuuri, s.THREE, 0x7fd06a, 0.5);
        const STEP = 1.3;
        const stepPhase = (t % STEP) / STEP;
        const marching = t < MARCH_SECONDS;
        yuuri.root.position.set(
          Math.sin(t * 0.7) * 0.4,
          marching ? Math.abs(Math.sin(stepPhase * Math.PI)) * 0.35 : 0,
          giantZ,
        );
        yuuri.root.rotation.z = marching ? Math.sin(t * (Math.PI / STEP)) * 0.05 : 0;
        face(yuuri);
        // A swat when a building is due; T-rex arms the rest of the time.
        const swatting = BUILDINGS.some(([, z]) => Math.abs(t - smashTime(z)) < 0.35);
        pose(yuuri, "clear", 1);
        if (swatting) pose(yuuri, "swing", 1);
        else pose(yuuri, "reach", 0.45);
        if (marching) {
          for (let n = 0; n < Math.floor(t / STEP); n++) {
            s.once(`hit${n}`, n * STEP + STEP * 0.5, () => {
              s.sfx.thud();
            });
          }
        }
      }
      s.once("roar1", 2.6, () => {
        s.sfx.menace(1.4);
        s.sfx.growl();
      });
      s.once("roar2", 9.2, () => {
        s.sfx.menace(1.2);
        s.sfx.growl();
      });

      // The snack: flat out down the middle of the road, one look back she
      // immediately regrets, sheltering behind the crate once it lands.
      if (chito) {
        s.walking = t < 14.4;
        const glance = t >= 7.4 && t < 8.2;
        const run = clamp01(t / 14.4);
        chito.root.position.set(
          0.35 + Math.sin(t * 2.1) * 0.25,
          0,
          -6 + 10.2 * smooth(run),
        );
        face(chito, glance ? Math.PI : 0);
        pose(chito, "clear", 1);
        pose(chito, "panic", glance ? 1 : 0.55 + Math.sin(t * 6) * 0.15, t);
        if (t >= 14.4) {
          face(chito, Math.PI); // turned back to watch, from cover
          pose(chito, "clear", 1);
          pose(chito, "gaze", 0.8);
        }
      }

      // The last warehouse gives up the goods: the crate arcs out of the
      // wreckage and lands in the road between them.
      const EJECT = smashTime(-6.2) + 0.15;
      if (t >= EJECT) {
        const p = clamp01((t - EJECT) / 0.85);
        showCrate(
          s,
          mix(4.3, 0.3, p),
          Math.sin(p * Math.PI) * 2.6 + (1 - p) * 2.2,
          mix(-6.2, 2.2, p),
        );
        s.crate.rotation.z = p * Math.PI * 2;
        if (p >= 1) {
          s.crate.rotation.z = 0;
          s.crate.position.y = 0.36;
        }
        s.once("land-crate", EJECT + 0.85, () => s.sfx.thud());
      }
      s.once("pop", 15.2, () => s.sfx.open());
      popLid(s, (t - 15.2) / 0.8);
    },
  },

  /**
   * The guugu. Two people in hot water, and the word ぐうぐ comes swimming
   * across the bath because from a distance it looks like a fish. It is not
   * a fish. It was never even a word. It glows anyway.
   */
  {
    id: "guugu",
    location: "bath",
    seconds: 19,
    opensAt: 16.6,
    reveal: () => [0, 0.65, -1.15],
    shots: [
      // The bath at rest, steam doing the work.
      { at: 0, from: [0, 1.6, 4.4], look: [0, 0.5, -1], fov: 36, to: [0, 1.3, 3.7] },
      // Water level, where something is making a wake.
      { at: 3.0, from: [-2.4, 0.5, 1.3], look: [-1.4, 0.42, -2.2], fov: 32 },
      // Tracking it in to the bath's edge.
      { at: 5.4, from: [-0.8, 0.5, 1.8], look: [0, 0.42, -1.2], fov: 34, shake: 0.02 },
      // The optimist.
      {
        at: 7.4,
        from: (s) => {
          const p = s.cast[0]?.root.position;
          return [(p?.x ?? 0) + 0.2, (p?.y ?? 0) + 1.3, (p?.z ?? 0) + 1.1];
        },
        look: (s) => posOf(s.cast[0], 1.12),
        fov: 30,
      },
      // The reader of dead words.
      { at: 9.6, from: [1.5, 0.9, 0.6], look: (s) => posOf(s.cast[1], 1.05), fov: 28 },
      // Two-shot over the thing bobbing between them.
      { at: 12.0, from: [0, 1.15, 2.6], look: [0, 0.55, -1.1] },
      // In on the glow.
      { at: 15.6, from: [0.5, 0.9, 1.2], look: [0, 0.55, -1.15], to: [0.2, 0.75, 0.4] },
    ],
    lines: [
      { at: 1.2, seconds: 2.0, who: "Yuuri", text: "the water is doing its job" },
      { at: 3.4, seconds: 2.0, who: "Chito", text: "Yuuri. Something is swimming at us" },
      { at: 5.6, seconds: 1.8, who: "Yuuri", text: "a fish!! we eat like queens", loud: true },
      { at: 7.7, seconds: 2.2, who: "Chito", text: "that's not a fish. it's the word ぐうぐ" },
      { at: 10.0, seconds: 2.0, who: "Yuuri", text: "what did guugu mean? before" },
      { at: 12.2, seconds: 2.0, who: "Chito", text: "nothing. it was never a word" },
      { at: 14.3, seconds: 1.9, who: "Yuuri", text: "then nobody will miss it. we eat it" },
      { at: 16.4, seconds: 1.8, who: "", text: "(the word would rather be a prize)" },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;
      place(
        s,
        [
          [-0.9, -1],
          [0.9, -1],
        ],
        -0.15,
        -0.62,
      );
      pose(yuuri, "soak", 1, t);
      pose(chito, "soak", 1, t + 1.4);
      if (t >= 5.4 && t < 8.6) pose(yuuri, "point", 1);
      if (t >= 7.4 && t < 12.6) pose(chito, "gaze", 0.6);

      // The word itself: three glyphs on planes, built the first frame they
      // are needed and swimming nose-first like the fish they are not.
      type Guugu = { group: any; glyphs: { mesh: any; material: any }[]; light: any };
      let guugu = (s as unknown as { guugu?: Guugu }).guugu;
      if (!guugu) {
        const THREE = s.THREE;
        const group = new THREE.Group();
        const glyphs = ["ぐ", "う", "ぐ"].map((glyph, i) => {
          const canvas = document.createElement("canvas");
          canvas.width = 128;
          canvas.height = 128;
          const paint = canvas.getContext("2d")!;
          paint.font = "bold 104px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
          paint.textAlign = "center";
          paint.textBaseline = "middle";
          paint.fillStyle = "#ffffff";
          paint.fillText(glyph, 64, 70);
          const material = new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            color: 0x2a3440,
          });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), material);
          mesh.position.x = -i * 0.3;
          group.add(mesh);
          return { mesh, material };
        });
        const light = new THREE.PointLight(0xffd97a, 0, 4, 1.8);
        group.add(light);
        s.crate.parent.add(group);
        guugu = { group, glyphs, light };
        (s as unknown as { guugu?: Guugu }).guugu = guugu;
      }

      // The swim: in from the far corner, arriving at the bath's edge, then
      // treading water between them. Each glyph trails the one before.
      const arrive = smooth(clamp01((t - 2.5) / 5));
      const bob = (phase: number): number => 0.42 + Math.sin(t * 2.4 + phase) * 0.03;
      guugu.group.position.set(mix(-4.4, 0, arrive), 0, mix(-4.2, -1.15, arrive) + 0);
      guugu.glyphs.forEach(({ mesh }, i) => {
        const wig = t * 3.2 - i * 0.9;
        mesh.position.x = -i * 0.3 + Math.sin(wig) * 0.05;
        mesh.position.y = bob(i * 1.3);
        mesh.position.z = Math.sin(wig * 0.7) * 0.06;
        mesh.rotation.z = Math.sin(wig) * 0.18;
      });
      for (let n = 0; n < 6; n++) {
        s.once(`swim${n}`, 2.8 + n, () => s.sfx.splash());
      }

      // The glow: ink to gold, and its own light coming up with the hum.
      const glow = smooth(clamp01((t - 15.5) / 1.6));
      for (const { material } of guugu.glyphs) {
        material.color.setRGB(mix(0.16, 1.0, glow), mix(0.2, 0.85, glow), mix(0.25, 0.48, glow));
      }
      guugu.light.intensity = glow * 8;
      guugu.light.position.set(0, 0.7, 0.1);
      s.once("hum", 15.5, () => s.sfx.menace(1.4));
      s.once("pop", 16.6, () => s.sfx.open());
    },
  },

  /**
   * Table stakes. The house has taken everything else, so Yuuri, with the
   * unshakeable confidence of somebody holding no cards worth holding,
   * puts her last asset on the felt. The asset files a complaint.
   */
  {
    id: "allin",
    location: "den",
    seconds: 17.5,
    opensAt: 15.4,
    shots: [
      // The game, from behind the players, lamp swinging.
      { at: 0, from: [0, 1.5, 2.6], look: [0, 1.0, -1.6], to: [0, 1.35, 2.0] },
      // The face of somebody about to have an idea. She faces the table,
      // so the camera sits on the felt side, looking back at her.
      {
        at: 4.2,
        from: (s) => {
          const p = s.cast[0]?.root.position;
          return [(p?.x ?? 0) + 0.15, (p?.y ?? 0) + 1.35, (p?.z ?? 0) - 1.15];
        },
        look: (s) => posOf(s.cast[0], 1.15),
        fov: 30,
      },
      // Wide for the transaction.
      { at: 7.0, from: [-2.4, 1.5, 1.6], look: [0, 0.9, -1.4], shake: 0.04 },
      // Table level: the merchandise, displayed.
      { at: 9.8, from: [1.6, 1.15, 0.2], look: [-0.3, 1.2, -1.5], fov: 30 },
      // Two-shot for the consequences.
      { at: 11.6, from: [-1.8, 1.3, 0.6], look: [-0.1, 1.1, -1.2] },
      // The dark across the table, where the house is not sitting.
      { at: 13.9, from: [0.8, 1.0, 0.4], look: [0, 1.0, -3.0] },
      // In on the pot.
      { at: 15.2, from: [0.6, 1.4, 0.6], look: [0.45, 1.25, -1.6], to: [0.4, 1.3, 0.0] },
    ],
    lines: [
      { at: 0.9, seconds: 2.2, who: "Chito", text: "You bet the blanket. And the torch" },
      { at: 3.1, seconds: 1.6, who: "Yuuri", text: "the house cheats" },
      { at: 4.9, seconds: 1.4, who: "Yuuri", text: "…I'm all in", loud: true },
      { at: 6.4, seconds: 1.6, who: "Chito", text: "you have nothing left" },
      { at: 8.1, seconds: 1.5, who: "Yuuri", text: "I have one Chito", loud: true },
      { at: 9.7, seconds: 1.2, who: "", text: "(the merchandise objects)" },
      { at: 10.9, seconds: 1.6, who: "Chito", text: "I am NOT a bet!!", loud: true },
      { at: 12.9, seconds: 1.5, who: "Yuuri", text: "ow. deal's off" },
      { at: 14.4, seconds: 1.6, who: "", text: "(the house folds anyway)" },
    ],
    run(t, _dt, s) {
      const [yuuri, chito] = s.cast;

      // The players, on their crates, facing the felt — until commerce.
      if (t < 7.2 && yuuri) {
        yuuri.root.position.set(0.9, 0.05, -0.1);
        face(yuuri, Math.PI);
        pose(yuuri, "sit", 1);
        if (t >= 4.5) pose(yuuri, "reach", 0.4);
      }
      if (chito) {
        if (t < 8.4) {
          chito.root.position.set(-0.9, 0.05, -0.1);
          face(chito, Math.PI);
          pose(chito, "sit", 1);
        } else if (t < 9.4) {
          // Airborne, against her clearly stated position on the matter.
          const p = smooth(clamp01((t - 8.4) / 1.0));
          chito.root.position.set(
            mix(-0.9, -0.3, p),
            mix(0.05, 0.23, p) + Math.sin(p * Math.PI) * 0.55,
            mix(-0.1, -1.5, p),
          );
          face(chito, p * Math.PI * 2);
          pose(chito, "panic", 1, t);
        } else {
          // Displayed on the felt, item one of one.
          chito.root.position.set(-0.3, 0.23, -1.5);
          face(chito);
          pose(chito, "sit", 1);
          if (t < 11.6) pose(chito, "panic", 0.7, t);
        }
      }

      // The seller: up from her crate, around the table, hands on the goods.
      if (yuuri && t >= 7.2) {
        const walk = smooth(clamp01((t - 7.2) / 1.2));
        s.walking = walk < 1 && t < 8.4;
        yuuri.root.position.set(mix(0.9, -0.75, walk), 0, mix(-0.1, -0.55, walk));
        face(yuuri, Math.PI * (1 - walk * 0.5));
        pose(yuuri, "clear", 1);
        if (t < 9.6) pose(yuuri, "reach", clamp01((t - 7.9) / 0.5));
      }
      s.once("hoist", 8.4, () => s.sfx.whoosh());
      s.once("landed", 9.35, () => s.sfx.thud());

      // The complaint, delivered flat-handed from on top of the table.
      if (t >= 11.6 && t < 13.4) {
        smackGag(s, chito, yuuri, clamp01((t - 11.6) / 1.8));
        if (chito) pose(chito, "sit", 1);
      }
      s.once("smack", 12.25, () => s.sfx.smack());
      if (t >= 13.4 && yuuri) pose(yuuri, "hurt", 0.7);

      // The house's answer: the lamp dips, and the pot slides out of the
      // dark to the felt's edge on its own.
      s.once("verdict", 14.2, () => s.sfx.menace(1.5));
      if (t >= 14.6) {
        const slide = smooth(clamp01((t - 14.6) / 0.8));
        showCrate(s, 0.45, 1.28, mix(-3.2, -1.6, slide));
      }
      s.once("arrive", 15.35, () => s.sfx.thud());
      s.once("pop", 15.5, () => s.sfx.open());
      if (t >= 15.5) popLid(s, (t - 15.5) / 1.0);

      // Chips going over in the scuffle.
      s.once("chips", 9.4, () => s.sfx.clatter());
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

    const scenario =
      SCENARIOS.find((s2) => s2.id === options.scenario) ??
      SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
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

    /**
     * Where the speaker's head is on screen, for the line above it.
     *
     * Yuuri is the first model and Chito the second, so a name is matched by
     * its first letters rather than by keeping a second list in step. Anyone
     * behind the camera has no place on screen, and the line falls back to
     * sitting along the bottom.
     */
    const headPoint = new THREE.Vector3();
    const anchorOf = (who: string): { x: number; y: number } | null => {
      const person = /^chi/i.test(who.trim()) ? cast[1] : cast[0];
      if (!person) return null;
      const p = person.root.position;
      headPoint.set(p.x, p.y + 1.56, p.z);
      headPoint.project(camera);
      if (headPoint.z > 1) return null;
      return { x: clamp01((headPoint.x + 1) / 2), y: clamp01((1 - headPoint.y) / 2) };
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

      dialogue.update(t, anchorOf);
      renderer.render(scene, camera);

      // The pull starts against the film rather than after it, and unrolls
      // from wherever the crate happens to be on screen.
      if (!announced && elapsed >= scenario.opensAt) {
        announced = true;
        // A crate-free scenario says where its prize comes out of.
        const source = scenario.reveal
          ? new THREE.Vector3(...scenario.reveal(stage))
          : crate.position.clone();
        const point = source.project(camera);
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
