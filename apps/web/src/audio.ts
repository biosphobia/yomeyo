/**
 * Word audio via the browser's own speech synthesis.
 *
 * Recorded audio for Japanese vocabulary (Forvo, JapanesePod101) is not
 * redistributable, so Yomeyo speaks words with the Japanese voice already
 * installed on the device. That works offline, costs nothing, and covers
 * every word rather than the subset some audio pack happens to include.
 *
 * Android ships Japanese TTS with Google's speech services; desktop browsers
 * expose whatever the OS has. When no Japanese voice exists we say so rather
 * than reading Japanese aloud with an English voice.
 */

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function synth(): SpeechSynthesis | null {
  return typeof speechSynthesis === "undefined" ? null : speechSynthesis;
}

/**
 * The voice list populates asynchronously in most browsers, and in some
 * (Chrome) it is empty until the `voiceschanged` event fires.
 */
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
    // Some engines never fire the event; do not hang the UI on it.
    setTimeout(finish, 1500);
  });
  return voicesReady;
}

/** Pick the best available Japanese voice, or null if there is none. */
export async function japaneseVoice(): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices();
  const japanese = voices.filter((v) => v.lang?.toLowerCase().startsWith("ja"));
  if (japanese.length === 0) return null;
  // Prefer a local voice: it works offline and starts instantly.
  return japanese.find((v) => v.localService) ?? japanese[0];
}

export async function audioAvailable(): Promise<boolean> {
  return (await japaneseVoice()) !== null;
}

export interface SpeakOptions {
  /** 0.1–2. Slightly under 1 is easier to follow when learning. */
  rate?: number;
}

/**
 * Speak Japanese text. Resolves when playback finishes (or fails), so callers
 * can show progress. Any in-flight utterance is cancelled first, so tapping
 * several words quickly does not queue up a backlog.
 */
export async function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const engine = synth();
  if (!engine || !text.trim()) return;

  const voice = await japaneseVoice();
  if (!voice) throw new Error("No Japanese voice is installed on this device.");

  engine.cancel();

  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang || "ja-JP";
    utterance.rate = options.rate ?? 0.9;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    // Some engines drop long utterances without firing either event.
    setTimeout(finish, 15000);

    engine.speak(utterance);
  });
}

/**
 * A reusable speaker button. Reading is preferred over the written form so
 * that kanji with several readings are pronounced the way the card teaches.
 */
export function speakerButton(term: string, reading?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "speaker";
  button.type = "button";
  button.textContent = "🔊";
  button.title = "Play audio";
  button.setAttribute("aria-label", `Play audio for ${term}`);

  button.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    button.classList.add("speaking");
    try {
      await speak(reading?.trim() || term);
      button.classList.remove("error");
    } catch {
      button.classList.add("error");
      button.title = "No Japanese voice installed on this device";
    } finally {
      button.classList.remove("speaking");
    }
  });

  return button;
}
