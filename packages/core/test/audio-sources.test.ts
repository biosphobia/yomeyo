import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIO_SOURCES,
  audioSourcesReady,
  buildAudioUrl,
  parseAudioList,
  redactKey,
} from "../src/audio-sources.js";

const KEY = "test_key_not_real";

describe("building audio request URLs", () => {
  it("substitutes term, reading, language and key", () => {
    const url = buildAudioUrl(DEFAULT_AUDIO_SOURCES.forvoUrl, { term: "読む", reading: "よむ" }, KEY);
    expect(url).toContain(`term=${encodeURIComponent("読む")}`);
    expect(url).toContain(`reading=${encodeURIComponent("よむ")}`);
    expect(url).toContain("language=ja");
    expect(url).toContain(`apiKey=${KEY}`);
    expect(url).toContain("sources=forvo");
    expect(url).not.toContain("{");
  });

  it("uses the TTS template for the fallback sources", () => {
    const url = buildAudioUrl(DEFAULT_AUDIO_SOURCES.ttsUrl, { term: "猫", reading: "ねこ" }, KEY);
    expect(url).toContain("openai");
    expect(url).toContain("elevenlabs");
    expect(url).toContain("polly");
    expect(url).not.toContain("sources=forvo&");
  });

  it("percent-encodes values so odd terms cannot break the query", () => {
    const url = buildAudioUrl(
      "https://x.test/a?term={term}&reading={reading}&apiKey={apiKey}",
      { term: "a&b=c", reading: "d?e" },
      "k&y",
    );
    expect(url).toBe("https://x.test/a?term=a%26b%3Dc&reading=d%3Fe&apiKey=k%26y");
  });

  it("falls back to the term when there is no reading", () => {
    const url = buildAudioUrl("https://x.test/?r={reading}", { term: "猫", reading: "" }, KEY);
    expect(url).toContain(encodeURIComponent("猫"));
  });

  it("defaults the language to Japanese", () => {
    expect(buildAudioUrl("https://x.test/?l={language}", { term: "a", reading: "b" }, KEY)).toContain(
      "l=ja",
    );
  });
});

describe("parsing audio list responses", () => {
  it("reads the Yomitan-style audioSources list", () => {
    const parsed = parseAudioList({
      type: "audioSourceList",
      audioSources: [
        { url: "https://cdn.test/a.mp3", name: "Forvo (akitomo)" },
        { url: "https://cdn.test/b.mp3", name: "Forvo (strawberry)" },
      ],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ url: "https://cdn.test/a.mp3", name: "Forvo (akitomo)" });
  });

  it("reads a bare array of objects", () => {
    expect(parseAudioList([{ url: "https://cdn.test/a.mp3" }])).toEqual([
      { url: "https://cdn.test/a.mp3" },
    ]);
  });

  it("reads a bare array of URL strings", () => {
    expect(parseAudioList(["https://cdn.test/a.mp3", "https://cdn.test/b.mp3"])).toHaveLength(2);
  });

  it("accepts the other field names these services use", () => {
    expect(parseAudioList([{ audioUrl: "https://cdn.test/a.mp3" }])[0].url).toBe("https://cdn.test/a.mp3");
    expect(parseAudioList([{ src: "https://cdn.test/b.mp3" }])[0].url).toBe("https://cdn.test/b.mp3");
    expect(parseAudioList({ results: [{ file: "https://cdn.test/c.mp3" }] })[0].url).toBe(
      "https://cdn.test/c.mp3",
    );
  });

  it("keeps the speaker name when one is given", () => {
    expect(parseAudioList([{ url: "https://cdn.test/a.mp3", speaker: "kaori" }])[0].name).toBe("kaori");
  });

  it("drops entries that are not playable URLs", () => {
    const parsed = parseAudioList({
      audioSources: [
        { url: "not-a-url" },
        { name: "no url at all" },
        null,
        42,
        { url: "https://cdn.test/ok.mp3" },
      ],
    });
    expect(parsed).toEqual([{ url: "https://cdn.test/ok.mp3" }]);
  });

  it("refuses plain-http URLs — clips travel encrypted or not at all", () => {
    const parsed = parseAudioList({
      audioSources: [{ url: "http://cdn.test/insecure.mp3" }, { url: "https://cdn.test/ok.mp3" }],
    });
    expect(parsed).toEqual([{ url: "https://cdn.test/ok.mp3" }]);
  });

  it("de-duplicates repeated URLs", () => {
    const parsed = parseAudioList({
      audioSources: [{ url: "https://cdn.test/a.mp3" }, { url: "https://cdn.test/a.mp3" }],
    });
    expect(parsed).toHaveLength(1);
  });

  it("returns nothing rather than throwing on junk", () => {
    expect(parseAudioList(null)).toEqual([]);
    expect(parseAudioList("nope")).toEqual([]);
    expect(parseAudioList({ error: "unauthorized" })).toEqual([]);
    expect(parseAudioList({ audioSources: [] })).toEqual([]);
  });
});

describe("configuration state", () => {
  it("is only ready with a key, a URL and the toggle on", () => {
    const base = { ...DEFAULT_AUDIO_SOURCES, apiKey: KEY, enabled: true };
    expect(audioSourcesReady(base)).toBe(true);
    expect(audioSourcesReady({ ...base, enabled: false })).toBe(false);
    expect(audioSourcesReady({ ...base, apiKey: "  " })).toBe(false);
    expect(audioSourcesReady(undefined)).toBe(false);
  });
});

describe("keeping the key out of messages", () => {
  it("redacts the key from a URL", () => {
    const url = buildAudioUrl(DEFAULT_AUDIO_SOURCES.forvoUrl, { term: "猫", reading: "ねこ" }, "secret123");
    expect(url).toContain("secret123");
    expect(redactKey(url)).not.toContain("secret123");
    expect(redactKey(url)).toContain("apiKey=***");
  });

  it("leaves a URL without a key alone", () => {
    expect(redactKey("https://x.test/a?term=b")).toBe("https://x.test/a?term=b");
  });

  it("ships no key of its own", () => {
    for (const template of [DEFAULT_AUDIO_SOURCES.forvoUrl, DEFAULT_AUDIO_SOURCES.ttsUrl]) {
      // The key must be a placeholder the app fills in at runtime...
      expect(template).toContain("{apiKey}");
      // ...and apiKey must never be followed by a literal value.
      expect(template).not.toMatch(/apiKey=(?!\{apiKey\})\S/);
      // No opaque credential-shaped token anywhere in the template.
      expect(template).not.toMatch(/[A-Za-z0-9_-]{20,}/);
    }
  });
});
