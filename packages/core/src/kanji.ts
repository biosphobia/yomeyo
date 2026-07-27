/** Kanji reference data: readings, meanings, and stroke order. */

export interface KanjiInfo {
  char: string;
  /** 1-6 elementary, 8 rest of jōyō, 9/10 jinmeiyō, 0 unknown. */
  grade: number;
  strokes: number;
  /** Old JLPT level (4 easiest … 1 hardest), 0 if unlisted. */
  jlpt: number;
  /** Newspaper frequency rank, 1 = most common, 0 if unranked. */
  freq: number;
  on: string[];
  kun: string[];
  meanings: string[];
}

/** Compact on-the-wire form: positional tuples, like the vocabulary dictionary. */
export interface KanjiFile {
  format: "yomeyo-kanji-1";
  kanji: Array<[string, number, number, number, number, string[], string[], string[]]>;
  meta?: { source?: string; date?: string; count?: number };
}

export function parseKanjiFile(data: unknown): KanjiInfo[] {
  const file = data as KanjiFile;
  if (!file || file.format !== "yomeyo-kanji-1" || !Array.isArray(file.kanji)) {
    throw new Error("Unrecognized kanji file format");
  }
  return file.kanji.map(([char, grade, strokes, jlpt, freq, on, kun, meanings]) => ({
    char,
    grade,
    strokes,
    jlpt,
    freq,
    on,
    kun,
    meanings,
  }));
}

/** True for CJK ideographs — kana and punctuation are excluded. */
export function isKanji(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

/**
 * Every distinct kanji in a string, in first-appearance order.
 * Used to turn a deck of words into the set of kanji worth studying.
 */
export function extractKanji(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of text) {
    if (isKanji(ch) && !seen.has(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}

/** Grade 1-8 is the jōyō set: what Japanese schooling actually covers. */
export function isJoyo(info: Pick<KanjiInfo, "grade">): boolean {
  return info.grade >= 1 && info.grade <= 8;
}

/** Human label for a grade value. */
export function gradeLabel(grade: number): string {
  if (grade >= 1 && grade <= 6) return `Grade ${grade}`;
  if (grade === 8) return "Secondary";
  if (grade === 9 || grade === 10) return "Name use";
  return "Uncommon";
}

/**
 * Which bucket file holds a kanji's stroke data. Mirrors the build script so
 * a detail view fetches ~100 KB rather than every stroke ever drawn.
 */
export function strokeBucket(char: string): string {
  const cp = char.codePointAt(0) ?? 0;
  return Math.floor(cp / 256)
    .toString(16)
    .padStart(2, "0");
}
