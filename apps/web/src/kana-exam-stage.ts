import { assetUrl } from "./store.js";

/**
 * The exam's stage: giant Yuuri, small Chito, and everything that happens
 * around them for three phases of running.
 *
 * The stage is a little world that keeps itself interesting. Every few
 * seconds it fires a procedural event — a building in Yuuri's path, a
 * camera that drops to the ground or swings ahead, a lamp post batted into
 * orbit, a tunnel, snow, a thrown crate, a wheelie — drawn from a pool
 * that changes by phase. None of it touches the quiz; all of it is why you
 * look up between answers.
 *
 * Phase 2 opens with Chito finding the kettenkrad, built here out of
 * primitives in the anime's shape — front fork and wheel, tracked rear,
 * exhaust that actually puffs — with an engine made of oscillators.
 *
 * The endings are little films. Defeat picks one of six in-character
 * catches. Victory is the shot from the kettenkrad's own gun, and then
 * the truth: both of them
 * waking from the dream in sleeping bags in a snowy forest.
 *
 * Everything three.js collapses to an emoji stand-in on failure; the
 * captions still play, the promises still resolve, the exam never blocks.
 */

export interface ExamStage {
  /** 1 = a comfortable lead, 0 = teeth on collar. */
  gap(fraction: number): void;
  lunge(): void;
  burst(): void;
  /** Phase interstitials: 2 is the kettenkrad, 3 the last stretch. */
  phase(n: 2 | 3): Promise<void>;
  /** Yuuri's final approach starts, `seconds` from arrival. */
  finale(seconds: number): void;
  /** The shot. Resolves when the victory film and the dream have played. */
  fire(): Promise<void>;
  /** She got you. Resolves when the chosen defeat film ends. */
  caught(): Promise<void>;
  stop(): void;
}

interface Caption {
  at: number;
  text: string;
}

/** The six ways it can end badly, each in character. */
const DEFEATS: { name: string; captions: Caption[] }[] = [
  {
    name: "rations",
    captions: [
      { at: 0.4, text: "YUURI: Got you. And your rations." },
      { at: 2.4, text: "CHITO: Those are MY rations." },
      { at: 4.2, text: "They were." },
    ],
  },
  {
    name: "bite",
    captions: [
      { at: 0.5, text: "YUURI: *bite*" },
      { at: 1.8, text: "YUURI: ...not bread." },
      { at: 3.4, text: "CHITO: It's a helmet, Yuu." },
    ],
  },
  {
    name: "tumble",
    captions: [
      { at: 0.6, text: "She lunged. She tripped. You were underneath." },
      { at: 2.8, text: "CHITO: ...ow." },
      { at: 4.0, text: "YUURI: You're comfy." },
    ],
  },
  {
    name: "hug",
    captions: [
      { at: 0.5, text: "YUURI: Caught you. Nap time." },
      { at: 2.4, text: "CHITO: This is a TEST, Yuu." },
      { at: 4.0, text: "The test can wait." },
    ],
  },
  {
    name: "salute",
    captions: [
      { at: 0.4, text: "She stopped. She saluted." },
      { at: 2.0, text: "Then she fell on you." },
      { at: 3.9, text: "CHITO: (muffled) mmmph." },
    ],
  },
  {
    name: "wrong-way",
    captions: [
      { at: 0.5, text: "She put you on her shoulder and set off." },
      { at: 2.5, text: "CHITO: The exam is the OTHER way." },
      { at: 4.2, text: "YUURI: Food is this way." },
    ],
  },
];

const VICTORY_CAPTIONS: Caption[] = [
  { at: 0.2, text: "FIRE." },
  { at: 2.0, text: "YUURI: ow." },
  { at: 3.6, text: "CHITO: ...you okay?" },
  { at: 5.2, text: "YUURI: I saw every letter at once." },
];

const DREAM_CAPTIONS: Caption[] = [
  { at: 1.0, text: "YUURI: Chi. I had the hiragana dream again." },
  { at: 3.4, text: "CHITO: The one where you're huge?" },
  { at: 5.6, text: "YUURI: I almost caught you this time." },
  { at: 7.8, text: "CHITO: Go back to sleep, Yuu." },
  { at: 10.4, text: "CHITO: ...I thought that would really be..." },
  { at: 12.9, text: "YUURI: our last tour..." },
  { at: 15.8, text: "— exam passed —" },
];

