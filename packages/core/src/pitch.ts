/**
 * Japanese pitch accent, as decks record it.
 *
 * An accent is a single number: which mora the pitch drops after. 0 is
 * heiban — no drop; the word starts low and stays high. 1 starts high and
 * drops at once. n ≥ 2 starts low, rises, and drops after the nth mora.
 * Decks write the number plainly ("0"), circled ("①"), full-width, or as a
 * list ("0,3") when a word has more than one accepted accent.
 */

/** Circled digits ①–⑳, the way pitch dictionaries often print the number. */
const CIRCLED_ZERO = 0x2460; // ① is 1

/** Pull the accent numbers out of a pitch field's text. */
export function parsePitchAccents(text: string): number[] {
  const normalised = text
    .replace(/[①-⑳]/g, (ch) => String(ch.charCodeAt(0) - CIRCLED_ZERO + 1))
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10));
  const out: number[] = [];
  for (const match of normalised.matchAll(/\d+/g)) {
    const value = Number(match[0]);
    // Beyond ~24 morae nothing is a pitch number; it is a frequency rank or
    // a stray id that wandered into the field.
    if (value <= 24 && !out.includes(value)) out.push(value);
    if (out.length >= 4) break;
  }
  return out;
}

/** Small kana attach to the mora before them; everything else stands alone. */
const SMALL_KANA = new Set([..."ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ"]);

/** Split a kana reading into morae, the unit pitch accent counts in. */
export function moraeOf(reading: string): string[] {
  const out: string[] = [];
  for (const ch of reading) {
    if (SMALL_KANA.has(ch) && out.length > 0) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/**
 * Which morae are high, for one accent over a reading of `moraCount` morae.
 *
 * An accent larger than the word (a number from some other system) is
 * treated as heiban rather than drawn wrongly.
 */
export function pitchLevels(moraCount: number, accent: number): boolean[] {
  const a = accent >= 0 && accent <= moraCount ? accent : 0;
  return Array.from({ length: moraCount }, (_, i) => {
    if (a === 1) return i === 0;
    if (a === 0) return i > 0;
    return i > 0 && i < a;
  });
}

/** The mora index the pitch drops after, or null when it never does. */
export function dropAfter(moraCount: number, accent: number): number | null {
  const a = accent >= 0 && accent <= moraCount ? accent : 0;
  return a === 0 ? null : a - 1;
}
