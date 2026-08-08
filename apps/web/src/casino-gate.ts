import { createSfx } from "./gacha-audio.js";
import { createDialogue, type Line } from "./gacha-dialogue.js";
import { warmUpCutscene } from "./gacha-scene.js";

/**
 * The casino's front door, out in the snow.
 *
 * A bunker with two enormous steel doors, and Yuuri sitting beside them
 * in the cold, working through a ration. The camera is the player: it
 * walks up through the snow, one crunching step at a time, and she
 * notices.
 *
 * Two versions of what happens next. Short of three thousand kana
 * answers, she plants a boot in the lens, the camera goes sprawling, and
 * the doors stay shut: "you need more practice", with the count still
 * owed. With the achievement earned, she gets up, hauls the doors apart,
 * warm light spills into the snow, and the scene cuts inside — Chito
 * already at the poker table, entirely unsurprised.
 */

export interface GateOptions {
  /** True for the doors-open welcome; false for the boot. */
  opened: boolean;
  /** Kana answers still owed, shown in the locked version. */
  remaining: number;
}

export async function playGate(host: HTMLElement, options: GateOptions): Promise<void> {
  host.innerHTML = `<div class="gate-stage" id="gate-stage"><div class="glosses cas-loading">Snow…</div></div>`;
  const stage = host.querySelector<HTMLDivElement>("#gate-stage")!;
  const sfx = createSfx();

  try {
    const { THREE, models } = (await warmUpCutscene()) as { THREE: any; models: any[] };
    const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
    if (!stage.isConnected) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(stage.clientWidth, Math.max(260, stage.clientHeight));
    renderer.shadowMap.enabled = true;
    stage.innerHTML = "";
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, stage.clientWidth / Math.max(260, stage.clientHeight), 0.1, 200);

    // ---- outside: snow, concrete, and the doors ----
    const SKY = 0xb9c2cc;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.FogExp2(SKY, 0.045);
    scene.add(new THREE.HemisphereLight(0xdfe7ef, 0x5a6270, 2.0));
    const sun = new THREE.DirectionalLight(0xfff2e0, 0.9);
    sun.position.set(-6, 10, 6);
    sun.castShadow = true;
    scene.add(sun);

    const matte = (colour: number, rough = 0.9): any =>
      new THREE.MeshStandardMaterial({ color: colour, roughness: rough });
    const slab = (material: any, w: number, h: number, d: number, x: number, y: number, z: number): any => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), matte(0xe8edf2, 1));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // The bunker face, and the two doors that are most of it.
    const concrete = matte(0x4a5058, 0.95);
    slab(concrete, 12, 6.5, 1.2, 0, 3.25, -2.6);
    slab(matte(0x3c424c), 4.6, 5.0, 0.3, 0, 2.5, -1.95); // door frame recess
    const steel = matte(0x39404d, 0.55);
    const doorLeft = slab(steel, 1.9, 4.4, 0.35, -1.0, 2.2, -1.8);
    const doorRight = slab(steel, 1.9, 4.4, 0.35, 1.0, 2.2, -1.8);
    for (const door of [doorLeft, doorRight]) {
      for (let i = 0; i < 6; i++) {
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), matte(0x5a6270, 0.4));
        rivet.position.set(door.position.x + (i % 2 === 0 ? -0.7 : 0.7), 0.6 + Math.floor(i / 2) * 1.5, -1.6);
        scene.add(rivet);
      }
    }
    const lamp = new THREE.PointLight(0xffc477, 6, 8, 1.8);
    lamp.position.set(0, 4.6, -1.2);
    scene.add(lamp);
    slab(matte(0x2a2e36), 0.5, 0.25, 0.5, 0, 4.75, -1.5);
    // Warm light behind the doors, waiting for them to part.
    const glow = new THREE.PointLight(0xffb85c, 0, 12, 1.6);
    glow.position.set(0, 2.0, -2.4);
    scene.add(glow);

    // Snowfall.
    const COUNT = 900;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = Math.random() * 12;
      positions[i * 3 + 2] = -8 + Math.random() * 20;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const snow = new THREE.Points(
      snowGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    scene.add(snow);

    // ---- inside: the poker table, parked far away until the cut ----
    const IX = 100;
    if (options.opened) {
      scene.add(new THREE.PointLight(0xffc477, 14, 10, 1.8).translateX(IX).translateY(2.6).translateZ(-0.2));
      slab(matte(0x1c1420), 14, 6, 0.5, IX, 3, -4);
      slab(matte(0x241a28), 0.5, 6, 12, IX - 6, 3, 0);
      slab(matte(0x241a28), 0.5, 6, 12, IX + 6, 3, 0);
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), matte(0x2a1626, 1));
      dark.rotation.x = -Math.PI / 2;
      dark.position.x = IX;
      dark.receiveShadow = true;
      scene.add(dark);
      const felt = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.12, 24), matte(0x1f5c3a, 0.9));
      felt.position.set(IX, 0.9, -0.8);
      scene.add(felt);
      slab(matte(0x3a2a20), 1.1, 0.85, 1.1, IX, 0.43, -0.8);
      // Cards fanned on the felt, and two towers of chips.
      for (let i = 0; i < 5; i++) {
        const card = slab(matte(0xf4efe6, 0.4), 0.16, 0.012, 0.24, IX - 0.35 + i * 0.17, 0.97, -0.45);
        card.rotation.y = -0.3 + i * 0.15;
      }
      for (const [dx, colour] of [
        [-0.55, 0xc23b4e],
        [0.55, 0x3b6ec2],
      ] as [number, number][]) {
        for (let i = 0; i < 4; i++) {
          const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), matte(colour, 0.5));
          chip.position.set(IX + dx, 0.98 + i * 0.033, -0.8);
          scene.add(chip);
        }
      }
    }

    // ---- the cast ----
    const build = (gltf: any): { root: any; bones: Record<string, any> } | null => {
      if (!gltf) return null;
      const model = clone(gltf.scene);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const height = Math.max(0.001, bounds.max.y - bounds.min.y);
      const scale = 1.5 / height;
      model.scale.setScalar(scale);
      model.position.y = -bounds.min.y * scale;
      model.traverse((node: any) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      const root = new THREE.Group();
      root.add(model);
      scene.add(root);
      const bones: Record<string, any> = {};
      model.traverse((node: any) => {
        if (node.isBone) bones[node.name] = node;
      });
      return { root, bones };
    };
    const yuuri = build(models[0]);
    const chito = options.opened ? build(models[1]) : null;
    if (yuuri) {
      yuuri.root.position.set(1.7, 0.28, -1.0);
      yuuri.root.rotation.y = -0.5;
    }
    if (chito) {
      chito.root.position.set(IX, 0.45, -1.7);
      chito.root.rotation.y = 0;
    }

    const pose = (who: { bones: Record<string, any> } | null, name: string, amount = 1, t = 0): void => {
      if (!who) return;
      const b = who.bones;
      const set = (bone: any, x = 0, y = 0, z = 0): void => {
        if (bone) bone.rotation.set(x * amount, y * amount, z * amount);
      };
      switch (name) {
        case "sit":
          set(b.LeftUpLeg, -1.5);
          set(b.RightUpLeg, -1.5);
          set(b.LeftLeg, 1.5);
          set(b.RightLeg, 1.5);
          set(b.Spine, 0.12);
          break;
        case "eat":
          set(b.LeftArm, -0.5, 0, -0.9);
          set(b.RightArm, -0.5, 0, 0.9);
          set(b.LeftForeArm, -1.5);
          set(b.RightForeArm, -1.5 + Math.sin(t * 2.2) * 0.2);
          set(b.Head, 0.32);
          break;
        case "kick":
          set(b.RightUpLeg, -1.9);
          set(b.RightLeg, 0.3);
          set(b.LeftArm, 0, 0, -0.9);
          set(b.RightArm, 0, 0, 0.9);
          set(b.Spine, -0.25);
          break;
        case "haul":
          set(b.LeftArm, -1.4, 0, -0.4);
          set(b.RightArm, -1.4, 0, 0.4);
          set(b.Spine, -0.15);
          break;
        case "deal":
          set(b.LeftArm, -1.0, 0, -0.3);
          set(b.RightArm, -1.0, 0, 0.3);
          set(b.LeftForeArm, -0.9);
          set(b.RightForeArm, -0.9);
          set(b.Head, 0.15);
          break;
        case "clear":
          for (const bone of Object.values(b)) bone?.rotation.set(0, 0, 0);
          break;
      }
    };

    // ---- the script ----
    const lines: Line[] = options.opened
      ? [
          { at: 2.4, seconds: 1.6, who: "", text: "(crunch… crunch…)" },
          { at: 4.2, seconds: 1.4, who: "Yuuri", text: "ん？" },
          { at: 6.4, seconds: 2.2, who: "Yuuri", text: "…you did the reviews." },
          { at: 9.4, seconds: 1.8, who: "", text: "(the doors give)" },
          { at: 13.6, seconds: 2.2, who: "Chito", text: "Took you long enough." },
          { at: 16.0, seconds: 1.8, who: "Chito", text: "Sit. The table's cold." },
        ]
      : [
          { at: 2.4, seconds: 1.6, who: "", text: "(crunch… crunch…)" },
          { at: 4.2, seconds: 1.4, who: "Yuuri", text: "ん？" },
          { at: 7.9, seconds: 2.2, who: "Yuuri", text: "You need more practice.", loud: true },
          { at: 10.4, seconds: 2.6, who: "", text: `(${options.remaining.toLocaleString()} kana answers to go)` },
        ];
    const dialogue = createDialogue(stage, lines);

    const TOTAL = options.opened ? 18.2 : 13.2;
    const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
    const smooth = (x: number): number => x * x * (3 - 2 * x);

    const start = performance.now();
    const fired = new Set<string>();
    const once = (key: string, at: number, t: number, fn: () => void): void => {
      if (t >= at && !fired.has(key)) {
        fired.add(key);
        fn();
      }
    };

    await new Promise<void>((resolve) => {
      const frame = (): void => {
        if (!stage.isConnected) {
          renderer.dispose();
          dialogue.dispose();
          resolve();
          return;
        }
        const t = (performance.now() - start) / 1000;
        if (t >= TOTAL) {
          renderer.dispose();
          dialogue.dispose();
          resolve();
          return;
        }
        requestAnimationFrame(frame);

        // Snow falls.
        const attr = snowGeo.getAttribute("position");
        for (let i = 0; i < COUNT; i++) {
          let y = attr.getY(i) - 0.016;
          if (y < 0) y = 12;
          attr.setY(i, y);
        }
        attr.needsUpdate = true;

        // The walk in: a slow push with a footstep bob, crunching.
        const approach = smooth(clamp01(t / 6));
        let camZ = 9 - 5.4 * approach;
        let camY = 1.5 + Math.sin(t * 3.4) * 0.035 * (approach < 1 ? 1 : 0);
        let camX = Math.sin(t * 1.7) * 0.05;
        let lookY = 1.6;
        for (let n = 1; n < 11; n++) once(`step${n}`, n * 0.55, t, () => sfx.step());

        // She's eating until she isn't.
        if (yuuri) {
          if (t < 5.6) {
            pose(yuuri, "sit", 1);
            pose(yuuri, "eat", 1, t);
            if (t >= 3.6) yuuri.root.rotation.y = -0.5 + smooth(clamp01((t - 3.6) / 0.6)) * 0.9;
          } else {
            // Up off the ground.
            const up = smooth(clamp01((t - 5.6) / 0.5));
            yuuri.root.position.y = 0.28 * (1 - up);
            pose(yuuri, "clear", 1);
            yuuri.root.rotation.y = 0.4;
          }
        }

        if (!options.opened) {
          // The boot. The camera takes it personally.
          if (yuuri && t >= 6.4 && t < 7.6) {
            const lunge = smooth(clamp01((t - 6.4) / 0.8));
            yuuri.root.position.z = -1.0 + lunge * 1.6;
            yuuri.root.position.x = 1.7 - lunge * 1.4;
          }
          once("plant", 7.3, t, () => sfx.whoosh());
          if (yuuri && t >= 7.3 && t < 8.4) pose(yuuri, "kick", 1);
          if (yuuri && t >= 8.4) pose(yuuri, "clear", 1);
          once("thud", 7.55, t, () => {
            sfx.thud();
            sfx.clatter();
          });
          if (t >= 7.5) {
            const knock = smooth(clamp01((t - 7.5) / 0.6));
            camZ = 3.6 + 4.4 * knock;
            camY = 1.5 - Math.sin(knock * Math.PI) * 0.7;
            camX += (1 - knock) * (Math.random() - 0.5) * 0.2;
            lookY = 1.6 - knock * 0.4;
          }
        } else {
          // The doors give way.
          once("grip", 8.2, t, () => sfx.creak());
          once("rumble", 8.8, t, () => sfx.menace(2.4));
          if (yuuri && t >= 7.0 && t < 8.8) {
            const walk = smooth(clamp01((t - 7.0) / 1.4));
            yuuri.root.position.x = 1.7 - walk * 1.2;
            yuuri.root.position.z = -1.0 - walk * 0.5;
          }
          if (yuuri && t >= 8.2 && t < 11.4) pose(yuuri, "haul", 1);
          if (t >= 8.8) {
            const open = smooth(clamp01((t - 8.8) / 2.6));
            doorLeft.position.x = -1.0 - open * 1.5;
            doorRight.position.x = 1.0 + open * 1.5;
            glow.intensity = open * 26;
          }
          if (t >= 11.6 && t < 13.0) {
            const enter = smooth(clamp01((t - 11.6) / 1.4));
            camZ = 3.6 - 3.4 * enter;
            camY = 1.5;
          }
          // The cut: inside, where the felt is warm and the dealer is not.
          if (t >= 13.0) {
            once("inside", 13.0, t, () => sfx.open());
            pose(chito, "sit", 1);
            pose(chito, "deal", 0.7, t);
            camera.position.set(IX + Math.sin(t * 0.5) * 0.08, 1.45, 1.9);
            camera.lookAt(IX, 1.05, -0.9);
            dialogue.update(t);
            renderer.render(scene, camera);
            return;
          }
        }

        camera.position.set(camX, camY, camZ);
        camera.lookAt(0, lookY, -1.8);
        dialogue.update(t);
        renderer.render(scene, camera);
      };
      frame();
    });
  } catch {
    // No models, no film: the caller falls through to its panel.
  }
}
