import { onTap } from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";
import { getMedia } from "./media.js";
import { assetUrl } from "./store.js";

/**
 * Word audio, in order of preference:
 *
 *   1. a clip an imported deck brought with it (the deck author's choice)
 *   2. the clip cached from an earlier play, which also works offline
 *   3. the site's own audio endpoint — real recordings first, synthesis second
 *   4. the Japanese voice built into the device
 *
 * The endpoint (`audio.php`, deployed next to the app) holds the API key on
 * the server, so there is nothing to configure here and no key ever reaches
 * the browser. A deployment without the endpoint — GitHub Pages, a local
 * build — simply falls through to the device voice.
 *
 * A single kana is the exception, and takes `playKana` instead: recordings of
 * one letter are whatever the speaker decided to say around it, so the kana
 * quiz asks for synthesis, which says the same sound the same way every time.
 */

/** `tts` asks for synthesis alone; `voice` prefers a real recording. */
type Mode = "voice" | "tts";

/** Synthesis and recordings cache apart: a word can be held as both. */
const clipKey = (term: string, reading: string, mode: Mode) =>
  `audioClip:${mode === "tts" ? "tts:" : ""}${term}\u0000${reading}`;

// ---------------- device speech (final fallback) ----------------

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function synth(): SpeechSynthesis | null {
  return typeof speechSynthesis === "undefined" ? null : speechSynthesis;
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const engine = synth();
    if (!engine) return resolve([]);
    const existing = engine.getVoices();
    if (existing.length > 0) return resolve(existing);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(engine.getVoices());
    };
    engine.addEventListener("voiceschanged", finish, { once: true });
    setTimeout(finish, 1500);
  });
  return voicesReady;
}

export async function japaneseVoice(): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices();
  const japanese = voices.filter((v) => v.lang?.toLowerCase().startsWith("ja"));
  if (japanese.length === 0) return null;
  return japanese.find((v) => v.localService) ?? japanese[0];
}

async function speakWithDevice(text: string, rate: number): Promise<void> {
  const engine = synth();
  if (!engine) throw new Error("This browser cannot speak text.");
  const voice = await japaneseVoice();
  if (!voice) throw new Error("No Japanese voice is installed on this device.");

  engine.cancel();
  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang || "ja-JP";
    utterance.rate = rate;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    setTimeout(finish, 15000);
    engine.speak(utterance);
  });
}

// ---------------- playback ----------------

let currentAudio: HTMLAudioElement | null = null;

function stopPlayback(): void {
  synth()?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

function playFromUrl(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Could not play that audio file."));
    // Never hang the UI if the file stalls.
    setTimeout(resolve, 20000);
    void audio.play().catch(reject);
  });
}

async function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await playFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------- the site's own audio endpoint ----------------

let endpointReady: Promise<boolean> | null = null;

/**
 * Is the endpoint deployed and configured? Asked once per page load.
 *
 * Only a 204 counts: a static host (GitHub Pages) answers this URL with the
 * PHP source as a 200, which is a file, not an endpoint.
 */
function audioEndpointReady(): Promise<boolean> {
  endpointReady ??= (async () => {
    try {
      const res = await fetch(assetUrl("audio.php?probe=1"), { cache: "no-store" });
      return res.status === 204;
    } catch {
      return false;
    }
  })();
  return endpointReady;
}

