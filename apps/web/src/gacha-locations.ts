/**
 * Where a cutscene happens.
 *
 * Four places, all built from boxes and points at run time — nothing here is
 * downloaded. Each returns an `ambient` called every frame for whatever
 * moves on its own: snow falling, steam rising, fish drifting, a lamp
 * swinging.
 *
 * They are deliberately readable from silhouette and colour rather than
 * detail, because everything past the second row is inside fog anyway, and
 * because a place you can recognise in one glance is the whole job.
 */

export type LocationId = "city" | "cafe" | "bath" | "aquarium" | "classroom";

export interface Location {
  /** Called every frame with the frame delta and the clock. */
  ambient: (dt: number, t: number) => void;
  /** Where the characters stand, and where the camera looks. */
  focusY: number;
}

interface Ctx {
  THREE: any;
  scene: any;
}

/** Points that fall (snow) or rise (steam), wrapping forever. */
function drift(
  { THREE, scene }: Ctx,
  opts: {
    count: number;
    spread: number;
    height: number;
    speed: number;
    size: number;
    colour: number;
    opacity: number;
    up?: boolean;
    z?: [number, number];
  },
): (dt: number) => void {
  const pos = new Float32Array(opts.count * 3);
  const rate = new Float32Array(opts.count);
  const sway = new Float32Array(opts.count);
  const [zNear, zFar] = opts.z ?? [-32, 10];
  for (let i = 0; i < opts.count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * opts.spread;
    pos[i * 3 + 1] = Math.random() * opts.height;
    pos[i * 3 + 2] = zNear + Math.random() * (zFar - zNear);
    rate[i] = opts.speed * (0.5 + Math.random());
    sway[i] = (Math.random() - 0.5) * 0.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: opts.colour,
      size: opts.size,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: false,
    }),
  );
  scene.add(points);

  return (dt: number) => {
    const attr = geo.getAttribute("position");
    for (let i = 0; i < opts.count; i++) {
      let y = attr.getY(i) + (opts.up ? rate[i] : -rate[i]) * dt;
      let x = attr.getX(i) + sway[i] * dt;
      if (opts.up ? y > opts.height : y < 0) {
        y = opts.up ? 0 : opts.height;
        x = (Math.random() - 0.5) * opts.spread;
      }
      attr.setY(i, y);
      attr.setX(i, x);
    }
    attr.needsUpdate = true;
  };
}

function lights({ THREE, scene }: Ctx, sky: number, ground: number, strength: number, sun?: [number, number, number]): void {
  scene.add(new THREE.HemisphereLight(sky, ground, strength));
  if (!sun) return;
  const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
  key.position.set(...sun);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
  scene.add(key);
}

const box = (THREE: any, colour: number, rough = 0.9): any =>
  new THREE.MeshStandardMaterial({ color: colour, roughness: rough });

function slab(ctx: Ctx, material: any, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): any {
  const mesh = new ctx.THREE.Mesh(new ctx.THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  return mesh;
}

// ---------------- the dead city ----------------

function city(ctx: Ctx): Location {
  const { THREE, scene } = ctx;
  const SKY = 0xb9c2cc;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.FogExp2(SKY, 0.055);
  lights(ctx, 0xdfe7ef, 0x5a6270, 2.2, [-6, 12, 5]);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), box(THREE, 0xe8edf2, 1));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const concrete = box(THREE, 0x4a5058, 0.95);
  const snowcap = box(THREE, 0xdde4ea, 1);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 54; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (2.6 + Math.random() * 13);
    const z = -2 - Math.random() * 34;
    const w = 1.4 + Math.random() * 3.4;
    const d = 1.4 + Math.random() * 3.4;
    const h = 2 + Math.random() * 13;
    const tower = new THREE.Mesh(cube, concrete);
    tower.scale.set(w, h, d);
    tower.position.set(x, h / 2, z);
    tower.rotation.y = Math.random() * Math.PI;
    if (Math.random() < 0.22) tower.rotation.z = (Math.random() - 0.5) * 0.3;
    tower.castShadow = true;
    tower.receiveShadow = true;
    scene.add(tower);

    const cap = new THREE.Mesh(cube, snowcap);
    cap.scale.set(w * 1.02, 0.18, d * 1.02);
    cap.position.set(x, h + 0.09, z);
    cap.rotation.copy(tower.rotation);
    scene.add(cap);
  }

  const snow = drift(ctx, {
    count: 1400,
    spread: 34,
    height: 16,
    speed: 1.1,
    size: 0.085,
    colour: 0xffffff,
    opacity: 0.9,
  });
  return { ambient: (dt) => snow(dt), focusY: 0.95 };
}

// ---------------- a cafe that stopped serving ----------------

