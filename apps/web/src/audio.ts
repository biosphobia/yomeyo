import {
  DEFAULT_AUDIO_SOURCES,
  audioSourcesReady,
  buildAudioUrl,
  onTap,
  parseAudioList,
  redactKey,
  type AudioSourceConfig,
} from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";
import { fetchThroughExtension } from "./extension-bridge.js";

/**
 * Word audio, in order of preference:
 *
 *   1. Forvo — a real person saying the word
 *   2. synthesised audio from the same endpoint (OpenAI / ElevenLabs / Polly)
 *   3. the Japanese voice built into the device
 *
 * The API key is entered in Settings and lives only in this browser's local
 * database. It is never written to the repository and never leaves the
 * device except in the request to the audio endpoint itself.
 */

const CONFIG_KEY = "audioSources";
const clipKey = (term: string, reading: string) => `audioClip:${term}\u0000${reading}`;

export async function getAudioConfig(): Promise<AudioSourceConfig> {
  const stored = await getMeta<Partial<AudioSourceConfig>>(CONFIG_KEY);
  return {
    forvoUrl: DEFAULT_AUDIO_SOURCES.forvoUrl,
    ttsUrl: DEFAULT_AUDIO_SOURCES.ttsUrl,
    apiKey: "",
    enabled: false,
    ...(stored ?? {}),
  };
}

export async function saveAudioConfig(config: AudioSourceConfig): Promise<void> {
  await setMeta(CONFIG_KEY, config);
}

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

// ---------------- remote audio ----------------

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

/**
 * Is the service there but refusing browsers, or not there at all?
 *
 * `fetch` reports both as the same bare "Failed to fetch", which tells a user
 * nothing about what to do. A `no-cors` request is sent regardless of the
 * missing header — its response is unreadable, but the fact that it completes
 * at all separates "the server said no to this page" from "nothing answered".
 */
async function refusedByCors(url: string): Promise<boolean> {
  try {
    // Bounded: this only decides the wording of an error, and the caller is
    // on its way to the device voice regardless.
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 2500);
    try {
      await fetch(url, { mode: "no-cors", cache: "no-store", signal: stop.signal });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** Fetch, falling back to the extension when this page is not allowed to. */
async function fetchMaybeViaExtension(url: string): Promise<Response> {
  try {
    return await fetch(url);
  } catch (err) {
    const relayed = await fetchThroughExtension(url);
    if (relayed.ok) {
      return new Response(relayed.body, { headers: { "content-type": relayed.contentType } });
    }

    // The extension is here, one press away from working — say exactly that,
    // not the generic advice to install what is already installed.
    if (relayed.reason === "no-permission") {
      throw new Error(
        "The Yomeyo extension is installed but has not been allowed to download audio yet. " +
          "Open its toolbar popup, press “Allow audio downloads”, and try again.",
      );
    }
    if (relayed.reason === "failed" && relayed.detail) {
      throw new Error(`The extension tried to fetch it but could not: ${relayed.detail}.`);
    }

    if (await refusedByCors(url)) {
      throw new Error(
        "The audio service answers, but does not let web pages read its replies (no CORS header), " +
          "and no Yomeyo extension answered on this page. In a browser with the extension, open its " +
          "toolbar popup and press “Allow audio downloads”. In a browser without extensions — like " +
          "Chrome for Android — this service cannot be reached from a page, and the device voice is " +
          "used instead.",
      );
    }
    throw new Error(
      `Could not reach the audio service (${redactKey(url)}). ${
        err instanceof Error ? err.message : ""
      }`.trim(),
    );
  }
}

/**
 * What one source offered: the clip's bytes when they could be read, or
 * failing that the clip URLs themselves.
 *
 * The distinction exists because CORS forbids *reading* a cross-origin reply,
 * not *playing* one — an <audio> element will happily play a URL whose bytes
 * this page may never see. So when the list is readable but the clip host
 * refuses pages, the recording can still be heard; it just cannot be cached
 * for offline replay.
 */
interface ClipResult {
  blob: Blob | null;
  playableUrls: string[];
}

/** Ask one source for a clip and download the first playable result. */
async function fetchClip(
  template: string,
  config: AudioSourceConfig,
  term: string,
  reading: string,
): Promise<ClipResult> {
  const url = buildAudioUrl(template, { term, reading }, config.apiKey);

  const response = await fetchMaybeViaExtension(url);
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "The audio service rejected the API key."
        : `The audio service returned ${response.status}.`,
    );
  }

  const candidates = parseAudioList(await response.json());
  for (const candidate of candidates) {
    try {
      // The clip itself often lives on another host again, with its own view
      // on who may fetch it, so it gets the same treatment.
      const clip = await fetchMaybeViaExtension(candidate.url);
      if (!clip.ok) continue;
      const blob = await clip.blob();
      if (blob.size > 0) return { blob, playableUrls: [] };
    } catch {
      // Try the next candidate rather than giving up on the whole source.
    }
  }
  return { blob: null, playableUrls: candidates.map((candidate) => candidate.url) };
}