/** Ask the endpoint for a clip; null when it has none for this word. */
async function fetchEndpointClip(term: string, reading: string, mode: Mode): Promise<Blob | null> {
  const res = await fetch(
    assetUrl(
      `audio.php?term=${encodeURIComponent(term)}&reading=${encodeURIComponent(reading)}` +
        (mode === "tts" ? "&mode=tts" : ""),
    ),
  );
  if (!res.ok) return null;
  // The same static-host caution as the probe: only audio is audio.
  if (!/^audio\//i.test(res.headers.get("content-type") ?? "")) return null;
  const blob = await res.blob();
  return blob.size > 0 ? blob : null;
}

// ---------------- playing a word ----------------

export interface PlayResult {
  /** Which source actually produced the sound. */
  source: "deck" | "cache" | "online" | "device";
}

/**
 * Play a clip an imported deck brought with it.
 *
 * False when the key resolves to nothing — the card came from another
 * device, or its deck's media was removed — so the caller can fall back to
 * the online chain rather than staying silent.
 */
export async function playStoredAudio(key: string): Promise<boolean> {
  const blob = await getMedia(key);
  if (!blob) return false;
  stopPlayback();
  await playBlob(blob);
  return true;
}

/**
 * Play a word, preferring a real recording.
 *
 * Successful downloads are cached locally, so replaying a card during review
 * is instant and keeps working without a connection.
 */
export async function playWord(
  term: string,
  reading: string,
  options: { rate?: number; mode?: Mode } = {},
): Promise<PlayResult> {
  const spoken = reading?.trim() || term;
  const mode = options.mode ?? "voice";
  stopPlayback();

  const cached = await getMeta<Blob>(clipKey(term, reading, mode));
  if (cached instanceof Blob && cached.size > 0) {
    await playBlob(cached);
    return { source: "cache" };
  }

  if (await audioEndpointReady()) {
    try {
      const blob = await fetchEndpointClip(term, reading, mode);
      if (blob) {
        await setMeta(clipKey(term, reading, mode), blob);
        await playBlob(blob);
        return { source: "online" };
      }
    } catch {
      // The device voice is always there.
    }
  }

  await speakWithDevice(spoken, options.rate ?? 0.9);
  return { source: "device" };
}

/**
 * Say one kana, always synthesised.
 *
 * Nobody records single letters for their own sake, so what a recording
 * service has for あ is a person saying whatever they chose to say — a name,
 * a word beginning with it, a whole sentence. Drilling wants the bare sound,
 * identical each time it comes round.
 */
export async function playKana(kana: string, options: { rate?: number } = {}): Promise<PlayResult> {
  return playWord(kana, kana, { rate: options.rate ?? 0.8, mode: "tts" });
}

/**
 * Fetch clips ahead of time and put them in the cache, without playing any.
 *
 * A quiz asks for its first clip the moment an answer lands, and waiting on
 * the network right then is the whole of the delay: the sound arrives after
 * the moment it belonged to. Warming the pool while the learner is still
 * reading the first question moves that wait somewhere it costs nothing.
 *
 * Deliberately quiet and interruptible: anything already cached is skipped,
 * failures are ignored, and `signal` lets a screen being left stop the rest.
 */
export async function prefetchAudio(
  items: { term: string; reading?: string; mode?: Mode }[],
  signal?: { aborted: boolean },
): Promise<void> {
  if (items.length === 0 || !(await audioEndpointReady())) return;

  // Same word twice in a pool is one download.
  const seen = new Set<string>();
  const queue = items.filter((item) => {
    const key = clipKey(item.term, item.reading ?? item.term, item.mode ?? "voice");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // A handful at a time: enough to hide the latency, few enough that the
  // clip actually being waited for is not stuck behind the queue.
  const WIDTH = 4;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      if (signal?.aborted) return;
      const item = queue[next++];
      const reading = item.reading ?? item.term;
      const mode = item.mode ?? "voice";
      const key = clipKey(item.term, reading, mode);
      try {
        const cached = await getMeta<Blob>(key);
        if (cached instanceof Blob && cached.size > 0) continue;
        const blob = await fetchEndpointClip(item.term, reading, mode);
        if (blob) await setMeta(key, blob);
      } catch {
        // A clip that will not come now can still come when it is played.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WIDTH, queue.length) }, worker));
}

/** Kept for callers that only want the device voice (e.g. reading a sentence). */
export async function speak(text: string, options: { rate?: number } = {}): Promise<void> {
  await speakWithDevice(text, options.rate ?? 0.9);
}

export async function audioAvailable(): Promise<boolean> {
  return (await japaneseVoice()) !== null;
}

// ---------------- buttons ----------------

/**
 * A reusable speaker button. Reading is preferred over the written form so
 * kanji with several readings are pronounced the way the card teaches.
 *
 * A card that brought its own recording across from Anki plays that first:
 * it is the exact clip the deck's author chose, already on this device, and
 * anything fetched or synthesised is only ever a stand-in for it.
 */
export function speakerButton(term: string, reading?: string, deckAudio?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "speaker";
  button.type = "button";
  button.textContent = "🔊";
  button.title = "Play audio";
  button.setAttribute("aria-label", `Play audio for ${term}`);

  onTap(button, async (ev: Event) => {
    ev.stopPropagation?.();
    ev.preventDefault?.();
    if (button.classList.contains("speaking")) return;
    button.classList.add("speaking");
    try {
      if (deckAudio && (await playStoredAudio(deckAudio))) {
        button.classList.remove("error");
        button.title = "Played the deck's own recording";
        return;
      }
      const result = await playWord(term, reading ?? "");
      button.classList.remove("error");
      button.title =
        result.source === "online"
          ? "Played a recording"
          : result.source === "cache"
            ? "Played the saved recording"
            : "Played with the device voice";
    } catch (err) {
      button.classList.add("error");
      button.title = err instanceof Error ? err.message : "Could not play audio";
    } finally {
      button.classList.remove("speaking");
    }
  });

  return button;
}

/**
 * A speaker that plays one stored clip and nothing else — for sentence
 * audio, where a fallback voice reading the whole sentence would drown the
 * card. Says so when the clip is not on this device, rather than guessing.
 */
export function clipSpeakerButton(key: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "speaker";
  button.type = "button";
  button.textContent = "🔊";
  button.title = label;
  button.setAttribute("aria-label", label);

  onTap(button, async (ev: Event) => {
    ev.stopPropagation?.();
    ev.preventDefault?.();
    if (button.classList.contains("speaking")) return;
    button.classList.add("speaking");
    try {
      if (await playStoredAudio(key)) {
        button.classList.remove("error");
      } else {
        button.classList.add("error");
        button.title = "This clip is not on this device.";
      }
    } catch (err) {
      button.classList.add("error");
      button.title = err instanceof Error ? err.message : "Could not play audio";
    } finally {
      button.classList.remove("speaking");
    }
  });

  return button;
}
