import { earnYennies, formatYennies, spendYennies, yennies } from "./yennies.js";
import { createSfx } from "./gacha-audio.js";
import { warmUpCutscene } from "./gacha-scene.js";

/**
 * The casino: a place two survivors definitely should not be spending
 * their rations, rendered with the same models and box-built scenery as
 * the gacha films.
 *
 * One three.js room, built once and lit like it wants your money: carpet,
 * a neon sign, a slot machine whose three reels really spin, and a
 * green-felt table where real 3D dice tumble out of the air. Yuuri sits
 * at the machine; Chito runs the table. The camera frames whichever game
 * is being played and leans in for the dice.
 *
 * Wins strobe the bulbs, pulse the neon, flash the room and ring bells;
 * losses get a growl and a head-clutch. All of it is yennies.
 */

type GameId = "slots" | "dice" | "highlow";

let game: GameId = "slots";

// ---------------- the reels ----------------

/** Eight cells around each reel; 月 and ☆ appear twice, so they hit often. */
const REEL: string[] = ["７", "ゆ", "魚", "月", "☆", "缶", "月", "☆"];
const SYMBOL_COLOUR: Record<string, string> = {
  "７": "#e8862c",
  ゆ: "#d4508a",
  魚: "#1f9e8e",
  月: "#5a6478",
  "☆": "#c9a227",
  缶: "#6a7280",
};

/** Multiplier for three of a kind. */
const TRIPLE_PAY: Record<string, number> = { "７": 60, ゆ: 30, 魚: 20, 缶: 14, 月: 9, "☆": 9 };
/** Multiplier for exactly two of a kind, for the two worth pairing. */
const PAIR_PAY: Record<string, number> = { "７": 4, ゆ: 2 };

const CELL_ANGLE = (Math.PI * 2) / REEL.length;

function slotResult(cells: number[]): { mult: number; line: string } {
  const [a, b, c] = cells.map((cell) => REEL[cell]);
  if (a === b && b === c) return { mult: TRIPLE_PAY[a] ?? 8, line: `${a} ${a} ${a} — three of a kind!` };
  for (const symbol of Object.keys(PAIR_PAY)) {
    if ([a, b, c].filter((s) => s === symbol).length === 2) {
      return { mult: PAIR_PAY[symbol], line: `a pair of ${symbol}` };
    }
  }
  return { mult: 0, line: "nothing lines up" };
}

// ---------------- poses, the casino's own small set ----------------

function pose(bones: Record<string, any> | null, name: string, amount = 1, t = 0): void {
  if (!bones) return;
  const set = (bone: any, x = 0, y = 0, z = 0): void => {
    if (bone) bone.rotation.set(x * amount, y * amount, z * amount);
  };
  switch (name) {
    case "sit":
      set(bones.LeftUpLeg, -1.5);
      set(bones.RightUpLeg, -1.5);
      set(bones.LeftLeg, 1.5);
      set(bones.RightLeg, 1.5);
      set(bones.Spine, 0.12);
      break;
    case "cheer":
      set(bones.LeftArm, 0, 0, -2.2 + Math.sin(t * 10) * 0.25);
      set(bones.RightArm, 0, 0, 2.2 + Math.sin(t * 10 + 1) * 0.25);
      set(bones.Head, Math.sin(t * 8) * 0.15);
      break;
    case "hurt":
      set(bones.LeftArm, -2.3, 0, -0.5);
      set(bones.RightArm, -2.3, 0, 0.5);
      set(bones.LeftForeArm, -1.9);
      set(bones.RightForeArm, -1.9);
      set(bones.Spine, 0.2);
      break;
    case "point":
      set(bones.RightArm, -1.7, 0, 0.5);
      set(bones.RightForeArm, -0.2);
      set(bones.Spine, 0, 0.2);
      break;
    case "lean":
      set(bones.Spine, -0.08 + Math.sin(t * 1.1) * 0.03);
      set(bones.Head, Math.sin(t * 0.9) * 0.06);
      break;
    case "clear":
      for (const bone of Object.values(bones)) bone?.rotation.set(0, 0, 0);
      break;
  }
}

