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

type GameId = "slots" | "dice" | "highlow" | "cups" | "race" | "door";

let game: GameId = "slots";

// ---------------- the reels ----------------

/** Ten cells per column; 月 and ☆ appear twice, so they hit often. */
const REEL: string[] = ["７", "ゆ", "🐟", "月", "🍐", "🥫", "☆", "🐱", "月", "☆"];
const SYMBOL_COLOUR: Record<string, string> = {
  "７": "#e8862c",
  ゆ: "#d4508a",
  月: "#5a6478",
  "☆": "#c9a227",
};

/** Multiplier for three of a kind. */
const TRIPLE_PAY: Record<string, number> = {
  "７": 60,
  ゆ: 30,
  "🐱": 25,
  "🐟": 20,
  "🍐": 18,
  "🥫": 15,
  月: 8,
  "☆": 8,
};
/** Multiplier for exactly two of a kind, for the two worth pairing. */
const PAIR_PAY: Record<string, number> = { "７": 4, ゆ: 2, "🥫": 3 };

/**
 * The payline, read the casino's way: triples first, then the house
 * specials — ゆ mistaken for a fish, the cat catching one, a night sky —
 * then the pairs worth anything.
 */
function slotResult(cells: number[]): { mult: number; line: string } {
  const [a, b, c] = cells.map((cell) => REEL[cell]);
  const line = [a, b, c];
  const has = (symbol: string): boolean => line.includes(symbol);
  if (a === b && b === c) return { mult: TRIPLE_PAY[a] ?? 8, line: `${a} ${a} ${a} — three of a kind!` };
  if (has("ゆ") && has("🐟")) return { mult: 3, line: "ゆ is not a fish. The machine disagrees" };
  if (has("🐱") && has("🐟")) return { mult: 3, line: "the cat gets the fish" };
  if (line.every((s) => s === "月" || s === "☆")) return { mult: 2, line: "a clear night sky" };
  for (const symbol of Object.keys(PAIR_PAY)) {
    if (line.filter((s) => s === symbol).length === 2) {
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
    case "deal":
      // Hands over the felt, working.
      set(bones.LeftArm, -1.0, 0, -0.3);
      set(bones.RightArm, -1.0, 0, 0.3);
      set(bones.LeftForeArm, -1.0);
      set(bones.RightForeArm, -1.0 + Math.sin(t * 1.6) * 0.1);
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
  /** Redraw the slot screen: three column positions in cells, win rows lit. */
  drawSlots: (positions: number[], highlight: boolean) => void;
  /** The shell game's cups and the fish that hides under one. */
  cups: any[];
  cupFish: any;
  /** Three racing fish, floor-grade. */
  racers: any[];
  /** The light leaking under the mystery door, for the loop to breathe. */
  doorGlow: any;
  bulbs: any[];
  neon: any;
  pink: any;
  winLight: any;
  mine: Die[];
  theirs: Die[];
  /** The high-low card, lying on the felt, repaintable per rank. */
  card: any;
  paintCard: (rank: string) => void;
  /** A pool of gold coins for the win showers. */
  coins: any[];
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

  // The slot machine: cabinet, gold trim, three reels in an OPEN window, a
  // crown of bulbs. The window is four strips around a hole, not a plate:
  // a plate in front of the reels is how the reels ended up invisible.
  const gold = matte(0xe0a850, 0.35);
  slab(matte(0xa32548, 0.4), 1.5, 2.2, 0.9, MX, 1.1, MZ);
  slab(gold, 1.6, 0.12, 1.0, MX, 2.26, MZ);
  slab(gold, 1.6, 0.12, 1.0, MX, 0.06, MZ);
  const frame = matte(0x35142a, 0.3);
  slab(frame, 1.44, 0.1, 0.14, MX, 2.0, MZ + 0.48); // above the screen
  slab(frame, 1.44, 0.1, 0.14, MX, 0.7, MZ + 0.48); // below it
  slab(frame, 0.1, 1.4, 0.14, MX - 0.67, 1.35, MZ + 0.48);
  slab(frame, 0.1, 1.4, 0.14, MX + 0.67, 1.35, MZ + 0.48);
  // The screen itself: a flat 3x3 grid drawn on canvas, self-lit so it
  // reads in any light, in honest perspective on the cabinet face.
  const CELL = 128;
  const slotCanvas = document.createElement("canvas");
  slotCanvas.width = CELL * 3;
  slotCanvas.height = CELL * 3;
  const slotPaint = slotCanvas.getContext("2d")!;
  const slotTexture = new THREE.CanvasTexture(slotCanvas);
  const drawSlots = (positions: number[], highlight: boolean): void => {
    slotPaint.fillStyle = "#221426";
    slotPaint.fillRect(0, 0, CELL * 3, CELL * 3);
    slotPaint.font = "bold 86px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
    slotPaint.textAlign = "center";
    slotPaint.textBaseline = "middle";
    for (let col = 0; col < 3; col++) {
      const base = Math.floor(positions[col]);
      const frac = positions[col] - base;
      for (let row = -1; row <= 3; row++) {
        const symbol = REEL[(((base + row) % REEL.length) + REEL.length) % REEL.length];
        const y = (row - frac) * CELL;
        slotPaint.fillStyle = (base + row) % 2 === 0 ? "#faf6ec" : "#ece4d4";
        slotPaint.fillRect(col * CELL + 4, y + 4, CELL - 8, CELL - 8);
        slotPaint.fillStyle = SYMBOL_COLOUR[symbol] ?? "#44404a";
        slotPaint.fillText(symbol, col * CELL + CELL / 2, y + CELL / 2 + 4);
      }
    }
    // The payline, across the middle row.
    slotPaint.fillStyle = highlight ? "rgba(255, 216, 96, 0.30)" : "rgba(255, 216, 96, 0.12)";
    slotPaint.fillRect(0, CELL, CELL * 3, CELL);
    slotPaint.strokeStyle = highlight ? "#ffd860" : "rgba(255, 216, 96, 0.55)";
    slotPaint.lineWidth = highlight ? 10 : 4;
    slotPaint.strokeRect(3, CELL + 3, CELL * 3 - 6, CELL - 6);
    slotTexture.needsUpdate = true;
  };
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.24, 1.24),
    new THREE.MeshBasicMaterial({ map: slotTexture }),
  );
  screen.position.set(MX, 1.35, MZ + 0.46);
  scene.add(screen);
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
  // Her stool, in front of the machine with knee room.
  slab(matte(0x51392a), 0.16, 0.55, 0.16, MX, 0.28, MZ + 1.6);
  slab(matte(0x7a5236, 0.6), 0.55, 0.1, 0.55, MX, 0.58, MZ + 1.6);

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
  const warm2 = new THREE.PointLight(0xffb1d5, 7, 7, 1.8);
  warm2.position.set(MX, 2.8, MZ + 1.6);
  scene.add(warm2);

  // The mystery door: sealed, signed with a question mark, light leaking
  // out underneath. It does nothing. For now.
  const steel = matte(0x2a2230, 0.5);
  slab(matte(0x1c1420, 0.6), 1.5, 2.7, 0.18, 4.6, 1.35, -6.24); // frame
  slab(steel, 0.62, 2.5, 0.12, 4.28, 1.25, -6.16); // left leaf
  slab(steel, 0.62, 2.5, 0.12, 4.92, 1.25, -6.16); // right leaf
  const chain = matte(0x8a7440, 0.35);
  slab(chain, 1.7, 0.09, 0.05, 4.6, 1.6, -6.08).rotation.z = 0.45;
  slab(chain, 1.7, 0.09, 0.05, 4.6, 1.2, -6.08).rotation.z = -0.45;
  const signCanvas = document.createElement("canvas");
  signCanvas.width = 128;
  signCanvas.height = 128;
  const signPaint = signCanvas.getContext("2d")!;
  signPaint.fillStyle = "#160d1c";
  signPaint.fillRect(0, 0, 128, 128);
  signPaint.shadowColor = "#a06fff";
  signPaint.shadowBlur = 22;
  signPaint.fillStyle = "#c9a6ff";
  signPaint.font = "bold 92px 'Hiragino Sans', sans-serif";
  signPaint.textAlign = "center";
  signPaint.textBaseline = "middle";
  signPaint.fillText("?", 64, 70);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(signCanvas) }),
  );
  sign.position.set(4.6, 2.95, -6.12);
  scene.add(sign);
  const doorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.07),
    new THREE.MeshBasicMaterial({ color: 0xa06fff, transparent: true, opacity: 0.6 }),
  );
  doorGlow.rotation.x = -Math.PI / 2;
  doorGlow.position.set(4.6, 0.012, -6.05);
  scene.add(doorGlow);

  // The shell game: three cups face-down on the felt, one fish.
  const cupMat = matte(0x8a4a2e, 0.55);
  const cups: any[] = [];
  for (let i = 0; i < 3; i++) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.26, 16, 1), cupMat);
    cup.castShadow = true;
    cup.visible = false;
    scene.add(cup);
    cups.push(cup);
  }
  const fishBody = (colour: number): any => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45 }),
    );
    body.scale.set(1.7, 0.9, 0.8);
    body.castShadow = true;
    group.add(body);
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.12, 8),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45 }),
    );
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -0.17;
    group.add(tail);
    group.visible = false;
    scene.add(group);
    return group;
  };
  const cupFish = fishBody(0x4fd1c5);
  // The racers: teal, orange, ivory. Nobody asks where they swim to.
  const racers = [0x4fd1c5, 0xf0a860, 0xe8e2d2].map((colour) => fishBody(colour));

  const mine = [0, 1, 2].map(() => makeDie(THREE, false));
  const theirs = [0, 1, 2].map(() => makeDie(THREE, true));
  for (const die of [...mine, ...theirs]) scene.add(die.group);

  // The high-low card: a real card on the felt, face on top, back below,
  // its rank repainted on a shared canvas per deal.
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = 256;
  faceCanvas.height = 358;
  const facePaint = faceCanvas.getContext("2d")!;
  const faceTexture = new THREE.CanvasTexture(faceCanvas);
  const paintCard = (rank: string): void => {
    facePaint.fillStyle = "#faf6ec";
    facePaint.fillRect(0, 0, 256, 358);
    facePaint.strokeStyle = "#b8b0a0";
    facePaint.lineWidth = 6;
    facePaint.strokeRect(8, 8, 240, 342);
    facePaint.fillStyle = "#a32548";
    facePaint.textAlign = "center";
    facePaint.font = "bold 170px 'Hiragino Sans', sans-serif";
    facePaint.fillText(rank, 128, 235);
    facePaint.font = "bold 54px 'Hiragino Sans', sans-serif";
    facePaint.textAlign = "left";
    facePaint.fillText(rank, 22, 66);
    facePaint.textAlign = "right";
    facePaint.fillText(rank, 234, 336);
    faceTexture.needsUpdate = true;
  };
  paintCard("?");
  const backCanvas = document.createElement("canvas");
  backCanvas.width = 256;
  backCanvas.height = 358;
  const backPaint = backCanvas.getContext("2d")!;
  backPaint.fillStyle = "#5a1a30";
  backPaint.fillRect(0, 0, 256, 358);
  backPaint.strokeStyle = "rgba(230, 176, 96, 0.6)";
  backPaint.lineWidth = 4;
  for (let i = -3; i < 6; i++) {
    backPaint.beginPath();
    backPaint.moveTo(i * 64, 0);
    backPaint.lineTo(i * 64 + 179, 358);
    backPaint.stroke();
    backPaint.beginPath();
    backPaint.moveTo(i * 64 + 179, 0);
    backPaint.lineTo(i * 64, 358);
    backPaint.stroke();
  }
  const edge = matte(0xf2ede0, 0.5);
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.47), [
    edge,
    edge,
    new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(backCanvas), roughness: 0.55 }),
    edge,
    edge,
  ]);
  card.castShadow = true;
  card.visible = false;
  card.position.set(TX, 0.93, TZ + 0.35);
  scene.add(card);

  // Coins, waiting in the dark for somebody to win.
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xe8b24c, roughness: 0.25, metalness: 0.6 });
  const coinGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.016, 10);
  const coins: any[] = [];
  for (let i = 0; i < 22; i++) {
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.visible = false;
    scene.add(coin);
    coins.push(coin);
  }

  return { drawSlots, cups, cupFish, racers, doorGlow, bulbs, neon, pink, winLight, mine, theirs, card, paintCard, coins };
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
        <button data-g="cups" class="${game === "cups" ? "on" : ""}">🥤 Cups</button>
        <button data-g="race" class="${game === "race" ? "on" : ""}">🐠 Race</button>
        <button data-g="door" class="${game === "door" ? "on" : ""}">🚪 ???</button>
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

  // Coins in flight: mesh plus velocity, run by the render loop.
  const flyingCoins: { mesh: any; vx: number; vy: number; vz: number }[] = [];
  const showerCoins = (origin: [number, number, number], count: number): void => {
    if (!room) return;
    const idle = room.coins.filter((coin: any) => !coin.visible).slice(0, count);
    for (const coin of idle) {
      coin.visible = true;
      coin.position.set(origin[0] + (Math.random() - 0.5) * 0.4, origin[1], origin[2] + (Math.random() - 0.5) * 0.3);
      coin.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      flyingCoins.push({
        mesh: coin,
        vx: (Math.random() - 0.5) * 1.6,
        vy: 1.6 + Math.random() * 1.6,
        vz: (Math.random() - 0.5) * 1.2 + 0.6,
      });
    }
    setTimeout(() => sfx.clatter(), 350);
    setTimeout(() => sfx.clatter(), 550);
  };

  // The light show: a flash that decays, a strobe that outstays it.
  const fx = { flashUntil: 0, strobeUntil: 0 };
  const celebrate = (big: boolean, at: [number, number, number]): void => {
    const now = performance.now() / 1000;
    fx.flashUntil = now + 0.6;
    fx.strobeUntil = now + (big ? 2.8 : 1.3);
    sfx.bell();
    showerCoins(at, big ? 18 : 8);
    if (big) {
      setTimeout(() => sfx.bell(), 220);
      setTimeout(() => sfx.bell(), 440);
      setTimeout(() => sfx.boing(), 650);
    }
  };

  /** Where the camera wants to be, per game; a timed zoom overrides it. */
  let zoomUntil = 0;
  let zoomTarget: { pos: number[]; look: number[] } | null = null;
  const CAMS: Record<GameId, { pos: number[]; look: number[] }> = {
    // A three-quarter view from the right: the whole machine, the reels at
    // an angle, and Yuuri on her stool in profile.
    slots: { pos: [1.6, 1.9, 0.35], look: [MX + 0.15, 1.2, MZ + 0.2] },
    dice: { pos: [TX, 2.35, -0.2], look: [TX, 0.9, TZ] },
    // The card table from a lower, angled seat: same felt, different chair.
    highlow: { pos: [TX - 1.1, 1.85, -0.8], look: [TX + 0.1, 0.95, TZ + 0.3] },
    // Over the felt for the shells, wide across the floor for the race.
    cups: { pos: [TX - 0.3, 2.0, -1.0], look: [TX, 0.95, TZ + 0.15] },
    race: { pos: [0, 2.15, 0.7], look: [0, 0.35, -2.7] },
    // Standing off from the mystery door, at a respectful distance.
    door: { pos: [4.3, 1.55, -2.9], look: [4.6, 1.5, -6.1] },
  };
  const DICE_ZOOM = { pos: [TX, 1.95, -1.25], look: [TX, 0.9, TZ] };
  const DOOR_ZOOM = { pos: [4.5, 1.5, -4.35], look: [4.6, 1.3, -6.1] };
  /** Yuuri's trip from her stool to bar the door, timed from its start. */
  let guard: { start: number } | null = null;
  let doorFlareUntil = 0;
  const smooth = (x: number): number => x * x * (3 - 2 * x);
  // Seated, the hips ride about 0.7 above the root, so parking her ON the
  // 0.63 stool means the root sits just below the floor line.
  const SIT_Y = -0.06;

  // The picture leans with the pointer, a few centimetres of parallax.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  stageHost.addEventListener("pointermove", (ev: PointerEvent) => {
    const rect = stageHost.getBoundingClientRect();
    pointer.tx = ((ev.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
    pointer.ty = ((ev.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
  });
  stageHost.addEventListener("pointerleave", () => {
    pointer.tx = 0;
    pointer.ty = 0;
  });

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
    room.drawSlots([0, 3, 5].map((n) => n + Math.floor(Math.random() * REEL.length)), false);

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
      // Sitting ON the stool: the sit pose parks the seat ~0.28 below the
      // root, so a 0.63 seat wants the root at 0.91 — same sum the campfire
      // scene uses for the ground.
      yuuri.root.position.set(MX, SIT_Y, MZ + 1.6);
      yuuri.root.rotation.y = Math.PI;
    }
    if (chito) {
      chito.root.position.set(TX, 0, TZ - 1.35);
      chito.root.rotation.y = 0;
    }

    // ---- the loop ----
    const camPos = new THREE.Vector3(0, 1.7, 0.5);
    const camLook = new THREE.Vector3(MX, 1.2, MZ);
    let lastFrame = performance.now();
    const frame = (): void => {
      if (mySeq !== seq || !stageHost.isConnected) {
        renderer.dispose();
        return;
      }
      requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const t = now / 1000;

      if (yuuri) {
        const STOOL = { x: MX, z: MZ + 1.6 };
        // Dead centre of the zoomed door shot, far enough from the lens
        // that her face fits the frame, not just the crown of her hat.
        const POP = { x: 4.58, z: -5.9 };
        const g = guard ? t - guard.start : -1;
        if (guard && g >= 3.1) guard = null;
        if (guard && g >= 0) {
          if (g < 0.3) {
            // UP, from below the frame, with a bounce at the top.
            const p = g / 0.3;
            const springy = 1 - Math.pow(2, -9 * p) * Math.cos(p * 13);
            yuuri.root.position.set(POP.x, -1.6 * (1 - springy), POP.z);
            yuuri.root.rotation.y = 0; // square in your face
            pose(yuuri.bones, "clear", 1);
          } else if (g < 2.7) {
            // The finger, held until it has definitely been understood.
            yuuri.root.position.set(POP.x, 0, POP.z);
            yuuri.root.rotation.y = 0;
            pose(yuuri.bones, "point", 1, t);
          } else {
            // Gone the way she came, straight down.
            const p = (g - 2.7) / 0.4;
            yuuri.root.position.set(POP.x, -1.6 * smooth(p), POP.z);
            pose(yuuri.bones, "clear", 1);
          }
        } else {
          yuuri.root.position.set(STOOL.x, SIT_Y, STOOL.z);
          yuuri.root.rotation.y = Math.PI;
          pose(yuuri.bones, "sit", 1);
          pose(yuuri.bones, "lean", 1, t);
        }
      }
      if (chito) {
        pose(chito.bones, "lean", 1, t + 3);
        // At the card table she's working; at the dice bowl, just watching.
        if (game === "highlow" || game === "cups") pose(chito.bones, "deal", 0.7, t);
      }

      // Coins fall, bounce nowhere, and are swept away.
      for (let i = flyingCoins.length - 1; i >= 0; i--) {
        const coin = flyingCoins[i];
        coin.vy -= 6.5 * dt;
        coin.mesh.position.x += coin.vx * dt;
        coin.mesh.position.y += coin.vy * dt;
        coin.mesh.position.z += coin.vz * dt;
        coin.mesh.rotation.x += 6 * dt;
        coin.mesh.rotation.z += 4 * dt;
        if (coin.mesh.position.y < 0.04) {
          coin.mesh.visible = false;
          flyingCoins.splice(i, 1);
        }
      }
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
      // Whatever is behind the mystery door, it's awake.
      room!.doorGlow.material.opacity =
        0.45 + Math.sin(t * 0.7) * 0.2 + Math.max(0, Math.sin(t * 0.13) - 0.98) * 12 + (t < doorFlareUntil ? 0.35 : 0);

      const target = t < zoomUntil && zoomTarget ? zoomTarget : CAMS[game];
      camPos.lerp(new THREE.Vector3(...target.pos), 0.045);
      camLook.lerp(new THREE.Vector3(...target.look), 0.045);
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      camera.position.set(
        camPos.x + Math.sin(t * 0.4) * 0.05 + pointer.x * 0.16,
        camPos.y - pointer.y * 0.1,
        camPos.z,
      );
      camera.lookAt(camLook.x - pointer.x * 0.06, camLook.y + pointer.y * 0.04, camLook.z);
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
    room.card.visible = false;
    for (const cup of room.cups) cup.visible = false;
    room.cupFish.visible = false;
    for (const racer of room.racers) racer.visible = false;
  };

  // ---- the card in the air ----

  const CARD_REST = { x: TX, y: 0.93, z: TZ + 0.35 };

  /** Hop, spin a full turn, land face-up showing `rank` (repainted mid-air). */
  const flipCard = (rank: string): Promise<void> =>
    new Promise((resolve) => {
      if (!room) return resolve();
      const card = room.card;
      card.visible = true;
      sfx.whoosh();
      const start = performance.now();
      const DUR = 620;
      let painted = false;
      const tick = (): void => {
        if (mySeq !== seq) return resolve();
        const p = Math.min(1, (performance.now() - start) / DUR);
        const hop = Math.sin(p * Math.PI) * 0.5;
        card.position.set(CARD_REST.x, CARD_REST.y + hop, CARD_REST.z);
        card.rotation.z = Math.PI * 2 * p;
        card.rotation.y = 0.25 - Math.sin(p * Math.PI) * 0.3;
        if (!painted && p >= 0.45) {
          painted = true;
          room!.paintCard(rank);
        }
        if (p >= 1) {
          card.rotation.set(0, 0.25, 0);
          sfx.open();
          resolve();
        } else requestAnimationFrame(tick);
      };
      tick();
    });

  /** The pot's card slides across the felt to the dealer and is gone. */
  const loseCard = (): Promise<void> =>
    new Promise((resolve) => {
      if (!room) return resolve();
      const card = room.card;
      const start = performance.now();
      const DUR = 700;
      const fromZ = card.position.z;
      const tick = (): void => {
        if (mySeq !== seq) return resolve();
        const p = Math.min(1, (performance.now() - start) / DUR);
        card.position.z = fromZ - p * 1.0;
        card.position.x = CARD_REST.x + Math.sin(p * Math.PI) * 0.12;
        card.rotation.y = 0.25 + p * 1.2;
        if (p >= 1) {
          card.visible = false;
          resolve();
        } else requestAnimationFrame(tick);
      };
      tick();
    });

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
      <div class="cas-result" id="cas-result">The middle row is the payline.</div>
      <details class="cas-paytable">
        <summary>Paytable</summary>
        <div class="cas-pay-grid">
          <span lang="ja">７ ７ ７</span><b>×60</b>
          <span lang="ja">ゆ ゆ ゆ</span><b>×30</b>
          <span>🐱 🐱 🐱</span><b>×25</b>
          <span>🐟 🐟 🐟</span><b>×20</b>
          <span>🍐 🍐 🍐</span><b>×18</b>
          <span>🥫 🥫 🥫</span><b>×15</b>
          <span lang="ja">月月月 / ☆☆☆</span><b>×8</b>
          <span lang="ja">ゆ ＋ 🐟 <i>it thinks it's a fish</i></span><b>×3</b>
          <span>🐱 ＋ 🐟 <i>the cat gets it</i></span><b>×3</b>
          <span lang="ja">月・☆ only <i>clear night sky</i></span><b>×2</b>
          <span lang="ja">７ ７ pair</span><b>×4</b>
          <span>🥫 🥫 pair</span><b>×3</b>
          <span lang="ja">ゆ ゆ pair</span><b>×2</b>
        </div>
      </details>
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
      // The screen ticks while the columns run, like something mechanical.
      const ticker = setInterval(() => sfx.step(), 110);
      const targets = [0, 1, 2].map(() => Math.floor(Math.random() * REEL.length));
      const startAt = performance.now();
      const spins = [3, 4, 5];
      const DURATION = [1400, 2000, 2600];
      // Column position p shows REEL[(floor p)+1] on the payline, so each
      // column lands at target-1 plus its share of full loops.
      const from = [0, 0, 0].map(() => Math.floor(Math.random() * REEL.length));
      const stopped = [false, false, false];
      await new Promise<void>((resolve) => {
        const tick = (): void => {
          const now = performance.now();
          let done = true;
          const positions = [0, 1, 2].map((i) => {
            const p = Math.min(1, (now - startAt) / DURATION[i]);
            const eased = 1 - Math.pow(1 - p, 3);
            const land = targets[i] - 1;
            const total = spins[i] * REEL.length + (((land - from[i]) % REEL.length) + REEL.length) % REEL.length;
            if (p < 1) done = false;
            else if (!stopped[i]) {
              stopped[i] = true;
              sfx.thud();
            }
            return from[i] + total * eased;
          });
          room!.drawSlots(positions, false);
          if (done || mySeq !== seq) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      clearInterval(ticker);
      const { mult, line } = slotResult(targets);
      room.drawSlots(targets.map((cell) => cell - 1), mult > 0);
      const won = Math.floor(bet * mult);
      await payout(won);
      if (won > 0) {
        celebrate(mult >= 14, [MX, 2.3, MZ + 0.5]);
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
      zoomTarget = DICE_ZOOM;
      zoomUntil = performance.now() / 1000 + 4.6;
      const playerDice = roll3();
      await throwDice(room.mine, playerDice, TZ + 0.55);
      const player = handOf(playerDice);
      result.textContent = `You: ${player.name}…`;
      await new Promise((r) => setTimeout(r, 500));
      sfx.creak();
      const dealerDice = roll3();
      await throwDice(room.theirs, dealerDice, TZ - 0.5);
      const dealer = handOf(dealerDice);
      const big = player.score >= 81;
      if (player.score > dealer.score && player.score > 0) {
        const mult = big ? 3 : 2;
        await payout(bet * mult);
        celebrate(big, [TX, 1.5, TZ]);
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
    if (room) {
      for (const die of [...room.mine, ...room.theirs]) die.group.visible = false;
      if (pot > 0) {
        room.paintCard(RANK[card]);
        room.card.visible = true;
        room.card.position.set(TX, 0.93, TZ + 0.35);
        room.card.rotation.set(0, 0.25, 0);
      } else {
        room.card.visible = false;
      }
    }
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
      busy = true;
      pot = bet;
      card = drawCard();
      await flipCard(RANK[card]);
      busy = false;
      drawHighlow();
    });
    const guess = async (higher: boolean): Promise<void> => {
      if (busy) return;
      busy = true;
      let next = drawCard();
      while (next === card) next = drawCard();
      const win = higher ? next > card : next < card;
      card = next;
      await flipCard(RANK[card]);
      if (win) {
        pot *= 2;
        celebrate(pot >= bet * 8, [TX, 1.5, TZ + 0.3]);
        react(0, "cheer", 1.4);
        busy = false;
        drawHighlow();
        const line = gameBox.querySelector("#cas-result");
        if (line) line.textContent = `${RANK[card]}! The pot is ${formatYennies(pot)}. Push it or take it.`;
      } else {
        sfx.growl();
        react(0, "hurt", 1.8);
        react(1, "point", 2.0);
        await loseCard();
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
      celebrate(pot >= bet * 8, [TX, 1.5, TZ + 0.3]);
      pot = 0;
      drawHighlow();
    });
  };

  // ---- cups (the shell game) ----

  const CUP_SPOTS = [TX - 0.5, TX, TX + 0.5];
  const CUP_Z = TZ + 0.22;
  const CUP_REST = 1.04;

  const placeCup = (cup: any, x: number, lift = 0): void => {
    cup.position.set(x, CUP_REST + lift, CUP_Z);
  };

  /** Two cups trade places, one arcing over the other. */
  const swapCups = (a: any, b: any): Promise<void> =>
    new Promise((resolve) => {
      const start = performance.now();
      const DUR = 240;
      const ax = a.position.x;
      const bx = b.position.x;
      sfx.whoosh();
      const tick = (): void => {
        if (mySeq !== seq) return resolve();
        const p = Math.min(1, (performance.now() - start) / DUR);
        const arc = Math.sin(p * Math.PI) * 0.16;
        a.position.set(ax + (bx - ax) * p, CUP_REST + arc, CUP_Z);
        b.position.set(bx + (ax - bx) * p, CUP_REST - arc * 0.4, CUP_Z);
        if (p >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });

  /** A cup rises (showing whatever is under it) or settles back down. */
  const liftCup = (cup: any, up: boolean): Promise<void> =>
    new Promise((resolve) => {
      const start = performance.now();
      const DUR = 320;
      sfx.creak();
      const tick = (): void => {
        if (mySeq !== seq) return resolve();
        const p = Math.min(1, (performance.now() - start) / DUR);
        const eased = p * p * (3 - 2 * p);
        cup.position.y = CUP_REST + (up ? eased : 1 - eased) * 0.42;
        if (p >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });

  const drawCups = (): void => {
    hideDice();
    gameBox.innerHTML = `
      ${betRow()}
      <div class="row-actions" style="justify-content:center" id="cas-cup-actions">
        <button id="cas-cups" class="cas-big">PLAY — <span id="cas-cost">${bet}</span> ¥</button>
      </div>
      <div class="cas-result" id="cas-result">Chito hides the fish, the cups dance, you point. Right cup pays ×2.5.</div>
    `;
    wireBets(() => {
      const cost = gameBox.querySelector("#cas-cost");
      if (cost) cost.textContent = String(bet);
    });
    const actions = gameBox.querySelector<HTMLDivElement>("#cas-cup-actions")!;
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
    gameBox.querySelector<HTMLButtonElement>("#cas-cups")!.addEventListener("click", async () => {
      if (!room || !(await take(bet))) return;
      busy = true;
      const stake = bet;
      result.textContent = "Watch the fish…";
      // The cups arrive; spot s holds cup atSpot[s].
      const atSpot = [0, 1, 2];
      room.cups.forEach((cup: any, i: number) => {
        cup.visible = true;
        placeCup(cup, CUP_SPOTS[i]);
      });
      sfx.thud();
      let fishAt = 1;
      room.cupFish.visible = true;
      room.cupFish.position.set(CUP_SPOTS[fishAt], 0.99, CUP_Z);
      await liftCup(room.cups[atSpot[fishAt]], true);
      sfx.splash();
      await new Promise((r) => setTimeout(r, 650));
      await liftCup(room.cups[atSpot[fishAt]], false);
      room.cupFish.visible = false;
      // The dance: eight trades, the fish riding its cup.
      for (let n = 0; n < 8; n++) {
        const s1 = Math.floor(Math.random() * 3);
        let s2 = Math.floor(Math.random() * 3);
        while (s2 === s1) s2 = Math.floor(Math.random() * 3);
        await swapCups(room.cups[atSpot[s1]], room.cups[atSpot[s2]]);
        const held = atSpot[s1];
        atSpot[s1] = atSpot[s2];
        atSpot[s2] = held;
        if (fishAt === s1) fishAt = s2;
        else if (fishAt === s2) fishAt = s1;
      }
      result.textContent = "Which cup?";
      actions.innerHTML = ["left", "middle", "right"]
        .map((label, s) => `<button class="cas-big" data-spot="${s}">${label.toUpperCase()}</button>`)
        .join("");
      for (const button of actions.querySelectorAll<HTMLButtonElement>("[data-spot]")) {
        button.addEventListener("click", async () => {
          const spot = Number(button.dataset.spot);
          actions.innerHTML = "";
          if (!room) return;
          if (spot === fishAt) {
            room.cupFish.visible = true;
            room.cupFish.position.set(CUP_SPOTS[spot], 0.99, CUP_Z);
          }
          await liftCup(room.cups[atSpot[spot]], true);
          if (spot === fishAt) {
            sfx.splash();
            await payout(Math.floor(stake * 2.5));
            celebrate(false, [TX, 1.5, TZ + 0.2]);
            react(0, "cheer");
            result.textContent = `The fish! +${formatYennies(Math.floor(stake * 2.5) - stake)}`;
          } else {
            sfx.growl();
            react(0, "hurt", 1.8);
            react(1, "point", 2.0);
            room.cupFish.visible = true;
            room.cupFish.position.set(CUP_SPOTS[fishAt], 0.99, CUP_Z);
            await liftCup(room.cups[atSpot[fishAt]], true);
            result.textContent = "Wrong cup. The fish was next door the whole time.";
          }
          busy = false;
          setTimeout(() => {
            if (game === "cups" && !busy) drawCups();
          }, 2400);
        });
      }
    });
  };

  // ---- the fish race ----

  const RACE_START = -2.4;
  const RACE_END = 2.4;
  const RACE_LANES = [-2.1, -2.55, -3.0];

  const drawRace = (): void => {
    hideDice();
    gameBox.innerHTML = `
      ${betRow()}
      <div class="row-actions" style="justify-content:center">
        <button class="cas-big" data-fish="0">🩵 TEAL</button>
        <button class="cas-big" data-fish="1">🧡 ORANGE</button>
        <button class="cas-big" data-fish="2">🤍 IVORY</button>
      </div>
      <div class="cas-result" id="cas-result">Three fish, no water, one carpet. Pick yours; the winner pays ×2.7.</div>
    `;
    wireBets();
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
    for (const button of gameBox.querySelectorAll<HTMLButtonElement>("[data-fish]")) {
      button.addEventListener("click", async () => {
        if (!room || !(await take(bet))) return;
        busy = true;
        const stake = bet;
        const pick = Number(button.dataset.fish);
        result.textContent = "They're off. Somehow.";
        sfx.splash();
        room.racers.forEach((racer: any, i: number) => {
          racer.visible = true;
          racer.position.set(RACE_START, 0.14, RACE_LANES[i]);
          racer.rotation.y = 0; // the tail is already at the back; nose to the finish
        });
        const speeds = [0, 0, 0].map(() => 0.55 + Math.random() * 0.2);
        let winner = -1;
        let lastSplash = 0;
        await new Promise<void>((resolve) => {
          let previous = performance.now();
          const tick = (): void => {
            if (mySeq !== seq || !room) return resolve();
            const now = performance.now();
            const dt = Math.min(0.05, (now - previous) / 1000);
            previous = now;
            room.racers.forEach((racer: any, i: number) => {
              // Wandering speeds, so the lead trades hands.
              speeds[i] = Math.max(0.3, Math.min(1.1, speeds[i] + (Math.random() - 0.5) * 0.12));
              racer.position.x += speeds[i] * dt;
              racer.position.y = 0.14 + Math.abs(Math.sin(now / 90 + i * 2)) * 0.05;
              racer.rotation.z = Math.sin(now / 70 + i) * 0.25;
              if (racer.position.x >= RACE_END && winner < 0) winner = i;
            });
            if (now - lastSplash > 700) {
              lastSplash = now;
              sfx.splash();
            }
            if (winner >= 0) resolve();
            else requestAnimationFrame(tick);
          };
          tick();
        });
        sfx.clatter();
        const names = ["the teal one", "the orange one", "the ivory one"];
        if (winner === pick) {
          await payout(Math.floor(stake * 2.7));
          celebrate(false, [0, 1.2, -2.5]);
          react(0, "cheer");
          result.textContent = `${names[winner]} takes it! +${formatYennies(Math.floor(stake * 2.7) - stake)}`;
        } else {
          sfx.growl();
          react(0, "hurt", 1.8);
          result.textContent = `${names[winner]} takes it. Yours is still apologising.`;
        }
        busy = false;
      });
    }
  };

  // ---- the mystery door ----
  const drawDoor = (): void => {
    hideDice();
    gameBox.innerHTML = `
      <div class="row-actions" style="justify-content:center">
        <button id="cas-door" class="cas-big">TRY THE DOOR</button>
      </div>
      <div class="cas-result" id="cas-result">Chained shut. Warm to stand near. Humming, slightly.</div>
    `;
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
    gameBox.querySelector<HTMLButtonElement>("#cas-door")!.addEventListener("click", () => {
      if (busy) return;
      busy = true;
      const now = performance.now() / 1000;
      zoomTarget = DOOR_ZOOM;
      zoomUntil = now + 4.6;
      result.textContent = "…";
      // Your steps, then the chain in your hand.
      sfx.step();
      setTimeout(() => sfx.step(), 320);
      setTimeout(() => sfx.step(), 640);
      setTimeout(() => sfx.creak(), 950);
      // The door notices — and she is suddenly VERY much in the way.
      setTimeout(() => {
        doorFlareUntil = performance.now() / 1000 + 2.2;
        sfx.menace(1.6);
        guard = { start: performance.now() / 1000 };
        sfx.boing();
      }, 1050);
      setTimeout(() => {
        result.textContent = "Yuuri: だめ。";
        sfx.thud();
      }, 1500);
      setTimeout(() => {
        result.textContent = "She points you back to the games, and won't say what's behind it.";
      }, 3100);
      setTimeout(() => sfx.whoosh(), 3750);
      setTimeout(() => {
        busy = false;
      }, 4400);
    });
  };

  const drawGame = (): void => {
    if (game === "slots") drawSlots();
    else if (game === "dice") drawDice();
    else if (game === "cups") drawCups();
    else if (game === "race") drawRace();
    else if (game === "door") drawDoor();
    else drawHighlow();
  };
  drawGame();

  for (const tab of body.querySelectorAll<HTMLButtonElement>(".cas-tabs button")) {
    tab.addEventListener("click", () => {
      if (busy) return;
      game = tab.dataset.g as GameId;
      sfx.whoosh();
      for (const other of body.querySelectorAll(".cas-tabs button")) other.classList.toggle("on", other === tab);
      drawGame();
    });
  }
}
