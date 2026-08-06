import { assetUrl } from "./store.js";

/**
 * Chito, in the flesh, for the stage-15 duel.
 *
 * The same model the gacha cutscenes use, standing in a small strip above
 * the quiz: she idles, she reacts, and the scoreline under her says how
 * the duel is going. Everything three.js is loaded lazily and every
 * failure path collapses to a drawn stand-in — a duel against an emoji is
 * still a duel, and a missing model must never block a level.
 */

export interface DuelStage {
  /** The player took the point: she flinches away. */
  you(): void;
  /** The fuse ran out or the answer was wrong: she takes it, and hops. */
  rival(): void;
  /** Update the scoreline. */
  score(you: number, rival: number): void;
  stop(): void;
}

export async function mountDuel(host: HTMLElement): Promise<DuelStage> {
  host.innerHTML = `
    <div class="duel-strip">
      <div class="duel-stage" id="duel-stage"><span class="duel-fallback">🤖</span></div>
      <div class="duel-score" id="duel-score">you 0 — 0 chito</div>
    </div>`;
  const stage = host.querySelector<HTMLDivElement>("#duel-stage")!;
  const scoreLine = host.querySelector<HTMLDivElement>("#duel-score")!;

  let stopped = false;
  /** Impulses the render loop spends: her reaction to the last point. */
  let flinch = 0;
  let hop = 0;

  const api: DuelStage = {
    you: () => {
      flinch = 1;
    },
    rival: () => {
      hop = 1;
    },
    score: (you, rival) => {
      scoreLine.textContent = `you ${you} — ${rival} chito`;
    },
    stop: () => {
      stopped = true;
    },
  };

  try {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    if (stopped || !stage.isConnected) return api;

    const width = stage.clientWidth || 300;
    const height = stage.clientHeight || 150;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
    camera.position.set(0, 1.05, 2.6);
    camera.lookAt(0, 0.85, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1.5, 3, 2);
    scene.add(sun);

    const gltf = await new GLTFLoader().loadAsync(assetUrl("gacha/models/chito.glb"));
    if (stopped || !stage.isConnected) {
      renderer.dispose();
      return api;
    }
    const chito = gltf.scene;
    chito.position.set(0, 0, 0);
    scene.add(chito);
    stage.innerHTML = "";
    stage.appendChild(renderer.domElement);

    const start = performance.now();
    const tick = (): void => {
      if (stopped || !stage.isConnected) {
        renderer.dispose();
        return;
      }
      const t = (performance.now() - start) / 1000;
      // Idle: a slow breath and a little sway, so she reads as present.
      chito.position.y = Math.sin(t * 1.7) * 0.02;
      chito.rotation.y = Math.sin(t * 0.6) * 0.22;
      // Reactions decay on their own; the loop just spends them.
      if (flinch > 0.01) {
        chito.rotation.z = Math.sin(flinch * Math.PI) * -0.18;
        chito.position.x = flinch * -0.12;
        flinch *= 0.92;
      } else {
        chito.rotation.z = 0;
        chito.position.x = 0;
      }
      if (hop > 0.01) {
        chito.position.y += Math.sin(hop * Math.PI) * 0.22;
        hop *= 0.9;
      }
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch {
    // The emoji stand-in is already on stage.
  }
  return api;
}