// ---------------- textures ----------------

function carpetTexture(THREE: any): any {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = "#552138";
  paint.fillRect(0, 0, 256, 256);
  paint.strokeStyle = "rgba(230, 176, 96, 0.4)";
  paint.lineWidth = 3;
  for (let i = -1; i < 3; i++) {
    paint.beginPath();
    paint.moveTo(i * 128, 0);
    paint.lineTo(i * 128 + 256, 256);
    paint.stroke();
    paint.beginPath();
    paint.moveTo(i * 128 + 256, 0);
    paint.lineTo(i * 128, 256);
    paint.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);
  return texture;
}

function neonTexture(THREE: any): any {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = "#1c1224";
  paint.fillRect(0, 0, 1024, 256);
  paint.shadowColor = "#ff5fa2";
  paint.shadowBlur = 42;
  paint.fillStyle = "#ffb1d5";
  paint.font = "bold 150px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
  paint.textAlign = "center";
  paint.fillText("カジノ", 512, 165);
  paint.shadowColor = "#5fd7ff";
  paint.shadowBlur = 24;
  paint.strokeStyle = "#9be8ff";
  paint.lineWidth = 6;
  paint.beginPath();
  paint.moveTo(230, 210);
  paint.lineTo(794, 210);
  paint.stroke();
  return new THREE.CanvasTexture(canvas);
}

function reelTexture(THREE: any): any {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const paint = canvas.getContext("2d")!;
  REEL.forEach((symbol, i) => {
    paint.fillStyle = i % 2 === 0 ? "#faf6ec" : "#ece4d4";
    paint.fillRect(i * 128, 0, 128, 128);
    paint.save();
    paint.translate(i * 128 + 64, 64);
    // The reel lies on its side, so the glyphs are painted on theirs.
    paint.rotate(Math.PI / 2);
    paint.fillStyle = SYMBOL_COLOUR[symbol] ?? "#333";
    paint.font = "bold 90px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    paint.fillText(symbol, 0, 0);
    paint.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** One die face, drawn: `dark` swaps ivory-and-black for charcoal-and-white. */
function dieFace(THREE: any, value: number, dark: boolean): any {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = dark ? "#2c2c36" : "#f6f2e8";
  paint.fillRect(0, 0, 128, 128);
  paint.fillStyle = dark ? "#f6f2e8" : value === 1 ? "#c23b4e" : "#22222a";
  const at = (x: number, y: number): void => {
    paint.beginPath();
    paint.arc(x, y, 13, 0, Math.PI * 2);
    paint.fill();
  };
  const L = 34;
  const M = 64;
  const R = 94;
  const spots: Record<number, [number, number][]> = {
    1: [[M, M]],
    2: [[L, L], [R, R]],
    3: [[L, L], [M, M], [R, R]],
    4: [[L, L], [R, L], [L, R], [R, R]],
    5: [[L, L], [R, L], [M, M], [L, R], [R, R]],
    6: [[L, L], [R, L], [L, M], [R, M], [L, R], [R, R]],
  };
  for (const [x, y] of spots[value]) at(x, y);
  return new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), roughness: 0.4 });
}

/** Materials in +x −x +y −y +z −z order: 1/6, 2/5, 3/4 — opposite faces sum to 7. */
function makeDie(THREE: any, dark: boolean): { group: any; inner: any } {
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.16),
    [1, 6, 2, 5, 3, 4].map((v) => dieFace(THREE, v, dark)),
  );
  inner.castShadow = true;
  const group = new THREE.Group();
  group.add(inner);
  group.visible = false;
  return { group, inner };
}

