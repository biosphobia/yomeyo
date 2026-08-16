import { KANA_GROUPS, isCorrect, type KanaEntry } from "./kana-data.js";
import { createSfx } from "./gacha-audio.js";
import { startGameSession } from "./kana-stats.js";
import { recordQuestEvent, recordQuestEvents } from "./quests.js";
import { unlockAchievement } from "./achievements.js";
import { earnYennies } from "./yennies.js";
import { assetUrl } from "./store.js";
import { toast } from "./toast.js";

/**
 * The hiragana exam: every single hiragana, one timer, four lives — and the
 * whole time, a giant Yuuri chasing a small Chito across the top of the
 * screen.
 *
 * The chase IS the exam state. Chito's lead is your lives: every miss or
 * timeout brings Yuuri thundering closer, every answer keeps Chito ahead,
 * and the last life lost is Yuuri catching her. There is no separate
 * health bar to glance at, because the thing you would glance at is the
 * thing already happening in front of you.
 *
 * The music is built from oscillators, like everything else here that
 * makes a sound: a low ostinato in A minor that tightens and climbs as
 * lives fall away. No file is downloaded and the whole score is numbers.
 */

const LIVES = 4;
/** Seconds to answer one kana. The clock, not the typing, is the exam. */
const SECONDS_PER_KANA = 7;
/** The prize for making it out. */
const REWARD = 300;

/** Every hiragana with a sound of its own: rows 1-15. The small tsu has no
 * sound to answer with, so it stays in its word drills. */
function examPool(): KanaEntry[] {
  return KANA_GROUPS.filter((group) => group.script === "hiragana" && group.id !== "hiragana-16").flatMap(
    (group) => group.entries,
  );
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------- the music ----------------

interface Music {
  /** 0 = four lives and all is well; 1 = one mistake from the teeth. */
  intensity(level: number): void;
  victory(): void;
  stop(): void;
}

const NO_MUSIC: Music = { intensity: () => undefined, victory: () => undefined, stop: () => undefined };

/**
 * An epic in four oscillators.
 *
 * A driving eighth-note bass on A, a minor arpeggio over it, and a low
 * fifth droning underneath. Intensity raises the tempo, opens a filter and
 * lets the arpeggio climb an octave — the same trick film scores use,
 * which is to say the chase gets faster because the music got scared.
 */
function startMusic(): Music {
  let ctx: AudioContext;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return NO_MUSIC;
    ctx = new Ctor();
  } catch {
    return NO_MUSIC;
  }
  void ctx.resume?.().catch(() => undefined);

  const master = ctx.createGain();
  master.gain.value = 0.16;
  const brightness = ctx.createBiquadFilter();
  brightness.type = "lowpass";
  brightness.frequency.value = 900;
  brightness.connect(master).connect(ctx.destination);

  // The drone: A1 and its fifth, held for the whole exam.
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.4;
  droneGain.connect(brightness);
  const drones: OscillatorNode[] = [55, 82.4].map((hz) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = hz;
    osc.connect(droneGain);
    osc.start();
    return osc;
  });

  let level = 0;
  let stopped = false;
  let nextBeat = ctx.currentTime + 0.1;
  let step = 0;

  // A minor, as MIDI-ish frequencies: A2 C3 E3 G3 A3 C4 E4.
  const LADDER = [110, 130.8, 164.8, 196, 220, 261.6, 329.6];
  const PATTERN = [0, 2, 1, 2, 3, 2, 4, 2];

  const note = (hz: number, at: number, seconds: number, gain: number, type: OscillatorType): void => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(g).connect(brightness);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  };

  // Scheduled a beat ahead of the clock, the way Web Audio wants it.
  const schedule = (): void => {
    if (stopped) return;
    const beat = 0.24 - level * 0.055; // 125bpm eighths → 155bpm at the teeth
    while (nextBeat < ctx.currentTime + 0.3) {
      // Bass: hammering eighths, harder as it climbs.
      note(55 * (step % 8 === 6 ? 1.5 : 1), nextBeat, beat * 0.9, 0.5 + level * 0.3, "square");
      // The arpeggio, an octave up when things get bad.
      const rung = PATTERN[step % 8] + (level > 0.6 ? 2 : 0);
      note(LADDER[Math.min(rung, LADDER.length - 1)], nextBeat, beat * 1.6, 0.24, "triangle");
      // A war drum on the bar line.
      if (step % 8 === 0) note(41, nextBeat, 0.3, 0.9, "sine");
      nextBeat += beat;
      step++;
    }
    timer = window.setTimeout(schedule, 90);
  };
  let timer = window.setTimeout(schedule, 0);

  return {
    intensity(next: number) {
      level = Math.max(0, Math.min(1, next));
      brightness.frequency.linearRampToValueAtTime(900 + level * 2600, ctx.currentTime + 0.4);
    },
    victory() {
      // The chase resolves to the relative major: C, held, with bells.
      stopped = true;
      clearTimeout(timer);
      droneGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      const at = ctx.currentTime + 0.15;
      [130.8, 196, 261.6, 329.6, 523.2].forEach((hz, i) => note(hz, at + i * 0.09, 1.8, 0.3, "triangle"));
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      try {
        for (const drone of drones) drone.stop();
        master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
        window.setTimeout(() => void ctx.close().catch(() => undefined), 600);
      } catch {
        /* closing an already-dead context */
      }
    },
  };
}

