import { assetUrl } from "./store.js";
import { createSfx, type Sfx } from "./gacha-audio.js";

/**
 * The cutscene a crate opening starts with.
 *
 * A dead city under snow, two figures, and a supply crate that arrives by
 * some means neither of them deserved. There are several of those means and
 * one is picked at random, so opening forty crates is not watching the same
 * film forty times.
 *
 * Everything except the two characters is built in code — the ruins are
 * boxes, the snow is points, the fog does most of the work, the sound is
 * oscillators — so the whole thing costs two small model files and nothing
 * else. Both characters load from `public/gacha/models/`, and replacing
 * either is dropping a different .glb in with the same name.
 *
 * three.js is a large library nobody who only reviews cards should pay for,
 * so it is imported here and this module is only imported when a pull
 * actually starts. If any of it fails — no WebGL, a model that will not
 * load, a device that would rather not — `done` resolves immediately and the
 * roll happens without a film.
 */

const MODELS = ["gacha/models/yuuri.glb", "gacha/models/chito.glb"];

export interface Cutscene {
  done: Promise<void>;
  stop: () => void;
  /** Which scenario was drawn, for the caption under the picture. */
  name: Promise<string>;
}

export function playCutscene(host: HTMLElement): Cutscene {
  let stop = (): void => undefined;
  let tellName: (name: string) => void = () => undefined;
  const name = new Promise<string>((resolve) => {
    tellName = resolve;
  });

  const done = new Promise<void>((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      tellName("");
      resolve();
    };
    stop = finish;

    void build(host, finish, tellName).then((teardown) => {
      const previous = stop;
      stop = () => {
        teardown();
        previous();
      };
      if (finished) teardown();
    });
  });
  return { done, stop, name };
}

// ---------------- the stage everything is played on ----------------

interface Walker {
  root: any;
  mixer: any;
  action: any;
  /** Where this one stands when the walk in is over. */
  homeX: number;
}

interface Stage {
  THREE: any;
  camera: any;
  sfx: Sfx;
  /** yuuri first, chito second — whoever loaded. May be shorter than two. */
  cast: Walker[];
  crate: any;
  lid: any;
  /** Spares, hidden until a scenario wants a sky full of them. */
  spares: any[];
  /** Fire `fn` the first time the clock passes `at`. */
  once: (key: string, at: number, fn: () => void) => void;
  /** True while the walk cycle should be running. */
  walking: boolean;
}

interface Scenario {
  id: string;
  /** Shown under the picture while it plays. */
  name: string;
  seconds: number;
  run: (t: number, dt: number, s: Stage) => void;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Overshoot and settle — for anything that lands or snaps into place. */
const spring = (t: number): number =>
  t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 13);

/** The shared opening: two figures coming out of the fog. */
function walkIn(s: Stage, t: number, seconds: number, from = -26): number {
  const walk = clamp01(t / seconds);
  s.walking = walk < 1;
  s.cast.forEach((person, i) => {
    const to = -0.2 - i * 0.35;
    person.root.position.z = from - i * 1.5 + (to - (from - i * 1.5)) * smooth(walk);
    person.root.position.x = person.homeX;
    person.root.rotation.set(0, Math.PI, 0);
  });
  // A crunch per footfall, roughly.
  for (let n = 0; n < Math.floor(walk * seconds * 2.4); n++) {
    s.once(`step${n}`, (n / 2.4) * 1, () => s.sfx.step());
  }
  return walk;
}

function placeCrate(s: Stage, x: number, y: number, z: number): void {
  s.crate.visible = true;
  s.crate.position.set(x, y, z);
}

/** The lid coming off, however it was persuaded. */
function popLid(s: Stage, p: number): void {
  const open = smooth(clamp01(p));
  s.lid.position.y = 0.43 + open * 1.9;
  s.lid.rotation.z = open * 1.4;
  s.lid.rotation.x = open * 0.8;
}

// ---------------- the scenarios ----------------