function cafe(ctx: Ctx): Location {
  const { THREE, scene } = ctx;
  const SKY = 0x2a2119;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.FogExp2(0x3a2f24, 0.07);
  lights(ctx, 0xffd9a0, 0x2a2119, 1.1);

  // One warm lamp over the counter, and the cold coming through the window.
  const lamp = new THREE.PointLight(0xffc477, 26, 14, 2);
  lamp.position.set(0, 3.1, -2.2);
  lamp.castShadow = true;
  scene.add(lamp);
  const shade = slab(ctx, box(THREE, 0x1b1410), 0.9, 0.28, 0.9, 0, 3.35, -2.2);
  const daylight = new THREE.DirectionalLight(0xbcd2e8, 1.4);
  daylight.position.set(7, 5, 3);
  scene.add(daylight);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), box(THREE, 0x4a3524, 0.95));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wall = box(THREE, 0x3b2e22, 1);
  slab(ctx, wall, 22, 7, 0.4, 0, 3.5, -9); // back
  slab(ctx, wall, 0.4, 7, 20, -9, 3.5, -1); // left
  // The right wall has fallen away; the weather comes in there.
  slab(ctx, wall, 0.4, 7, 7, 9, 3.5, -6.5);
  slab(ctx, box(THREE, 0x2b211a), 22, 0.4, 20, 0, 7, -1); // ceiling

  // Counter, stools, a couple of tables.
  const wood = box(THREE, 0x6b4a2e, 0.8);
  slab(ctx, wood, 8, 1.1, 1.2, 0, 0.55, -3.4);
  slab(ctx, box(THREE, 0x8a6440, 0.6), 8.4, 0.14, 1.5, 0, 1.16, -3.4);
  for (const x of [-2.4, -0.8, 0.8, 2.4]) {
    slab(ctx, box(THREE, 0x51392a), 0.18, 0.75, 0.18, x, 0.38, -2.1);
    slab(ctx, box(THREE, 0x7a5236, 0.7), 0.62, 0.12, 0.62, x, 0.8, -2.1);
  }
  for (const [x, z] of [
    [-4.6, 0.6],
    [4.2, 0.2],
  ]) {
    slab(ctx, box(THREE, 0x51392a), 0.2, 0.7, 0.2, x, 0.35, z);
    slab(ctx, box(THREE, 0x7a5236, 0.7), 1.5, 0.12, 1.5, x, 0.76, z);
  }
  // Shelves of things nobody will drink.
  for (let i = 0; i < 14; i++) {
    slab(
      ctx,
      box(THREE, [0x8d9aa5, 0x6f7f6a, 0x93704a][i % 3], 0.5),
      0.22,
      0.42 + Math.random() * 0.2,
      0.22,
      -3.4 + i * 0.5,
      2.0,
      -8.5,
    );
  }
  slab(ctx, wall, 8, 0.16, 0.7, 0, 1.72, -8.5);

  // Snow blowing in through the gap where the wall used to be.
  const flurry = drift(ctx, {
    count: 320,
    spread: 8,
    height: 7,
    speed: 1.4,
    size: 0.06,
    colour: 0xffffff,
    opacity: 0.75,
    z: [-3, 4],
  });
  return {
    ambient: (dt, t) => {
      flurry(dt);
      // The lamp never quite settles.
      shade.rotation.z = Math.sin(t * 0.9) * 0.06;
      shade.position.x = Math.sin(t * 0.9) * 0.22;
      lamp.position.x = shade.position.x;
      lamp.intensity = 26 + Math.sin(t * 7.3) * 2.5;
    },
    focusY: 0.95,
  };
}

// ---------------- a bath, still somehow hot ----------------

