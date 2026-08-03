/**
 * Remote audio sources for vocabulary.
 *
 * The app can pull pronunciation audio from a list endpoint — the shape
 * popularised by Yomitan's "custom audio source" setting, which returns a
 * list of playable URLs for a term/reading pair. Real human recordings
 * (Forvo) are preferred; synthesised voices are the fallback when nobody has
 * recorded the word.
 *
 * These functions are pure so the URL building and response parsing can be
 * tested without a network or an API key.
 */

/** A URL template with {term} {reading} {language} {apiKey} placeholders. */
export type AudioSourceTemplate = string;

export interface AudioSourceConfig {
  /** Recorded human audio, tried first. */
  forvoUrl: AudioSourceTemplate;
  /** Synthesised audio, tried when there is no recording. */
  ttsUrl: AudioSourceTemplate;
  /**
   * The user's key. Never stored in the repository — it is entered in
   * Settings and kept in the browser's local database.
   */
  apiKey: string;
  enabled: boolean;
}

/** Defaults point at the allaudio endpoint; the key is filled in at runtime. */
export const DEFAULT_AUDIO_SOURCES = {
  forvoUrl:
    "https://allaudio.animecards.site/audio/list?term={term}&reading={reading}&language={language}&sources=forvo&apiKey={apiKey}",
  ttsUrl:
    "https://allaudio.animecards.site/audio/list?term={term}&reading={reading}&language={language}&sources=openai,elevenlabs,polly&apiKey={apiKey}",
} as const;

export interface AudioQuery {
  term: string;
  reading: string;
  language?: string;
}

/** Fill a template, percent-encoding every substituted value. */
export function buildAudioUrl(
  template: AudioSourceTemplate,
  query: AudioQuery,
  apiKey: string,
): string {
  const values: Record<string, string> = {
    term: query.term,
    reading: query.reading || query.term,
    language: query.language ?? "ja",
    apiKey,
  };
  return template.replace(/\{(term|reading|language|apiKey)\}/g, (_, key: string) =>
    encodeURIComponent(values[key] ?? ""),
  );
}

export interface AudioCandidate {
  url: string;
  /** Where it came from, e.g. "Forvo (user)" — shown in the UI. */
  name?: string;
}

// https only: a clip fetched in the clear could be read or replaced on the
// way, and every service worth using serves TLS anyway.
function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

function candidateFrom(entry: unknown): AudioCandidate | null {
  if (isHttpUrl(entry)) return { url: entry };
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  // Different services name the field differently; accept the common ones.
  for (const key of ["url", "audioUrl", "src", "file", "audio"]) {
    if (isHttpUrl(record[key])) {
      const name = [record.name, record.displayName, record.source, record.speaker].find(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      return name ? { url: record[key] as string, name } : { url: record[key] as string };
    }
  }
  return null;
}

/**
 * Pull playable URLs out of a list response.
 *
 * The exact schema is not pinned down by any spec, so this accepts the
 * shapes these endpoints actually use — Yomitan's `{audioSources: [...]}`,
 * a bare array, or a wrapper object — rather than failing on an unexpected
 * key and leaving the user with no audio.
 */
export function parseAudioList(payload: unknown): AudioCandidate[] {
  const lists: unknown[] = [];

  if (Array.isArray(payload)) {
    lists.push(payload);
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["audioSources", "audioFileUrls", "results", "sources", "audio", "data"]) {
      if (Array.isArray(record[key])) lists.push(record[key]);
    }
    // A single object describing one file.
    const single = candidateFrom(record);
    if (single) return [single];
  }

  const out: AudioCandidate[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const entry of list as unknown[]) {
      const candidate = candidateFrom(entry);
      if (candidate && !seen.has(candidate.url)) {
        seen.add(candidate.url);
        out.push(candidate);
      }
    }
  }
  return out;
}

/** True when a config is complete enough to try. */
export function audioSourcesReady(config: Partial<AudioSourceConfig> | undefined): boolean {
  return Boolean(config?.enabled && config.apiKey?.trim() && config.forvoUrl?.trim());
}

/** Redact the key so a URL can be shown in an error message or a log. */
export function redactKey(url: string): string {
  return url.replace(/([?&]apiKey=)[^&]*/gi, "$1***");
}