export async function mountExamStage(stage: HTMLElement): Promise<ExamStage> {
  // The caption line lives over the stage whatever renders beneath it.
  // Until the models arrive the stage is just the winter sky — no stand-in;
  // if three.js never comes, the captions alone carry the films.
  stage.innerHTML = `
    <div class="exam-tint" aria-hidden="true"></div>
    <div class="exam-caption" id="exam-caption"></div>
    <div class="exam-flash" id="exam-flash"></div>`;
  const captionEl = stage.querySelector<HTMLDivElement>("#exam-caption")!;
  const flashEl = stage.querySelector<HTMLDivElement>("#exam-flash")!;

  let stopped = false;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!stopped) fn();
    }, ms);
    timers.add(id);
  };

  let captionHideAt = 0;
  const say = (text: string, seconds = 2.2): void => {
    captionEl.textContent = text;
    captionEl.classList.add("on");
    captionHideAt = performance.now() + seconds * 1000;
    later(() => {
      if (performance.now() >= captionHideAt - 50) captionEl.classList.remove("on");
    }, seconds * 1000);
  };
  const playCaptions = (captions: Caption[]): void => {
    for (const line of captions) later(() => say(line.text), line.at * 1000);
  };
  /** A lightening of the frame, not a whiteout. The default is a glow a
   * destruction event earns; only the gun's own muzzle goes bright. */
  const flash = (strength = 0.22): void => {
    flashEl.style.opacity = String(strength);
    flashEl.classList.add("on");
    later(() => {
      flashEl.classList.remove("on");
      flashEl.style.opacity = "0";
    }, 160);
  };

  // ---------------- sounds of the world ----------------
  // The exam's own sfx handles pings and thuds; these are the stage's:
  // collapses, the shot, the engine. Built here so the engine can idle.
  let actx: AudioContext | null = null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Ctor) actx = new Ctor();
    void actx?.resume?.().catch(() => undefined);
  } catch {
    actx = null;
  }
  const sMaster = actx ? actx.createGain() : null;
  if (actx && sMaster) {
    sMaster.gain.value = 0.3;
    sMaster.connect(actx.destination);
  }
  const noiseBuf = (() => {
    if (!actx) return null;
    const buf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  })();
  const sBurst = (duration: number, gain: number, from: number, to: number, q = 1): void => {
    if (!actx || !sMaster || !noiseBuf) return;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = actx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(from, actx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), actx.currentTime + duration);
    filter.Q.value = q;
    const g = actx.createGain();
    g.gain.setValueAtTime(gain, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + duration);
    src.connect(filter).connect(g).connect(sMaster);
    src.start();
    src.stop(actx.currentTime + duration + 0.05);
  };
  const sTone = (duration: number, gain: number, from: number, to: number, type: OscillatorType = "sine"): void => {
    if (!actx || !sMaster) return;
    const osc = actx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, actx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), actx.currentTime + duration);
    const g = actx.createGain();
    g.gain.setValueAtTime(gain, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + duration);
    osc.connect(g).connect(sMaster);
    osc.start();
    osc.stop(actx.currentTime + duration + 0.05);
  };
  const crash = (): void => {
    sBurst(0.5, 0.8, 900, 90, 0.8);
    sTone(0.4, 0.5, 120, 40);
  };
  const boom = (): void => {
    sTone(0.9, 1.0, 90, 28);
    sBurst(0.7, 0.9, 400, 60, 0.6);
  };
  const roar = (): void => {
    sTone(0.7, 0.5, 90, 180, "sawtooth");
    sBurst(0.6, 0.4, 300, 700, 2);
  };
  const screech = (): void => sBurst(0.45, 0.35, 1800, 2600, 6);
  const swoosh = (): void => sBurst(0.35, 0.4, 500, 2400, 1.4);

  /** The kettenkrad's engine: a putter that can rev, sputter and stop. */
  const engine = (() => {
    if (!actx || !sMaster) {
      return { start: () => undefined, rev: () => undefined, sputter: () => undefined, stop: () => undefined };
    }
    let osc: OscillatorNode | null = null;
    let g: GainNode | null = null;
    let lfo: OscillatorNode | null = null;
    return {
      start(): void {
        if (osc || !actx || !sMaster) return;
        osc = actx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 62;
        g = actx.createGain();
        g.gain.value = 0.0;
        // The putter: an LFO chopping the engine into strokes.
        lfo = actx.createOscillator();
        lfo.frequency.value = 13;
        const depth = actx.createGain();
        depth.gain.value = 0.05;
        lfo.connect(depth).connect(g.gain);
        osc.connect(g).connect(sMaster);
        osc.start();
        lfo.start();
        g.gain.linearRampToValueAtTime(0.11, actx.currentTime + 0.6);
      },
      rev(): void {
        if (!osc || !actx) return;
        osc.frequency.setValueAtTime(62, actx.currentTime);
        osc.frequency.linearRampToValueAtTime(105, actx.currentTime + 0.25);
        osc.frequency.linearRampToValueAtTime(70, actx.currentTime + 1.1);
      },
      sputter(): void {
        if (!g || !actx) return;
        for (let i = 0; i < 4; i++) {
          g.gain.setValueAtTime(0.02, actx.currentTime + i * 0.16);
          g.gain.setValueAtTime(0.11, actx.currentTime + i * 0.16 + 0.08);
        }
      },
      stop(): void {
        if (!osc || !g || !actx) return;
        g.gain.linearRampToValueAtTime(0.0001, actx.currentTime + 0.4);
        const dying = osc;
        const dyingLfo = lfo;
        later(() => {
          try {
            dying.stop();
            dyingLfo?.stop();
          } catch {
            /* already gone */
          }
        }, 600);
        osc = null;
        g = null;
        lfo = null;
      },
    };
  })();

  // ---------------- shared state ----------------
  let gapTarget = 1;
  let lungeLife = 0;
  let burstLife = 0;
  let phaseNum: 1 | 2 | 3 = 1;
  let riding = false;

  // Filled in by the three.js mount when it succeeds; the emoji fallback
  // provides its own timing-only behaviour until then (and forever, if the
  // models never arrive).
  let three: {
    playPhase(n: 2 | 3, done: () => void): void;
    playFinale(seconds: number): void;
    playFire(done: () => void): void;
    playCaught(script: (typeof DEFEATS)[number], done: () => void): void;
  } | null = null;

  const api: ExamStage = {
    gap: (fraction) => {
      gapTarget = Math.max(0, Math.min(1, fraction));
    },
    lunge: () => {
      lungeLife = 1;
    },
    burst: () => {
      burstLife = 1;
    },
    phase: (n) =>
      new Promise<void>((resolve) => {
        phaseNum = n;
        if (three) {
          three.playPhase(n, resolve);
          return;
        }
        // Fallback: the words still happen, over the emoji.
        if (n === 2) {
          say("CHITO: ...the kettenkrad!", 2.2);
          engine.start();
          later(() => {
            engine.rev();
            riding = true;
            say("YUURI: NO FAIR.", 1.8);
          }, 1600);
          later(resolve, 3400);
        } else {
          say("THE LAST STRETCH.", 2.0);
          roar();
          later(resolve, 2000);
        }
      }),
    finale: (seconds) => {
      if (three) {
        three.playFinale(seconds);
        return;
      }
      say("The gun. Fire when she's close.", 2.5);
    },
    fire: () =>
      new Promise<void>((resolve) => {
        flash(0.8);
        boom();
        engine.stop();
        if (three) {
          three.playFire(resolve);
          return;
        }
        playCaptions(VICTORY_CAPTIONS);
        later(() => playCaptions(DREAM_CAPTIONS), 6500);
        later(resolve, 23500);
      }),
    caught: () =>
      new Promise<void>((resolve) => {
        const script = DEFEATS[Math.floor(Math.random() * DEFEATS.length)];
        engine.stop();
        if (three) {
          three.playCaught(script, resolve);
          return;
        }
        playCaptions(script.captions);
        later(resolve, 5200);
      }),
    stop: () => {
      stopped = true;
      engine.stop();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      void actx?.close().catch(() => undefined);
    },
  };

  // ---------------- the real stage ----------------
  try {
    const THREE: any = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    if (stopped || !stage.isConnected) return api;

    const width = stage.clientWidth || 340;
    const height = stage.clientHeight || 190;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 80);
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.5);
    sun.position.set(2, 4, 3);
    scene.add(sun);

    const matte = (color: number, rough = 0.85): any =>
      new THREE.MeshStandardMaterial({ color, roughness: rough });

    /** What the stage is doing: running, playing a film, or the approach. */
    type Mode =
      | { kind: "chase" }
      | { kind: "film"; name: string; start: number; done: () => void }
      | { kind: "finale"; start: number; seconds: number };
    let mode: Mode = { kind: "chase" };

    // Winter light: everything far dissolves into the same pale distance
    // the CSS sky is painted in, which is what sells depth on a phone.
    scene.fog = new THREE.Fog(0x93a2ba, 6.5, 15);

    // Everything scenery joins `world` so the dream can strip it at once.
    const world = new THREE.Group();
    scene.add(world);

    // The road: packed snow, with tyre-worn ruts showing tarmac beneath.
    // Grounds change colour by easing toward `groundTint` (null = home),
    // so a sea or a field arrives as a wash, not a cut.
    let groundTint: any = null;
    const slabs: any[] = [];
    for (let i = 0; i < 10; i++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 2.6), matte(0xdde5ee, 1));
      slab.userData.homeColor = new THREE.Color(0xdde5ee);
      slab.position.set(-7 + i * 1.6, -0.06, 0);
      world.add(slab);
      slabs.push(slab);
      const rut = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.005, 0.14), matte(0x525a68, 0.95));
      rut.position.set(0, 0.043, 0.35);
      slab.add(rut);
      const rut2 = rut.clone();
      rut2.position.z = -0.35;
      slab.add(rut2);
    }
    // Snowbanks shoulder the road on both sides, lumpy on purpose.
    for (let i = 0; i < 14; i++) {
      const bank = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 0.4, 7, 5), matte(0xe9eff6, 1));
      bank.userData.homeColor = new THREE.Color(0xe9eff6);
      bank.scale.set(1.6, 0.5, 1);
      bank.position.set(-7 + i * 1.15, -0.12, i % 2 === 0 ? 1.5 : -1.6);
      world.add(bank);
      slabs.push(bank); // recycled with the road
    }
    // A far skyline of dead towers, snow-capped, parallaxing slower.
    const skyline: any[] = [];
    for (let i = 0; i < 8; i++) {
      const h = 1.2 + Math.random() * 2.6;
      const tower = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.6), matte(0x3e4a60, 0.95));
      body.position.y = h / 2 - 0.1;
      tower.add(body);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.09, 0.66), matte(0xe9eff6, 1));
      cap.position.y = h - 0.08;
      tower.add(cap);
      // Dark windows, the odd one faintly lit: somebody's old light.
      for (let w = 0; w < 3; w++) {
        const lit = Math.random() < 0.15;
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.16, 0.02),
          lit
            ? new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffdd66, emissiveIntensity: 0.5 })
            : matte(0x1c2230, 0.6),
        );
        win.position.set(-0.25 + w * 0.25, 0.4 + Math.random() * (h - 0.8), 0.32);
        tower.add(win);
      }
      tower.position.set(-8 + i * 2.4, 0, -3.6);
      world.add(tower);
      skyline.push(tower);
    }

    /**
     * The roadside props, one every stretch of road: the junk a dead city
     * leaves by its arteries. Each is built fresh from a small catalogue,
     * capped with snow, and recycled when it scrolls off the left edge.
     */
    const propRoster: (() => any)[] = [
      // A street lamp, upright or knocked crooked.
      () => {
        const lamp = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.7, 7), matte(0x55606e, 0.7));
        post.position.y = 0.85;
        lamp.add(post);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 7, 6), matte(0x8b95a4, 0.5));
        head.position.y = 1.72;
        lamp.add(head);
        if (Math.random() < 0.4) lamp.rotation.z = (Math.random() - 0.5) * 0.7;
        return lamp;
      },
      // A telegraph pole with its crossbar, wires long gone.
      () => {
        const pole = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 6), matte(0x4a4038, 0.9));
        post.position.y = 1.05;
        pole.add(post);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), matte(0x4a4038, 0.9));
        bar.position.y = 1.85;
        pole.add(bar);
        return pole;
      },
      // A rusted barrel, or a small stack of crates.
      () => {
        if (Math.random() < 0.5) {
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 9), matte(0x7a4a34, 0.85));
          barrel.position.y = 0.21;
          const group = new THREE.Group();
          group.add(barrel);
          return group;
        }
        const stack = new THREE.Group();
        for (let c = 0; c < 2 + Math.floor(Math.random() * 2); c++) {
          const crate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), matte(0x6e5a42, 0.85));
          crate.position.set((Math.random() - 0.5) * 0.2, 0.15 + c * 0.3, (Math.random() - 0.5) * 0.15);
          crate.rotation.y = Math.random() * 0.6;
          stack.add(crate);
        }
        return stack;
      },
      // A dead tree: a trunk and a few bare cones for branches.
      () => {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.3, 6), matte(0x3d3229, 0.95));
        trunk.position.y = 0.65;
        tree.add(trunk);
        for (let b = 0; b < 3; b++) {
          const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.04, 0.7, 5), matte(0x3d3229, 0.95));
          branch.position.set(0, 0.9 + b * 0.18, 0);
          branch.rotation.z = (b % 2 === 0 ? 1 : -1) * (0.7 + Math.random() * 0.4);
          tree.add(branch);
        }
        return tree;
      },
      // A car, dead where it stopped, half a snowdrift already.
      () => {
        const car = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.38), matte(0x5a6a74, 0.8));
        body.position.y = 0.2;
        car.add(body);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.34), matte(0x46545e, 0.8));
        cabin.position.set(-0.05, 0.4, 0);
        car.add(cabin);
        const drift = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 5), matte(0xe9eff6, 1));
        drift.scale.set(1.4, 0.5, 1);
        drift.position.set(0.25, 0.28, 0);
        car.add(drift);
        return car;
      },
      // A tank hulk, turret askew, long cold.
      () => {
        const hulk = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 0.6), matte(0x4c5548, 0.9));
        hull.position.y = 0.25;
        hulk.add(hull);
        const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.2, 9), matte(0x434c40, 0.9));
        turret.position.y = 0.5;
        turret.rotation.y = Math.random() * 2;
        hulk.add(turret);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.8, 6), matte(0x353d33, 0.7));
        barrel.rotation.z = Math.PI / 2 - 0.2 + Math.random() * 0.4;
        barrel.position.set(-0.4, 0.55, 0);
        hulk.add(barrel);
        return hulk;
      },
      // A leaning road sign nobody reads any more.
      () => {
        const sign = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), matte(0x666e7a, 0.7));
        post.position.y = 0.5;
        sign.add(post);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.02), matte(0x2e5a8a, 0.6));
        plate.position.y = 1.05;
        sign.add(plate);
        sign.rotation.z = (Math.random() - 0.5) * 0.4;
        return sign;
      },
      // A rubble pile with a snow cap.
      () => {
        const pile = new THREE.Group();
        for (let r = 0; r < 3; r++) {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.1), matte(0x5c6470, 0.95));
          rock.position.set((Math.random() - 0.5) * 0.3, 0.1 + r * 0.08, (Math.random() - 0.5) * 0.2);
          pile.add(rock);
        }
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), matte(0xe9eff6, 1));
        cap.scale.set(1.3, 0.5, 1);
        cap.position.y = 0.34;
        pile.add(cap);
        return pile;
      },
    ];
    // Named picks, straight out of the catalogue, for the sequences below.
    const [, , , buildTree, buildCar, buildHulk] = propRoster;

    const props: any[] = [];
    let nextPropAt = 0;
    /** Put one prop into the stream, in the near or the far lane. Placing
     * is chase-only: an environment still winding down during the finale
     * must not roll fresh scenery — least of all a hulk — past the gun. */
    const placeProp = (prop: any, near: boolean, xJitter = 0): void => {
      if (mode.kind !== "chase") return;
      prop.position.set(9 + xJitter, -0.02, near ? 1.35 + Math.random() * 0.4 : -1.7 - Math.random() * 1.2);
      prop.userData.parallax = near ? 1.15 : 0.75;
      if (!near) prop.scale.setScalar(0.85);
      world.add(prop);
      props.push(prop);
    };
    const spawnProp = (t: number): void => {
      nextPropAt = t + 0.5 + Math.random() * 0.9;
      placeProp(propRoster[Math.floor(Math.random() * propRoster.length)](), Math.random() < 0.45);
    };

    /**
     * Whole-world sequences — the interior, the sea, the bridge, the wreck
     * field — take the stage one at a time. Anything else in the pool can
     * still fire over them; two SEAS at once cannot.
     */
    let envUntil = 0;
    const claimEnv = (t: number, seconds: number): boolean => {
      if (t < envUntil) return false;
      envUntil = t + seconds + 0.8;
      return true;
    };

    // Snow that never stops: a recycled flock of flakes riding the wind.
    const ambientFlakes: any[] = [];
    for (let i = 0; i < 55; i++) {
      const flake = new THREE.Mesh(new THREE.SphereGeometry(0.02 + Math.random() * 0.015, 5, 5), matte(0xffffff, 0.4));
      flake.position.set(-6 + Math.random() * 14, Math.random() * 4.5, -2.5 + Math.random() * 4);
      flake.userData.fall = 0.35 + Math.random() * 0.5;
      flake.userData.sway = Math.random() * Math.PI * 2;
      world.add(flake);
      ambientFlakes.push(flake);
    }

    // ---------------- the kettenkrad ----------------
    // The anime's silhouette out of primitives: motorcycle front, tracked
    // rear, a seat for a very small person.
    const krad = new THREE.Group();
    const kBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.34), matte(0x5a5f52, 0.6));
    kBody.position.set(-0.05, 0.26, 0);
    krad.add(kBody);
    const kNose = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.26), matte(0x515646, 0.6));
    kNose.position.set(0.36, 0.24, 0);
    krad.add(kNose);
    const frontWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 14), matte(0x1c1c22, 0.8));
    frontWheel.rotation.x = Math.PI / 2;
    frontWheel.position.set(0.52, 0.13, 0);
    krad.add(frontWheel);
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.05), matte(0x3a3d33, 0.5));
    fork.position.set(0.48, 0.3, 0);
    fork.rotation.z = -0.5;
    krad.add(fork);
    const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), matte(0x2a2d26, 0.4));
    bars.rotation.x = Math.PI / 2;
    bars.position.set(0.42, 0.44, 0);
    krad.add(bars);
    const roadWheels: any[] = [frontWheel];
    for (const wx of [-0.28, -0.06, 0.14]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 12), matte(0x22242a, 0.8));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.11, 0);
      krad.add(wheel);
      roadWheels.push(wheel);
    }
    // The tread, suggested by plates above and below the road wheels.
    for (const [ty, tw] of [
      [0.005, 0.62],
      [0.225, 0.56],
    ] as [number, number][]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.03, 0.32), matte(0x14151a, 0.9));
      plate.position.set(-0.07, ty, 0);
      krad.add(plate);
    }
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), matte(0x3c3f36, 0.4));
    exhaust.rotation.z = 1.2;
    exhaust.position.set(-0.4, 0.34, 0.1);
    krad.add(exhaust);
    const headlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffdd66, emissiveIntensity: 0.4 }),
    );
    headlight.position.set(0.47, 0.35, 0);
    krad.add(headlight);
    krad.visible = false;
    krad.scale.setScalar(1.35);
    scene.add(krad);

    // ---------------- the cast ----------------
    const loader = new GLTFLoader();
    const [yuuriGltf, chitoGltf] = await Promise.all([
      loader.loadAsync(assetUrl("gacha/models/yuuri.glb")),
      loader.loadAsync(assetUrl("gacha/models/chito.glb")),
    ]);
    if (stopped || !stage.isConnected) {
      renderer.dispose();
      return api;
    }
    const yuuri = yuuriGltf.scene;
    const chito = chitoGltf.scene;
    yuuri.scale.setScalar(2.6);
    chito.scale.setScalar(0.85);
    yuuri.rotation.y = Math.PI / 2 - 0.25;
    chito.rotation.y = Math.PI / 2 + 0.15;
    scene.add(yuuri, chito);
    stage.prepend(renderer.domElement);

    // ---------------- actors, camera, events ----------------
    /** Transient things: debris, birds, snow. Update returns false to die. */
    const actors: ((dt: number, t: number) => boolean)[] = [];
    const spawn = (actor: (dt: number, t: number) => boolean): void => {
      actors.push(actor);
    };

    const debris = (x: number, y: number, z: number, count: number, color: number, size = 0.14): void => {
      for (let i = 0; i < count; i++) {
        const bit = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), matte(color, 0.9));
        bit.position.set(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.4);
        const vel = {
          x: (Math.random() - 0.2) * 3,
          y: 2 + Math.random() * 3,
          z: (Math.random() - 0.5) * 2,
        };
        const spin = { x: Math.random() * 8, z: Math.random() * 8 };
        world.add(bit);
        let life = 0;
        spawn((dt) => {
          life += dt;
          vel.y -= 9 * dt;
          bit.position.x += vel.x * dt;
          bit.position.y += vel.y * dt;
          bit.position.z += vel.z * dt;
          bit.rotation.x += spin.x * dt;
          bit.rotation.z += spin.z * dt;
          if (bit.position.y < -0.5 || life > 2.5) {
            world.remove(bit);
            return false;
          }
          return true;
        });
      }
    };

    /** Fire, smoke, debris, flash, thunder: the full send, one call. */
    const explode = (x: number, y: number, z: number, color: number, count = 14): void => {
      boom();
      flash();
      quake = Math.max(quake, 0.14);
      debris(x, y, z, count, color, 0.15);
      for (let i = 0; i < 5; i++) {
        const smoke = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 6, 5),
          new THREE.MeshStandardMaterial({ color: 0x555b66, transparent: true, opacity: 0.55, roughness: 1 }),
        );
        smoke.position.set(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.4, z);
        world.add(smoke);
        let life = 1.1 + Math.random() * 0.5;
        spawn((dt) => {
          life -= dt;
          smoke.position.y += 0.7 * dt;
          smoke.scale.setScalar(smoke.scale.x + dt * 2.4);
          (smoke.material as any).opacity = Math.max(0, life * 0.4);
          if (life <= 0) {
            world.remove(smoke);
            return false;
          }
          return true;
        });
      }
      const fire = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.9 }),
      );
      fire.position.set(x, y, z);
      world.add(fire);
      let fLife = 0.35;
      spawn((dt) => {
        fLife -= dt;
        fire.scale.setScalar(fire.scale.x + dt * 8);
        (fire.material as any).opacity = Math.max(0, fLife * 2.5);
        if (fLife <= 0) {
          world.remove(fire);
          return false;
        }
        return true;
      });
    };

    /** The camera's default seat, and temporary overrides events request. */
    const CAM_HOME = { pos: [0, 1.35, 5.4], look: [0, 1.0, 0] };
    let camOverride: { pos: number[]; look: number[]; roll: number; until: number } | null = null;
    /** Park the camera somewhere else for `seconds`. */
    const lookAngle = (seconds: number, pos: number[], look: number[], roll = 0): void => {
      camOverride = { pos, look, roll, until: performance.now() / 1000 + seconds };
    };
    let quake = 0;
    let timeScale = 1;
    let dark = 0; // tunnel / night, eased toward darkTarget
    let darkTarget = 0;
    let redSky = 0;
    let redTarget = 0;
    let lastGait = 0; // where her stride was last frame, for footfalls
    let lastThump = 0;
    let lastChitoStep = 0;
    let wind = 0.5; // sideways push on the falling snow
    let windTarget = 0.5;
    let weave = 0; // how hard the runners swing across the road
    let weaveTarget = 0;
    let sea = 0; // how underwater the light currently is
    let seaTarget = 0;
    let swim = 0; // how underwater the RUNNERS currently are
    let swimTarget = 0;

    // ---------------- the procedural events ----------------
    const EVENTS: { name: string; phases: number[]; run: (t: number) => void }[] = [
      {
        name: "building-through",
        phases: [1, 3],
        run: () => {
          // A tower scrolls in from the right, and she does not go around.
          const h = 1.6 + Math.random() * 1.2;
          const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 1.2), matte(0x46536b, 0.9));
          tower.position.set(8, h / 2, -0.5);
          world.add(tower);
          let smashed = false;
          spawn((dt) => {
            tower.position.x -= roadSpeed() * dt;
            if (!smashed && tower.position.x < yuuri.position.x + 0.7) {
              smashed = true;
              world.remove(tower);
              crash();
              explode(yuuri.position.x + 0.6, h / 2, -0.5, 0x46536b);
              return false;
            }
            return tower.position.x > -9;
          });
        },
      },
      {
        name: "lamp-post-swat",
        phases: [1, 2, 3],
        run: () => {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), matte(0x5a6070, 0.6));
          post.position.set(8, 0.9, -0.9);
          world.add(post);
          let batted = false;
          const vel = { x: 2 + Math.random() * 2, y: 5 };
          spawn((dt) => {
            if (!batted) {
              post.position.x -= roadSpeed() * dt;
              if (post.position.x < yuuri.position.x + 0.5) {
                batted = true;
                swoosh();
                sBurst(0.3, 0.4, 700, 300, 2);
              }
              return post.position.x > -9;
            }
            vel.y -= 9 * dt;
            post.position.x += vel.x * dt;
            post.position.y += vel.y * dt;
            post.rotation.z += 9 * dt;
            if (post.position.y < -1) {
              world.remove(post);
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "cam-low",
        phases: [1, 2, 3],
        run: () => lookAngle(2.8, [-1.2, 0.25, 4.2], [yuuri.position.x, 2.2, 0]),
      },
      {
        name: "cam-ahead",
        phases: [1, 2, 3],
        run: () => lookAngle(2.8, [4.6, 0.9, 1.6], [0.4, 1.0, 0]),
      },
      {
        name: "cam-overhead",
        phases: [1, 2, 3],
        run: () => lookAngle(2.6, [0.4, 5.6, 1.4], [0.2, 0, 0]),
      },
      {
        name: "cam-dutch",
        phases: [1, 2, 3],
        run: () => lookAngle(2.6, [0, 1.5, 5.0], [0, 1.0, 0], 0.22),
      },
      {
        name: "roar",
        phases: [1, 2, 3],
        run: () => {
          roar();
          quake = Math.max(quake, 0.06);
          const pulse = 1;
          let life = pulse;
          spawn((dt) => {
            life -= dt;
            yuuri.scale.setScalar(2.6 + Math.sin((pulse - life) * Math.PI) * 0.25);
            return life > 0;
          });
        },
      },
      {
        name: "birds",
        phases: [1, 2],
        run: () => {
          swoosh();
          for (let i = 0; i < 6; i++) {
            const bird = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), matte(0x15161c, 0.6));
            bird.rotation.z = -1.2;
            bird.position.set(-2 + Math.random() * 2, 0.4, -1.6);
            world.add(bird);
            const vx = 1.5 + Math.random() * 2;
            const vy = 2.2 + Math.random() * 1.8;
            spawn((dt) => {
              bird.position.x += vx * dt;
              bird.position.y += vy * dt;
              if (bird.position.y > 5) {
                world.remove(bird);
                return false;
              }
              return true;
            });
          }
        },
      },
      {
        name: "red-sky",
        phases: [1, 2, 3],
        run: () => {
          redTarget = 1;
          sTone(1.4, 0.3, 60, 45, "sawtooth");
          later(() => {
            redTarget = phaseNum === 3 ? 0.5 : 0;
          }, 5000);
        },
      },
      {
        name: "rubble-hop",
        phases: [1],
        run: () => {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), matte(0x565160, 0.95));
          rock.position.set(8, 0.12, 0.1);
          world.add(rock);
          let hopped = false;
          spawn((dt) => {
            rock.position.x -= roadSpeed() * dt;
            if (!hopped && rock.position.x < chito.position.x + 0.7) {
              hopped = true;
              burstLife = Math.max(burstLife, 1); // she springs over it
              sTone(0.25, 0.3, 300, 700, "triangle");
            }
            if (rock.position.x < -9) {
              world.remove(rock);
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "yuuri-trips",
        phases: [1, 2],
        run: () => {
          sBurst(0.4, 0.7, 300, 80, 0.8);
          quake = Math.max(quake, 0.1);
          let life = 1.4;
          spawn((dt) => {
            life -= dt;
            const roll = Math.max(0, life) / 1.4;
            yuuri.rotation.z = Math.sin((1 - roll) * Math.PI * 2) * 0.7 * roll;
            yuuri.position.y = Math.abs(Math.sin((1 - roll) * Math.PI * 3)) * 0.3 * roll;
            return life > 0;
          });
        },
      },
      {
        name: "tunnel",
        phases: [1, 2],
        run: (t) => {
          if (!claimEnv(t, 6)) return;
          darkTarget = 0.55;
          sBurst(1.2, 0.2, 200, 120, 0.5);
          later(() => {
            darkTarget = 0;
          }, 5200);
        },
      },
      {
        name: "debris-rain",
        phases: [1, 3],
        run: () => {
          crash();
          debris(2 + Math.random() * 2, 3.4, -0.8, 8, 0x3f3a4a, 0.11);
        },
      },
      {
        name: "slow-mo",
        phases: [1, 2, 3],
        run: () => {
          swoosh();
          timeScale = 0.35;
          later(() => {
            timeScale = 1;
            swoosh();
          }, 1100);
        },
      },
      {
        name: "krad-jump",
        phases: [2, 3],
        run: () => {
          engine.rev();
          swoosh();
          let life = 1.1;
          spawn((dt) => {
            life -= dt;
            const arc = Math.max(0, life) / 1.1;
            krad.position.y = Math.sin((1 - arc) * Math.PI) * 0.7;
            krad.rotation.z = Math.sin((1 - arc) * Math.PI) * 0.2;
            if (life <= 0) {
              krad.position.y = 0;
              krad.rotation.z = 0;
              sBurst(0.25, 0.5, 200, 80, 1);
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "krad-drift",
        phases: [2, 3],
        run: () => {
          screech();
          lookAngle(1.8, [2.6, 1.1, 3.6], [1.4, 0.5, 0]);
          let life = 1.4;
          spawn((dt) => {
            life -= dt;
            krad.rotation.y = Math.sin((1.4 - life) * 4) * 0.35;
            if (life <= 0) {
              krad.rotation.y = 0;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "thrown-crate",
        phases: [2, 3],
        run: () => {
          const crate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), matte(0x7a5a36, 0.8));
          crate.position.set(yuuri.position.x, 1.8, 0);
          world.add(crate);
          swoosh();
          const vx = 4.4;
          let vy = 1.8;
          spawn((dt) => {
            vy -= 9 * dt;
            crate.position.x += vx * dt;
            crate.position.y += vy * dt;
            crate.rotation.z += 7 * dt;
            if (crate.position.y < 0.1) {
              crash();
              quake = Math.max(quake, 0.05);
              debris(crate.position.x, 0.2, 0, 6, 0x7a5a36, 0.09);
              world.remove(crate);
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "engine-sputter",
        phases: [2],
        run: () => {
          engine.sputter();
          let life = 1.2;
          spawn((dt) => {
            life -= dt;
            krad.position.x = 1.55 - Math.sin((1.2 - life) * 6) * 0.12;
            if (life <= 0) {
              krad.position.x = 1.55;
              engine.rev();
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "snowfall",
        phases: [2, 3],
        run: () => {
          sBurst(1.6, 0.12, 800, 400, 0.4);
          for (let i = 0; i < 26; i++) {
            const flake = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 5), matte(0xffffff, 0.4));
            flake.position.set(-4 + Math.random() * 10, 3 + Math.random() * 2, -2 + Math.random() * 2.5);
            world.add(flake);
            const drift = 0.4 + Math.random() * 0.5;
            spawn((dt) => {
              flake.position.y -= drift * dt;
              flake.position.x -= 0.5 * dt;
              if (flake.position.y < -0.2) {
                world.remove(flake);
                return false;
              }
              return true;
            });
          }
        },
      },
      {
        name: "bridge-behind",
        phases: [2, 3],
        run: () => {
          explode(yuuri.position.x - 1.2, 2.6, -1, 0x2f3442, 16);
        },
      },
      {
        name: "wheelie",
        phases: [2],
        run: () => {
          engine.rev();
          let life = 1.2;
          spawn((dt) => {
            life -= dt;
            krad.rotation.z = Math.sin(((1.2 - life) / 1.2) * Math.PI) * 0.4;
            if (life <= 0) {
              krad.rotation.z = 0;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "berserk",
        phases: [3],
        run: () => {
          roar();
          roar();
          quake = Math.max(quake, 0.08);
          let life = 2.2;
          spawn((dt, t) => {
            life -= dt;
            yuuri.rotation.x = Math.sin(t * 22) * 0.12;
            if (life <= 0) {
              yuuri.rotation.x = 0;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "building-interior",
        phases: [1, 2],
        run: (t) => {
          // Through the wall, along a dead building's great hall, and out
          // the far side. Foreground columns strobe past between camera
          // and runners, which is what says INSIDE more than anything.
          if (!claimEnv(t, 10)) return;
          explode(3.2, 1.2, 0.6, 0x46536b, 16); // the way in
          darkTarget = 0.5;
          groundTint = new THREE.Color(0x4a443c);
          const ceiling = new THREE.Mesh(new THREE.BoxGeometry(22, 0.15, 6), matte(0x2c3140, 0.95));
          ceiling.position.set(0, 2.7, -0.5);
          world.add(ceiling);

          let life = 10;
          let nextColumn = 0;
          let nextLamp = 0.7;
          let nextFurniture = 1.4;
          spawn((dt, t2) => {
            life -= dt;

            if (t2 > nextColumn && life > 1.5) {
              nextColumn = t2 + 0.5;
              // A back wall segment with a dim window, and a fat column in
              // the foreground with a capital, both streaming.
              const wall = new THREE.Group();
              const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.8, 0.2), matte(0x333a4c, 0.95));
              panel.position.y = 1.3;
              wall.add(panel);
              const pane = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.7, 0.05),
                new THREE.MeshStandardMaterial({ color: 0x9fb4d0, emissive: 0x6a86ac, emissiveIntensity: 0.35 }),
              );
              pane.position.set((Math.random() - 0.5) * 0.6, 1.6, 0.12);
              wall.add(pane);
              placeProp(wall, false);

              const column = new THREE.Group();
              const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.7, 9), matte(0x3f4658, 0.9));
              shaft.position.y = 1.3;
              column.add(shaft);
              const capital = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), matte(0x4a5268, 0.9));
              capital.position.y = 2.6;
              column.add(capital);
              placeProp(column, true);
            }

            // Lamps hanging from the dark, swinging as the giant passes.
            if (t2 > nextLamp && life > 1.5) {
              nextLamp = t2 + 1.1;
              const lamp = new THREE.Group();
              const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.7, 4), matte(0x222, 0.6));
              cord.position.y = 2.3;
              lamp.add(cord);
              const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 8), matte(0x5a6274, 0.7));
              shade.position.y = 1.95;
              lamp.add(shade);
              const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 6, 5),
                new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd966, emissiveIntensity: 0.6 }),
              );
              bulb.position.y = 1.88;
              lamp.add(bulb);
              placeProp(lamp, false);
              const swing = lamp;
              spawn((sdt, st) => {
                swing.rotation.z = Math.sin(st * 2.4) * 0.18;
                return swing.parent !== null;
              });
            }

            // The furniture is in her way. The furniture loses.
            if (t2 > nextFurniture && life > 2) {
              nextFurniture = t2 + 1.7;
              const desk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), matte(0x6e5a42, 0.85));
              desk.position.set(9, 0.18, -0.35);
              world.add(desk);
              let smashed = false;
              spawn((ddt) => {
                desk.position.x -= roadSpeed() * ddt;
                if (!smashed && desk.position.x < yuuri.position.x + 0.6) {
                  smashed = true;
                  world.remove(desk);
                  explode(yuuri.position.x + 0.5, 0.4, -0.35, 0x6e5a42, 8);
                  return false;
                }
                if (desk.position.x < -9) {
                  world.remove(desk);
                  return false;
                }
                return true;
              });
            }

            // Dust, sinking through the lamp light.
            if (Math.random() < dt * 3) {
              const mote = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), matte(0xcfd4dd, 0.5));
              mote.position.set(-2 + Math.random() * 5, 2.2, 0.5);
              world.add(mote);
              let mLife = 2;
              spawn((mdt) => {
                mLife -= mdt;
                mote.position.y -= 0.3 * mdt;
                if (mLife <= 0) {
                  world.remove(mote);
                  return false;
                }
                return true;
              });
            }

            if (life <= 0) {
              world.remove(ceiling);
              darkTarget = 0;
              groundTint = null;
              explode(yuuri.position.x + 0.6, 1.4, -0.4, 0x333a4c, 18); // the way out
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "sea-crossing",
        phases: [1, 2, 3],
        run: (t) => {
          // The road runs out and there is simply a sea. Nobody explains.
          if (!claimEnv(t, 14)) return;
          seaTarget = 1;
          sBurst(1.0, 0.6, 300, 120, 0.6);
          say("CHITO: why is there a SEA.", 2.2);
          groundTint = new THREE.Color(0x39647e);

          // They go IN. A beat after the shore, both of them plunge, the
          // camera sinks with them, and the surface becomes a ceiling of
          // light overhead with shafts leaning down through it.
          const surface = new THREE.Mesh(
            new THREE.BoxGeometry(24, 0.05, 8),
            new THREE.MeshBasicMaterial({ color: 0xbfe7f5, transparent: true, opacity: 0.35, depthWrite: false }),
          );
          surface.position.set(0, 1.32, -0.5);
          const shafts: any[] = [];
          for (let i = 0; i < 3; i++) {
            const shaft = new THREE.Mesh(
              new THREE.ConeGeometry(0.5, 2.4, 8, 1, true),
              new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.08, depthWrite: false }),
            );
            shaft.position.set(-3 + i * 3, 0.6, -1.2);
            shaft.rotation.z = 0.15;
            shafts.push(shaft);
          }
          later(() => {
            if (stopped) return;
            sBurst(0.8, 0.7, 400, 100, 0.7); // the plunge
            swimTarget = 1;
            world.add(surface);
            for (const shaft of shafts) world.add(shaft);
          }, 900);

          // The same fish every game in this app draws: a fat ellipsoid
          // with a cone for a tail, in the fishing drill's own colours.
          const buildFish = (colour: number, size = 1): any => {
            const fish = new THREE.Group();
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.09 * size, 8, 7), matte(colour, 0.45));
            body.scale.set(1.7, 0.9, 0.8);
            fish.add(body);
            const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06 * size, 0.12 * size, 7), matte(colour, 0.45));
            tail.rotation.z = Math.PI / 2;
            tail.position.x = -0.17 * size;
            fish.add(tail);
            return fish;
          };
          const FISH_COLOURS = [0x4fd1c5, 0xf0a860, 0xe8e2d2, 0xd4508a];

          // A school keeping pace in the far lane, half out of the water,
          // wriggling as one.
          const school: any[] = [];
          for (let i = 0; i < 6; i++) {
            const swimmer = buildFish(FISH_COLOURS[i % FISH_COLOURS.length], 0.8);
            swimmer.position.set(3 + i * 0.55, 0.5, -1.2 + (i % 3) * 0.5);
            world.add(swimmer);
            school.push(swimmer);
          }

          let life = 14;
          let nextSplash = 0;
          let nextLeap = 1.2;
          let nextFloe = 0.6;
          spawn((dt, t2) => {
            life -= dt;

            // The camera rides just under the surface while they swim, and
            // hands itself back as they climb out.
            if (swim > 0.25 && life > 1.2) {
              lookAngle(0.2, [0, 0.6 + (1 - swim) * 0.75, 4.9], [0.3, 0.5 * swim + 1.0 * (1 - swim), 0]);
              surface.position.y = 1.32 + Math.sin(t2 * 1.7) * 0.03;
            }
            // The way out: surface, shake off, run on.
            if (life < 1.6 && swimTarget !== 0) {
              swimTarget = 0;
              sBurst(0.7, 0.6, 500, 150, 0.7);
              world.remove(surface);
              for (const shaft of shafts) world.remove(shaft);
            }

            // Spray off everything moving — at the surface. Underwater it
            // is bubbles, and the swim blend already makes those.
            if (t2 > nextSplash && swim < 0.5) {
              nextSplash = t2 + 0.14;
              for (const [sx, sz, big] of [
                [chito.position.x - 0.3, chito.position.z, false],
                [yuuri.position.x + 0.4, -0.2, true],
              ] as [number, number, boolean][]) {
                const drop = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.06 : 0.035, 4, 4), matte(0xbfe0ee, 0.3));
                drop.position.set(sx, 0.1, sz);
                world.add(drop);
                const vx = -1 - Math.random() * 1.5;
                let vy = 1.6 + Math.random() * (big ? 1.6 : 0.8);
                spawn((ddt) => {
                  vy -= 9 * ddt;
                  drop.position.x += vx * ddt;
                  drop.position.y += vy * ddt;
                  if (drop.position.y < 0) {
                    world.remove(drop);
                    return false;
                  }
                  return true;
                });
              }
              if (Math.random() < 0.2) sBurst(0.3, 0.25, 500, 200, 0.8);
            }

            // Fish leaping clear across the road in bright arcs, one
            // splash out and one splash back in.
            if (t2 > nextLeap && life > 2) {
              nextLeap = t2 + 0.9 + Math.random() * 1.3;
              const leaper = buildFish(FISH_COLOURS[Math.floor(Math.random() * FISH_COLOURS.length)], 1 + Math.random() * 0.6);
              const fromX = -2 + Math.random() * 5;
              leaper.position.set(fromX, 0, 0.6);
              world.add(leaper);
              sBurst(0.25, 0.3, 600, 250, 0.9);
              const vx = 1.4 + Math.random();
              let vy = 3 + Math.random() * 1.2;
              spawn((ldt) => {
                vy -= 9 * ldt;
                leaper.position.x += vx * ldt;
                leaper.position.y += vy * ldt;
                leaper.rotation.z = Math.atan2(vy, vx) * 0.5;
                if (leaper.position.y < -0.1) {
                  sBurst(0.3, 0.35, 500, 180, 0.8);
                  for (let d = 0; d < 3; d++) {
                    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 4), matte(0xbfe0ee, 0.3));
                    drop.position.copy(leaper.position);
                    drop.position.y = 0.1;
                    world.add(drop);
                    let dvy = 1.5 + Math.random();
                    spawn((ddt) => {
                      dvy -= 9 * ddt;
                      drop.position.y += dvy * ddt;
                      if (drop.position.y < 0) {
                        world.remove(drop);
                        return false;
                      }
                      return true;
                    });
                  }
                  world.remove(leaper);
                  return false;
                }
                return true;
              });
            }

            // Flotsam streaming past: ice floes, a buoy, a drowned mast.
            if (t2 > nextFloe && life > 1.5) {
              nextFloe = t2 + 0.8;
              const roll = Math.random();
              if (roll < 0.7) {
                // Overhead traffic: floes and buoys ride the ceiling of
                // light, seen from below.
                const floater = new THREE.Group();
                if (Math.random() < 0.6) {
                  const floe = new THREE.Mesh(new THREE.BoxGeometry(0.5 + Math.random() * 0.4, 0.07, 0.4), matte(0xe9f2f8, 0.9));
                  floe.rotation.y = Math.random();
                  floater.add(floe);
                } else {
                  const float = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 6), matte(0xc23b28, 0.6));
                  floater.add(float);
                }
                floater.position.set(8, 1.3, -0.8 + Math.random() * 1.4);
                world.add(floater);
                spawn((fdt) => {
                  floater.position.x -= roadSpeed() * 0.85 * fdt;
                  if (floater.position.x < -9) {
                    world.remove(floater);
                    return false;
                  }
                  return true;
                });
              } else {
                const wreck = new THREE.Group();
                const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 6), matte(0x4a4038, 0.9));
                mast.rotation.z = 0.5;
                mast.position.y = 0.5;
                wreck.add(mast);
                const spar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), matte(0x4a4038, 0.9));
                spar.position.set(-0.2, 0.9, 0);
                spar.rotation.z = 0.5;
                wreck.add(spar);
                placeProp(wreck, false);
              }
            }

            // The school swims with them, at their depth, weaving close.
            school.forEach((swimmer, i) => {
              swimmer.position.x -= roadSpeed() * 0.2 * dt;
              swimmer.position.y = 0.35 + swim * 0.15 + Math.sin(t2 * 3 + i * 1.3) * 0.18;
              swimmer.position.z = -1.2 + (i % 3) * 0.5 + Math.sin(t2 * 1.5 + i) * 0.2;
              swimmer.rotation.z = Math.sin(t2 * 8 + i) * 0.2;
              if (swimmer.position.x < -6) swimmer.position.x = 6;
            });

            if (life <= 0) {
              seaTarget = 0;
              for (const swimmer of school) world.remove(swimmer);
              groundTint = null;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "bridge-chasm",
        phases: [2, 3],
        run: (t) => {
          // A rail bridge over nothing much, complaining the whole way.
          if (!claimEnv(t, 7)) return;
          darkTarget = 0.15;
          lookAngle(3, [-1.6, 0.35, 4.6], [0.4, 1.4, 0]);
          let life = 7;
          let nextPost = 0;
          spawn((dt, t2) => {
            life -= dt;
            if (t2 > nextPost && life > 1) {
              nextPost = t2 + 0.3;
              for (const near of [true, false]) {
                const post = new THREE.Group();
                const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), matte(0x6b4f3a, 0.85));
                rail.position.y = 0.4;
                post.add(rail);
                const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), matte(0x6b4f3a, 0.85));
                beam.position.y = 0.75;
                post.add(beam);
                placeProp(post, near, near ? 0 : 0.4);
              }
              if (Math.random() < 0.25) sBurst(0.4, 0.14, 180, 90, 3); // the complaint
            }
            if (life <= 0) {
              darkTarget = 0;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "wreck-field",
        phases: [1, 3],
        run: (t) => {
          // A motorway where everyone stopped at once, years ago: wrecks
          // both sides, and the runners weave between them.
          if (!claimEnv(t, 6.5)) return;
          weaveTarget = 0.3;
          let life = 6.5;
          let nextWreck = 0;
          spawn((dt, t2) => {
            life -= dt;
            if (t2 > nextWreck && life > 1.5) {
              nextWreck = t2 + 0.45;
              placeProp(Math.random() < 0.75 ? buildCar() : buildHulk(), Math.random() < 0.5);
            }
            if (life <= 0) {
              weaveTarget = 0;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "potato-field",
        phases: [1, 2, 3],
        run: (t) => {
          // A worked field, out here: furrows, fences, a scarecrow, a
          // whole harvest — and potatoes the size the dream says they are.
          if (!claimEnv(t, 13)) return;
          say("YUURI: POTATOES.", 1.8);
          redTarget = Math.max(redTarget, 0.18); // low golden light over the field
          groundTint = new THREE.Color(0x4f3d2c);

          const buildPotato = (size: number): any => {
            const potato = new THREE.Mesh(new THREE.SphereGeometry(size, 7, 6), matte(0xb08d57, 0.95));
            potato.scale.set(1.35, 0.85, 1);
            potato.rotation.z = Math.random();
            return potato;
          };

          let life = 13;
          let nextRow = 0;
          let nextSet = 0;
          let clodTrail = 0;
          spawn((dt, t2) => {
            life -= dt;

            // The furrows: long soil mounds, leafy tops, and potatoes
            // sitting proud of the earth, big enough to argue about.
            if (t2 > nextRow && life > 1) {
              nextRow = t2 + 0.3;
              for (const near of [true, false]) {
                const furrow = new THREE.Group();
                const mound = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 1.8), matte(0x3d2f21, 1));
                mound.position.y = 0.06;
                furrow.add(mound);
                for (let plant = 0; plant < 3; plant++) {
                  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.16, 5), matte(0x3c5a2e, 0.9));
                  stem.position.set((Math.random() - 0.5) * 0.3, 0.2, -0.7 + plant * 0.7);
                  furrow.add(stem);
                  const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), matte(0x4f7a3c, 0.9));
                  leaves.scale.set(1.3, 0.7, 1.3);
                  leaves.position.set(stem.position.x, 0.3, stem.position.z);
                  furrow.add(leaves);
                }
                if (Math.random() < 0.7) {
                  const spud = buildPotato(0.11 + Math.random() * 0.05);
                  spud.position.set(0.12, 0.18, (Math.random() - 0.5) * 1.2);
                  furrow.add(spud);
                }
                placeProp(furrow, near);
              }
            }

            // Set dressing between the rows: fences, the scarecrow, sacks
            // and baskets, and now and then a heap of the harvest itself.
            if (t2 > nextSet && life > 1.5) {
              nextSet = t2 + 1.3;
              const roll = Math.random();
              if (roll < 0.3) {
                const fence = new THREE.Group();
                for (let post = 0; post < 3; post++) {
                  const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), matte(0x5c4632, 0.95));
                  upright.position.set(post * 0.5 - 0.5, 0.25, 0);
                  fence.add(upright);
                }
                const rail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.04), matte(0x5c4632, 0.95));
                rail.position.y = 0.4;
                fence.add(rail);
                placeProp(fence, Math.random() < 0.5);
              } else if (roll < 0.5) {
                // The scarecrow, doing nothing about any of this.
                const scarecrow = new THREE.Group();
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.2, 6), matte(0x5c4632, 0.95));
                pole.position.y = 0.6;
                scarecrow.add(pole);
                const arms = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), matte(0x5c4632, 0.95));
                arms.position.y = 0.95;
                scarecrow.add(arms);
                const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 7, 6), matte(0xd8c49a, 0.9));
                head.position.y = 1.25;
                scarecrow.add(head);
                const hat = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.12, 7), matte(0x8a6a3a, 0.9));
                hat.position.y = 1.38;
                scarecrow.add(hat);
                const coat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.1), matte(0x6a4a8a, 0.9));
                coat.position.y = 0.85;
                scarecrow.add(coat);
                placeProp(scarecrow, Math.random() < 0.4);
              } else if (roll < 0.75) {
                // A heap of the harvest: a mound of fat potatoes.
                const heap = new THREE.Group();
                for (let spud = 0; spud < 6; spud++) {
                  const potato = buildPotato(0.1 + Math.random() * 0.05);
                  potato.position.set((Math.random() - 0.5) * 0.4, 0.08 + (spud > 3 ? 0.14 : 0), (Math.random() - 0.5) * 0.3);
                  heap.add(potato);
                }
                placeProp(heap, Math.random() < 0.5);
              } else {
                // Sacks, tied and leaning on each other.
                const sacks = new THREE.Group();
                for (let sack = 0; sack < 2; sack++) {
                  const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.18, 4, 8), matte(0x9a835e, 0.95));
                  bag.position.set(sack * 0.25, 0.2, 0);
                  bag.rotation.z = (Math.random() - 0.5) * 0.4;
                  sacks.add(bag);
                }
                placeProp(sacks, Math.random() < 0.5);
              }
            }

            // Dirt kicked up behind both of them, the whole way through.
            clodTrail += dt;
            if (clodTrail > 0.12) {
              clodTrail = 0;
              for (const [cx, cz] of [
                [chito.position.x - 0.25, chito.position.z],
                [yuuri.position.x + 0.3, -0.2],
              ] as [number, number][]) {
                const clod = new THREE.Mesh(new THREE.DodecahedronGeometry(0.035), matte(0x3d2f21, 1));
                clod.position.set(cx, 0.12, cz);
                world.add(clod);
                const vx = -1.2 - Math.random();
                let vy = 1.4 + Math.random();
                spawn((cdt) => {
                  vy -= 9 * cdt;
                  clod.position.x += vx * cdt;
                  clod.position.y += vy * cdt;
                  clod.rotation.x += 8 * cdt;
                  if (clod.position.y < 0) {
                    world.remove(clod);
                    return false;
                  }
                  return true;
                });
              }
            }

            // Big ones come loose under her feet and sail across the sky.
            if (Math.random() < dt * 1.4) {
              const loose = buildPotato(0.12 + Math.random() * 0.06);
              loose.position.set(yuuri.position.x + 0.4, 0.25, 0.2);
              world.add(loose);
              let vy = 2.8 + Math.random() * 1.8;
              const vx = 1 + Math.random() * 2.2;
              spawn((ddt) => {
                vy -= 9 * ddt;
                loose.position.x += vx * ddt;
                loose.position.y += vy * ddt;
                loose.rotation.z += 6 * ddt;
                if (loose.position.y < 0) {
                  world.remove(loose);
                  return false;
                }
                return true;
              });
            }

            if (life <= 0) {
              redTarget = phaseNum === 3 ? 0.5 : 0;
              groundTint = null;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "dead-forest",
        phases: [1, 2],
        run: (t) => {
          // The road threads a stand of dead trees, close on both sides.
          if (!claimEnv(t, 7)) return;
          darkTarget = 0.2;
          windTarget = 1.4;
          let life = 7;
          let nextTree = 0;
          spawn((dt, t2) => {
            life -= dt;
            if (t2 > nextTree && life > 1) {
              nextTree = t2 + 0.28;
              placeProp(buildTree(), Math.random() < 0.5);
            }
            if (life <= 0) {
              darkTarget = 0;
              windTarget = 0.5;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "searchlight",
        phases: [1, 2, 3],
        run: () => {
          // A beam from somewhere in the ruins, sweeping the road once.
          const beam = new THREE.Mesh(
            new THREE.ConeGeometry(0.7, 6, 12, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xfff6cc, transparent: true, opacity: 0.14, depthWrite: false }),
          );
          beam.position.set(2, 3.2, -2.6);
          beam.rotation.z = 0.8;
          world.add(beam);
          sTone(2.4, 0.12, 220, 180, "sine");
          let life = 3;
          spawn((dt) => {
            life -= dt;
            beam.rotation.z = 0.8 - (3 - life) * 0.5;
            (beam.material as any).opacity = Math.min(0.14, life * 0.1);
            if (life <= 0) {
              world.remove(beam);
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "artillery-horizon",
        phases: [1, 2, 3],
        run: () => {
          for (let i = 0; i < 3; i++) {
            later(() => {
              if (stopped) return;
              const glow = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.5 }),
              );
              glow.position.set(-5 + Math.random() * 10, 0.6, -4.2);
              world.add(glow);
              sTone(0.9, 0.18, 60, 24);
              let life = 0.7;
              spawn((dt) => {
                life -= dt;
                glow.scale.setScalar(1 + (0.7 - life) * 2);
                (glow.material as any).opacity = Math.max(0, life * 0.7);
                if (life <= 0) {
                  world.remove(glow);
                  return false;
                }
                return true;
              });
            }, i * 900 + Math.random() * 300);
          }
        },
      },
      {
        name: "wind-gust",
        phases: [1, 2, 3],
        run: () => {
          windTarget = 3.2;
          sBurst(2.2, 0.22, 500, 900, 0.4);
          later(() => {
            windTarget = 0.5;
          }, 2600);
        },
      },
      {
        name: "sky-fish",
        phases: [1, 2],
        run: () => {
          // Something pale and enormous, swimming through the sky. Neither
          // of them has time to ask.
          const fish = new THREE.Group();
          const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), matte(0xf0f2ee, 0.4));
          body.scale.set(1.9, 0.8, 0.7);
          fish.add(body);
          const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 7), matte(0xf0f2ee, 0.4));
          tail.rotation.z = Math.PI / 2;
          tail.position.x = -1.1;
          fish.add(tail);
          fish.position.set(8, 3.6, -3);
          world.add(fish);
          spawn((dt, t2) => {
            fish.position.x -= 0.9 * dt;
            fish.position.y = 3.6 + Math.sin(t2 * 0.8) * 0.2;
            tail.rotation.y = Math.sin(t2 * 4) * 0.4;
            if (fish.position.x < -9) {
              world.remove(fish);
              return false;
            }
            return true;
          });
          say("CHITO: ...was that a fish?", 2.2);
        },
      },
      {
        name: "tower-collapse",
        phases: [2, 3],
        run: () => {
          // One of the skyline's towers gives up, on camera.
          const tower = skyline[Math.floor(Math.random() * skyline.length)];
          let life = 1.6;
          boom();
          spawn((dt) => {
            life -= dt;
            tower.rotation.z += dt * 1.1;
            tower.position.y -= dt * 0.8;
            if (life <= 0) {
              debris(tower.position.x, 0.6, -3.4, 10, 0x3e4a60, 0.2);
              crash();
              quake = Math.max(quake, 0.08);
              // Reborn off the right edge, upright, as a different building.
              tower.rotation.z = 0;
              tower.position.y = 0;
              tower.position.x = 10 + Math.random() * 3;
              return false;
            }
            return true;
          });
        },
      },
      {
        name: "night-falls",
        phases: [2, 3],
        run: () => {
          darkTarget = 0.4;
          sBurst(1.6, 0.1, 300, 150, 0.4);
          later(() => {
            darkTarget = 0;
          }, 7000);
        },
      },
      {
        name: "meteors",
        phases: [3],
        run: () => {
          for (let i = 0; i < 3; i++) {
            later(() => {
              if (stopped) return;
              const rock = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 6, 6),
                new THREE.MeshStandardMaterial({ color: 0xff8844, emissive: 0xff5522, emissiveIntensity: 0.8 }),
              );
              rock.position.set(4 + Math.random() * 3, 5, -1.5);
              world.add(rock);
              swoosh();
              spawn((dt) => {
                rock.position.x -= 6 * dt;
                rock.position.y -= 7 * dt;
                if (rock.position.y < 0) {
                  explode(rock.position.x, 0.25, -1.5, 0x774433, 8);
                  world.remove(rock);
                  return false;
                }
                return true;
              });
            }, i * 700);
          }
        },
      },
    ];

    const ENV_NAMES = new Set([
      "building-interior",
      "sea-crossing",
      "bridge-chasm",
      "wreck-field",
      "potato-field",
      "dead-forest",
      "tunnel",
    ]);
    let nextEventAt = 3;
    const fireEvent = (t: number): void => {
      const here = EVENTS.filter((event) => event.phases.includes(phaseNum));
      // When the stage is free for a whole new place, it usually takes one;
      // the small events fill the gaps between places rather than the
      // other way round.
      const wantEnv = t >= envUntil && Math.random() < 0.8;
      const pool = here.filter((event) => ENV_NAMES.has(event.name) === wantEnv);
      (pool.length > 0 ? pool : here)[Math.floor(Math.random() * (pool.length > 0 ? pool.length : here.length))].run(t);
      nextEventAt = t + 2.2 + Math.random() * 2.6;
    };

    // ---------------- modes and films ----------------
    let gapNow = 1;

    const roadSpeed = (): number =>
      (phaseNum === 1 ? 3.4 : phaseNum === 2 ? 5.2 : 6.0) + (1 - gapNow) * 2.4;

    /**
     * The finale's gun, mounted on the kettenkrad's tail and pointing back
     * the way they came — which is where she is. Built once, when the last
     * question is answered; there is no other artillery on this stage.
     */
    let kradGun: any = null;
    const mountGun = (): void => {
      if (kradGun) return;
      kradGun = new THREE.Group();
      const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8), matte(0x3a3f36, 0.7));
      pivot.position.y = 0.42;
      kradGun.add(pivot);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.9, 8), matte(0x272c24, 0.6));
      barrel.rotation.z = Math.PI / 2 - 0.12;
      barrel.position.set(-0.45, 0.5, 0);
      kradGun.add(barrel);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.3), matte(0x3a3f36, 0.8));
      shield.position.set(-0.12, 0.5, 0);
      kradGun.add(shield);
      kradGun.position.x = -0.25; // over the tail, behind the seat
      krad.add(kradGun);
    };

    // The dream: the world swapped for a snowy forest and two sleeping bags.
    let dream: { bags: any[]; flakes: any[] } | null = null;
    const buildDream = (): void => {
      // Strip the chase world.
      scene.remove(world);
      krad.visible = false;
      stage.classList.add("exam-dream");
      // Night air instead of daylight fog, so the forest keeps its dark.
      scene.fog = new THREE.Fog(0x1a2440, 7, 18);
      const snowGround = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 8), matte(0xdfe6ee, 1));
      snowGround.position.y = -0.1;
      scene.add(snowGround);
      for (let i = 0; i < 7; i++) {
        const tree = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 7), matte(0x2c4a3c, 0.9));
        tree.position.set(-4.5 + i * 1.5 + (Math.random() - 0.5), 0.7, -2.2 - Math.random());
        scene.add(tree);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.5, 7), matte(0xe8eef4, 1));
        cap.position.copy(tree.position);
        cap.position.y += 0.55;
        scene.add(cap);
      }
      // The kettenkrad, parked where they left it: real, theirs, and at
      // last the same size as everything else. The dream's gun is gone.
      if (kradGun) {
        krad.remove(kradGun);
        kradGun = null;
      }
      krad.visible = true;
      krad.position.set(-2.1, 0, -0.7);
      krad.rotation.set(0, 0.55, 0);
      const kradSnow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 5), matte(0xe8eef4, 1));
      kradSnow.scale.set(1.5, 0.4, 1);
      kradSnow.position.set(-0.05, 0.42, 0);
      krad.add(kradSnow);
      // The stars the camera is going to look up into.
      for (let i = 0; i < 44; i++) {
        const star = new THREE.Mesh(
          new THREE.SphereGeometry(0.02 + Math.random() * 0.015, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0xf2f6ff }),
        );
        star.position.set(-7 + Math.random() * 14, 3.5 + Math.random() * 5.5, -4.5 - Math.random() * 2);
        scene.add(star);
      }
      const bags: any[] = [];
      for (const [bx, color] of [
        [-0.7, 0x6a4a8a],
        [0.7, 0x8a5a4a],
      ] as [number, number][]) {
        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.9, 6, 10), matte(color, 0.8));
        bag.rotation.z = Math.PI / 2;
        bag.position.set(bx, 0.2, 0.4);
        scene.add(bag);
        bags.push(bag);
      }
      // Both of them the same size again: the giant was only ever a dream.
      yuuri.scale.setScalar(1.0);
      chito.scale.setScalar(1.0);
      yuuri.rotation.set(-1.35, 0.2, 0);
      chito.rotation.set(-1.35, -0.2, 0);
      yuuri.position.set(-0.7, 0.34, 0.42);
      chito.position.set(0.7, 0.34, 0.42);
      const flakes: any[] = [];
      for (let i = 0; i < 40; i++) {
        const flake = new THREE.Mesh(new THREE.SphereGeometry(0.02, 5, 5), matte(0xffffff, 0.3));
        flake.position.set(-5 + Math.random() * 10, Math.random() * 4, -2 + Math.random() * 3);
        scene.add(flake);
        flakes.push(flake);
      }
      dream = { bags, flakes };
    };

    three = {
      playPhase(n, done) {
        if (n === 2) {
          mode = { kind: "film", name: "kettenkrad", start: performance.now(), done };
          krad.visible = true;
          krad.position.set(8, 0, 0.35);
          say("CHITO: ...the kettenkrad!", 2.2);
        } else {
          mode = { kind: "film", name: "last-stretch", start: performance.now(), done };
          redTarget = 0.5;
          roar();
          say("THE LAST STRETCH.", 2.0);
        }
      },
      playFinale(seconds) {
        mode = { kind: "finale", start: performance.now(), seconds };
        // A clear stage: her, the ride, and the gun it just grew.
        for (const prop of props) world.remove(prop);
        props.length = 0;
        mountGun();
        engine.sputter();
        later(() => engine.stop(), 900);
        say("The gun. Fire when she's close.", 2.5);
      },
      playFire(done) {
        mode = { kind: "film", name: "victory", start: performance.now(), done };
        playCaptions(VICTORY_CAPTIONS);
        // The shell, visibly, from the kettenkrad's own barrel to Yuuri —
        // and the whole ride kicks back on the recoil.
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 6, 6),
          new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0xffaa33, emissiveIntensity: 1 }),
        );
        shell.position.set(krad.position.x - 0.8, 0.85, krad.position.z);
        scene.add(shell);
        let recoil = 0.5;
        spawn((dt) => {
          recoil -= dt;
          krad.position.x = 2.5 + Math.max(0, recoil) * 0.5;
          krad.rotation.z = Math.max(0, recoil) * 0.25;
          if (recoil <= 0) {
            krad.rotation.z = 0;
            return false;
          }
          return true;
        });
        spawn((dt) => {
          shell.position.x -= 16 * dt;
          if (shell.position.x <= yuuri.position.x + 0.3) {
            scene.remove(shell);
            boom();
            flash(0.5);
            quake = 0.2;
            explode(yuuri.position.x, 1.4, 0, 0x4a4256, 18);
            return false;
          }
          return true;
        });
        later(() => {
          buildDream();
          playCaptions(DREAM_CAPTIONS);
        }, 7000);
        // The shooting star crosses on Yuuri's line, while the camera is
        // already up among the stars.
        later(() => {
          if (stopped) return;
          const star = new THREE.Group();
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
          star.add(head);
          const trail = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.02, 0.02),
            new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.7 }),
          );
          trail.position.x = 0.5;
          star.add(trail);
          star.position.set(4.2, 8.2, -5);
          star.rotation.z = -0.45;
          scene.add(star);
          sTone(0.8, 0.06, 2400, 900, "sine");
          let life = 0.9;
          spawn((dt) => {
            life -= dt;
            star.position.x -= 7.5 * dt;
            star.position.y -= 3.6 * dt;
            (trail.material as any).opacity = Math.max(0, life * 0.8);
            if (life <= 0) {
              scene.remove(star);
              return false;
            }
            return true;
          });
        }, 7000 + 12700);
        later(done, 24500);
      },
      playCaught(script, done) {
        mode = { kind: "film", name: `caught-${script.name}`, start: performance.now(), done };
        playCaptions(script.captions);
        roar();
        later(done, 5600);
      },
    };

    // ---------------- the loop ----------------
    const start = performance.now();
    let last = start;
    const tick = (): void => {
      if (stopped || !stage.isConnected) {
        renderer.dispose();
        return;
      }
      const now = performance.now();
      const rawDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dt = rawDt * timeScale;
      const t = (now - start) / 1000;

      gapNow += (gapTarget - gapNow) * (1 - Math.exp(-rawDt * 4));
      const lunge = lungeLife > 0.01 ? Math.sin(lungeLife * Math.PI) : 0;
      const sprint = burstLife > 0.01 ? Math.sin(burstLife * Math.PI) : 0;
      lungeLife *= 0.94;
      burstLife *= 0.95;
      redSky += (redTarget - redSky) * rawDt * 2;
      dark += (darkTarget - dark) * rawDt * 2;
      wind += (windTarget - wind) * rawDt * 2;
      weave += (weaveTarget - weave) * rawDt * 2;
      sea += (seaTarget - sea) * rawDt * 2;
      swim += (swimTarget - swim) * rawDt * 2.2;
      for (const slab of slabs) {
        const mat = (slab as any).material;
        if (mat?.color && slab.userData.homeColor) {
          mat.color.lerp(groundTint ?? slab.userData.homeColor, rawDt * 1.6);
        }
      }
      stage.style.setProperty("--exam-sea", sea.toFixed(2));
      stage.style.setProperty("--exam-red", redSky.toFixed(2));
      stage.style.setProperty("--exam-dark", dark.toFixed(2));

      // Transient actors always run; they carry the debris and the snow.
      for (let i = actors.length - 1; i >= 0; i--) {
        if (!actors[i](dt, t)) actors.splice(i, 1);
      }

      const stride = t * (9 + (1 - gapNow) * 4);
      /**
       * A footfall kicks up a puff of whatever the ground currently is.
       * Cheap, and it is most of what makes the running read as weight.
       */
      const footPuff = (x: number, z: number, size: number): void => {
        const puffColor = groundTint ? groundTint.getHex() : 0xffffff;
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(size, 5, 4),
          new THREE.MeshStandardMaterial({ color: puffColor, transparent: true, opacity: 0.5, roughness: 1 }),
        );
        puff.position.set(x, 0.05, z);
        world.add(puff);
        let life = 0.45;
        spawn((pdt) => {
          life -= pdt;
          puff.position.x -= 0.8 * pdt;
          puff.position.y += 0.5 * pdt;
          puff.scale.setScalar(puff.scale.x + pdt * 3);
          (puff.material as any).opacity = Math.max(0, life);
          if (life <= 0) {
            world.remove(puff);
            return false;
          }
          return true;
        });
      };
      const yuuriRun = (back: number): void => {
        const gait = stride * 0.62;
        yuuri.position.set(back, Math.abs(Math.sin(gait)) * 0.34, -0.3);
        if (mode.kind === "chase" || mode.kind === "finale") {
          // The heavyweight's run: sway, a churn of the shoulders, and a
          // squash into every landing that stretches through the leap.
          yuuri.rotation.z = Math.sin(gait) * 0.07 - 0.18;
          yuuri.rotation.x = Math.sin(gait * 2) * 0.05;
          const crouch = Math.max(0, -Math.sin(gait * 2)) * 0.07;
          yuuri.scale.set(2.6 * (1 + crouch * 0.6), 2.6 * (1 - crouch), 2.6);
          // Each step lands: a thump you can hear and a puff you can see.
          if (Math.sin(gait) * Math.sin(lastGait) < 0) {
            footPuff(yuuri.position.x + 0.2, -0.1, 0.12);
            quake = Math.max(quake, 0.02);
            if (now - lastThump > 260) {
              lastThump = now;
              sBurst(0.16, 0.3, 130, 60, 0.9);
            }
          }
          lastGait = gait;
        }
      };

      if (mode.kind === "chase" || mode.kind === "finale") {
        for (const slab of slabs) {
          slab.position.x -= roadSpeed() * dt;
          if (slab.position.x < -8) slab.position.x += 10 * 1.6;
        }
        for (const tower of skyline) {
          tower.position.x -= roadSpeed() * 0.3 * dt;
          if (tower.position.x < -9) tower.position.x += 8 * 2.4;
        }
        // The roadside junk streams past with the road, and more arrives —
        // but not during the finale: that stage belongs to the gun, and a
        // catalogue hulk rolling past it reads as a second one.
        if (mode.kind === "chase" && t > nextPropAt) spawnProp(t);
        for (let i = props.length - 1; i >= 0; i--) {
          const prop = props[i];
          prop.position.x -= roadSpeed() * prop.userData.parallax * dt;
          if (prop.position.x < -9) {
            world.remove(prop);
            props.splice(i, 1);
          }
        }
      }

      // Snow falls through everything except the dream, which brings its own.
      if (!dream) {
        for (const flake of ambientFlakes) {
          flake.userData.sway += rawDt * 2;
          flake.position.y -= flake.userData.fall * rawDt;
          flake.position.x -= (wind + Math.sin(flake.userData.sway) * 0.3) * rawDt;
          if (flake.position.y < -0.2 || flake.position.x < -7) {
            flake.position.y = 4 + Math.random();
            flake.position.x = -4 + Math.random() * 13;
          }
        }
      }

      if (mode.kind === "chase") {
        if (t > nextEventAt) fireEvent(t);
        if (riding) {
          krad.visible = true;
          if (krad.position.x < 1.5 || krad.position.x > 1.6) {
            krad.position.x += (1.55 - krad.position.x) * dt * 3;
          }
          for (const wheel of roadWheels) wheel.rotation.z -= roadSpeed() * dt * 6;
          const kBob = Math.sin(t * 18) * 0.015;
          krad.position.z = 0.35 + Math.sin(t * 2.6) * weave;
          chito.position.set(krad.position.x - 0.02, 0.36 + krad.position.y + kBob, krad.position.z);
          // Leant into the bars, and further into it the faster it goes.
          chito.rotation.z = -0.1 - (1 - gapNow) * 0.08 + krad.rotation.z * 0.6;
          chito.scale.set(0.85, 0.85, 0.85);
          // Exhaust, puffing in time with the putter.
          if (Math.floor(t * 6) !== Math.floor((t - dt) * 6)) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), matte(0x99a, 0.5));
            puff.position.set(krad.position.x - 0.55, 0.4, 0.12);
            world.add(puff);
            let life = 0.7;
            spawn((pdt) => {
              life -= pdt;
              puff.position.x -= 1.4 * pdt;
              puff.position.y += 0.7 * pdt;
              puff.scale.setScalar(1 + (0.7 - life) * 2);
              if (life <= 0) {
                world.remove(puff);
                return false;
              }
              return true;
            });
          }
        } else {
          chito.position.set(1.55 + sprint * 0.3, Math.abs(Math.sin(stride)) * 0.16, Math.sin(t * 2.6) * weave);
          chito.rotation.z = Math.sin(stride) * 0.08 - 0.12;
          // Squash into the landing, stretch through the leap, and every
          // few seconds a glance back over the shoulder at the problem.
          const crouch = Math.max(0, -Math.sin(stride * 2)) * 0.08;
          chito.scale.set(0.85 * (1 + crouch * 0.5), 0.85 * (1 - crouch), 0.85);
          const glance = Math.max(0, Math.sin(t * 0.55) - 0.94) / 0.06;
          chito.rotation.y = Math.PI / 2 + 0.15 - glance * 1.0;
          if (Math.sin(stride) * Math.sin(lastChitoStep) < 0) footPuff(chito.position.x - 0.1, chito.position.z, 0.05);
          lastChitoStep = stride;
        }
        yuuriRun(-0.6 - gapNow * 3.4 + lunge * 0.9);
        yuuri.position.z = -0.3 + Math.sin(t * 2.6 + 1.2) * weave * 0.7;

        // Under the sea, running becomes swimming: both of them prone,
        // kicking, trailing bubbles, the ride sinking gently with them.
        if (swim > 0.01) {
          const bob = Math.sin(t * 2.1);
          chito.position.y = chito.position.y * (1 - swim) + (0.52 + bob * 0.06) * swim;
          chito.rotation.z = chito.rotation.z * (1 - swim) + (0.95 + Math.sin(t * 3.4) * 0.22) * swim * -1;
          yuuri.position.y = yuuri.position.y * (1 - swim) + (0.6 + Math.sin(t * 2.1 + 1) * 0.1) * swim;
          yuuri.rotation.z = yuuri.rotation.z * (1 - swim) + (0.85 + Math.sin(t * 2.7 + 0.5) * 0.28) * swim * -1;
          if (riding) krad.position.y = krad.position.y * (1 - swim) + (0.15 + bob * 0.05) * swim;
          if (Math.random() < rawDt * 8) {
            const from = Math.random() < 0.5 ? chito : yuuri;
            const bubble = new THREE.Mesh(
              new THREE.SphereGeometry(0.025 + Math.random() * 0.02, 5, 4),
              new THREE.MeshStandardMaterial({ color: 0xcfeaf5, transparent: true, opacity: 0.6, roughness: 0.3 }),
            );
            bubble.position.set(from.position.x + 0.2, from.position.y + 0.2, from.position.z);
            world.add(bubble);
            spawn((bdt) => {
              bubble.position.y += 0.8 * bdt;
              bubble.position.x += Math.sin(bubble.position.y * 8) * 0.1 * bdt;
              if (bubble.position.y > 1.5) {
                world.remove(bubble);
                return false;
              }
              return true;
            });
          }
        }
      }

      if (mode.kind === "finale") {
        const gone = (now - mode.start) / 1000;
        const closeness = Math.min(1, gone / mode.seconds);
        // She spends the countdown eating the whole gap on camera.
        yuuriRun(-4 + closeness * 4.6);
        yuuri.scale.setScalar(2.6 + closeness * 0.5);
        quake = Math.max(quake, closeness * 0.05);
        // The ride pulls over hard right and swings side-on, so the gun
        // on its tail faces down the road at what is coming.
        krad.position.x += (2.5 - krad.position.x) * rawDt * 2;
        krad.position.y = 0;
        chito.position.set(krad.position.x, 0.36, krad.position.z);
        chito.rotation.z = -0.06;
      }

      if (mode.kind === "film") {
        const gone = (now - mode.start) / 1000;
        const name = mode.name;
        if (name === "kettenkrad") {
          // It scrolls in, she hops on, the engine catches, and go.
          krad.position.x += (1.55 - krad.position.x) * rawDt * 2.2;
          yuuriRun(-4.4);
          if (gone < 1.2) {
            chito.position.set(1.55, Math.abs(Math.sin(stride)) * 0.16, 0);
          } else if (gone < 1.9) {
            const hop = (gone - 1.2) / 0.7;
            chito.position.set(1.55, 0.36 * hop + Math.sin(hop * Math.PI) * 0.4, 0);
            if (!riding) {
              riding = true;
              engine.start();
              later(() => engine.rev(), 500);
            }
          } else {
            chito.position.set(1.55, 0.36, 0);
          }
          if (gone > 2.2 && gone < 2.3) say("YUURI: NO FAIR.", 1.6);
          lookAngle(0.2, [2.2, 0.8, 3.2], [1.55, 0.4, 0]);
          if (gone > 3.6) {
            camOverride = null;
            mode.done();
            mode = { kind: "chase" };
            nextEventAt = t + 3;
          }
        } else if (name === "last-stretch") {
          yuuriRun(-0.6 - gapNow * 3.4);
          lookAngle(0.2, [-2.4, 2.6, 4.6], [0, 1.4, 0], 0.12);
          if (gone > 2.2) {
            camOverride = null;
            mode.done();
            mode = { kind: "chase" };
            nextEventAt = t + 2.5;
          }
        } else if (name === "victory") {
          if (!dream) {
            // Blown flat: she spins back, lands, and stays there.
            const knock = Math.min(1, gone / 1.2);
            yuuri.position.x = -1 - knock * 2.4;
            yuuri.position.y = Math.sin(knock * Math.PI) * 1.6;
            yuuri.rotation.z = knock * Math.PI * 1.5;
            if (gone > 2 && gone < 5) {
              // Chito rolls up to look at her.
              krad.position.x += (yuuri.position.x + 1.6 - krad.position.x) * rawDt * 1.2;
              chito.position.set(krad.position.x, 0.36, krad.position.z);
            }
          } else {
            // The dream: snow falls, and at the right lines they sit up.
            for (const flake of dream.flakes) {
              flake.position.y -= rawDt * (0.25 + (flake.position.x % 0.3));
              if (flake.position.y < 0) flake.position.y = 4;
            }
            const dreamTime = gone - 7;
            const situp = (who: any, at: number): void => {
              const rise = Math.max(0, Math.min(1, (dreamTime - at) / 1.2));
              who.rotation.x = -1.35 + rise * 1.1;
              who.position.y = 0.34 + rise * 0.18;
            };
            situp(yuuri, 0.8);
            situp(chito, 2.6);
            // Yuuri settles back down alongside, before the stars.
            if (dreamTime > 9.0) {
              const down = Math.min(1, (dreamTime - 9.0) / 1.6);
              yuuri.rotation.x = -0.25 - down * 1.1;
              yuuri.position.y = 0.52 - down * 0.18;
            }
            // Chito lies back down, and from there they are both looking
            // up — so the camera goes where they are looking: the stars.
            if (dreamTime > 8.2) {
              const down = Math.min(1, (dreamTime - 8.2) / 1.4);
              chito.rotation.x = -0.25 - down * 1.1;
              chito.position.y = 0.52 - down * 0.18;
            }
            if (dreamTime > 10.8) {
              const up = Math.min(1, (dreamTime - 10.8) / 2.2);
              lookAngle(0.2, [0, 1.4 + up * 0.5, 4.6], [0, 0.5 + up * 5.5, 0.3 - up * 3.5]);
            } else {
              lookAngle(0.2, [0, 1.4, 4.6], [0, 0.5, 0.3]);
            }
          }
        } else if (name.startsWith("caught-")) {
          const which = name.slice(7);
          const e = Math.min(1, gone / 1.0);
          // She closes the last of the distance in every version.
          yuuri.position.x = -1.6 + e * (chito.position.x - 1.2);
          yuuri.position.y = Math.abs(Math.sin(stride * 0.62)) * 0.3 * (1 - e);
          if (which === "rations" || which === "bite" || which === "hug") {
            if (gone > 1) {
              // Chito, lifted: held up in front of the enormous face.
              const held = Math.min(1, gone - 1);
              chito.position.set(yuuri.position.x + 1.0, 0.4 + held * 1.2, 0.2);
              chito.rotation.z = Math.sin(gone * 6) * 0.15;
              if (which === "hug" && gone > 2.2) {
                yuuri.scale.setScalar(2.6 + Math.sin((gone - 2.2) * 8) * 0.08);
              }
              if (which === "bite" && gone > 1.6 && gone < 1.7) sBurst(0.2, 0.5, 200, 90, 1);
            }
          } else if (which === "tumble") {
            const roll = Math.min(1, gone / 2);
            yuuri.rotation.z = roll * Math.PI;
            yuuri.position.y = Math.sin(roll * Math.PI) * 0.8;
            chito.rotation.z = roll * Math.PI * 2;
            chito.position.x = 1.55 + roll * 0.8;
            if (gone > 1.9 && gone < 2.0) crash();
          } else if (which === "salute") {
            if (gone < 2) {
              yuuri.rotation.z = 0;
              yuuri.position.y = 0;
              yuuri.rotation.x = -0.1; // bolt upright
            } else {
              const fall = Math.min(1, (gone - 2) / 1.2);
              yuuri.rotation.x = -0.1 + fall * (Math.PI / 2 - 0.1);
              yuuri.position.y = fall * -0.2;
              if (gone > 3.1 && gone < 3.2) {
                boom();
                quake = 0.15;
              }
            }
          } else if (which === "wrong-way") {
            if (gone > 1.4) {
              const walk = gone - 1.4;
              yuuri.rotation.y = -Math.PI / 2; // turned round
              yuuri.position.x += rawDt * 0.8;
              chito.position.set(yuuri.position.x + 0.3, 2.2 + Math.sin(walk * 4) * 0.08, 0.1);
            }
          }
          lookAngle(0.2, [0.6, 1.2, 4.4], [yuuri.position.x + 0.8, 1.2, 0]);
        }
      }

      // The camera: home, or wherever an event has parked it.
      quake *= 0.94;
      const seat = camOverride && now / 1000 < camOverride.until ? camOverride : null;
      const goal = seat ?? { pos: CAM_HOME.pos, look: CAM_HOME.look, roll: 0 };
      camera.position.x += (goal.pos[0] - camera.position.x) * rawDt * 5 + (Math.random() - 0.5) * quake;
      camera.position.y += (goal.pos[1] - camera.position.y) * rawDt * 5 + (Math.random() - 0.5) * quake;
      camera.position.z += (goal.pos[2] - camera.position.z) * rawDt * 5;
      camera.lookAt(goal.look[0], goal.look[1], goal.look[2]);
      camera.rotation.z += goal.roll ?? 0;

      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch {
    // The emoji chase carries the exam alone.
  }
  return api;
}