function bath(ctx: Ctx): Location {
  const { THREE, scene } = ctx;
  scene.background = new THREE.Color(0xd8e3e8);
  scene.fog = new THREE.FogExp2(0xdbe6ea, 0.1);
  lights(ctx, 0xfdf6ec, 0x8fa3ad, 2.4, [-3, 9, 6]);

  const tile = box(THREE, 0xcfd9dd, 0.6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), box(THREE, 0xc4ced3, 0.7));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  slab(ctx, tile, 20, 6, 0.4, 0, 3, -8);
  slab(ctx, tile, 0.4, 6, 16, -7, 3, -1);
  slab(ctx, tile, 0.4, 6, 16, 7, 3, -1);

  // The bath: a sunken rectangle of water with a rim around it.
  const rim = box(THREE, 0xb9c6cc, 0.5);
  slab(ctx, rim, 7.4, 0.5, 0.5, 0, 0.25, 1.1);
  slab(ctx, rim, 7.4, 0.5, 0.5, 0, 0.25, -3.1);
  slab(ctx, rim, 0.5, 0.5, 4.7, -3.45, 0.25, -1);
  slab(ctx, rim, 0.5, 0.5, 4.7, 3.45, 0.25, -1);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, 4.1),
    new THREE.MeshStandardMaterial({ color: 0x7fc4d8, roughness: 0.15, transparent: true, opacity: 0.86 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.34, -1);
  scene.add(water);

  // Pipes along the back wall, one of them dripping into the bath.
  for (const x of [-4.4, 4.4]) slab(ctx, box(THREE, 0x8d9299, 0.4), 0.28, 5.4, 0.28, x, 2.7, -7.6);
  slab(ctx, box(THREE, 0x8d9299, 0.4), 9.2, 0.26, 0.26, 0, 4.6, -7.6);
  const spout = slab(ctx, box(THREE, 0x8d9299, 0.4), 0.22, 1.1, 0.22, 0, 3.9, -7.2);

  const steam = drift(ctx, {
    count: 420,
    spread: 7,
    height: 5.5,
    speed: 0.55,
    size: 0.22,
    colour: 0xffffff,
    opacity: 0.28,
    up: true,
    z: [-3.2, 1.2],
  });
  return {
    ambient: (dt, t) => {
      steam(dt);
      // The surface moves, slightly, forever.
      water.position.y = 0.34 + Math.sin(t * 1.5) * 0.015;
      spout.rotation.z = Math.sin(t * 0.6) * 0.02;
    },
    focusY: 0.8,
  };
}

// ---------------- something still lit, underwater ----------------

function aquarium(ctx: Ctx): Location {
  const { THREE, scene } = ctx;
  scene.background = new THREE.Color(0x04121c);
  scene.fog = new THREE.FogExp2(0x06202e, 0.09);
  lights(ctx, 0x3fa8d8, 0x041018, 0.9);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), box(THREE, 0x11242e, 0.8));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  slab(ctx, box(THREE, 0x0d1b24, 0.9), 0.5, 8, 18, -8, 4, -2);
  slab(ctx, box(THREE, 0x0d1b24, 0.9), 0.5, 8, 18, 8, 4, -2);

  // The tank fills the back wall and is the only thing lit.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(14, 6.4, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0x2f9fc4,
      roughness: 0.08,
      transparent: true,
      opacity: 0.42,
      emissive: 0x0d5f7d,
      emissiveIntensity: 0.8,
    }),
  );
  glass.position.set(0, 3.3, -7.4);
  scene.add(glass);
  const glow = new THREE.PointLight(0x59d3f5, 40, 26, 2);
  glow.position.set(0, 3.2, -6.2);
  scene.add(glow);
  slab(ctx, box(THREE, 0x0a1a22, 0.8), 15, 0.6, 1.2, 0, 0.3, -7.4);
  slab(ctx, box(THREE, 0x0a1a22, 0.8), 15, 0.5, 1.2, 0, 6.7, -7.4);

  // Fish, drifting inside it.
  const fish: any[] = [];
  const fishGeo = new THREE.SphereGeometry(0.16, 8, 6);
  for (let i = 0; i < 26; i++) {
    const one = new THREE.Mesh(
      fishGeo,
      new THREE.MeshStandardMaterial({
        color: [0xf0a860, 0xe8e2d2, 0x8fd8f0][i % 3],
        emissive: 0x214a5c,
        emissiveIntensity: 0.4,
        roughness: 0.5,
      }),
    );
    one.scale.set(1.6, 0.85, 0.7);
    one.position.set(-6 + Math.random() * 12, 1.1 + Math.random() * 4.6, -7.4 + (Math.random() - 0.5) * 0.2);
    one.userData = { speed: 0.35 + Math.random() * 0.7, phase: Math.random() * 10 };
    scene.add(one);
    fish.push(one);
  }

  const motes = drift(ctx, {
    count: 260,
    spread: 15,
    height: 7,
    speed: 0.18,
    size: 0.05,
    colour: 0x9fe4ff,
    opacity: 0.5,
    up: true,
    z: [-7.5, -6.5],
  });

  return {
    ambient: (dt, t) => {
      motes(dt);
      for (const one of fish) {
        const { speed, phase } = one.userData;
        one.position.x += speed * dt;
        if (one.position.x > 6.6) one.position.x = -6.6;
        one.position.y += Math.sin(t * 1.6 + phase) * dt * 0.3;
        one.rotation.z = Math.sin(t * 6 + phase) * 0.12;
      }
      glow.intensity = 40 + Math.sin(t * 2.1) * 5;
    },
    focusY: 1.0,
  };
}


// ---------------- the destroyed classroom ----------------

/**
 * A school nobody dismissed. Half the roof is gone, one wall with it; dust
 * hangs in the light from the hole. The whiteboard survived, which is how
 * it goes: everything falls down except the homework.
 *
 * The board is a canvas texture, so the chalk on it is drawn, not downloaded
 * — a big ゆ front and centre, the faded ghosts of older lessons around it.
 */
