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
 * catches. Victory is the tank shot, and then the truth: both of them
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
  { at: 10.0, text: "— exam passed —" },
];

export async function mountExamStage(stage: HTMLElement): Promise<ExamStage> {
  // The caption line lives over the stage whatever renders beneath it.
  stage.innerHTML = `
    <div class="exam-chase-fallback" aria-hidden="true">
      <span class="exam-yuuri">😤</span>
      <span class="exam-chito">🏃</span>
    </div>
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
  const flash = (): void => {
    flashEl.classList.add("on");
    later(() => flashEl.classList.remove("on"), 180);
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
      say("She's coming. The tank is RIGHT THERE.", 3);
    },
    fire: () =>
      new Promise<void>((resolve) => {
        flash();
        boom();
        engine.stop();
        if (three) {
          three.playFire(resolve);
          return;
        }
        playCaptions(VICTORY_CAPTIONS);
        later(() => playCaptions(DREAM_CAPTIONS), 6500);
        later(resolve, 17500);
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

  // The emoji fallback's own little run cycle.
  const fallbackYuuri = stage.querySelector<HTMLElement>(".exam-yuuri");
  let fallbackGap = 1;
  const fallbackTick = (): void => {
    if (stopped || three || !fallbackYuuri?.isConnected) return;
    fallbackGap += (gapTarget - fallbackGap) * 0.06;
    fallbackYuuri.style.transform = `translateX(${(1 - fallbackGap) * 90}px) scale(${2.2 + (1 - fallbackGap)})`;
    requestAnimationFrame(fallbackTick);
  };
  requestAnimationFrame(fallbackTick);

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

    // The road: slabs streaming left. Everything scenery joins `world` so
    // the dream scene can strip it all at once.
    const world = new THREE.Group();
    scene.add(world);
    const slabs: any[] = [];
    for (let i = 0; i < 10; i++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 2.4), matte(0x3a3f4a, 0.9));
      slab.position.set(-7 + i * 1.6, -0.06, 0);
      world.add(slab);
      slabs.push(slab);
    }
    // A far skyline, parallaxing slower: ruins the world scrolls past.
    const skyline: any[] = [];
    for (let i = 0; i < 7; i++) {
      const h = 1 + Math.random() * 2.4;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.6), matte(0x232838, 0.95));
      tower.position.set(-8 + i * 2.6, h / 2 - 0.1, -3.4);
      world.add(tower);
      skyline.push(tower);
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
    stage.querySelector(".exam-chase-fallback")?.remove();
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

    // ---------------- the procedural events ----------------
    const EVENTS: { name: string; phases: number[]; run: (t: number) => void }[] = [
      {
        name: "building-through",
        phases: [1, 3],
        run: () => {
          // A tower scrolls in from the right, and she does not go around.
          const h = 1.6 + Math.random() * 1.2;
          const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 1.2), matte(0x4a4256, 0.9));
          tower.position.set(8, h / 2, -0.5);
          world.add(tower);
          let smashed = false;
          spawn((dt) => {
            tower.position.x -= roadSpeed() * dt;
            if (!smashed && tower.position.x < yuuri.position.x + 0.7) {
              smashed = true;
              world.remove(tower);
              crash();
              quake = Math.max(quake, 0.09);
              debris(yuuri.position.x + 0.6, h / 2, -0.5, 12, 0x4a4256);
              say("She went THROUGH it.", 1.8);
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
          say(["YUURI: WAIT.", "YUURI: I just want to TALK.", "YUURI: You have SNACKS."][Math.floor(Math.random() * 3)], 1.8);
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
          say("She tripped. GO.", 1.6);
        },
      },
      {
        name: "tunnel",
        phases: [1, 2],
        run: () => {
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
          say("AIRBORNE.", 1.3);
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
              say("YUURI: (throwing things)", 1.4);
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
          say("The engine coughs. The engine reconsiders.", 1.8);
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
          boom();
          quake = Math.max(quake, 0.12);
          debris(yuuri.position.x - 1.2, 3, -1, 14, 0x2f3442, 0.18);
          say("The bridge did not make it.", 1.8);
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
          say("CHITO: (accidental wheelie)", 1.5);
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
          say("She has stopped pretending to be tired.", 2);
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
                  crash();
                  debris(rock.position.x, 0.2, -1.5, 5, 0x774433, 0.1);
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

    let nextEventAt = 4;
    const fireEvent = (t: number): void => {
      const pool = EVENTS.filter((event) => event.phases.includes(phaseNum));
      pool[Math.floor(Math.random() * pool.length)].run(t);
      nextEventAt = t + 5 + Math.random() * 6;
    };

    // ---------------- modes and films ----------------
    type Mode =
      | { kind: "chase" }
      | { kind: "film"; name: string; start: number; done: () => void }
      | { kind: "finale"; start: number; seconds: number };
    let mode: Mode = { kind: "chase" };
    let gapNow = 1;

    const roadSpeed = (): number =>
      (phaseNum === 1 ? 3.4 : phaseNum === 2 ? 5.2 : 6.0) + (1 - gapNow) * 2.4;

    // The tank, built when the finale needs it.
    let tank: any = null;
    const buildTank = (): void => {
      tank = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.0), matte(0x3d4438, 0.8));
      hull.position.y = 0.45;
      tank.add(hull);
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.36, 10), matte(0x333a2f, 0.8));
      turret.position.y = 0.85;
      tank.add(turret);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.7, 8), matte(0x272c24, 0.6));
      barrel.rotation.z = Math.PI / 2 - 0.06;
      barrel.position.set(-0.9, 0.92, 0);
      tank.add(barrel);
      for (const wx of [-0.6, -0.2, 0.2, 0.6]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.04, 10), matte(0x1a1d18, 0.9));
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wx, 0.17, 0);
        tank.add(wheel);
      }
      tank.position.set(6.5, 0, 0.3);
      scene.add(tank);
    };

    // The dream: the world swapped for a snowy forest and two sleeping bags.
    let dream: { bags: any[]; flakes: any[] } | null = null;
    const buildDream = (): void => {
      // Strip the chase world.
      scene.remove(world);
      if (tank) scene.remove(tank);
      krad.visible = false;
      stage.classList.add("exam-dream");
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
          say("THE LAST STRETCH. Answer, and keep answering.", 2.4);
        }
      },
      playFinale(seconds) {
        mode = { kind: "finale", start: performance.now(), seconds };
        buildTank();
        engine.sputter();
        later(() => engine.stop(), 900);
        say("Out of road. The TANK. FIRE when she's close.", 3);
      },
      playFire(done) {
        mode = { kind: "film", name: "victory", start: performance.now(), done };
        playCaptions(VICTORY_CAPTIONS);
        // The shell, visibly, from barrel to Yuuri.
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 6, 6),
          new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0xffaa33, emissiveIntensity: 1 }),
        );
        shell.position.set(tank ? tank.position.x - 1.6 : 3, 0.95, 0.2);
        scene.add(shell);
        spawn((dt) => {
          shell.position.x -= 16 * dt;
          if (shell.position.x <= yuuri.position.x + 0.3) {
            scene.remove(shell);
            boom();
            flash();
            quake = 0.2;
            debris(yuuri.position.x, 1.4, 0, 16, 0x4a4256, 0.16);
            return false;
          }
          return true;
        });
        later(() => {
          buildDream();
          playCaptions(DREAM_CAPTIONS);
        }, 7000);
        later(done, 19000);
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
      stage.style.setProperty("--exam-red", redSky.toFixed(2));
      stage.style.setProperty("--exam-dark", dark.toFixed(2));

      // Transient actors always run; they carry the debris and the snow.
      for (let i = actors.length - 1; i >= 0; i--) {
        if (!actors[i](dt, t)) actors.splice(i, 1);
      }

      const stride = t * (9 + (1 - gapNow) * 4);
      const yuuriRun = (back: number): void => {
        yuuri.position.set(back, Math.abs(Math.sin(stride * 0.62)) * 0.3, -0.3);
        if (mode.kind === "chase") yuuri.rotation.z = Math.sin(stride * 0.62) * 0.06 - 0.16;
      };

      if (mode.kind === "chase" || mode.kind === "finale") {
        for (const slab of slabs) {
          slab.position.x -= roadSpeed() * dt;
          if (slab.position.x < -8) slab.position.x += 10 * 1.6;
        }
        for (const tower of skyline) {
          tower.position.x -= roadSpeed() * 0.3 * dt;
          if (tower.position.x < -9) tower.position.x += 7 * 2.6;
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
          chito.position.set(krad.position.x - 0.02, 0.36 + krad.position.y + kBob, krad.position.z);
          chito.rotation.z = -0.06 + krad.rotation.z * 0.6;
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
          chito.position.set(1.55 + sprint * 0.3, Math.abs(Math.sin(stride)) * 0.16, 0);
          chito.rotation.z = Math.sin(stride) * 0.08 - 0.1;
        }
        yuuriRun(-0.6 - gapNow * 3.4 + lunge * 0.9);
      }

      if (mode.kind === "finale") {
        const gone = (now - mode.start) / 1000;
        const closeness = Math.min(1, gone / mode.seconds);
        // She spends the countdown eating the whole gap on camera.
        yuuriRun(-4 + closeness * 4.6);
        yuuri.scale.setScalar(2.6 + closeness * 0.5);
        quake = Math.max(quake, closeness * 0.05);
        // Chito and the ride pull in next to the tank.
        if (tank) {
          tank.position.x += (3.4 - tank.position.x) * rawDt * 2;
          krad.position.x += (2.5 - krad.position.x) * rawDt * 2;
          chito.position.set(krad.position.x, 0.36, krad.position.z);
        }
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
            // Chito lies back down on her last line.
            if (dreamTime > 8.2) {
              const down = Math.min(1, (dreamTime - 8.2) / 1.4);
              chito.rotation.x = -0.25 - down * 1.1;
              chito.position.y = 0.52 - down * 0.18;
            }
            lookAngle(0.2, [0, 1.4, 4.6], [0, 0.5, 0.3]);
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
