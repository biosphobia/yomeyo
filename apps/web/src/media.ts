import type { Card } from "@yomeyo/core";
import { deleteMeta, getMeta, setMeta } from "./db.js";

/**
 * The pictures and audio clips that came with an imported deck.
 *
 * Each file is stored once, as a Blob under an opaque key, and cards point
 * at the key. The blobs stay on this device: sync and the shared library
 * carry the words, not the megabytes, so a card arriving on another device
 * simply has keys that resolve to nothing there — it falls back to
 * synthesised audio and shows no picture, exactly as if the media had never
 * existed.
 *
 * The keys live in the account's own database, like the cards that use
 * them, so two people sharing a browser do not see each other's decks'
 * pictures.
 */

const PREFIX = "cardMedia:";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  webm: "audio/webm",
  "3gp": "audio/3gpp",
};

/** The type a filename implies, for the Blob so elements know how to decode it. */
export function mediaMime(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

export async function saveMedia(key: string, blob: Blob): Promise<void> {
  await setMeta(PREFIX + key, blob);
}

export async function getMedia(key: string): Promise<Blob | null> {
  const blob = await getMeta<Blob>(PREFIX + key);
  return blob instanceof Blob && blob.size > 0 ? blob : null;
}

/**
 * Delete the media these cards point at, for when their deck is removed.
 * Without this, removing a deck with a thousand clips would keep the clips.
 */
export async function deleteMediaOf(cards: Card[]): Promise<void> {
  const keys = new Set<string>();
  for (const card of cards) {
    for (const key of [card.audio, card.sentenceAudio, card.image]) {
      if (key) keys.add(key);
    }
  }
  for (const key of keys) await deleteMeta(PREFIX + key);
}
