import { assetUrl } from "./store.js";

/**
 * The cutscene the case opening starts with.
 *
 * A dead city under snow: two figures come out of the fog, walk towards the
 * camera, a supply crate falls out of the sky and flattens one of them, and
 * the other opens it. Then the roll begins.
 *
 * Everything except the two characters is built in code — the buildings are
 * boxes, the snow is points, the fog does most of the work — so the whole
 * scene costs two small model files and nothing else. Both characters are
 * loaded from `public/gacha/models/`, and replacing either one is dropping
 * a different .glb in with the same name.
 *
 * three.js is a large library nobody who only reviews cards should pay for,
 * so it is imported here and this module is only imported when a pull
 * actually starts. If any of it fails — no WebGL, a model that will not
 * load, a device that would rather not — `play` resolves immediately and
 * the roll happens without it.
 */

const MODELS = ["gacha/models/yuuri.glb", "gacha/models/chito.glb"];

/** Roughly how long the cutscene runs, in seconds. */
const BEATS = {
  walk: 5.2,
  /** When the crate first appears above. */
  drop: 5.2,
  /** When it lands. */
  impact: 6.1,
  open: 7.6,
  end: 9.2,
};

export interface Cutscene {
  /** Resolves when the scene is over or has been skipped. */
  done: Promise<void>;
  /** Stop early and tear everything down. */
  stop: () => void;
}

export function playCutscene(host: HTMLElement): Cutscene {
  let stop = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      resolve();
    };
    stop = finish;

    void build(host, finish).then((teardown) => {
      const previous = stop;
      stop = () => {
        teardown();
        previous();
      };
      if (finished) teardown();
    });
  });
  return { done, stop };
}