const SCENARIOS: Scenario[] = [
  {
    id: "airdrop",
    name: "Unscheduled delivery",
    seconds: 14.5,
    run(t, _dt, s) {
      const [victim, other] = s.cast;
      walkIn(s, t, 6.4);

      if (t > 6.4 && victim) {
        // A moment of nothing, which is the whole joke.
        s.once("look", 6.9, () => other && (other.root.rotation.y = Math.PI - 0.4));
      }
      s.once("whistle", 8.2, () => s.sfx.falling(1.5));
      if (t >= 8.2 && victim) {
        const fall = clamp01((t - 8.2) / 1.5);
        placeCrate(s, victim.root.position.x, 13 - 12.6 * fall * fall, victim.root.position.z);
        s.crate.rotation.y = fall * 4;
      }
      s.once("impact", 9.7, () => s.sfx.thud());
      if (t >= 9.7 && victim) {
        const down = clamp01((t - 9.7) / 0.4);
        victim.root.rotation.x = -smooth(down) * 1.5;
        victim.root.position.y = -0.05 * smooth(down);
        if (other) other.root.rotation.y = Math.PI + smooth(down) * 0.7;
      }
      // The other one wanders over and gives it a poke.
      if (t >= 10.4 && other && victim) {
        const walk = clamp01((t - 10.4) / 1.5);
        other.root.position.x = other.homeX + (victim.root.position.x + 0.75 - other.homeX) * smooth(walk);
      }
      s.once("poke", 12.0, () => s.sfx.creak());
      s.once("pop", 12.6, () => s.sfx.open());
      if (t >= 12.6) popLid(s, (t - 12.6) / 1.5);
    },
  },

  {
    id: "kick",
    name: "Percussive maintenance",
    seconds: 16,
    run(t, _dt, s) {
      const [kicker, other] = s.cast;
      walkIn(s, t, 5.6);
      // It was already here, half buried, before either of them arrived.
      placeCrate(s, 0, 0.3, -1.2);

      // Three kicks, each more committed than the last.
      const kicks = [
        { at: 6.4, who: kicker, lift: 0.1 },
        { at: 8.0, who: other, lift: 0.14 },
        { at: 9.6, who: kicker, lift: 0.2 },
      ];
      kicks.forEach((kick, i) => {
        s.once(`kick${i}`, kick.at, () => (i < 2 ? s.sfx.thud() : s.sfx.boing()));
        if (kick.who && t >= kick.at - 0.5 && t < kick.at + 0.7) {
          const lean = Math.sin(clamp01((t - (kick.at - 0.5)) / 1.2) * Math.PI);
          kick.who.root.rotation.x = -lean * kick.lift * 3;
          kick.who.root.position.z = (kick.who === kicker ? -0.2 : -0.55) - lean * 0.5;
        }
      });

      // The third one works. Rather too well.
      if (t >= 9.6 && t < 12.4) {
        const up = (t - 9.6) / 2.8;
        // Straight up, out of frame, and a long silence while it is gone.
        placeCrate(s, 0, 0.3 + Math.sin(up * Math.PI) * 22, -1.2);
        s.crate.rotation.set(up * 9, up * 6, up * 4);
      }
      s.once("gone", 10.4, () => s.sfx.whoosh());
      s.once("coming", 11.6, () => s.sfx.falling(0.8));
      s.once("land", 12.4, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 12.4) {
        // Lands dead flat, as if nothing had happened.
        placeCrate(s, 0, 0.36 * spring(clamp01((t - 12.4) / 0.9)), -1.2);
        s.crate.rotation.set(0, 0, 0);
        if (kicker) kicker.root.rotation.y = Math.PI - 0.3;
        if (other) other.root.rotation.y = Math.PI + 0.3;
      }
      s.once("pop", 14.0, () => s.sfx.open());
      if (t >= 14.0) popLid(s, (t - 14.0) / 1.6);
    },
  },

  {
    id: "tug",
    name: "A disagreement",
    seconds: 15,
    run(t, _dt, s) {
      const [left, right] = s.cast;
      walkIn(s, t, 5.2);
      placeCrate(s, 0, 0.36, -1.1);

      // Both take a side and pull. It does not care.
      if (t >= 5.8 && t < 11.4) {
        const pull = t - 5.8;
        const heave = Math.sin(pull * 3.4);
        if (left) {
          left.root.position.x = -0.95 - Math.max(0, heave) * 0.35;
          left.root.rotation.y = Math.PI + 0.5;
          left.root.rotation.z = heave * 0.16;
        }
        if (right) {
          right.root.position.x = 0.95 + Math.max(0, -heave) * 0.35;
          right.root.rotation.y = Math.PI - 0.5;
          right.root.rotation.z = heave * 0.16;
        }
        // The crate rocks a few degrees and no more.
        s.crate.rotation.z = heave * 0.05;
        for (let n = 0; n < 6; n++) s.once(`strain${n}`, 6.2 + n * 0.85, () => s.sfx.creak());
      }

      // They give up and sit down in the snow.
      if (t >= 11.4) {
        const give = clamp01((t - 11.4) / 0.8);
        s.crate.rotation.z = 0;
        for (const person of [left, right]) {
          if (!person) continue;
          person.root.rotation.x = -smooth(give) * 0.9;
          person.root.position.y = -0.28 * smooth(give);
          person.root.rotation.z = 0;
        }
        s.once("flop", 11.5, () => s.sfx.step());
      }
      // At which point it opens by itself.
      s.once("sigh", 12.8, () => s.sfx.creak());
      s.once("pop", 13.2, () => s.sfx.open());
      if (t >= 13.2) popLid(s, (t - 13.2) / 1.5);
    },
  },

  {
    id: "bowling",
    name: "Right of way",
    seconds: 15.5,
    run(t, _dt, s) {
      const [a, b] = s.cast;
      walkIn(s, t, 5.4);

      // Something is coming, from the left, fast, and nobody has noticed.
      s.once("rumble", 6.0, () => s.sfx.whoosh());
      if (t >= 6.0 && t < 7.6) {
        const roll = (t - 6.0) / 1.6;
        placeCrate(s, -12 + 24 * roll, 0.4, -0.6);
        s.crate.rotation.z = -roll * 26;
      }
      // It goes straight through both of them.
      s.once("strike", 6.85, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 6.85) {
        const spun = clamp01((t - 6.85) / 1.1);
        if (a) {
          a.root.rotation.y = Math.PI + smooth(spun) * 7;
          a.root.rotation.x = -smooth(spun) * 1.3;
          a.root.position.y = -0.05 * smooth(spun);
        }
        if (b) {
          b.root.rotation.y = Math.PI - smooth(spun) * 6;
          b.root.rotation.x = -smooth(spun) * 1.1;
          b.root.position.y = -0.05 * smooth(spun);
        }
      }
      // Off into the fog, a distant crash, and then it comes back.
      s.once("crash", 8.4, () => {
        s.sfx.thud();
        s.sfx.clatter();
      });
      if (t >= 8.4 && t < 11.2) {
        const back = (t - 8.4) / 2.8;
        placeCrate(s, 12 - 12 * smooth(back), 0.4, -0.6);
        s.crate.rotation.z = back * 14;
      }
      s.once("settle", 11.2, () => s.sfx.thud());
      if (t >= 11.2) {
        placeCrate(s, 0, 0.36, -0.6);
        s.crate.rotation.set(0, 0, 0);
        // They sit up and stare at it.
        const up = clamp01((t - 11.6) / 1.2);
        for (const person of [a, b]) {
          if (!person) continue;
          person.root.rotation.x = -1.2 * (1 - smooth(up));
          person.root.rotation.y = Math.PI;
          person.root.position.y = -0.05 * (1 - smooth(up));
        }
      }
      s.once("pop", 13.6, () => s.sfx.open());
      if (t >= 13.6) popLid(s, (t - 13.6) / 1.5);
    },
  },

  {
    id: "hail",
    name: "Adverse weather",
    seconds: 16,
    run(t, _dt, s) {
      const [a, b] = s.cast;
      walkIn(s, t, 5.0);

      // The sky opens. None of them are the one.
      const RAIN = s.spares.length;
      for (let i = 0; i < RAIN; i++) {
        const at = 5.8 + i * 0.42;
        const box = s.spares[i];
        s.once(`hail${i}`, at, () => s.sfx.falling(0.6));
        s.once(`hit${i}`, at + 0.6, () => s.sfx.thud());
        if (t >= at) {
          const fall = clamp01((t - at) / 0.6);
          const x = (i % 2 === 0 ? -1 : 1) * (1.4 + (i % 3) * 0.9);
          const z = -2.4 + (i % 4) * 0.7;
          box.visible = true;
          box.position.set(x, Math.max(0.34, 14 - 14 * fall * fall), z);
          box.rotation.set(fall * 5, fall * 3 + i, 0);
          // Sinks out of sight into the snow, so the ground never fills up.
          if (t > at + 1.4) box.position.y = 0.34 - Math.min(0.8, (t - at - 1.4) * 0.9);
          if (t > at + 2.4) box.visible = false;
        }
      }
      // They dodge, badly, the whole way through.
      if (t >= 5.6 && t < 12.4) {
        const panic = t - 5.6;
        if (a) {
          a.root.position.x = a.homeX + Math.sin(panic * 4.1) * 0.6;
          a.root.rotation.y = Math.PI + Math.sin(panic * 4.1) * 0.5;
        }
        if (b) {
          b.root.position.x = b.homeX + Math.sin(panic * 3.3 + 1.6) * 0.6;
          b.root.rotation.y = Math.PI + Math.sin(panic * 3.3 + 1.6) * 0.5;
        }
        s.walking = true;
      }

      // Then one lands between them, gently, right way up.
      s.once("last", 12.6, () => s.sfx.falling(1.1));
      if (t >= 12.6 && t < 13.7) {
        const fall = clamp01((t - 12.6) / 1.1);
        placeCrate(s, 0, 9 - 8.64 * smooth(fall), -1.0);
        s.crate.rotation.y = fall * 2;
      }
      s.once("gentle", 13.7, () => s.sfx.creak());
      if (t >= 13.7) {
        placeCrate(s, 0, 0.36, -1.0);
        s.crate.rotation.set(0, 0, 0);
        if (a) {
          a.root.position.x = -0.7;
          a.root.rotation.y = Math.PI;
        }
        if (b) {
          b.root.position.x = 0.7;
          b.root.rotation.y = Math.PI;
        }
        s.walking = false;
      }
      s.once("pop", 14.4, () => s.sfx.open());
      if (t >= 14.4) popLid(s, (t - 14.4) / 1.4);
    },
  },
];

