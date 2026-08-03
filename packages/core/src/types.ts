/** A single dictionary entry (one sense group of one term/reading pair). */
export interface DictEntry {
  /** Headword, usually with kanji, e.g. 食べる */
  term: string;
  /** Kana reading, e.g. たべる */
  reading: string;
  /**
   * Part-of-speech tags, JMdict-style: "v1", "v5k", "v5r", "vs", "vk",
   * "adj-i", "adj-na", "n", "exp", "adv", ...
   */
  pos: string[];
  /** English glosses. */
  glosses: string[];
  /** Popularity rank (lower = more common). Used for ranking results. */
  freq?: number;
  /**
   * Which dictionary this came from. Unset for the built-in one; set when
   * several are enabled, so results can be labelled.
   */
  source?: string;
}

/** A compiled, lookupable dictionary. */
export interface Dictionary {
  lookupExact(text: string): DictEntry[];
}

/** One deinflection candidate produced from surface text. */
export interface DeinflectionResult {
  /** The dictionary form this chain arrives at, e.g. 食べる */
  term: string;
  /** Human-readable chain of applied rules, e.g. ["-te", "progressive"] */
  reasons: string[];
  /**
   * Word classes the final form must belong to for the chain to be valid.
   * Empty set means unconstrained (no rules applied, or rules don't care).
   */
  classes: string[];
}

/** A ranked lookup match: dictionary entries + how we got there. */
export interface LookupMatch {
  /** The exact substring of the scanned text that matched. */
  matchedText: string;
  /**
   * Where the match begins in the scanned text. Not necessarily where the
   * user tapped: a tap lands inside a word at least as often as at its start.
   */
  start: number;
  /** Length of matchedText in code points (for highlight). */
  matchLength: number;
  /** The deinflected dictionary form that was found. */
  term: string;
  reasons: string[];
  entries: DictEntry[];
}

/** Review grades, Anki-style. */
export type Grade = "again" | "hard" | "good" | "easy";

export type CardState = "new" | "learning" | "review" | "relearning";

/** A vocabulary flashcard with SRS scheduling state. */
export interface Card {
  /** Stable unique id (uuid). */
  id: string;
  term: string;
  reading: string;
  glosses: string[];
  /** The sentence the word was mined from, if any. */
  sentence?: string;
  /** What the sentence means, when the deck carried a translation. */
  sentenceMeaning?: string;
  /** Free-form notes from the deck's author: usage, nuance, mnemonics. */
  notes?: string;
  /** Source URL / page title, if mined from a page. */
  source?: string;
  /**
   * Which deck this card belongs to. Absent means the mining deck — the
   * words you saved yourself — which is where every card was before there
   * was more than one deck.
   */
  deckId?: string;
  /**
   * Media that came with the card, usually from an Anki import: the word
   * spoken, the example sentence read out, and a picture. Each value is a
   * key into the device's local media storage (the importer sets it), so the
   * files themselves never travel with the card — a device without them
   * falls back to synthesised audio and shows no picture.
   */
  audio?: string;
  sentenceAudio?: string;
  image?: string;
  createdAt: number;
  /** Last-modified timestamp; drives last-write-wins sync. */
  updatedAt: number;
  /** Soft-delete flag so deletions sync across devices. */
  deleted?: boolean;

  // --- scheduling state ---
  state: CardState;
  /** Epoch ms when the card is next due. */
  due: number;
  /** Current interval in days (0 while in learning steps). */
  intervalDays: number;
  /** Ease factor, Anki-style, starts at 2.5, floor 1.3. SM-2 only. */
  ease: number;
  /** FSRS memory state. Absent until the card's first FSRS review. */
  stability?: number;
  difficulty?: number;
  /** When the card was last reviewed, for FSRS's elapsed-time term. */
  lastReview?: number;
  /** Set once lapses reach the leech threshold. */
  leech?: boolean;
  /** Index into learning steps while state is learning/relearning. */
  stepIndex: number;
  reps: number;
  lapses: number;
}
