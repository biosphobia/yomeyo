/**
 * The cutscene's sound, made from oscillators and noise rather than files.
 *
 * Nothing is downloaded and nothing is a recording: wind is filtered noise,
 * a footstep in snow is a very short noise burst, a falling crate is a sine
 * sliding downwards, an impact is that plus a thump. It costs a couple of
 * kilobytes of code instead of a couple of megabytes of audio, and it can be
 * retuned by changing numbers.
 *
 * Everything is built the moment a crate is opened, which is a click, so the
 * browser's autoplay rules are satisfied without asking anybody's permission
 * for anything. If the Web Audio API is missing or refuses, every call here
 * quietly does nothing and the cutscene plays silently.
 */

export interface Sfx {
  wind: (on: boolean) => void;
  step: () => void;
  /** A falling whistle, `seconds` long, ending in nothing. */
  falling: (seconds: number) => void;
  thud: () => void;
  creak: () => void;
  clatter: () => void;
  /** The lid coming off: bright, upward, short. */
  open: () => void;
  boing: () => void;
  whoosh: () => void;
  /** A flat hand meeting the back of a head. */
  smack: () => void;
  /** An empty stomach, at length. */
  growl: () => void;
  /** Something is about to go badly, and the music knows first. */
  menace: (seconds: number) => void;
  /** Getting in or out of water. */
  splash: () => void;
  /** A counter bell nobody answers. */
  bell: () => void;
  stop: () => void;
}

const SILENT: Sfx = {
  wind: () => undefined,
  step: () => undefined,
  falling: () => undefined,
  thud: () => undefined,
  creak: () => undefined,
  clatter: () => undefined,
  open: () => undefined,
  boing: () => undefined,
  whoosh: () => undefined,
  smack: () => undefined,
  growl: () => undefined,
  menace: () => undefined,
  splash: () => undefined,
  bell: () => undefined,
  stop: () => undefined,
};