export interface PlayResult {
  /** Which source actually produced the sound. */
  source: "cache" | "forvo" | "tts" | "device";
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
  options: { rate?: number } = {},
): Promise<PlayResult> {
  const spoken = reading?.trim() || term;
  stopPlayback();

  const cached = await getMeta<Blob>(clipKey(term, reading));
  if (cached instanceof Blob && cached.size > 0) {
    await playBlob(cached);
    return { source: "cache" };
  }

  const config = await getAudioConfig();
  if (audioSourcesReady(config)) {
    // Recording first, synthesis second — that ordering is the whole point.
    for (const [source, template] of [
      ["forvo", config.forvoUrl],
      ["tts", config.ttsUrl],
    ] as const) {
      if (!template?.trim()) continue;
      try {
        const { blob, playableUrls } = await fetchClip(template, config, term, reading);
        if (blob) {
          await setMeta(clipKey(term, reading), blob);
          await playBlob(blob);
          return { source };
        }
        // The bytes were refused, but playing is not reading: hand the URL
        // straight to an <audio> element. No caching — there is nothing this
        // page is allowed to keep — but the recording is heard.
        for (const clipUrl of playableUrls) {
          try {
            await playFromUrl(clipUrl);
            return { source };
          } catch {
            // A dead or undecodable clip; the next candidate may play.
          }
        }
      } catch {
        // Fall through to the next source; the device voice is always there.
      }
    }
  }

  await speakWithDevice(spoken, options.rate ?? 0.9);
  return { source: "device" };
}

/**
 * Check the configuration and report what happened, for the Settings test
 * button. Never includes the API key in its message.
 */
export async function testAudioConfig(
  config: AudioSourceConfig,
  term = "日本語",
  reading = "にほんご",
): Promise<string> {
  if (!config.apiKey.trim()) throw new Error("Enter your API key first.");
  const results: string[] = [];
  for (const [label, template] of [
    ["Forvo", config.forvoUrl],
    ["TTS", config.ttsUrl],
  ] as const) {
    try {
      const { blob, playableUrls } = await fetchClip(template, config, term, reading);
      results.push(
        blob
          ? `${label}: ok (${Math.round(blob.size / 1024)} KB)`
          : playableUrls.length > 0
            ? `${label}: found a clip this page may play but not save — it will play online, without offline caching`
            : `${label}: no audio found`,
      );
    } catch (err) {
      results.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Failures above never mean silence — say what actually happens instead.
  const voice = await japaneseVoice();
  results.push(
    voice
      ? `Device voice: ready (${voice.name || "Japanese"}) — used whenever the sources above fail`
      : "Device voice: no Japanese voice installed on this device",
  );
  return results.join(" · ");
}

/** Kept for callers that only want the device voice (e.g. reading a sentence). */
export async function speak(text: string, options: { rate?: number } = {}): Promise<void> {
  await speakWithDevice(text, options.rate ?? 0.9);
}

export async function audioAvailable(): Promise<boolean> {
  return (await japaneseVoice()) !== null;
}

/**
 * A reusable speaker button. Reading is preferred over the written form so
 * kanji with several readings are pronounced the way the card teaches.
 */
export function speakerButton(term: string, reading?: string): HTMLButtonElement {
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
      const result = await playWord(term, reading ?? "");
      button.classList.remove("error");
      button.title =
        result.source === "forvo"
          ? "Played a Forvo recording"
          : result.source === "tts"
            ? "Played synthesised audio"
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