// ---------------- the chase ----------------

interface Chase {
  /** 1 = a comfortable lead, 0 = teeth on collar. Animated smoothly. */
  gap(fraction: number): void;
  /** A miss: Yuuri lunges, the ground shakes. */
  lunge(): void;
  /** A correct answer: Chito puts on a burst. */
  burst(): void;
  caught(): void;
  escaped(): void;
  stop(): void;
}

/**
 * Giant Yuuri, small Chito, side on, running for the whole exam.
 *
 * The same models the gacha films use, and the same rule as everywhere
 * else they appear: every failure path collapses to a drawn stand-in, and
 * a missing model never blocks the exam.
 */
async function mountChase(stage: HTMLElement): Promise<Chase> {
  stage.innerHTML = `
    <div class="exam-chase-fallback" aria-hidden="true">
      <span class="exam-yuuri">😤</span>
      <span class="exam-chito">🏃</span>
    </div>`;

  let stopped = false;
  let gapNow = 1;
  let gapTarget = 1;
  let lungeLife = 0;
  let burstLife = 0;
  let ending: "caught" | "escaped" | null = null;
  let endStart = 0;

  const api: Chase = {
    gap: (fraction) => {
      gapTarget = Math.max(0, Math.min(1, fraction));
    },
    lunge: () => {
      lungeLife = 1;
    },
    burst: () => {
      burstLife = 1;
    },
    caught: () => {
      ending = "caught";
      endStart = performance.now();
    },
    escaped: () => {
      ending = "escaped";
      endStart = performance.now();
    },
    stop: () => {
      stopped = true;
    },
  };

  // The emoji stand-in mirrors the gap so the exam works even if three.js
  // never arrives.
  const fallbackYuuri = stage.querySelector<HTMLElement>(".exam-yuuri");
  const fallbackTick = (): void => {
    if (stopped || !fallbackYuuri?.isConnected) return;
    gapNow += (gapTarget - gapNow) * 0.06;
    fallbackYuuri.style.transform = `translateX(${(1 - gapNow) * 90}px) scale(${2.2 + (1 - gapNow)})`;
    requestAnimationFrame(fallbackTick);
  };
  requestAnimationFrame(fallbackTick);

  try {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    if (stopped || !stage.isConnected) return api;

    const width = stage.clientWidth || 340;
    const height = stage.clientHeight || 170;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 60);
    camera.position.set(0, 1.35, 5.4);
    camera.lookAt(0, 1.0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.5);
    sun.position.set(2, 4, 3);
    scene.add(sun);

    // A road of slabs sliding past, which is what says "running" even
    // while both runners hold their screen positions.
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 });
    const slabs: InstanceType<typeof THREE.Mesh>[] = [];
    for (let i = 0; i < 9; i++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 2.2), slabMat);
      slab.position.set(-6 + i * 1.6, -0.06, 0);
      scene.add(slab);
      slabs.push(slab);
    }

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
    // The whole joke, in two numbers.
    yuuri.scale.setScalar(2.6);
    chito.scale.setScalar(0.85);
    yuuri.rotation.y = Math.PI / 2 - 0.25; // facing the way she is running
    chito.rotation.y = Math.PI / 2 + 0.15;
    scene.add(yuuri, chito);

    stage.innerHTML = "";
    stage.appendChild(renderer.domElement);

    const start = performance.now();
    let last = start;
    const tick = (): void => {
      if (stopped || !stage.isConnected) {
        renderer.dispose();
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;

      gapNow += (gapTarget - gapNow) * (1 - Math.exp(-dt * 4));
      const lunge = lungeLife > 0.01 ? Math.sin(lungeLife * Math.PI) : 0;
      const sprint = burstLife > 0.01 ? Math.sin(burstLife * Math.PI) : 0;
      lungeLife *= 0.94;
      burstLife *= 0.95;

      // The road streams left; faster when Yuuri is close, because fear.
      const speed = 3.4 + (1 - gapNow) * 2.4;
      for (const slab of slabs) {
        slab.position.x -= speed * dt;
        if (slab.position.x < -7) slab.position.x += 9 * 1.6;
      }

      // Chito, out front on the right, pounding along.
      const stride = t * (9 + (1 - gapNow) * 4);
      chito.position.set(1.55 + sprint * 0.3, Math.abs(Math.sin(stride)) * 0.16, 0);
      chito.rotation.z = Math.sin(stride) * 0.08 - 0.1;

      // Yuuri, enormous, eating the distance. The gap decides how far
      // behind she looms; a lunge throws her forward for a beat.
      const back = -0.6 - gapNow * 3.4 + lunge * 0.9;
      yuuri.position.set(back, Math.abs(Math.sin(stride * 0.62)) * 0.3, -0.3);
      yuuri.rotation.z = Math.sin(stride * 0.62) * 0.06 - 0.16;

      if (ending) {
        const e = Math.min(1, (now - endStart) / 1400);
        if (ending === "caught") {
          // She closes the last of it and the picture tips over.
          yuuri.position.x = back + e * (chito.position.x - back - 0.4);
          camera.rotation.z = e * 0.25;
          camera.position.y = 1.35 - e * 0.4;
        } else {
          // Chito accelerates off the right edge; Yuuri runs out of belief.
          chito.position.x = 1.55 + e * 4.5;
          yuuri.position.x = back - e * 2.2;
          yuuri.rotation.z = -0.16 + e * 0.5; // doubling over
        }
      }

      // A close Yuuri shakes the ground she lands on.
      const quake = (1 - gapNow) * 0.02 + lunge * 0.05;
      camera.position.x = (Math.random() - 0.5) * quake;

      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch {
    // The emoji chase is already running.
  }
  return api;
}

// ---------------- the exam itself ----------------

/**
 * Run the exam inside `main`. Calls `onExit` when the learner leaves the
 * results screen, however it went.
 */
export async function runHiraganaExam(main: HTMLElement, onExit: () => void): Promise<void> {
  const pool = shuffled(examPool());
  const sfx = createSfx();
  const music = startMusic();
  const session = startGameSession({
    level: 100, // the exam's own number, past every playable level
    groups: KANA_GROUPS.filter((g) => g.script === "hiragana").map((g) => g.id),
    poolSize: pool.length,
    words: false,
  });

  main.innerHTML = `
    <div class="kana-exam">
      <div class="exam-chase" id="exam-chase"></div>
      <div class="exam-hud">
        <span id="exam-lives" class="exam-lives"></span>
        <span id="exam-count" class="glosses"></span>
      </div>
      <div class="exam-timer"><div class="exam-timer-fill" id="exam-fuse"></div></div>
      <div class="card-panel exam-card">
        <div class="exam-kana" id="exam-kana" lang="ja"></div>
        <input id="exam-input" type="text" autocomplete="off" autocapitalize="none"
          spellcheck="false" enterkeyhint="go" placeholder="romaji" aria-label="Type the romaji" />
        <div class="glosses" id="exam-note">Type the sound. Right answers go through on their own.</div>
      </div>
      <div class="row-actions" style="justify-content:center">
        <button id="exam-flee" class="ghost">Give up</button>
      </div>
    </div>
  `;

  const chase = await mountChase(main.querySelector<HTMLElement>("#exam-chase")!);
  const kanaEl = main.querySelector<HTMLDivElement>("#exam-kana")!;
  const input = main.querySelector<HTMLInputElement>("#exam-input")!;
  const fuse = main.querySelector<HTMLDivElement>("#exam-fuse")!;
  const livesEl = main.querySelector<HTMLElement>("#exam-lives")!;
  const countEl = main.querySelector<HTMLElement>("#exam-count")!;
  const note = main.querySelector<HTMLDivElement>("#exam-note")!;

  let lives = LIVES;
  let at = 0;
  let correct = 0;
  let over = false;
  let fuseTimer = 0;
  let asked = 0;
  const startedAt = Date.now();

  const cleanup = (): void => {
    over = true;
    clearTimeout(fuseTimer);
    music.stop();
    sfx.stop();
    chase.stop();
  };

  const drawHud = (): void => {
    livesEl.textContent = "❤️".repeat(lives) + "🖤".repeat(LIVES - lives);
    countEl.textContent = `${at} / ${pool.length}`;
    chase.gap(lives / LIVES);
    music.intensity(1 - lives / LIVES);
  };

  /** One kana on the card, and the clock lit under it. */
  const ask = (): void => {
    if (over) return;
    const entry = pool[at];
    kanaEl.textContent = entry.kana;
    input.value = "";
    input.focus();
    asked = Date.now();
    // Restart the drain: width snapped to full with the transition off,
    // then eased to nothing over the allowance.
    fuse.style.transition = "none";
    fuse.style.width = "100%";
    requestAnimationFrame(() => {
      fuse.style.transition = `width ${SECONDS_PER_KANA}s linear`;
      fuse.style.width = "0%";
    });
    clearTimeout(fuseTimer);
    fuseTimer = window.setTimeout(() => miss(true), SECONDS_PER_KANA * 1000);
  };

  const advance = (): void => {
    at++;
    if (at >= pool.length) {
      void finish(true);
      return;
    }
    drawHud();
    ask();
  };

  const hit = (): void => {
    if (over) return;
    clearTimeout(fuseTimer);
    correct++;
    session.answer(pool[at].kana, { correct: true });
    void recordQuestEvent("kana-correct");
    sfx.ping();
    chase.burst();
    advance();
  };

  const miss = (timeout: boolean): void => {
    if (over) return;
    clearTimeout(fuseTimer);
    const entry = pool[at];
    session.answer(entry.kana, { correct: false, timeout, mistake: timeout ? undefined : input.value.trim() });
    lives--;
    sfx.thud();
    sfx.growl();
    chase.lunge();
    note.textContent = `${entry.kana} is “${entry.romaji[0]}”. ${lives > 0 ? "She's closing in." : ""}`;
    if (lives <= 0) {
      void finish(false);
      return;
    }
    advance();
  };

  input.addEventListener("input", () => {
    if (over) return;
    if (isCorrect(pool[at], input.value)) hit();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || over) return;
    // Enter on a non-answer is a wrong answer, said out loud.
    if (!isCorrect(pool[at], input.value)) miss(false);
  });

  main.querySelector<HTMLButtonElement>("#exam-flee")!.addEventListener("click", () => {
    session.end("quit");
    cleanup();
    onExit();
  });

  /** The end, either way, and the screen that says so. */
  const finish = async (passed: boolean): Promise<void> => {
    clearTimeout(fuseTimer);
    over = true;
    input.disabled = true;
    session.end(passed ? "cleared" : "failed");
    const seconds = Math.round((Date.now() - startedAt) / 1000);

    if (passed) {
      chase.escaped();
      music.victory();
      sfx.bell();
      await recordQuestEvents(["hiragana-exam"]);
      void unlockAchievement("hiragana-exam");
      await earnYennies(REWARD);
    } else {
      chase.caught();
      music.stop();
      sfx.menace(1.4);
      sfx.smack();
    }

    // Let the ending play on the stage before the verdict covers the card.
    window.setTimeout(() => {
      if (!main.isConnected) return;
      const card = main.querySelector<HTMLElement>(".exam-card");
      if (!card) return;
      card.innerHTML = passed
        ? `
          <div class="exam-verdict">🎓 ESCAPED</div>
          <div class="glosses">Every hiragana, outrun. ${correct} of ${pool.length} first time,
            ${Math.floor(seconds / 60)}m ${seconds % 60}s, ${lives} ${lives === 1 ? "life" : "lives"} to spare.</div>
          <div class="glosses" style="margin-top:6px">+${REWARD} ¥. Something small and metal is in your pocket now.</div>
          <div class="row-actions" style="justify-content:center;margin-top:12px">
            <button id="exam-done">Done</button>
          </div>`
        : `
          <div class="exam-verdict caught">CAUGHT</div>
          <div class="glosses">${at} of ${pool.length} answered before she got you.
            The exam is here whenever you want another run.</div>
          <div class="row-actions" style="justify-content:center;margin-top:12px">
            <button id="exam-retry">Run again</button>
            <button id="exam-done" class="secondary">Done</button>
          </div>`;
      card.querySelector<HTMLButtonElement>("#exam-retry")?.addEventListener("click", () => {
        cleanup();
        void runHiraganaExam(main, onExit);
      });
      card.querySelector<HTMLButtonElement>("#exam-done")!.addEventListener("click", () => {
        cleanup();
        onExit();
      });
    }, 1600);
    if (passed) toast(`Hiragana exam passed! +${REWARD} ¥`);
  };

  drawHud();
  // A beat of intro: she is already being chased; the first kana is the
  // starting gun.
  note.textContent = "RUN. Type each sound before the clock runs out.";
  sfx.menace(1.2);
  window.setTimeout(() => {
    if (!over) ask();
  }, 1300);
}