export function createSfx(): Sfx {
  let ctx: AudioContext;
  try {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return SILENT;
    ctx = new Ctor();
  } catch {
    return SILENT;
  }
  void ctx.resume?.().catch(() => undefined);

  const master = ctx.createGain();
  master.gain.value = 0.34;
  master.connect(ctx.destination);

  /** A second of white noise, reused by everything that needs any. */
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const now = (): number => ctx.currentTime;

  /** A noise burst through a filter — the basis of wind, steps and impacts. */
  function burst(opts: {
    duration: number;
    gain: number;
    type: BiquadFilterType;
    from: number;
    to?: number;
    q?: number;
  }): void {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.setValueAtTime(opts.from, now());
    if (opts.to !== undefined) filter.frequency.exponentialRampToValueAtTime(opts.to, now() + opts.duration);
    filter.Q.value = opts.q ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, now());
    gain.gain.exponentialRampToValueAtTime(0.0001, now() + opts.duration);
    source.connect(filter).connect(gain).connect(master);
    source.start();
    source.stop(now() + opts.duration + 0.05);
  }

  function tone(opts: {
    duration: number;
    gain: number;
    from: number;
    to: number;
    type?: OscillatorType;
    delay?: number;
  }): void {
    const at = now() + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), at + opts.duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(opts.gain, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + opts.duration);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + opts.duration + 0.05);
  }

  // The wind never stops in this place, so it is one long source that is
  // faded in and out rather than started and restarted.
  const windSource = ctx.createBufferSource();
  windSource.buffer = noise;
  windSource.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 420;
  windFilter.Q.value = 0.7;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  windSource.connect(windFilter).connect(windGain).connect(master);
  try {
    windSource.start();
  } catch {
    /* already started, or refused */
  }

  // A slow wander in the filter, so the wind gusts instead of hissing.
  const gust = ctx.createOscillator();
  gust.type = "sine";
  gust.frequency.value = 0.11;
  const gustDepth = ctx.createGain();
  gustDepth.gain.value = 190;
  gust.connect(gustDepth).connect(windFilter.frequency);
  try {
    gust.start();
  } catch {
    /* as above */
  }

  let stopped = false;
  const guard = (fn: () => void) => (): void => {
    if (stopped) return;
    try {
      fn();
    } catch {
      /* a sound that will not play is not worth an exception */
    }
  };

  return {
    wind: (on) =>
      guard(() => {
        windGain.gain.cancelScheduledValues(now());
        windGain.gain.setValueAtTime(windGain.gain.value, now());
        windGain.gain.linearRampToValueAtTime(on ? 0.28 : 0, now() + (on ? 1.6 : 0.7));
      })(),
    step: guard(() => burst({ duration: 0.11, gain: 0.16, type: "highpass", from: 1800, to: 700, q: 0.8 })),
    falling: (seconds) =>
      guard(() => {
        tone({ duration: seconds, gain: 0.16, from: 1150, to: 190, type: "triangle" });
        burst({ duration: seconds, gain: 0.06, type: "bandpass", from: 1400, to: 400, q: 2 });
      })(),
    thud: guard(() => {
      tone({ duration: 0.5, gain: 0.5, from: 150, to: 34 });
      burst({ duration: 0.28, gain: 0.38, type: "lowpass", from: 900, to: 90 });
      // The snow it landed in.
      burst({ duration: 0.5, gain: 0.12, type: "highpass", from: 3000, to: 900 });
    }),
    creak: guard(() => {
      tone({ duration: 0.42, gain: 0.09, from: 300, to: 520, type: "sawtooth" });
      tone({ duration: 0.3, gain: 0.06, from: 520, to: 410, type: "sawtooth", delay: 0.34 });
    }),
    clatter: guard(() => {
      for (let i = 0; i < 5; i++) {
        setTimeout(
          guard(() => burst({ duration: 0.12, gain: 0.2, type: "bandpass", from: 900 + Math.random() * 1600, q: 3 })),
          i * (70 + Math.random() * 90),
        );
      }
    }),
    open: guard(() => {
      // A little rising figure, deliberately silly.
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ duration: 0.34, gain: 0.16, from: f, to: f * 1.01, type: "triangle", delay: i * 0.085 }),
      );
      burst({ duration: 0.7, gain: 0.1, type: "highpass", from: 4000, to: 1800 });
    }),
    boing: guard(() => {
      tone({ duration: 0.42, gain: 0.24, from: 620, to: 120, type: "sine" });
      tone({ duration: 0.3, gain: 0.12, from: 200, to: 460, type: "sine", delay: 0.16 });
    }),
    whoosh: guard(() => burst({ duration: 0.6, gain: 0.22, type: "bandpass", from: 300, to: 2600, q: 1.4 })),
    smack: guard(() => {
      // Sharp, over almost before it starts, with a little body under it.
      burst({ duration: 0.09, gain: 0.5, type: "bandpass", from: 2600, to: 900, q: 1.2 });
      tone({ duration: 0.16, gain: 0.3, from: 240, to: 90 });
    }),
    growl: guard(() => {
      // Low, wandering, and longer than is comfortable.
      tone({ duration: 1.5, gain: 0.14, from: 78, to: 52, type: "sawtooth" });
      tone({ duration: 1.3, gain: 0.07, from: 120, to: 64, type: "sine", delay: 0.2 });
      burst({ duration: 1.4, gain: 0.05, type: "lowpass", from: 260, to: 90 });
    }),
    menace: (seconds) =>
      guard(() => {
        // A tritone that will not resolve, and a rise underneath it.
        for (const f of [92, 130]) {
          tone({ duration: seconds, gain: 0.13, from: f, to: f * 1.06, type: "sawtooth" });
        }
        tone({ duration: seconds, gain: 0.09, from: 300, to: 1500, type: "triangle" });
        burst({ duration: seconds, gain: 0.08, type: "bandpass", from: 200, to: 1800, q: 3 });
      })(),
    splash: guard(() => {
      burst({ duration: 0.42, gain: 0.34, type: "highpass", from: 900, to: 3400 });
      tone({ duration: 0.3, gain: 0.18, from: 420, to: 120 });
    }),
    bell: guard(() => {
      // A small counter bell: two partials and a long tail.
      tone({ duration: 1.4, gain: 0.16, from: 2093, to: 2085, type: "sine" });
      tone({ duration: 1.1, gain: 0.08, from: 3136, to: 3120, type: "sine" });
    }),
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        windGain.gain.cancelScheduledValues(now());
        windGain.gain.linearRampToValueAtTime(0, now() + 0.2);
        setTimeout(() => void ctx.close().catch(() => undefined), 400);
      } catch {
        /* nothing left to do */
      }
    },
  };
}
