import { earnYennies, formatYennies, spendYennies, yennies } from "./yennies.js";
import { createSfx } from "./gacha-audio.js";
import { warmUpCutscene } from "./gacha-scene.js";
import { itemCounts, takeItems } from "./gacha-collection.js";
import { getMeta, setMeta } from "./db.js";
import { DOOR_KEY_IDS, heldDoorKeys, insertDoorKey, insertedDoorKeys } from "./door-keys.js";

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

type GameId = "slots" | "pachinko" | "dice" | "highlow" | "cups" | "race" | "door";

let game: GameId = "slots";

/**
 * Where the pachinko ball ends up pays: the centre pocket, its neighbours,
 * or nothing. Simulated at every dial setting, with the windmill pin in
 * play: 0.87 at the best dial.
 *
 * Up here rather than beside the game because the board's paint asks it too
 * — the labels under the pockets are drawn from the same answer that pays
 * them out, so they cannot disagree.
 */
const pocketMult = (x: number): number => (Math.abs(x) < 0.035 ? 8 : Math.abs(x) < 0.15 ? 2 : 0);

// ---------------- the reels ----------------

/**
 * Fifteen cells per column. Everything appears twice except the pear,
 * which appears once — so 🍐🍐🍐 is the rarest line on the machine, eight
 * times rarer than any other triple, and it pays like it.
 */
const REEL: string[] = ["７", "ゆ", "🐟", "月", "🍐", "🥫", "☆", "🐱", "月", "７", "☆", "ゆ", "🥫", "🐟", "🐱"];
const SYMBOL_COLOUR: Record<string, string> = {
  "７": "#e8862c",
  ゆ: "#d4508a",
  月: "#5a6478",
  "☆": "#c9a227",
};

/** Multiplier for three of a kind. YAY PEARS outranks everything. */
const TRIPLE_PAY: Record<string, number> = {
  "🍐": 120,
  "７": 40,
  ゆ: 25,
  "🐱": 20,
  "🐟": 16,
  "🥫": 12,
  月: 6,
  "☆": 6,
};
/** Multiplier for exactly two of a kind, for the two worth pairing. */
const PAIR_PAY: Record<string, number> = { "７": 2, ゆ: 1.5, "🥫": 1.5 };

/**
 * The payline, read the casino's way: triples first, then the house
 * specials — ゆ mistaken for a fish, the cat catching one, a night sky —
 * then the pairs worth anything. Full enumeration of the 15-cell reels
 * puts the return at 0.92 with a hit on one spin in three.
 */