async function build(host: HTMLElement, finish: () => void): Promise<() => void> {
  let cleanup = (): void => undefined;
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
    // the figures arrive rather than simply be there, and it means the
    // whole thing can be a few dozen boxes without ever looking like it.
    const SKY = 0xb9c2cc;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.FogExp2(SKY, 0.055);

    const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 200);
    camera.position.set(0, 1.55, 6.4);
    camera.lookAt(0, 1.0, 0);

    scene.add(new THREE.HemisphereLight(0xdfe7ef, 0x5a6270, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.1);
    sun.position.set(-6, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    scene.add(sun);

    // ---- ground ----
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ---- the city ----
    //
    // Ruins read as ruins from silhouette and nothing else at this distance,
    // so they are boxes: leaning, broken-topped, dark against the fog, and
    // never near the middle where the characters walk.
    const rubble = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.95 });
    const snowcap = new THREE.MeshStandardMaterial({ color: 0xdde4ea, roughness: 1 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 54; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (2.6 + Math.random() * 13);
      const z = -2 - Math.random() * 34;
      const w = 1.4 + Math.random() * 3.4;
      const d = 1.4 + Math.random() * 3.4;
      const h = 2 + Math.random() * 13;

      const tower = new THREE.Mesh(box, concrete);
      tower.scale.set(w, h, d);
      tower.position.set(x, h / 2, z);
      tower.rotation.y = Math.random() * Math.PI;
      // A few have given up and lean.
      if (Math.random() < 0.22) tower.rotation.z = (Math.random() - 0.5) * 0.3;
      tower.castShadow = true;
      tower.receiveShadow = true;
      rubble.add(tower);

      // Snow sits on top of everything that has been standing long enough.
      const cap = new THREE.Mesh(box, snowcap);
      cap.scale.set(w * 1.02, 0.18, d * 1.02);
      cap.position.set(x, h + 0.09, z);
      cap.rotation.copy(tower.rotation);
      rubble.add(cap);
    }
    scene.add(rubble);

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

    // ---- the crate ----
    const crate = new THREE.Group();
    const crateBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.72, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x9a6b3a, roughness: 0.8 }),
    );
    crateBody.castShadow = true;
    crate.add(crateBody);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.14, 1.16),
      new THREE.MeshStandardMaterial({ color: 0xb07d45, roughness: 0.8 }),
    );
    lid.position.y = 0.43;
    lid.castShadow = true;
    crate.add(lid);
    for (const dx of [-0.58, 0.58]) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.78, 1.18),
        new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.9 }),
      );
      band.position.x = dx;
      crate.add(band);
    }
    crate.visible = false;
    scene.add(crate);

    // ---- the characters ----
    const loader = new GLTFLoader();
    const walkers: {
      root: any;
      mixer: any;
      startZ: number;
      endZ: number;
      x: number;
    }[] = [];

    const loaded = await Promise.all(
      MODELS.map((path) =>
        loader.loadAsync(assetUrl(path)).catch(() => null),
      ),
    );

    // One walk cycle for everybody.
    //
    // The models come out of the same generator on the same biped rig — same
    // twenty-four joints, same names — but only one of them was exported with
    // a real clip; the other's is a single keyframe, which is a T-pose that
    // slides. Since the mixer binds tracks by node name and the names match,
    // the one real cycle drives both. A clip with two keyframes or fewer is
    // taken to be a pose rather than a movement.
    const clips = loaded.flatMap((gltf) => gltf?.animations ?? []);
    const walkClip =
      clips
        .filter((clip: any) => clip.duration > 0.1)
        .sort((a: any, b: any) => b.duration - a.duration)[0] ?? null;

    loaded.forEach((gltf, i) => {
      if (!gltf) return;
      const root = gltf.scene;
      // Meshy exports arrive at wildly different scales; normalise on the
      // measured height so a replacement model needs no code change.
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

      const x = i === 0 ? -0.62 : 0.62;
      root.position.x = x;
      root.rotation.y = Math.PI; // facing the camera
      scene.add(root);

      const mixer = new THREE.AnimationMixer(root);
      if (walkClip) {
        const action = mixer.clipAction(walkClip);
        action.play();
        // Out of step with each other, or two people walking together look
        // like one person rendered twice.
        action.time = i * walkClip.duration * 0.5;
      }
      walkers.push({ root, mixer, startZ: -26 - i * 1.5, endZ: -0.2 - i * 0.35, x });
      root.position.z = walkers[walkers.length - 1].startZ;
    });

    // Whoever got loaded first is the one the crate lands on.
    const victim = walkers[0];

    // ---- the sequence ----
    const clock = new THREE.Clock();
    let elapsed = 0;
    let frame = 0;
    const smooth = (t: number): number => t * t * (3 - 2 * t);
    const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;

      for (const flake of [snow]) {
        const pos = flake.geometry.getAttribute("position");
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
      }

      // The walk in, out of the fog. Legs stop when the crate does its work:
      // one of them is on the floor, and the other has stopped to look.
      const walk = clamp01(elapsed / BEATS.walk);
      const stillWalking = elapsed < BEATS.impact;
      for (const person of walkers) {
        if (stillWalking) person.mixer.update(dt);
        person.root.position.z = person.startZ + (person.endZ - person.startZ) * smooth(walk);
      }

      // The crate: straight down, no warning.
      if (elapsed >= BEATS.drop && victim) {
        crate.visible = true;
        const fall = clamp01((elapsed - BEATS.drop) / (BEATS.impact - BEATS.drop));
        const from = 11;
        const to = 0.36;
        crate.position.set(victim.root.position.x, from + (to - from) * fall * fall, victim.root.position.z);
        crate.rotation.y = fall * 3.4;
      }

      // Flattened. She goes over backwards; the crate settles on top.
      if (victim && elapsed >= BEATS.impact) {
        const down = clamp01((elapsed - BEATS.impact) / 0.45);
        victim.root.rotation.x = -smooth(down) * (Math.PI / 2) * 0.92;
        victim.root.position.y = -0.02 * smooth(down);
        // The other one turns to look, because of course she does.
        if (walkers[1]) walkers[1].root.rotation.y = Math.PI + smooth(down) * 0.55;
      }

      // The lid comes off.
      if (elapsed >= BEATS.open) {
        const open = clamp01((elapsed - BEATS.open) / (BEATS.end - BEATS.open));
        lid.position.y = 0.43 + smooth(open) * 1.5;
        lid.rotation.z = smooth(open) * 1.1;
        lid.rotation.x = smooth(open) * 0.6;
      }

      // A slow push in the whole way through, and a shove on impact.
      const push = smooth(clamp01(elapsed / BEATS.end));
      camera.position.z = 6.4 - push * 2.1;
      camera.position.y = 1.55 - push * 0.22;
      const shakeFor = elapsed - BEATS.impact;
      if (shakeFor > 0 && shakeFor < 0.5) {
        const decay = 1 - shakeFor / 0.5;
        camera.position.x = Math.sin(shakeFor * 60) * 0.09 * decay;
        camera.position.y += Math.sin(shakeFor * 47) * 0.06 * decay;
      } else {
        camera.position.x = 0;
      }
      camera.lookAt(0, 0.95, 0);

      renderer.render(scene, camera);
      if (elapsed >= BEATS.end) finish();
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
      renderer.dispose();
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
    finish();
    return cleanup;
  }
}