function classroom(ctx: Ctx): Location {
  const { THREE, scene } = ctx;
  const DUSK = 0x8f8577;
  scene.background = new THREE.Color(DUSK);
  scene.fog = new THREE.FogExp2(DUSK, 0.035);
  lights(ctx, 0xcfc6b4, 0x4a443c, 1.6, [3.5, 9, 2]);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), box(THREE, 0x8a7358, 1));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const plaster = box(THREE, 0xb0a692);
  // Back wall, whole — it holds the board. One side wall whole, the other
  // broken to a stub with the sky showing through.
  slab(ctx, plaster, 14, 4.2, 0.3, 0, 2.1, -4.4);
  slab(ctx, plaster, 0.3, 4.2, 12, -5.2, 2.1, 1);
  slab(ctx, plaster, 0.3, 1.4, 4, 5.2, 0.7, -2.2);
  slab(ctx, plaster, 0.3, 2.2, 2.4, 5.2, 1.1, 3.4);
  // Half a roof: the missing half is where the light comes from.
  slab(ctx, box(THREE, 0x6e6355), 14, 0.25, 6, 0, 4.25, -1.6);

  // The whiteboard: frame, then the chalk.
  slab(ctx, box(THREE, 0x54483a), 3.9, 2.2, 0.1, 0, 1.75, -4.24);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.fillStyle = "#2e4438";
    paint.fillRect(0, 0, 1024, 512);
    // Older lessons, half erased.
    paint.fillStyle = "rgba(235, 235, 225, 0.16)";
    paint.font = "64px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
    paint.fillText("\u306f \u3072 \u3075 \u3078 \u307b", 70, 110);
    paint.fillText("\u3084  \u3086  \u3088", 620, 430);
    // Smudges where an eraser gave up.
    for (let i = 0; i < 7; i++) {
      paint.fillStyle = "rgba(220, 220, 210, 0.05)";
      paint.fillRect(80 + i * 130, 180 + (i % 3) * 90, 110, 46);
    }
    // Today's lesson, front and centre, pressed hard.
    paint.fillStyle = "rgba(246, 246, 238, 0.92)";
    paint.font = "bold 300px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
    paint.fillText("\u3086", 380, 400);
    paint.strokeStyle = "rgba(246, 246, 238, 0.75)";
    paint.lineWidth = 7;
    paint.beginPath();
    paint.moveTo(360, 440);
    paint.lineTo(700, 448);
    paint.stroke();
  }
  const chalk = new THREE.CanvasTexture(canvas);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.9),
    new THREE.MeshBasicMaterial({ map: chalk }),
  );
  board.position.set(0, 1.75, -4.18);
  scene.add(board);

  // Desks: two standing, two thrown. A chair on its side under the hole.
  const wood = box(THREE, 0x7a6248);
  const desk = (x: number, z: number, tipped = false): void => {
    const top = slab(ctx, wood, 0.95, 0.06, 0.6, x, tipped ? 0.34 : 0.66, z);
    const leg = slab(ctx, wood, 0.08, 0.6, 0.5, x, tipped ? 0.2 : 0.36, z);
    if (tipped) {
      top.rotation.z = 1.35;
      leg.rotation.z = 1.35;
      top.position.y = 0.5;
    }
  };
  desk(-0.6, -1.6);
  desk(1.4, -0.9);
  desk(-2.6, -0.4, true);
  desk(3.1, 0.9, true);
  slab(ctx, wood, 0.45, 0.5, 0.45, 4.1, 0.22, -0.8).rotation.z = 1.5;

  // Rubble where the wall used to be.
  for (let i = 0; i < 9; i++) {
    const bit = slab(
      ctx,
      plaster,
      0.3 + (i % 3) * 0.25,
      0.2 + (i % 2) * 0.18,
      0.3 + ((i + 1) % 3) * 0.2,
      4.4 + (i % 3) * 0.5,
      0.12 + (i % 2) * 0.1,
      0.2 + i * 0.34 - 1.4,
    );
    bit.rotation.y = i * 0.7;
  }

  // Dust, hanging in the light from the missing roof.
  const dust = drift(ctx, {
    count: 60,
    spread: 9,
    height: 3.8,
    speed: 0.06,
    size: 0.045,
    colour: 0xd8cfb8,
    opacity: 0.35,
    up: true,
    z: [-4, 2],
  });

  return { ambient: (dt) => dust(dt), focusY: 1.0 };
}

const BUILDERS: Record<LocationId, (ctx: Ctx) => Location> = { city, cafe, bath, aquarium, classroom };

export function buildLocation(id: LocationId, THREE: any, scene: any): Location {
  return (BUILDERS[id] ?? city)({ THREE, scene });
}