function slotResult(cells: number[]): { mult: number; line: string } {
  const [a, b, c] = cells.map((cell) => REEL[cell]);
  const line = [a, b, c];
  const has = (symbol: string): boolean => line.includes(symbol);
  if (a === b && b === c) {
    if (a === "🍐") return { mult: TRIPLE_PAY[a], line: "🍐 🍐 🍐 — YAY PEARS!" };
    return { mult: TRIPLE_PAY[a] ?? 6, line: `${a} ${a} ${a} — three of a kind!` };
  }
  if (has("ゆ") && has("🐟")) return { mult: 2, line: "ゆ is not a fish. The machine disagrees" };
  if (has("🐱") && has("🐟")) return { mult: 2, line: "the cat gets the fish" };
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
    case "flail":
      // Every limb its own opinion: the ragdoll special.
      set(bones.LeftArm, Math.sin(t * 21) * 1.4, 0, -0.6 + Math.sin(t * 17 + 2) * 0.7);
      set(bones.RightArm, Math.sin(t * 19 + 1) * 1.4, 0, 0.6 + Math.sin(t * 23 + 4) * 0.7);
      set(bones.LeftUpLeg, Math.sin(t * 18 + 3) * 1.2);
      set(bones.RightUpLeg, Math.sin(t * 22 + 5) * 1.2);
      set(bones.Spine, Math.sin(t * 9 + 1) * 0.4);
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
/**
 * The race track's centre lane. The machines all stand along the back
 * wall around z = -3.4; the track lives out on the open carpet in the
 * foreground so nothing runs through a cabinet.
 */
const RACE_Z = 1.15;
/** Where the felt's top surface is, plus half a die. */
const DIE_REST = 1.0;

interface Die {
  group: any;
  inner: any;
}

interface Room {
  /** Redraw the slot screen: three column positions in cells, win rows lit. */
  drawSlots: (positions: number[], highlight: boolean) => void;
  /** The pachinko machine: tilted board, ball, pegs, marquee and windmill. */
  pachinko: { group: any; ball: any; pegs: { x: number; y: number }[]; bulbs: any[]; spinner: any };
  /** The shell game's cups and the fish that hides under one. */
  cups: any[];
  cupFish: any;
  /** Three racing fish, floor-grade. */
  racers: any[];
  /** The red arrow that rides over whichever fish was backed. */
  racePicker: any;
  /** The scrap-built race track, shown only on race days. */
  raceTrack: any;
  /** The crowd: cans on benches. Each remembers its seat in userData. */
  cans: any[];
  /** The light leaking under the mystery door, for the loop to breathe. */
  doorGlow: any;
  /** The lamp over the door, wired badly on purpose: it flickers. */
  doorLight: any;
  /**
   * The door's moving parts: its two leaves, the chains that come off,
   * three keyholes each holding an (initially invisible) key, and the
   * light waiting behind it all.
   */
  door: { left: any; right: any; chains: any[]; keyholes: { key: any }[]; blaze: any; beam: any };
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

  // The pachinko machine, along the wall past the slots: an upright board
  // behind real brass pins, leaning back the way the parlour kind do. The
  // ball is a real ball — its physics run in board space (x across,
  // y up the face) and the mesh just follows.
  const PKX = -4.3;
  // The pockets along the bottom, defined once. The fins are built from
  // this, the payouts are read from it and the labels are placed by it, so
  // a pocket cannot be worth one thing and be labelled another — which is
  // what hand-placed labels had already drifted into.
  const PK_FINS = [-0.3, -0.15, -0.035, 0.035, 0.15, 0.3];
  const PK_BOARD_W = 0.96;
  slab(matte(0x1f5a78, 0.4), 1.3, 2.3, 0.7, PKX, 1.15, MZ);
  slab(gold, 1.4, 0.12, 0.8, PKX, 2.32, MZ);
  slab(gold, 1.4, 0.12, 0.8, PKX, 0.06, MZ);
  const pachinkoGroup = new THREE.Group();
  // Proud of the cabinet face even at the top of the lean-back, so the
  // board never sinks into the box behind it.
  pachinkoGroup.position.set(PKX, 1.42, MZ + 0.46);
  pachinkoGroup.rotation.x = -0.07;
  scene.add(pachinkoGroup);
  const boardCanvas = document.createElement("canvas");
  // Painted in a 256x384 space at twice the pixels. The pocket labels are
  // small by necessity — the money pocket is seven hundredths of the board
  // wide — and at one pixel per unit the ×8 came out as a smear.
  boardCanvas.width = 512;
  boardCanvas.height = 768;
  const boardPaint = boardCanvas.getContext("2d")!;
  boardPaint.scale(2, 2);
  boardPaint.fillStyle = "#140a26";
  boardPaint.fillRect(0, 0, 256, 384);
  // A full sunburst behind the pins, parlour-loud.
  for (let ray = 0; ray < 16; ray++) {
    boardPaint.beginPath();
    boardPaint.moveTo(128, 150);
    const a1 = (ray / 16) * Math.PI * 2;
    const a2 = ((ray + 1) / 16) * Math.PI * 2;
    boardPaint.arc(128, 150, 190, a1, a2);
    boardPaint.closePath();
    boardPaint.fillStyle = ray % 2 === 0 ? "#3a1e56" : "#552138";
    boardPaint.fill();
  }
  for (let ring = 3; ring >= 1; ring--) {
    boardPaint.beginPath();
    boardPaint.arc(128, 150, ring * 34, 0, Math.PI * 2);
    boardPaint.fillStyle = ring % 2 === 0 ? "#6a2a7a" : "#8a2548";
    boardPaint.fill();
  }
  boardPaint.shadowColor = "#ffd97a";
  boardPaint.shadowBlur = 24;
  boardPaint.fillStyle = "#e8b24c";
  boardPaint.beginPath();
  boardPaint.arc(128, 150, 22, 0, Math.PI * 2);
  boardPaint.fill();
  // The marquee name, glowing, and a sprinkle of stars.
  boardPaint.shadowColor = "#9be8ff";
  boardPaint.shadowBlur = 16;
  boardPaint.fillStyle = "#c9ecff";
  boardPaint.font = "bold 34px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
  boardPaint.textAlign = "center";
  boardPaint.fillText("パチンコ", 128, 40);
  boardPaint.shadowBlur = 8;
  for (let i = 0; i < 26; i++) {
    const sx = (i * 97) % 256;
    const sy = 60 + ((i * 53) % 260);
    boardPaint.fillStyle = i % 3 === 0 ? "#9be8ff" : "#ffd97a";
    boardPaint.fillRect(sx, sy, 3, 3);
  }
  boardPaint.shadowBlur = 0;
  /*
   * The pocket labels.
   *
   * Each one is placed from the fins it sits between and sized to the gap it
   * has, rather than from three numbers somebody typed. The three labels
   * used to be hand-placed at a fixed size around the middle, so the ×8
   * pocket — seven hundredths of the board wide — got a label wider than
   * itself, and the two losing pockets on the outside got nothing at all:
   * the row read as one blob in the centre with dead space either side.
   *
   * Now every pocket is marked, the losing ones included as a plain x0, and
   * each label shrinks until it fits between its own fins.
   */
  const toCanvasX = (boardX: number): number => 128 + (boardX / PK_BOARD_W) * 256;
  const pocketFont = (text: string, space: number): void => {
    for (let size = 21; size >= 8; size--) {
      boardPaint.font = `bold ${size}px 'Hiragino Sans', sans-serif`;
      if (boardPaint.measureText(text).width <= space - 3) return;
    }
  };
  // A dark band behind them, so a number never has to be read off a
  // sunburst ray. It ends where the pockets do.
  boardPaint.fillStyle = "rgba(10, 5, 20, 0.72)";
  boardPaint.fillRect(toCanvasX(PK_FINS[0]), 318, toCanvasX(PK_FINS[5]) - toCanvasX(PK_FINS[0]), 46);
  for (let i = 0; i < PK_FINS.length - 1; i++) {
    const middle = (PK_FINS[i] + PK_FINS[i + 1]) / 2;
    const mult = pocketMult(middle);
    const space = toCanvasX(PK_FINS[i + 1]) - toCanvasX(PK_FINS[i]);
    const text = `×${mult}`;
    pocketFont(text, space);
    boardPaint.fillStyle = mult >= 8 ? "#ffd97a" : mult > 0 ? "#b8a8d8" : "#6b5f80";
    boardPaint.fillText(text, toCanvasX(middle), 355);
  }
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(0.96, 1.44),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(boardCanvas) }),
  );
  pachinkoGroup.add(board);
  // A gold frame around the glass, wearing a marquee of chasing bulbs.
  const framePiece = (w: number, h: number, x: number, y: number): void => {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), gold);
    piece.position.set(x, y, 0.0);
    pachinkoGroup.add(piece);
  };
  framePiece(1.08, 0.06, 0, 0.75);
  framePiece(1.08, 0.06, 0, -0.75);
  framePiece(0.06, 1.56, -0.51, 0);
  framePiece(0.06, 1.56, 0.51, 0);
  const pkBulbs: any[] = [];
  const bulbAt = (x: number, y: number): void => {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x2a3444 }),
    );
    bulb.position.set(x, y, 0.05);
    pachinkoGroup.add(bulb);
    pkBulbs.push(bulb);
  };
  for (let i = 0; i < 5; i++) bulbAt(-0.4 + i * 0.2, 0.75);
  for (let i = 0; i < 4; i++) {
    bulbAt(-0.51, -0.55 + i * 0.36);
    bulbAt(0.51, -0.55 + i * 0.36);
  }
  const pegMat = matte(0xd8c060, 0.3);
  const pegGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8);
  const pegSpots: { x: number; y: number }[] = [];
  for (let row = 0; row < 8; row++) {
    const y = 0.42 - row * 0.1;
    const offset = row % 2 === 0 ? 0 : 0.06;
    for (let x = -0.36 + offset; x <= 0.37; x += 0.12) {
      pegSpots.push({ x, y });
      const peg = new THREE.Mesh(pegGeo, pegMat);
      peg.rotation.x = Math.PI / 2;
      peg.position.set(x, y, 0.03);
      pachinkoGroup.add(peg);
    }
  }
  // The windmill, the classic deflector: it spins all day, and whatever
  // is falling bounces off it like any other pin.
  // Just off-centre, so it teases the money pocket without guarding it.
  pegSpots.push({ x: 0.09, y: -0.4 });
  const spinner = new THREE.Group();
  spinner.position.set(0.09, -0.4, 0.035);
  const bladeMat = matte(0xd4508a, 0.35);
  for (const angle of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.022), bladeMat);
    blade.rotation.z = angle;
    spinner.add(blade);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.034, 8), gold);
  hub.rotation.x = Math.PI / 2;
  spinner.add(hub);
  pachinkoGroup.add(spinner);
  // Fins divide the bottom into pockets; the middle one is the money.
  for (const x of PK_FINS) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.12, 0.055), gold);
    fin.position.set(x, -0.56, 0.03);
    pachinkoGroup.add(fin);
  }
  const pachinkoBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.024, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xdde4ec, roughness: 0.15, metalness: 0.8 }),
  );
  pachinkoBall.position.z = 0.04;
  pachinkoBall.visible = false;
  pachinkoGroup.add(pachinkoBall);
  const pkGlow = new THREE.PointLight(0x9be8ff, 5, 5, 1.8);
  pkGlow.position.set(PKX, 2.5, MZ + 1.0);
  scene.add(pkGlow);

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
  const leftLeaf = slab(steel, 0.62, 2.5, 0.12, 4.28, 1.25, -6.16);
  const rightLeaf = slab(steel, 0.62, 2.5, 0.12, 4.92, 1.25, -6.16);
  const chain = matte(0x8a7440, 0.35);
  const chainA = slab(chain, 1.7, 0.09, 0.05, 4.6, 1.6, -6.08);
  chainA.rotation.z = 0.45;
  const chainB = slab(chain, 1.7, 0.09, 0.05, 4.6, 1.2, -6.08);
  chainB.rotation.z = -0.45;
  // Three keyholes down the left leaf, and a key waiting invisible in each.
  // What fits them, and where those things come from, the door does not say.
  const keyholes: { key: any }[] = [];
  const brass = matte(0xf2cf6a, 0.25);
  for (let i = 0; i < 3; i++) {
    const y = 1.66 - i * 0.34;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12), gold);
    plate.rotation.x = Math.PI / 2;
    plate.position.set(4.45, y, -6.095);
    scene.add(plate);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.05, 0.03), matte(0x14101a, 0.4));
    slot.position.set(4.45, y, -6.085);
    scene.add(slot);
    const key = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.15, 8), brass);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.05;
    key.add(shaft);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.011, 8, 14), brass);
    bow.position.z = 0.14;
    key.add(bow);
    key.position.set(4.45, y, -6.07);
    key.visible = false;
    scene.add(key);
    keyholes.push({ key });
  }
  // What waits behind: a light with a pulse in it, dark until the door parts.
  const blaze = new THREE.Mesh(
    new THREE.PlaneGeometry(1.34, 2.5),
    new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0 }),
  );
  blaze.position.set(4.6, 1.3, -6.22);
  scene.add(blaze);
  const beam = new THREE.PointLight(0xffe9b0, 0, 11, 1.6);
  beam.position.set(4.6, 1.4, -5.5);
  scene.add(beam);
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
  // The lamp above the door. Its wiring is not up to code: the loop
  // flickers it, harder when someone is standing there looking.
  const doorLight = new THREE.PointLight(0xa06fff, 3, 8, 1.7);
  doorLight.position.set(4.6, 2.3, -5.4);
  scene.add(doorLight);

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

  /*
   * The marker over the fish you backed.
   *
   * Three fish of similar size, seen from a camera trotting alongside, and
   * the only thing telling you which one was yours is the colour named on a
   * button you pressed a moment ago. This says it outright: a red arrow,
   * pointing down at your fish, riding above it for the whole race and
   * still there at the finish.
   *
   * Unlit material on purpose — it is a pointer, not part of the scene, and
   * it must read the same whichever way the room's lights fall.
   */
  const pickerMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const racePicker = new THREE.Group();
  const pickerHead = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.15, 4), pickerMat);
  pickerHead.rotation.x = Math.PI; // nose down, at the fish
  pickerHead.rotation.y = Math.PI / 4; // square on to the camera's side view
  racePicker.add(pickerHead);
  const pickerStem = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.14, 0.035), pickerMat);
  pickerStem.position.y = 0.14;
  racePicker.add(pickerStem);
  racePicker.visible = false;
  scene.add(racePicker);

  // The race track, built the only way anything here gets built: out of
  // scrap. Salvaged plates for a bed, pipes for rails, a checkered strip
  // for a finish, and the crowd is tinned — rows of cans on benches.
  const raceTrack = new THREE.Group();
  raceTrack.visible = false;
  scene.add(raceTrack);
  const put = (mesh: any, x: number, y: number, z: number): any => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    raceTrack.add(mesh);
    return mesh;
  };
  const SCRAP = [0x5a5f66, 0x6e6257, 0x4e565e, 0x715c48];
  for (let i = 0; i < 9; i++) {
    const plate = put(
      new THREE.Mesh(new THREE.BoxGeometry(1.3 + (i % 3) * 0.3, 0.035, 1.72), matte(SCRAP[i % SCRAP.length], 0.9)),
      -3.3 + i * 0.83,
      0.02 + (i % 2) * 0.012,
      RACE_Z,
    );
    plate.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.045;
  }
  const pipeMat = matte(0x3c444e, 0.45);
  for (const z of [RACE_Z + 0.83, RACE_Z - 0.83]) {
    const rail = put(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 7.4, 10), pipeMat), 0, 0.14, z);
    rail.rotation.z = Math.PI / 2;
    for (let x = -3.4; x <= 3.5; x += 1.7) {
      put(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), pipeMat), x, 0.07, z);
    }
  }
  // The finish: a checkered strip on the bed and a gantry over it.
  const checkCanvas = document.createElement("canvas");
  checkCanvas.width = 32;
  checkCanvas.height = 128;
  const checkPaint = checkCanvas.getContext("2d")!;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 2; col++) {
      checkPaint.fillStyle = (row + col) % 2 === 0 ? "#e8e2d2" : "#20242c";
      checkPaint.fillRect(col * 16, row * 16, 16, 16);
    }
  }
  const finish = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 1.66),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(checkCanvas) }),
  );
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(3.0, 0.05, RACE_Z);
  raceTrack.add(finish);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.09), pipeMat), 3.0, 0.57, RACE_Z + 0.83);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.09), pipeMat), 3.0, 0.57, RACE_Z - 0.83);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 1.85), matte(0x8a4a2e, 0.7)), 3.0, 1.18, RACE_Z);
  // The crowd: two tiers of benches a side, cans standing on them, a few
  // already leaning. Each can remembers its seat so events can knock it
  // over and the next race can put it back.
  const CAN_COLOURS = [0xb8bcc2, 0xa33232, 0x6e7d46, 0xc2952e, 0x4a6e8a];
  const cans: any[] = [];
  for (const [zRow, away] of [
    [RACE_Z + 1.07, 1],
    [RACE_Z - 1.07, -1],
  ] as [number, number][]) {
    put(new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.1, 0.3), matte(0x4e4438, 0.85)), 0, 0.16, zRow);
    put(new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.1, 0.3), matte(0x5a5f66, 0.85)), 0, 0.36, zRow + away * 0.34);
    for (let tier = 0; tier < 2; tier++) {
      for (let i = 0; i < 11; i++) {
        const can = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, 0.15, 10),
          matte(CAN_COLOURS[(i + tier * 2) % CAN_COLOURS.length], 0.35),
        );
        const seat = {
          x: -3.1 + i * 0.62 + tier * 0.31,
          y: (tier === 0 ? 0.21 : 0.41) + 0.075,
          z: zRow + away * 0.34 * tier + Math.sin(i * 7 + tier) * 0.05,
          lean: i % 5 === 4 ? 0.16 : 0,
        };
        can.userData.seat = seat;
        can.position.set(seat.x, seat.y, seat.z);
        can.rotation.z = seat.lean;
        can.castShadow = true;
        raceTrack.add(can);
        cans.push(can);
      }
    }
  }

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

  return {
    drawSlots,
    pachinko: { group: pachinkoGroup, ball: pachinkoBall, pegs: pegSpots, bulbs: pkBulbs, spinner },
    cups,
    cupFish,
    racers,
    racePicker,
    raceTrack,
    cans,
    doorGlow,
    doorLight,
    door: { left: leftLeaf, right: rightLeaf, chains: [chainA, chainB], keyholes, blaze, beam },
    bulbs,
    neon,
    pink,
    winLight,
    mine,
    theirs,
    card,
    paintCard,
    coins,
  };
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
        <button data-g="pachinko" class="${game === "pachinko" ? "on" : ""}">🎯 Pachinko</button>
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
  /** Palm-sized clones of the girls, for launching into the pachinko. */
  const dolls: { root: any; bones: Record<string, any>; name: string }[] = [];
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
    // Square-on to the pachinko board, close enough to follow the ball.
    pachinko: { pos: [-3.9, 1.7, -0.85], look: [-4.3, 1.42, MZ + 0.3] },
    dice: { pos: [TX, 2.35, -0.2], look: [TX, 0.9, TZ] },
    // The card table from a lower, angled seat: same felt, different chair.
    highlow: { pos: [TX - 1.1, 1.85, -0.8], look: [TX + 0.1, 0.95, TZ + 0.3] },
    // Over the felt for the shells, wide across the floor for the race.
    cups: { pos: [TX - 0.3, 2.0, -1.0], look: [TX, 0.95, TZ + 0.15] },
    // High and wide enough to hold the whole scrap track and its crowd,
    // out on the open carpet; during a race the camera trots along.
    race: { pos: [0, 2.9, RACE_Z + 4.4], look: [0, 0.2, RACE_Z] },
    // Standing off from the mystery door, at a respectful distance.
    door: { pos: [4.0, 1.65, -2.2], look: [4.6, 1.5, -6.1] },
  };
  const DICE_ZOOM = { pos: [TX, 1.95, -1.25], look: [TX, 0.9, TZ] };
  const DOOR_ZOOM = { pos: [4.45, 1.5, -3.95], look: [4.6, 1.3, -6.1] };
  /**
   * Yuuri's trip from her stool to bar the door. She rises, then holds
   * her post until `leave` is set — pointing, or cheering when `joy` is
   * on (a bento does that) — and only then sinks back down.
   */
  let guard: { start: number; leave: number | null; joy: boolean } | null = null;
  let doorFlareUntil = 0;
  /** When the door hums next; zero means the moment the tab is opened. */
  let nextHum = 0;
  /** The door's slide, 0 shut to 1 open; the loop eases towards the target. */
  let doorOpenP = 0;
  let doorOpenTarget = 0;
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

    // The pachinko dolls: the same two, cloned at palm size and centred
    // on their middles so they tumble about themselves, not an ankle.
    const DOLL_NAMES = ["Yuuri", "Chito"];
    models.forEach((gltf: any, i: number) => {
      if (!gltf || !room) return;
      const model = clone(gltf.scene);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const height = Math.max(0.001, bounds.max.y - bounds.min.y);
      const scale = 0.15 / height;
      model.scale.setScalar(scale);
      model.position.y = -(bounds.min.y + height / 2) * scale;
      const root = new THREE.Group();
      root.add(model);
      root.visible = false;
      room.pachinko.group.add(root);
      const bones: Record<string, any> = {};
      model.traverse((node: any) => {
        if (node.isBone) bones[node.name] = node;
      });
      dolls.push({ root, bones, name: DOLL_NAMES[i] ?? "Somebody" });
    });

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
        const leaving = guard && guard.leave !== null ? t - guard.leave : -1;
        if (guard && leaving >= 0.45) guard = null;
        if (guard && g >= 0) {
          if (leaving >= 0) {
            // Gone the way she came, straight down.
            const p = leaving / 0.45;
            yuuri.root.position.set(POP.x, -1.6 * smooth(p), POP.z);
            pose(yuuri.bones, "clear", 1);
          } else if (g < 0.3) {
            // UP, from below the frame, with a bounce at the top.
            const p = g / 0.3;
            const springy = 1 - Math.pow(2, -9 * p) * Math.cos(p * 13);
            yuuri.root.position.set(POP.x, -1.6 * (1 - springy), POP.z);
            yuuri.root.rotation.y = 0; // square in your face
            pose(yuuri.bones, "clear", 1);
          } else {
            // Holding her post: the finger, or — paid in bento — both
            // arms up, still exactly in the way.
            yuuri.root.position.set(POP.x, 0, POP.z);
            yuuri.root.rotation.y = 0;
            pose(yuuri.bones, guard.joy ? "cheer" : "point", 1, t);
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
      // The pachinko marquee chases all day, faster with someone playing,
      // and its windmill never stops.
      const pkPace = game === "pachinko" ? 11 : 4;
      room!.pachinko.bulbs.forEach((bulb: any, i: number) => {
        const lit = Math.floor(t * pkPace + i) % 3 === i % 3;
        bulb.material.color.setHex(lit ? (i % 2 === 0 ? 0x9be8ff : 0xffd97a) : 0x2a3444);
      });
      room!.pachinko.spinner.rotation.z = t * (game === "pachinko" ? 7 : 3);
      room!.winLight.intensity = Math.max(0, fx.flashUntil - t) * 60;
      // Whatever is behind the mystery door, it's awake. The lamp over it
      // flickers like bad wiring — two incommensurate sines and a random
      // dropout — and both flicker harder when someone stands looking.
      const dropout = Math.sin(t * 11.3) * Math.sin(t * 5.1) < -0.88 ? 0.15 : 1;
      const flicker = (0.55 + 0.45 * Math.abs(Math.sin(t * 7.3) + Math.sin(t * 17.7) * 0.4) * 0.7) * dropout;
      room!.doorLight.intensity = (game === "door" ? 6 : 2.4) * flicker + (t < doorFlareUntil ? 9 : 0);
      room!.doorGlow.material.opacity =
        (0.45 + Math.sin(t * 0.7) * 0.2 + Math.max(0, Math.sin(t * 0.13) - 0.98) * 12 + (t < doorFlareUntil ? 0.35 : 0)) *
        (0.6 + flicker * 0.4);
      // And it hums. Low, patient, only really audible standing at it.
      if (game === "door" && t > nextHum) {
        nextHum = t + 5 + Math.random() * 4;
        sfx.hum(4.5);
      }
      // Three keys turned, and the leaves slide; the light behind takes over.
      doorOpenP += (doorOpenTarget - doorOpenP) * Math.min(1, dt * 1.1);
      room!.door.left.position.x = 4.28 - doorOpenP * 0.72;
      room!.door.right.position.x = 4.92 + doorOpenP * 0.72;
      for (const link of room!.door.chains) link.visible = doorOpenP < 0.02;
      room!.door.blaze.material.opacity = doorOpenP * (0.75 + Math.sin(t * 2.1) * 0.12);
      room!.door.beam.intensity = doorOpenP * (22 + Math.sin(t * 2.6) * 6) * flicker;

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
    room.racePicker.visible = false;
    room.raceTrack.visible = false;
    room.pachinko.ball.visible = false;
    for (const doll of dolls) doll.root.visible = false;
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
          <span>🍐 🍐 🍐 <i>YAY PEARS — the rarest line there is</i></span><b>×120</b>
          <span lang="ja">７ ７ ７</span><b>×40</b>
          <span lang="ja">ゆ ゆ ゆ</span><b>×25</b>
          <span>🐱 🐱 🐱</span><b>×20</b>
          <span>🐟 🐟 🐟</span><b>×16</b>
          <span>🥫 🥫 🥫</span><b>×12</b>
          <span lang="ja">月月月 / ☆☆☆</span><b>×6</b>
          <span lang="ja">ゆ ＋ 🐟 <i>it thinks it's a fish</i></span><b>×2</b>
          <span>🐱 ＋ 🐟 <i>the cat gets it</i></span><b>×2</b>
          <span lang="ja">月・☆ only <i>clear night sky</i></span><b>×2</b>
          <span lang="ja">７ ７ pair</span><b>×2</b>
          <span>🥫 🥫 pair</span><b>×1.5</b>
          <span lang="ja">ゆ ゆ pair</span><b>×1.5</b>
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

  // ---- pachinko ----

  const drawPachinko = (): void => {
    hideDice();
    gameBox.innerHTML = `
      ${betRow()}
      <div class="cas-dial-row">
        <span class="glosses">soft</span>
        <input type="range" id="cas-dial" min="0" max="100" value="55">
        <span class="glosses">hard</span>
      </div>
      <div class="row-actions" style="justify-content:center">
        <button id="cas-launch" class="cas-big">LAUNCH — <span id="cas-cost">${bet}</span> ¥</button>
      </div>
      <div class="cas-result" id="cas-result">The plunger takes whoever is nearest. Harder comes in further left. Centre pocket ×8, neighbours ×2.</div>
    `;
    wireBets(() => {
      const cost = gameBox.querySelector("#cas-cost");
      if (cost) cost.textContent = String(bet);
    });
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;
    const dial = gameBox.querySelector<HTMLInputElement>("#cas-dial")!;
    gameBox.querySelector<HTMLButtonElement>("#cas-launch")!.addEventListener("click", async () => {
      if (!room || !(await take(bet))) return;
      busy = true;
      const stake = bet;
      result.textContent = "…";
      const { ball, pegs } = room.pachinko;
      // One of the girls, at palm size, in place of the steel ball. The
      // ball itself only flies if the models never arrived.
      const doll = dolls.length > 0 ? dolls[Math.floor(Math.random() * dolls.length)] : null;
      const body = doll ? doll.root : ball;
      const bodyZ = doll ? 0.06 : 0.04;
      const who = doll ? doll.name : "The ball";
      const strength = Number(dial.value) / 100;
      // Up the right rail, over the top, and in — the dial decides how far
      // across the board the launch comes down, give or take a wobble.
      const entryX = Math.max(-0.38, Math.min(0.3, -0.36 + (1 - strength) * 0.62 + (Math.random() - 0.5) * 0.08));
      body.visible = true;
      body.rotation.set(0, 0, 0);
      sfx.whoosh();
      if (doll) sfx.boing();
      await new Promise<void>((resolve) => {
        const start = performance.now();
        const RAIL = 620;
        let whistled = false;
        const tick = (): void => {
          if (mySeq !== seq) return resolve();
          const p = Math.min(1, (performance.now() - start) / RAIL);
          if (p < 0.45) {
            const q = p / 0.45;
            body.position.set(0.45, -0.5 + q * 1.12, bodyZ);
          } else {
            const q = (p - 0.45) / 0.55;
            body.position.set(0.45 + (entryX - 0.45) * q, 0.62 + Math.sin(q * Math.PI) * 0.06, bodyZ);
            if (doll && !whistled) {
              whistled = true;
              sfx.falling(0.9); // the launch, from her side of it
            }
          }
          if (doll) {
            // A full cartwheel up the rail and over the top.
            body.rotation.z = p * Math.PI * 2;
            pose(doll.bones, "flail", 1, performance.now() / 1000);
          }
          if (p >= 1) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      // Board physics, the honest kind: gravity, brass pins, side walls.
      // Every collision is a real reflection with a little randomness, so
      // the same dial setting never falls the same way twice.
      let x = entryX;
      let y = 0.64;
      let vx = -0.05 - strength * 0.15;
      let vy = 0;
      let spin = (Math.random() - 0.5) * 8;
      let angle = 0;
      let lastPing = 0;
      await new Promise<void>((resolve) => {
        let previous = performance.now();
        const step = (): void => {
          if (mySeq !== seq) return resolve();
          const now = performance.now();
          const dt = Math.min(0.024, (now - previous) / 1000);
          previous = now;
          vy -= 1.9 * dt;
          x += vx * dt;
          y += vy * dt;
          for (const peg of pegs) {
            const dx = x - peg.x;
            const dy = y - peg.y;
            const d2 = dx * dx + dy * dy;
            const R = 0.038;
            if (d2 < R * R && d2 > 1e-8) {
              const d = Math.sqrt(d2);
              const nx = dx / d;
              const ny = dy / d;
              x = peg.x + nx * R;
              y = peg.y + ny * R;
              const dot = vx * nx + vy * ny;
              if (dot < 0) {
                vx -= 1.45 * dot * nx;
                vy -= 1.45 * dot * ny;
                vx += (Math.random() - 0.5) * 0.3;
                spin = (Math.random() - 0.5) * 16; // a fresh tumble per pin
                if (now - lastPing > 60) {
                  lastPing = now;
                  sfx.ping();
                }
              }
            }
          }
          if (x < -0.43) {
            x = -0.43;
            vx = Math.abs(vx) * 0.5;
          }
          if (x > 0.45) {
            x = 0.45;
            vx = -Math.abs(vx) * 0.5;
          }
          body.position.set(x, y, bodyZ);
          if (doll) {
            angle += spin * dt;
            spin *= 1 - 0.25 * dt;
            body.rotation.z = angle;
            pose(doll.bones, "flail", 1, now / 1000);
          }
          if (y <= -0.5) return resolve();
          requestAnimationFrame(step);
        };
        step();
      });
      const mult = pocketMult(x);
      // Whoever it was drops into whichever pocket they earned.
      await new Promise<void>((resolve) => {
        const start = performance.now();
        const fromY = y;
        const tick = (): void => {
          if (mySeq !== seq) return resolve();
          const p = Math.min(1, (performance.now() - start) / 240);
          body.position.y = fromY - p * 0.1;
          if (doll) body.rotation.z = angle + p * 0.6;
          if (p >= 1) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      body.visible = false;
      if (doll) pose(doll.bones, "clear", 1);
      sfx.clatter();
      const won = Math.floor(stake * mult);
      await payout(won);
      if (mult >= 8) {
        celebrate(true, [-4.3, 2.2, MZ + 0.6]);
        react(0, "cheer");
        result.textContent = `${who} lands in the centre pocket! +${formatYennies(won)}`;
      } else if (mult > 0) {
        celebrate(false, [-4.3, 2.2, MZ + 0.6]);
        result.textContent = `${who} finds a side pocket. +${formatYennies(won)}`;
      } else {
        sfx.growl();
        result.textContent = doll
          ? `${who} drops out the bottom. She's fine. Probably.`
          : "Through the pins and out the bottom. The house keeps the ball.";
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

  /** Two cups trade places, one arcing over the other, at the given tempo. */
  const swapCups = (a: any, b: any, duration = 240): Promise<void> =>
    new Promise((resolve) => {
      const start = performance.now();
      const ax = a.position.x;
      const bx = b.position.x;
      const arcHeight = 0.1 + Math.random() * 0.1;
      sfx.whoosh();
      const tick = (): void => {
        if (mySeq !== seq) return resolve();
        const p = Math.min(1, (performance.now() - start) / duration);
        const arc = Math.sin(p * Math.PI) * arcHeight;
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
      // The dance, and Chito is not being fair about it: a different number
      // of trades every game, each at its own tempo — some almost lazy,
      // some too fast to follow, with the cruellest bursts saved for the
      // end when your eyes are already tired.
      const trades = 13 + Math.floor(Math.random() * 6);
      for (let n = 0; n < trades; n++) {
        const s1 = Math.floor(Math.random() * 3);
        let s2 = Math.floor(Math.random() * 3);
        while (s2 === s1) s2 = Math.floor(Math.random() * 3);
        const lateGame = n / trades;
        const tempo = 90 + Math.random() * (220 - lateGame * 120);
        await swapCups(room.cups[atSpot[s1]], room.cups[atSpot[s2]], tempo);
        const held = atSpot[s1];
        atSpot[s1] = atSpot[s2];
        atSpot[s2] = held;
        if (fishAt === s1) fishAt = s2;
        else if (fishAt === s2) fishAt = s1;
        // An occasional breath between trades, so the speed never settles
        // into a rhythm you can ride.
        if (Math.random() < 0.2) await new Promise((r) => setTimeout(r, 120 + Math.random() * 240));
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

  const RACE_START = -3.0;
  const RACE_END = 2.9;
  const RACE_LANES = [RACE_Z + 0.45, RACE_Z, RACE_Z - 0.45];
  const RACE_NAMES = ["the teal one", "the orange one", "the ivory one"];

  /** Every can back on its seat, upright, ready to be knocked off again. */
  const seatTheCrowd = (): void => {
    if (!room) return;
    for (const can of room.cans) {
      const seat = can.userData.seat;
      can.position.set(seat.x, seat.y, seat.z);
      can.rotation.set(0, 0, seat.lean);
    }
  };

  const drawRace = (): void => {
    hideDice();
    if (room) {
      room.raceTrack.visible = true;
      seatTheCrowd();
    }
    gameBox.innerHTML = `
      ${betRow()}
      <div class="row-actions" style="justify-content:center">
        <button class="cas-big" data-fish="0">🩵 TEAL</button>
        <button class="cas-big" data-fish="1">🧡 ORANGE</button>
        <button class="cas-big" data-fish="2">🤍 IVORY</button>
      </div>
      <div class="cas-result" id="cas-result">A track of scrap, a crowd of cans, no water anywhere. Pick yours; the winner pays ×2.7.</div>
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
        seatTheCrowd();
        room.racers.forEach((racer: any, i: number) => {
          racer.visible = true;
          racer.position.set(RACE_START, 0.14, RACE_LANES[i]);
          racer.rotation.y = 0; // the tail is already at the back; nose to the finish
        });
        // Yours, marked, from the off.
        room.racePicker.visible = true;
        room.racePicker.position.set(RACE_START, 0.62, RACE_LANES[pick]);
        const speeds = [0, 0, 0].map(() => 0.55 + Math.random() * 0.2);
        // Race events: a burst, a stall, a can on the track, a rattling
        // crowd — each holds a per-fish multiplier for a moment.
        const boosts: { mult: number; until: number }[] = [0, 0, 0].map(() => ({ mult: 1, until: 0 }));
        let nextEvent = performance.now() + 1100 + Math.random() * 900;
        let rattleUntil = 0;
        let winner = -1;
        let lastSplash = 0;
        await new Promise<void>((resolve) => {
          let previous = performance.now();
          const tick = (): void => {
            if (mySeq !== seq || !room) return resolve();
            const now = performance.now();
            const dt = Math.min(0.05, (now - previous) / 1000);
            previous = now;
            const leading = Math.max(...room.racers.map((racer: any) => racer.position.x));
            if (now > nextEvent && leading < RACE_END - 0.9) {
              nextEvent = now + 1400 + Math.random() * 1200;
              const who = Math.floor(Math.random() * 3);
              const what = Math.floor(Math.random() * 4);
              if (what === 0) {
                boosts[who] = { mult: 2.3, until: now + 750 };
                result.textContent = `${RACE_NAMES[who]} surges ahead!`;
                sfx.whoosh();
              } else if (what === 1) {
                boosts[who] = { mult: 0.05, until: now + 750 };
                result.textContent = `${RACE_NAMES[who]} stops to think about water.`;
                sfx.boing();
              } else if (what === 2) {
                // A spectator comes off the bench and onto the track,
                // right in somebody's lane.
                const fallen = room.cans[Math.floor(Math.random() * room.cans.length)];
                fallen.position.set(
                  room.racers[who].position.x + 0.5,
                  0.075,
                  RACE_LANES[who] + (Math.random() - 0.5) * 0.2,
                );
                fallen.rotation.set(0, Math.random() * 3, Math.PI / 2);
                boosts[who] = { mult: 0.35, until: now + 950 };
                result.textContent = `A can rolls into ${RACE_NAMES[who]}'s lane!`;
                sfx.clatter();
              } else {
                rattleUntil = now + 1300;
                result.textContent = "The crowd is rattling!";
                sfx.clatter();
                sfx.bell();
              }
            }
            room.racers.forEach((racer: any, i: number) => {
              // Wandering speeds, so the lead trades hands.
              speeds[i] = Math.max(0.3, Math.min(1.1, speeds[i] + (Math.random() - 0.5) * 0.12));
              const boost = now < boosts[i].until ? boosts[i].mult : 1;
              racer.position.x += speeds[i] * boost * dt;
              const wriggle = boost < 0.5 ? 2.2 : 1; // a stalled fish panics
              racer.position.y = 0.14 + Math.abs(Math.sin(now / 90 + i * 2)) * 0.05 * wriggle;
              racer.rotation.z = Math.sin(now / 70 + i) * 0.25 * wriggle;
              if (racer.position.x >= RACE_END && winner < 0) winner = i;
            });
            // The arrow rides over its fish, bobbing on its own beat so it
            // reads as a marker and not as something the fish is wearing.
            const mine = room.racers[pick];
            room.racePicker.position.set(
              mine.position.x,
              mine.position.y + 0.4 + Math.abs(Math.sin(now / 260)) * 0.05,
              RACE_LANES[pick],
            );
            // The camera trots alongside the pack, and the room's own
            // lerp keeps the ride smooth.
            const packX = Math.max(
              -2.6,
              Math.min(2.6, room.racers.reduce((sum: number, racer: any) => sum + racer.position.x, 0) / 3),
            );
            zoomTarget = { pos: [packX * 0.92, 1.8, RACE_Z + 2.9], look: [packX, 0.25, RACE_Z] };
            zoomUntil = now / 1000 + 0.6;
            if (now < rattleUntil) {
              room.cans.forEach((can: any, i: number) => {
                if (can.rotation.z > 1) return; // the fallen stay fallen
                can.position.y = can.userData.seat.y + Math.abs(Math.sin(now / 55 + i * 1.7)) * 0.03;
              });
            }
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
        // Hold on the finish line for a beat, then drift back out wide.
        zoomTarget = { pos: [2.3, 1.8, RACE_Z + 2.9], look: [RACE_END, 0.3, RACE_Z] };
        zoomUntil = performance.now() / 1000 + 2.4;
        if (winner === pick) {
          await payout(Math.floor(stake * 2.7));
          celebrate(false, [RACE_END, 1.2, RACE_Z]);
          react(0, "cheer");
          result.textContent = `${RACE_NAMES[winner]} takes it! +${formatYennies(Math.floor(stake * 2.7) - stake)}`;
        } else {
          sfx.growl();
          react(0, "hurt", 1.8);
          result.textContent = `${RACE_NAMES[winner]} takes it. Yours is still apologising.`;
        }
        busy = false;
      });
    }
  };

  // ---- the mystery door ----

  /** The one currency Yuuri respects. */
  const BENTO_ID = "item-bag-of-food";
  const BRIBE_GOAL = 5;
  const BRIBE_KEY = "yuuriDoorBribes";

  const drawDoor = (): void => {
    hideDice();
    // The door remembers: keys already turned stay turned, and a fully
    // keyed door stands open before anyone presses anything.
    void (async () => {
      const inserted = await insertedDoorKeys();
      if (!room) return;
      for (const id of inserted) {
        const hole = room.door.keyholes[DOOR_KEY_IDS.indexOf(id)];
        if (hole) {
          hole.key.visible = true;
          hole.key.position.z = -6.07;
          hole.key.rotation.z = 0;
        }
      }
      if (inserted.length >= DOOR_KEY_IDS.length) doorOpenTarget = 1;
    })();
    gameBox.innerHTML = `
      <div class="row-actions" style="justify-content:center" id="cas-door-actions">
        <button id="cas-door" class="cas-big">TRY THE DOOR</button>
      </div>
      <div class="cas-result" id="cas-result">Chained shut. Three dark keyholes. Warm to stand near. Humming, slightly.</div>
    `;
    const actions = gameBox.querySelector<HTMLDivElement>("#cas-door-actions")!;
    const result = gameBox.querySelector<HTMLDivElement>("#cas-result")!;

    const armTry = (): void => {
      actions.innerHTML = `<button id="cas-door" class="cas-big">TRY THE DOOR</button>`;
      actions.querySelector<HTMLButtonElement>("#cas-door")!.addEventListener("click", () => void tryDoor());
    };

    /** She stands down and the camera lets go of the door. */
    const dismiss = (): void => {
      if (guard) guard.leave = performance.now() / 1000;
      zoomUntil = performance.now() / 1000 + 1.2;
      sfx.whoosh();
    };

    const wireBack = (): void => {
      actions.querySelector<HTMLButtonElement>("#cas-back")?.addEventListener("click", () => {
        dismiss();
        armTry();
        result.textContent = "Chained shut. Three dark keyholes. Warm to stand near. Humming, slightly.";
        busy = false;
      });
    };

    /** The choice, once she is up: retreat, or open the lunch negotiations. */
    const offerChoices = async (): Promise<void> => {
      const held = (await itemCounts())[BENTO_ID] ?? 0;
      const paid = (await getMeta<number>(BRIBE_KEY)) ?? 0;
      result.textContent =
        held > 0
          ? `She points you back to the games. She has also noticed your ${held > 1 ? "bento boxes" : "bento box"}.`
          : "She points you back to the games, and won't say what's behind it.";
      actions.innerHTML =
        `<button id="cas-back" class="secondary">Go back</button>` +
        (held > 0 ? `<button id="cas-bribe" class="cas-big">🍱 Bribe Yuuri (×${held})</button>` : "");
      wireBack();
      actions.querySelector<HTMLButtonElement>("#cas-bribe")?.addEventListener("click", () => {
        void (async () => {
          const gave = await takeItems(BENTO_ID, BRIBE_GOAL * 2);
          if (gave <= 0) return;
          const total = Math.min(BRIBE_GOAL, paid + gave);
          await setMeta(BRIBE_KEY, total);
          actions.innerHTML = "";
          if (guard) guard.joy = true;
          sfx.open();
          sfx.bell();
          setTimeout(() => sfx.boing(), 260);
          result.textContent =
            gave > 1 ? `Yuuri accepts ${gave} bento boxes. All of them. At once.` : "Yuuri accepts the bento box with both hands.";
          setTimeout(() => {
            if (total >= BRIBE_GOAL) {
              result.textContent = "That makes five. She gathers her lunches and stands aside. The door is all yours.";
              dismiss();
              armTry();
              busy = false;
            } else {
              if (guard) guard.joy = false;
              result.textContent = `${total} of ${BRIBE_GOAL} bento boxes so far. She is delighted. She is also still in the way.`;
              actions.innerHTML = `<button id="cas-back" class="secondary">Go back</button>`;
              wireBack();
            }
          }, 2600);
        })();
      });
    };

    const tryDoor = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      const paid = (await getMeta<number>(BRIBE_KEY)) ?? 0;
      const now = performance.now() / 1000;
      zoomTarget = DOOR_ZOOM;
      // The camera stays on the door for as long as she stays in the way.
      zoomUntil = now + (paid >= BRIBE_GOAL ? 9 : 120);
      result.textContent = "…";
      // Your steps, then the chain in your hand.
      sfx.step();
      setTimeout(() => sfx.step(), 320);
      setTimeout(() => sfx.step(), 640);
      setTimeout(() => sfx.creak(), 950);
      if (paid >= BRIBE_GOAL) {
        // Paid in full: nobody comes. Now it is between you, three
        // keyholes, and whatever in your travels happens to fit them.
        const held = await heldDoorKeys();
        const inserted = await insertedDoorKeys();

        if (inserted.length >= DOOR_KEY_IDS.length) {
          // Already open; the visit is its own reward.
          doorOpenTarget = 1;
          setTimeout(() => sfx.hum(4), 1000);
          setTimeout(() => {
            result.textContent = "It stands open. The light inside has a pulse. Nothing in there wants to be hurried.";
            busy = false;
          }, 2200);
          return;
        }

        const nextKey = held.find((id) => !inserted.includes(id));
        if (!nextKey) {
          setTimeout(() => {
            doorFlareUntil = performance.now() / 1000 + 2.2;
            sfx.hum(3);
          }, 1050);
          setTimeout(() => {
            result.textContent =
              inserted.length > 0
                ? `Three keyholes. ${inserted.length} already turned. Nothing else you carry fits.`
                : "No one comes to stop you. Three dark keyholes. Nothing you carry fits them. Yet.";
          }, 1700);
          setTimeout(() => {
            busy = false;
          }, 3400);
          return;
        }

        // Something in your pocket is suddenly warm. It knows which hole.
        const slot = DOOR_KEY_IDS.indexOf(nextKey);
        await insertDoorKey(nextKey);
        const turned = inserted.length + 1;
        setTimeout(() => {
          const hole = room?.door.keyholes[slot];
          if (!hole) return;
          const key = hole.key;
          key.visible = true;
          sfx.whoosh();
          const start = performance.now();
          const tick = (): void => {
            if (mySeq !== seq) return;
            const p = Math.min(1, (performance.now() - start) / 900);
            key.position.z = -5.5 - p * 0.57;
            key.rotation.z = (1 - p) * 2.6;
            if (p >= 1) {
              key.rotation.z = 0;
              sfx.creak();
              sfx.bell();
            } else requestAnimationFrame(tick);
          };
          tick();
        }, 1200);
        if (turned >= DOOR_KEY_IDS.length) {
          setTimeout(() => {
            result.textContent = "The third key turns.";
            sfx.thud();
          }, 2400);
          setTimeout(() => {
            doorOpenTarget = 1;
            doorFlareUntil = performance.now() / 1000 + 3.5;
            sfx.menace(2.6);
            sfx.open();
            setTimeout(() => sfx.bell(), 700);
            result.textContent =
              "The chains let go. The doors part on a light with a pulse in it. What waits inside arrives soon.";
          }, 3400);
          setTimeout(() => {
            busy = false;
          }, 7000);
        } else {
          setTimeout(() => {
            result.textContent = `Something turns, deep in the door. ${turned} of ${DOOR_KEY_IDS.length}.`;
          }, 2500);
          setTimeout(() => {
            busy = false;
          }, 3600);
        }
        return;
      }
      // The door notices — and she is suddenly VERY much in the way.
      setTimeout(() => {
        doorFlareUntil = performance.now() / 1000 + 2.2;
        sfx.menace(1.6);
        guard = { start: performance.now() / 1000, leave: null, joy: false };
        sfx.boing();
      }, 1050);
      setTimeout(() => {
        result.textContent = "Yuuri: だめ。";
        sfx.thud();
      }, 1500);
      setTimeout(() => void offerChoices(), 3100);
    };

    armTry();
  };

  const drawGame = (): void => {
    if (game === "slots") drawSlots();
    else if (game === "pachinko") drawPachinko();
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