/** The inner rotation that puts `value` on top. */
function faceUp(inner: any, value: number): void {
  const HALF = Math.PI / 2;
  switch (value) {
    case 1: inner.rotation.set(0, 0, HALF); break;
    case 6: inner.rotation.set(0, 0, -HALF); break;
    case 2: inner.rotation.set(0, 0, 0); break;
    case 5: inner.rotation.set(Math.PI, 0, 0); break;
    case 3: inner.rotation.set(-HALF, 0, 0); break;
    case 4: inner.rotation.set(HALF, 0, 0); break;
  }
}

/** Park a reel with cell index (fractional while spinning) at the front. */
function setReel(reel: any, cell: number): void {
  reel.rotation.y = -(cell + 0.5) * CELL_ANGLE;
}

// ---------------- the room ----------------

const MX = -1.7;
const MZ = -3.4;
const TX = 1.9;
const TZ = -3.4;
/** Where the felt's top surface is, plus half a die. */
const DIE_REST = 1.0;

interface Die {
  group: any;
  inner: any;
}

interface Room {
  reels: any[];
  bulbs: any[];
  neon: any;
  pink: any;
  winLight: any;
  mine: Die[];
  theirs: Die[];
}

function buildRoom(THREE: any, scene: any): Room {
  const NIGHT = 0x1c1226;
  scene.background = new THREE.Color(NIGHT);
  scene.fog = new THREE.FogExp2(NIGHT, 0.028);
  scene.add(new THREE.HemisphereLight(0x9a86b8, 0x241628, 2.0));
  const key = new THREE.DirectionalLight(0xfff0e0, 0.8);
  key.position.set(3, 8, 6);
  scene.add(key);

  const slab = (material: any, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): any => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const matte = (colour: number, rough = 0.85): any => new THREE.MeshStandardMaterial({ color: colour, roughness: rough });

  // Carpet, walls, and the sign.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ map: carpetTexture(THREE), roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  slab(matte(0x3a2242), 18, 6, 0.5, 0, 3, -6.5);
  slab(matte(0x30203a), 0.5, 6, 16, -7, 3, -1);
  slab(matte(0x30203a), 0.5, 6, 16, 7, 3, -1);

  const neon = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 1.15),
    new THREE.MeshBasicMaterial({ map: neonTexture(THREE) }),
  );
  neon.position.set(0, 3.6, -6.2);
  scene.add(neon);
  const pink = new THREE.PointLight(0xff5fa2, 16, 16, 1.8);
  pink.position.set(0, 3.4, -5.2);
  scene.add(pink);
  // The win flash: dark until somebody gets lucky.
  const winLight = new THREE.PointLight(0xffffff, 0, 12, 1.6);
  winLight.position.set(0, 2.6, -2.4);
  scene.add(winLight);

  // The slot machine: cabinet, gold trim, three lit reels, a crown of bulbs.
  const gold = matte(0xe0a850, 0.35);
  slab(matte(0xa32548, 0.4), 1.5, 2.2, 0.9, MX, 1.1, MZ);
  slab(gold, 1.6, 0.12, 1.0, MX, 2.26, MZ);
  slab(gold, 1.6, 0.12, 1.0, MX, 0.06, MZ);
  slab(matte(0x35142a, 0.3), 1.34, 0.72, 0.1, MX, 1.35, MZ + 0.44);
  const reelStrip = reelTexture(THREE);
  const reels: any[] = [];
  for (let i = 0; i < 3; i++) {
    const reel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.36, 24, 1, true),
      new THREE.MeshStandardMaterial({ map: reelStrip, roughness: 0.45 }),
    );
    reel.rotation.z = Math.PI / 2;
    reel.position.set(MX - 0.39 + i * 0.39, 1.35, MZ + 0.28);
    setReel(reel, Math.floor(Math.random() * REEL.length));
    scene.add(reel);
    reels.push(reel);
  }
  // A lamp aimed straight at the reels, so the game is never in the dark.
  const reelLight = new THREE.PointLight(0xfff6e0, 7, 4, 1.6);
  reelLight.position.set(MX, 1.5, MZ + 1.1);
  scene.add(reelLight);
  const bulbs: any[] = [];
  for (let i = 0; i < 5; i++) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd97a }),
    );
    bulb.position.set(MX - 0.6 + i * 0.3, 2.38, MZ + 0.4);
    scene.add(bulb);
    bulbs.push(bulb);
  }
  // The stool sits beside the machine, so nobody's head blocks the reels.
  slab(matte(0x51392a), 0.16, 0.55, 0.16, MX - 1.15, 0.28, MZ + 0.75);
  slab(matte(0x7a5236, 0.6), 0.55, 0.1, 0.55, MX - 1.15, 0.58, MZ + 0.75);

  // The dealer's table: bright felt under its own lamp, dice at the ready.
  const felt = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.1, 24), matte(0x2a7a4c, 0.85));
  felt.position.set(TX, 0.86, TZ);
  felt.castShadow = true;
  felt.receiveShadow = true;
  scene.add(felt);
  slab(matte(0x4a362a), 0.9, 0.82, 0.9, TX, 0.41, TZ);
  const warm = new THREE.PointLight(0xffd9a0, 24, 9, 1.8);
  warm.position.set(TX, 2.7, TZ + 0.6);
  warm.castShadow = true;
  scene.add(warm);
  const warm2 = new THREE.PointLight(0xffb1d5, 12, 8, 1.8);
  warm2.position.set(MX, 2.8, MZ + 1.2);
  scene.add(warm2);

  const mine = [0, 1, 2].map(() => makeDie(THREE, false));
  const theirs = [0, 1, 2].map(() => makeDie(THREE, true));
  for (const die of [...mine, ...theirs]) scene.add(die.group);

  return { reels, bulbs, neon, pink, winLight, mine, theirs };
}

