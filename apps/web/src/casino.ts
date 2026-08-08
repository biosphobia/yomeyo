import { earnYennies, formatYennies, spendYennies, yennies } from "./yennies.js";
import { createSfx, type Sfx } from "./gacha-audio.js";
import { warmUpCutscene } from "./gacha-scene.js";

/**
 * The casino: a place two survivors definitely should not be spending
 * their rations, rendered with the same models and box-built scenery as
 * the gacha films.
 *
 * One three.js room, built once: carpet, a neon sign, a slot machine with
 * three real spinning reels, and a dealer's table. Yuuri sits at the
 * machine; Chito runs the table. The HUD underneath carries three games,
 * all played with yennies:
 *
 *   slots    — the machine itself; the reels in the scene actually spin
 *   dice     — chinchiro against Chito, best hand wins
 *   highlow  — double-or-nothing card guessing; walk away any time
 *
 * Wins and losses reach the stage: she cheers, she clutches her head, the
 * dealer points, the bell rings. The camera drifts to whichever game is
 * being played.
 */

type GameId = "slots" | "dice" | "highlow";

let game: GameId = "slots";

// ---------------- the reels ----------------

/** Eight cells around each reel; 月 and ☆ appear twice, so they hit often. */
const REEL: string[] = ["７", "ゆ", "魚", "月", "☆", "缶", "月", "☆"];
const SYMBOL_COLOUR: Record<string, string> = {
  "７": "#f6ad55",
  ゆ: "#f0a6ca",
  魚: "#4fd1c5",
  月: "#e2e8f0",
  "☆": "#faf089",
  缶: "#a0aec0",
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

// ---------------- the room ----------------

interface Casino {
  reels: any[];
  bulbs: any[];
  neon: any;
  cast: { root: any; bones: Record<string, any> }[];
  camera: any;
  renderer: any;
  scene: any;
  THREE: any;
}

function carpetTexture(THREE: any): any {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = "#3a1626";
  paint.fillRect(0, 0, 256, 256);
  paint.strokeStyle = "rgba(214, 158, 76, 0.28)";
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
  paint.fillStyle = "#160d1c";
  paint.fillRect(0, 0, 1024, 256);
  paint.shadowColor = "#ff5fa2";
  paint.shadowBlur = 42;
  paint.fillStyle = "#ff9ac8";
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
    paint.fillStyle = i % 2 === 0 ? "#f4efe6" : "#e6dfd2";
    paint.fillRect(i * 128, 0, 128, 128);
    paint.save();
    paint.translate(i * 128 + 64, 64);
    // The reel lies on its side, so the glyphs are painted on theirs.
    paint.rotate(Math.PI / 2);
    paint.fillStyle = SYMBOL_COLOUR[symbol] ?? "#333";
    paint.strokeStyle = "rgba(0,0,0,0.35)";
    paint.font = "bold 84px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    paint.fillText(symbol, 0, 0);
    paint.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** Park a reel with cell index (fractional while spinning) at the front. */
function setReel(reel: any, cell: number): void {
  reel.rotation.y = -(cell + 0.5) * CELL_ANGLE;
}

function buildRoom(THREE: any, scene: any): Omit<Casino, "cast" | "camera" | "renderer" | "scene" | "THREE"> {
  const NIGHT = 0x140d1a;
  scene.background = new THREE.Color(NIGHT);
  scene.fog = new THREE.FogExp2(NIGHT, 0.05);
  scene.add(new THREE.HemisphereLight(0x6a5a86, 0x140d1a, 1.0));

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
  slab(matte(0x241428), 18, 6, 0.5, 0, 3, -6.5);
  slab(matte(0x1e1022), 0.5, 6, 16, -7, 3, -1);
  slab(matte(0x1e1022), 0.5, 6, 16, 7, 3, -1);

  const neon = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 1.15),
    new THREE.MeshBasicMaterial({ map: neonTexture(THREE), transparent: false }),
  );
  neon.position.set(0, 3.6, -6.2);
  scene.add(neon);
  const pink = new THREE.PointLight(0xff5fa2, 12, 14, 1.8);
  pink.position.set(0, 3.4, -5.4);
  scene.add(pink);

  // The slot machine: cabinet, gold trim, three real reels, a crown of bulbs.
  const MX = -1.7;
  const MZ = -3.4;
  const gold = matte(0xd69e4c, 0.35);
  slab(matte(0x8a1f3a, 0.4), 1.5, 2.2, 0.9, MX, 1.1, MZ);
  slab(gold, 1.6, 0.12, 1.0, MX, 2.26, MZ);
  slab(gold, 1.6, 0.12, 1.0, MX, 0.06, MZ);
  slab(matte(0x2a1020, 0.3), 1.3, 0.7, 0.1, MX, 1.35, MZ + 0.46); // reel window frame
  const reelStrip = reelTexture(THREE);
  const reels: any[] = [];
  for (let i = 0; i < 3; i++) {
    const reel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.36, 24, 1, true),
      new THREE.MeshStandardMaterial({ map: reelStrip, roughness: 0.5 }),
    );
    reel.rotation.z = Math.PI / 2;
    reel.position.set(MX - 0.39 + i * 0.39, 1.35, MZ + 0.28);
    setReel(reel, Math.floor(Math.random() * REEL.length));
    scene.add(reel);
    reels.push(reel);
  }
  // Bulbs across the crown, blinking in the render loop.
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
  // The stool in front of it.
  slab(matte(0x51392a), 0.16, 0.55, 0.16, MX, 0.28, MZ + 1.25);
  slab(matte(0x7a5236, 0.6), 0.55, 0.1, 0.55, MX, 0.58, MZ + 1.25);

  // The dealer's table: green felt, a dice bowl, warm light.
  const TX = 1.9;
  const TZ = -3.4;
  const felt = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.1, 24), matte(0x1f5c3a, 0.9));
  felt.position.set(TX, 0.86, TZ);
  felt.castShadow = true;
  felt.receiveShadow = true;
  scene.add(felt);
  slab(matte(0x3a2a20), 0.9, 0.82, 0.9, TX, 0.41, TZ);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.16, 20, 1, true), matte(0x2a2a33, 0.6));
  bowl.position.set(TX, 0.98, TZ);
  scene.add(bowl);
  const warm = new THREE.PointLight(0xffc477, 10, 8, 1.8);
  warm.position.set(TX, 2.6, TZ + 0.5);
  warm.castShadow = true;
  scene.add(warm);
  const warm2 = new THREE.PointLight(0xff9ac8, 7, 7, 1.8);
  warm2.position.set(MX, 2.7, MZ + 1.0);
  scene.add(warm2);

  return { reels, bulbs, neon };
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
  let casino: Casino | null = null;
  let reaction: { who: number; name: string; until: number } | null = null;
  const react = (who: number, name: string, seconds = 2.2): void => {
    reaction = { who, name, until: performance.now() / 1000 + seconds };
  };

  try {
    const { THREE, models } = (await warmUpCutscene()) as { THREE: any; models: any[] };
    const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
    if (mySeq !== seq || !isCurrent() || !stageHost.isConnected) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(stageHost.clientWidth, Math.max(240, stageHost.clientHeight));
    renderer.shadowMap.enabled = true;
    stageHost.innerHTML = "";
    stageHost.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, stageHost.clientWidth / Math.max(240, stageHost.clientHeight), 0.1, 100);
    camera.position.set(0, 1.75, 2.4);

    const room = buildRoom(THREE, scene);

    // The cast: Yuuri (0) on the stool, Chito (1) behind the table.
    const cast: { root: any; bones: Record<string, any> }[] = [];
    models.forEach((gltf: any, i: number) => {
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
      yuuri.root.position.set(-1.7, 0.3, -2.15);
      yuuri.root.rotation.y = Math.PI; // facing her machine
    }
    if (chito) {
      chito.root.position.set(1.9, 0, -4.35);
      chito.root.rotation.y = 0; // facing the room
    }

    casino = { ...room, cast, camera, renderer, scene, THREE };

    // ---- the loop ----
    const look = new THREE.Vector3(0, 1.2, -3.4);
    let last = performance.now();
    const frame = (): void => {
      if (mySeq !== seq || !stageHost.isConnected) {
        renderer.dispose();
        return;
      }
      requestAnimationFrame(frame);
      const now = performance.now();
      const t = now / 1000;
      last = now;

      // Idle life: she watches the reels, he minds his table, bulbs chase.
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
      room.bulbs.forEach((bulb: any, i: number) => {
        bulb.material.color.setHex(Math.floor(t * 4 + i) % 5 === i % 5 ? 0xfff2b0 : 0x6a4a20);
      });

      // The camera drifts toward the game being played.
      const targetX = game === "slots" ? -1.5 : 1.7;
      look.x += (targetX - look.x) * 0.04;
      camera.position.x = look.x * 0.25 + Math.sin(t * 0.4) * 0.05;
      camera.lookAt(look);
      renderer.render(scene, camera);
    };
    frame();
  } catch {
    stageHost.innerHTML = `<div class="glosses cas-loading">The casino needs its models — check the connection and come back.</div>`;
  }

  // ---- the games ----

  let bet = 25;
  let busy = false;

  const betRow = (): string => `
    <div class="cas-bets">
      ${[10, 25, 50, 100]
        .map((amount) => `<button class="cas-chip${bet === amount ? " on" : ""}" data-bet="${amount}">${amount}</button>`)
        .join("")}
    </div>`;

  const wireBets = (): void => {
    for (const chip of gameBox.querySelectorAll<HTMLButtonElement>("[data-bet]")) {
      chip.addEventListener("click", () => {
        bet = Number(chip.dataset.bet);
        for (const other of gameBox.querySelectorAll("[data-bet]")) other.classList.toggle("on", other === chip);
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
    gameBox.innerHTML = `
      ${betRow()}
      <div class="row-actions" style="justify-content:center">
        <button id="cas-spin" class="cas-big">SPIN — <span id="cas-spin-cost">${bet}</span> ¥</button>
      </div>
      <div class="cas-result" id="cas-result">Three ７ pays ×60 · three ゆ ×30 · pairs of ７ and ゆ pay too</div>
    `;
    wireBets();
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
    gameBox.querySelector<HTMLButtonElement>("#cas-spin")!.addEventListener("click", async () => {
      if (!casino || !(await take(bet))) return;
      busy = true;
      result.textContent = "…";
      sfx.whoosh();
      const targets = casino.reels.map(() => Math.floor(Math.random() * REEL.length));
      const start = performance.now();
      const spins = [4, 5, 6]; // full turns per reel, so they stop in order
      const DURATION = [1400, 2000, 2600];
      const from = casino.reels.map((reel: any) => -reel.rotation.y / CELL_ANGLE - 0.5);
      const stopped = [false, false, false];
      await new Promise<void>((resolve) => {
        const tick = (): void => {
          const now = performance.now();
          let done = true;
          casino!.reels.forEach((reel: any, i: number) => {
            const p = Math.min(1, (now - start) / DURATION[i]);
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
      const { mult, line } = slotResult(targets);
      const won = Math.floor(bet * mult);
      await payout(won);
      if (won > 0) {
        sfx.bell();
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
  const DIE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
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
    gameBox.innerHTML = `
      ${betRow()}
      <div class="cas-dice"><div id="cas-mine" class="cas-dice-row">— — —</div>
      <div class="glosses">Chito's hand:</div><div id="cas-theirs" class="cas-dice-row">— — —</div></div>
      <div class="row-actions" style="justify-content:center">
        <button id="cas-roll" class="cas-big">ROLL — <span>${bet}</span> ¥</button>
      </div>
      <div class="cas-result" id="cas-result">Best hand wins double. 4-5-6 pays ×3, triples ×3. Ties go to the dealer's calm face.</div>
    `;
    wireBets();
    const mine = gameBox.querySelector<HTMLDivElement>("#cas-mine")!;
    const theirs = gameBox.querySelector<HTMLDivElement>("#cas-theirs")!;
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
    gameBox.querySelector<HTMLButtonElement>("#cas-roll")!.addEventListener("click", async () => {
      if (!(await take(bet))) return;
      busy = true;
      result.textContent = "…";
      const shake = (box: HTMLElement): Promise<number[]> =>
        new Promise((resolve) => {
          let n = 0;
          const timer = setInterval(() => {
            const dice = roll3();
            box.textContent = dice.map((d) => DIE[d]).join(" ");
            sfx.clatter();
            if (++n >= 6) {
              clearInterval(timer);
              resolve(dice);
            }
          }, 130);
        });
      const playerDice = await shake(mine);
      const player = handOf(playerDice);
      await new Promise((r) => setTimeout(r, 350));
      const dealerDice = await shake(theirs);
      const dealer = handOf(dealerDice);
      const big = player.score >= 100 || player.score > 80;
      if (player.score > dealer.score && player.score > 0) {
        const mult = big ? 3 : 2;
        await payout(bet * mult);
        sfx.bell();
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
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
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
        sfx.bell();
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