// ---------------- building it ----------------

async function build(
  host: HTMLElement,
  finish: () => void,
  tellName: (name: string) => void,
): Promise<() => void> {
  let cleanup = (): void => undefined;
  const sfx = createSfx();
  try {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // The fog IS the environment: it hides where the city stops, it makes
    // the figures arrive rather than simply be there, and it means the whole
    // thing can be a few dozen boxes without ever looking like it.
    const SKY = 0xb9c2cc;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.FogExp2(SKY, 0.055);

    const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 200);
    camera.position.set(0, 1.55, 6.4);

    scene.add(new THREE.HemisphereLight(0xdfe7ef, 0x5a6270, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.1);
    sun.position.set(-6, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Ruins read as ruins from silhouette alone at this distance, so they are
    // boxes: leaning, snow-capped, dark against the fog, never in the middle.
    const concrete = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.95 });
    const snowcap = new THREE.MeshStandardMaterial({ color: 0xdde4ea, roughness: 1 });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 54; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (2.6 + Math.random() * 13);
      const z = -2 - Math.random() * 34;
      const w = 1.4 + Math.random() * 3.4;
      const d = 1.4 + Math.random() * 3.4;
      const h = 2 + Math.random() * 13;

      const tower = new THREE.Mesh(boxGeo, concrete);
      tower.scale.set(w, h, d);
      tower.position.set(x, h / 2, z);
      tower.rotation.y = Math.random() * Math.PI;
      if (Math.random() < 0.22) tower.rotation.z = (Math.random() - 0.5) * 0.3;
      tower.castShadow = true;
      tower.receiveShadow = true;
      scene.add(tower);

      const cap = new THREE.Mesh(boxGeo, snowcap);
      cap.scale.set(w * 1.02, 0.18, d * 1.02);
      cap.position.set(x, h + 0.09, z);
      cap.rotation.copy(tower.rotation);
      scene.add(cap);
    }

    // ---- snow ----
    const FLAKES = 1400;
    const flakePos = new Float32Array(FLAKES * 3);
    const flakeFall = new Float32Array(FLAKES);
    const flakeDrift = new Float32Array(FLAKES);
    for (let i = 0; i < FLAKES; i++) {
      flakePos[i * 3] = (Math.random() - 0.5) * 34;
      flakePos[i * 3 + 1] = Math.random() * 16;
      flakePos[i * 3 + 2] = -32 + Math.random() * 42;
      flakeFall[i] = 0.5 + Math.random() * 1.1;
      flakeDrift[i] = (Math.random() - 0.5) * 0.5;
    }
    const flakeGeo = new THREE.BufferGeometry();
    flakeGeo.setAttribute("position", new THREE.BufferAttribute(flakePos, 3));
    const snow = new THREE.Points(
      flakeGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.085, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    scene.add(snow);

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
    const loader = new GLTFLoader();
    const loaded = await Promise.all(MODELS.map((path) => loader.loadAsync(assetUrl(path)).catch(() => null)));

    // One walk cycle for everybody. The models come off the same biped rig —
    // same joints, same names — but only one was exported with a real clip;
    // the other's is a single keyframe, a T-pose that slides. Since the mixer
    // binds tracks by node name, the one real cycle drives both.
    const clips = loaded.flatMap((gltf) => gltf?.animations ?? []);
    const walkClip = clips.filter((c: any) => c.duration > 0.1).sort((a: any, b: any) => b.duration - a.duration)[0];

    const cast: Walker[] = [];
    loaded.forEach((gltf, i) => {
      if (!gltf) return;
      const root = gltf.scene;
      // Exports arrive at wildly different scales; normalise on the measured
      // height so a replacement model needs no code change.
      const bounds = new THREE.Box3().setFromObject(root);
      const height = Math.max(0.001, bounds.max.y - bounds.min.y);
      const scale = 1.5 / height;
      root.scale.setScalar(scale);
      root.position.y = -bounds.min.y * scale;
      root.traverse((node: any) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      root.rotation.y = Math.PI;
      scene.add(root);

      const mixer = new THREE.AnimationMixer(root);
      let action = null;
      if (walkClip) {
        action = mixer.clipAction(walkClip);
        action.play();
        // Out of step, or two people walking together look like one person
        // rendered twice.
        action.time = i * walkClip.duration * 0.5;
      }
      cast.push({ root, mixer, action, homeX: i === 0 ? -0.62 : 0.62 });
    });

    // ---- pick tonight's film ----
    const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    tellName(scenario.name);

    const clock = new THREE.Clock();
    let elapsed = 0;
    let frame = 0;
    const shakes: number[] = [];

    const fired = new Set<string>();
    const stage: Stage = {
      THREE,
      camera,
      sfx,
      cast,
      crate,
      lid,
      spares,
      walking: true,
      once: (key, at, fn) => {
        if (fired.has(key)) return;
        if (elapsed < at) return;
        fired.add(key);
        fn();
      },
    };

    sfx.wind(true);

    // Camera shake, driven by whichever beats the scenario marked as loud.
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

      const pos = snow.geometry.getAttribute("position");
      for (let i = 0; i < FLAKES; i++) {
        let y = pos.getY(i) - flakeFall[i] * dt;
        let x = pos.getX(i) + flakeDrift[i] * dt;
        if (y < 0) {
          y = 14 + Math.random() * 3;
          x = (Math.random() - 0.5) * 34;
        }
        pos.setY(i, y);
        pos.setX(i, x);
      }
      pos.needsUpdate = true;

      // Reset per-frame state the scenario is expected to set itself.
      stage.walking = false;
      scenario.run(elapsed, dt, stage);
      for (const person of cast) if (stage.walking) person.mixer.update(dt);

      // A slow push the whole way through, and a shove on any loud moment.
      const push = smooth(clamp01(elapsed / scenario.seconds));
      camera.position.z = 6.4 - push * 2.2;
      camera.position.y = 1.55 - push * 0.24;
      camera.position.x = shake(elapsed);
      camera.lookAt(0, 0.95, 0);

      renderer.render(scene, camera);
      if (elapsed >= scenario.seconds) finish();
    };

    const originalOnce = stage.once;
    stage.once = (key, at, fn) => {
      const before = fired.has(key);
      originalOnce(key, at, fn);
      if (!before && fired.has(key) && /impact|land|strike|crash|settle|hit|kick|gone/.test(key)) {
        shakes.push(elapsed);
      }
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
    finish();
    return cleanup;
  }
}