// ---------------- the render ----------------

let seq = 0;

export async function renderCasino(body: HTMLDivElement, isCurrent: () => boolean = () => true): Promise<void> {
  const mySeq = ++seq;
  body.innerHTML = `
    <div class="cas-stage" id="cas-stage"><div class="glosses cas-loading">Opening the casino…</div></div>
    <div class="cas-hud">
      <div class="cas-bar">
        <span class="cas-balance" id="cas-balance"></span>
        <span class="glosses" id="cas-note"></span>
      </div>
      <div class="segmented cas-tabs">
        <button data-g="slots" class="${game === "slots" ? "on" : ""}">🎰 Slots</button>
        <button data-g="dice" class="${game === "dice" ? "on" : ""}">🎲 Dice</button>
        <button data-g="highlow" class="${game === "highlow" ? "on" : ""}">🃏 High-Low</button>
      </div>
      <div id="cas-game"></div>
    </div>
  `;

  const stageHost = body.querySelector<HTMLDivElement>("#cas-stage")!;
  const balanceBox = body.querySelector<HTMLSpanElement>("#cas-balance")!;
  const note = body.querySelector<HTMLSpanElement>("#cas-note")!;
  const gameBox = body.querySelector<HTMLDivElement>("#cas-game")!;
  const sfx = createSfx();

  const refreshBalance = async (): Promise<void> => {
    balanceBox.textContent = formatYennies(await yennies());
  };
  void refreshBalance();

  // ---- the stage ----
  let room: Room | null = null;
  let THREE_: any = null;
  let reaction: { who: number; name: string; until: number } | null = null;
  const react = (who: number, name: string, seconds = 2.2): void => {
    reaction = { who, name, until: performance.now() / 1000 + seconds };
  };

  // The light show: a flash that decays, a strobe that outstays it.
  const fx = { flashUntil: 0, strobeUntil: 0 };
  const celebrate = (big: boolean): void => {
    const now = performance.now() / 1000;
    fx.flashUntil = now + 0.6;
    fx.strobeUntil = now + (big ? 2.8 : 1.3);
    sfx.bell();
    if (big) {
      setTimeout(() => sfx.bell(), 220);
      setTimeout(() => sfx.bell(), 440);
      setTimeout(() => sfx.boing(), 650);
    }
  };

  /** Where the camera wants to be, per game; the dice zoom overrides it. */
  let zoomUntil = 0;
  const CAMS: Record<GameId, { pos: number[]; look: number[] }> = {
    slots: { pos: [-0.2, 1.6, -1.35], look: [MX, 1.3, MZ] },
    dice: { pos: [TX, 2.05, -0.9], look: [TX, 0.95, TZ] },
    highlow: { pos: [TX, 2.05, -0.9], look: [TX, 0.95, TZ] },
  };
  const ZOOM = { pos: [TX, 1.6, -2.05], look: [TX, 0.95, TZ + 0.1] };

  try {
    const { THREE, models } = (await warmUpCutscene()) as { THREE: any; models: any[] };
    const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
    if (mySeq !== seq || !isCurrent() || !stageHost.isConnected) return;
    THREE_ = THREE;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(stageHost.clientWidth, Math.max(240, stageHost.clientHeight));
    renderer.shadowMap.enabled = true;
    stageHost.innerHTML = "";
    stageHost.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, stageHost.clientWidth / Math.max(240, stageHost.clientHeight), 0.1, 100);

    room = buildRoom(THREE, scene);

    // The cast: Yuuri (0) on the stool beside her machine, Chito (1) at the
    // table, far enough back that the felt doesn't swallow her.
    const cast: { root: any; bones: Record<string, any> }[] = [];
    models.forEach((gltf: any) => {
      if (!gltf) return;
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
      cast.push({ root, bones });
    });
    const [yuuri, chito] = cast;
    if (yuuri) {
      yuuri.root.position.set(MX - 1.15, 0.3, MZ + 0.75);
      yuuri.root.rotation.y = Math.PI + 0.7; // angled at the machine, profile to the camera
    }
    if (chito) {
      chito.root.position.set(TX, 0, TZ - 1.35);
      chito.root.rotation.y = 0;
    }

    // ---- the loop ----
    const camPos = new THREE.Vector3(0, 1.7, 0.5);
    const camLook = new THREE.Vector3(MX, 1.2, MZ);
    const frame = (): void => {
      if (mySeq !== seq || !stageHost.isConnected) {
        renderer.dispose();
        return;
      }
      requestAnimationFrame(frame);
      const t = performance.now() / 1000;

      if (yuuri) {
        pose(yuuri.bones, "sit", 1);
        pose(yuuri.bones, "lean", 1, t);
      }
      if (chito) pose(chito.bones, "lean", 1, t + 3);
      if (reaction && t < reaction.until) {
        const actor = cast[reaction.who];
        if (actor) {
          if (reaction.who === 0) pose(actor.bones, "sit", 1);
          pose(actor.bones, reaction.name, 1, t);
        }
      } else {
        reaction = null;
      }

      // House lighting: a lazy chase, until a win turns everything up.
      const strobing = t < fx.strobeUntil;
      room!.bulbs.forEach((bulb: any, i: number) => {
        const on = strobing ? Math.floor(t * 12 + i) % 2 === 0 : Math.floor(t * 4 + i) % 5 === i % 5;
        bulb.material.color.setHex(on ? 0xfff2b0 : 0x6a4a20);
      });
      room!.pink.intensity = strobing ? 16 + Math.sin(t * 18) * 12 : 16;
      room!.neon.material.color.setHSL(strobing ? (t * 1.5) % 1 : 0, strobing ? 0.5 : 0, 1);
      room!.winLight.intensity = Math.max(0, fx.flashUntil - t) * 60;

      const target = t < zoomUntil ? ZOOM : CAMS[game];
      camPos.lerp(new THREE.Vector3(...target.pos), 0.045);
      camLook.lerp(new THREE.Vector3(...target.look), 0.045);
      camera.position.set(camPos.x + Math.sin(t * 0.4) * 0.05, camPos.y, camPos.z);
      camera.lookAt(camLook);
      renderer.render(scene, camera);
    };
    frame();
  } catch {
    stageHost.innerHTML = `<div class="glosses cas-loading">The casino needs its models — check the connection and come back.</div>`;
  }

  // ---- dice in the air ----

  /** Throw three dice onto the felt: tumble down, clatter, land showing `values`. */
  const throwDice = (dice: Die[], values: number[], nearZ: number): Promise<void> =>
    new Promise((resolve) => {
      if (!room || !THREE_) return resolve();
      const start = performance.now();
      const DUR = 900;
      const flights = dice.map((die, i) => ({
        die,
        fromX: TX - 0.6 + i * 0.6 + (Math.random() - 0.5) * 0.2,
        toX: TX - 0.5 + i * 0.5 + (Math.random() - 0.5) * 0.12,
        z: nearZ + (Math.random() - 0.5) * 0.2,
        spinX: (3 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1),
        spinZ: (3 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1),
        yaw: Math.random() * Math.PI * 2,
        landed: false,
      }));
      for (const flight of flights) flight.die.group.visible = true;
      sfx.whoosh();
      const tick = (): void => {
        const p = Math.min(1, (performance.now() - start) / DUR);
        flights.forEach((flight) => {
          const drop = p * p;
          const bounce = Math.abs(Math.sin(p * Math.PI * 2.2)) * (1 - p) * 0.28;
          flight.die.group.position.set(
            flight.fromX + (flight.toX - flight.fromX) * p,
            2.1 - (2.1 - DIE_REST) * drop + bounce,
            flight.z,
          );
          if (p < 0.72) {
            flight.die.group.rotation.x += flight.spinX * 0.016;
            flight.die.group.rotation.z += flight.spinZ * 0.016;
            flight.die.group.rotation.y += 0.02;
          } else if (!flight.landed) {
            flight.landed = true;
            flight.die.group.rotation.set(0, flight.yaw, 0);
            faceUp(flight.die.inner, values[flights.indexOf(flight)]);
            sfx.clatter();
          }
        });
        if (p >= 1 || mySeq !== seq) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });

  const hideDice = (): void => {
    if (!room) return;
    for (const die of [...room.mine, ...room.theirs]) die.group.visible = false;
  };

  // ---- the games ----

  let bet = 25;
  let busy = false;

  const betRow = (): string => `
    <div class="cas-bets">
      ${[10, 25, 50, 100]
        .map((amount) => `<button class="cas-chip${bet === amount ? " on" : ""}" data-bet="${amount}">${amount}</button>`)
        .join("")}
    </div>`;

  const wireBets = (extra?: () => void): void => {
    for (const chip of gameBox.querySelectorAll<HTMLButtonElement>("[data-bet]")) {
      chip.addEventListener("click", () => {
        bet = Number(chip.dataset.bet);
        for (const other of gameBox.querySelectorAll("[data-bet]")) other.classList.toggle("on", other === chip);
        extra?.();
      });
    }
  };

  const say = (text: string): void => {
    note.textContent = text;
  };

  const take = async (amount: number): Promise<boolean> => {
    if (busy) return false;
    if (!(await spendYennies(amount))) {
      say("Not enough yennies. The drills pay.");
      return false;
    }
    void refreshBalance();
    return true;
  };

  const payout = async (amount: number): Promise<void> => {
    if (amount > 0) await earnYennies(amount);
    void refreshBalance();
  };

  // ---- slots ----
  const drawSlots = (): void => {
    hideDice();
    gameBox.innerHTML = `
      ${betRow()}
      <div class="row-actions" style="justify-content:center">
        <button id="cas-spin" class="cas-big">SPIN — <span id="cas-cost">${bet}</span> ¥</button>
      </div>
      <div class="cas-result" id="cas-result">Three ７ pays ×60 · three ゆ ×30 · pairs of ７ and ゆ pay too</div>
    `;
    wireBets(() => {
      const cost = gameBox.querySelector("#cas-cost");
      if (cost) cost.textContent = String(bet);
    });
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
    gameBox.querySelector<HTMLButtonElement>("#cas-spin")!.addEventListener("click", async () => {
      if (!room || !(await take(bet))) return;
      busy = true;
      result.textContent = "…";
      sfx.whoosh();
      // The reels tick while they turn, like something mechanical should.
      const ticker = setInterval(() => sfx.step(), 110);
      const targets = room.reels.map(() => Math.floor(Math.random() * REEL.length));
      const startAt = performance.now();
      const spins = [4, 5, 6];
      const DURATION = [1400, 2000, 2600];
      const from = room.reels.map((reel: any) => -reel.rotation.y / CELL_ANGLE - 0.5);
      const stopped = [false, false, false];
      await new Promise<void>((resolve) => {
        const tick = (): void => {
          const now = performance.now();
          let done = true;
          room!.reels.forEach((reel: any, i: number) => {
            const p = Math.min(1, (now - startAt) / DURATION[i]);
            const eased = 1 - Math.pow(1 - p, 3);
            const total = spins[i] * REEL.length + ((targets[i] - from[i]) % REEL.length + REEL.length) % REEL.length;
            setReel(reel, from[i] + total * eased);
            if (p < 1) done = false;
            else if (!stopped[i]) {
              stopped[i] = true;
              sfx.thud();
            }
          });
          if (done || mySeq !== seq) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      clearInterval(ticker);
      const { mult, line } = slotResult(targets);
      const won = Math.floor(bet * mult);
      await payout(won);
      if (won > 0) {
        celebrate(mult >= 14);
        react(0, "cheer");
        if (mult >= 20) react(1, "hurt", 2.6);
        result.textContent = `${line} — +${formatYennies(won)}`;
      } else {
        sfx.growl();
        react(0, "hurt", 1.8);
        result.textContent = `${line}.`;
      }
      busy = false;
    });
  };

  // ---- dice (chinchiro) ----
  const roll3 = (): number[] => [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6));
  /** Hand strength: 456 → 100, triple n → 80+n, pair point → n, 123 → -1, else 0. */
  const handOf = (dice: number[]): { score: number; name: string } => {
    const sorted = [...dice].sort((a, b) => a - b).join("");
    if (sorted === "456") return { score: 100, name: "4-5-6! the best hand" };
    if (sorted === "123") return { score: -1, name: "1-2-3… the worst hand" };
    const [a, b, c] = [...sorted].map(Number);
    if (a === b && b === c) return { score: 80 + a, name: `triple ${a}s` };
    if (a === b) return { score: c, name: `a point of ${c}` };
    if (b === c) return { score: a, name: `a point of ${a}` };
    return { score: 0, name: "no hand" };
  };

  const drawDice = (): void => {
    hideDice();
    gameBox.innerHTML = `
      ${betRow()}
      <div class="row-actions" style="justify-content:center">
        <button id="cas-roll" class="cas-big">ROLL — <span id="cas-cost">${bet}</span> ¥</button>
      </div>
      <div class="cas-result" id="cas-result">Your dice land near you, Chito's across the felt. Best hand wins double; 4-5-6 and triples pay ×3.</div>
    `;
    wireBets(() => {
      const cost = gameBox.querySelector("#cas-cost");
      if (cost) cost.textContent = String(bet);
    });
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
    gameBox.querySelector<HTMLButtonElement>("#cas-roll")!.addEventListener("click", async () => {
      if (!room || !(await take(bet))) return;
      busy = true;
      result.textContent = "…";
      hideDice();
      // Lean in for the throw, and stay in until it's read.
      zoomUntil = performance.now() / 1000 + 4.6;
      const playerDice = roll3();
      await throwDice(room.mine, playerDice, TZ + 0.55);
      const player = handOf(playerDice);
      result.textContent = `You: ${player.name}…`;
      await new Promise((r) => setTimeout(r, 500));
      const dealerDice = roll3();
      await throwDice(room.theirs, dealerDice, TZ - 0.5);
      const dealer = handOf(dealerDice);
      const big = player.score >= 81;
      if (player.score > dealer.score && player.score > 0) {
        const mult = big ? 3 : 2;
        await payout(bet * mult);
        celebrate(big);
        react(0, "cheer");
        react(1, "hurt", 2.0);
        result.textContent = `You: ${player.name}. Chito: ${dealer.name}. +${formatYennies(bet * mult - bet)}!`;
      } else {
        sfx.growl();
        react(0, "hurt", 1.8);
        react(1, "point", 2.0);
        result.textContent = `You: ${player.name}. Chito: ${dealer.name}. The house stays fed.`;
      }
      busy = false;
    });
  };

  // ---- high-low ----
  let pot = 0;
  let card = 0;
  const RANK = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const drawCard = (): number => 1 + Math.floor(Math.random() * 13);

  const drawHighlow = (): void => {
    hideDice();
    const playing = pot > 0;
    gameBox.innerHTML = `
      ${playing ? "" : betRow()}
      <div class="cas-card-row">
        <div class="cas-card" id="cas-card">${playing ? RANK[card] : "?"}</div>
        <div class="cas-pot">${playing ? `pot: ${formatYennies(pot)}` : ""}</div>
      </div>
      <div class="row-actions" style="justify-content:center">
        ${
          playing
            ? `<button id="cas-hi" class="cas-big">HIGHER</button>
               <button id="cas-lo" class="cas-big">LOWER</button>
               <button id="cas-out" class="secondary">Cash out</button>`
            : `<button id="cas-deal" class="cas-big">DEAL — <span>${bet}</span> ¥</button>`
        }
      </div>
      <div class="cas-result" id="cas-result">Guess right, the pot doubles. Wrong, it's Chito's. Ties re-draw.</div>
    `;
    wireBets();
    gameBox.querySelector("#cas-deal")?.addEventListener("click", async () => {
      if (!(await take(bet))) return;
      pot = bet;
      card = drawCard();
      sfx.open();
      drawHighlow();
    });
    const guess = async (higher: boolean): Promise<void> => {
      if (busy) return;
      busy = true;
      let next = drawCard();
      while (next === card) next = drawCard();
      const win = higher ? next > card : next < card;
      card = next;
      if (win) {
        pot *= 2;
        celebrate(pot >= bet * 8);
        react(0, "cheer", 1.4);
        busy = false;
        drawHighlow();
        const line = gameBox.querySelector("#cas-result");
        if (line) line.textContent = `${RANK[card]}! The pot is ${formatYennies(pot)}. Push it or take it.`;
      } else {
        sfx.growl();
        react(0, "hurt", 1.8);
        react(1, "point", 2.0);
        pot = 0;
        busy = false;
        drawHighlow();
        const line = gameBox.querySelector("#cas-result");
        if (line) line.textContent = `${RANK[card]}. The pot slides across the felt to Chito.`;
      }
    };
    gameBox.querySelector("#cas-hi")?.addEventListener("click", () => void guess(true));
    gameBox.querySelector("#cas-lo")?.addEventListener("click", () => void guess(false));
    gameBox.querySelector("#cas-out")?.addEventListener("click", async () => {
      await payout(pot);
      say(`Cashed out ${formatYennies(pot)}.`);
      react(0, "cheer", 1.6);
      sfx.bell();
      pot = 0;
      drawHighlow();
    });
  };

  const drawGame = (): void => {
    if (game === "slots") drawSlots();
    else if (game === "dice") drawDice();
    else drawHighlow();
  };
  drawGame();

  for (const tab of body.querySelectorAll<HTMLButtonElement>(".cas-tabs button")) {
    tab.addEventListener("click", () => {
      if (busy) return;
      game = tab.dataset.g as GameId;
      for (const other of body.querySelectorAll(".cas-tabs button")) other.classList.toggle("on", other === tab);
      drawGame();
    });
  }
}
