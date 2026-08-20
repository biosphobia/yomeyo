import {
  MINING_DECK_ID,
  cardKey,
  deckOf,
  makeId,
  newCardSchedule,
  orderOf,
  type Card,
  type DictEntry,
} from "@yomeyo/core";
import { activeDictionary, assetUrl, importCards, liveCards } from "./store.js";

/**
 * Building a deck by typing, rather than by importing a file.
 *
 * A premade deck used to have exactly one way in: find an .apkg, map its
 * fields, import it. That is fine for Core 2k and hopeless for "the forty
 * words in chapter three", which is a list somebody has in their head and
 * nowhere else. This turns such a list into cards.
 *
 * Two doors, one road. Paste a list and every word is looked up in the
 * dictionary, which supplies the reading and the meaning so nobody has to
 * type them. Or describe the deck you want and Claude drafts it — and every
 * word it drafts is then looked up in exactly the same way, so a reading the
 * model invented for a word the dictionary has never heard of is visibly
 * flagged before it becomes a card somebody studies.
 *
 * Nothing is added until it has been looked at. Drafts are shown first,
 * marked with what is known about them, and the ones that are wrong can be
 * thrown away.
 */

/** One card-to-be, with what could be verified about it. */
export interface Draft {
  term: string;
  reading: string;
  glosses: string[];
  sentence?: string;
  sentenceMeaning?: string;
  notes?: string;
  /** The dictionary has this word: the reading could be checked. */
  known: boolean;
  /** Already a card somewhere. The deck it is in, when it is elsewhere. */
  have?: "here" | "elsewhere";
}

const KANA_ONLY = /^[぀-ヿー\s]+$/u;

/** The dictionary's own answer for a word, if it has one. */
function lookup(dictionary: { lookupExact(t: string): DictEntry[] }, term: string): DictEntry | null {
  const entries = dictionary.lookupExact(term);
  if (entries.length === 0) return null;
  // The commonest sense of the commonest entry: a deck wants the word people
  // mean, not the fourteenth archaic reading of it.
  return [...entries].sort((a, b) => (a.freq ?? 1e9) - (b.freq ?? 1e9))[0];
}

/**
 * Turn typed lines into drafts.
 *
 * One word per line. Anything the dictionary knows needs nothing else — the
 * reading and the meaning come from there. A line can still say them itself,
 * separated by tabs, `|`, or commas:
 *
 *     食べる
 *     食べる | たべる | to eat
 *     食べる, たべる, to eat; to have a meal
 */
export async function draftsFromText(text: string, deckId: string): Promise<Draft[]> {
  const dictionary = await activeDictionary();
  const have = await existingCards();
  const drafts: Draft[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith("#")) continue;
    const parts = (/[\t|]/.test(row) ? row.split(/\s*[\t|]\s*/) : row.split(/\s*,\s*/)).map((p) =>
      p.trim(),
    );
    const term = parts[0];
    if (!term) continue;
    // Only the first two separators mean anything: a meaning may well have a
    // comma in it, and "to eat, to have a meal" is one meaning field.
    let reading = parts[1] ?? "";
    let glosses = parts.slice(2).filter(Boolean);
    if (parts.length > 3) glosses = [parts.slice(2).join(", ")];

    const entry = lookup(dictionary, term);
    if (!reading) reading = entry?.reading ?? (KANA_ONLY.test(term) ? term : "");
    if (glosses.length === 0) glosses = (entry?.glosses ?? []).slice(0, 3);

    const draft: Draft = {
      term,
      reading,
      glosses: glosses.flatMap((g) => g.split(/\s*;\s*/)).filter(Boolean),
      known: entry !== null,
    };
    if (seen.has(cardKey(draft.term, draft.reading))) continue;
    seen.add(cardKey(draft.term, draft.reading));
    markHeld(draft, have, deckId);
    drafts.push(draft);
  }
  return drafts;
}

/** Every live card, by word, for spotting what is already in the collection. */
async function existingCards(): Promise<Map<string, Card>> {
  const map = new Map<string, Card>();
  for (const card of await liveCards()) map.set(cardKey(card.term, card.reading), card);
  return map;
}

function markHeld(draft: Draft, have: Map<string, Card>, deckId: string): void {
  const card = have.get(cardKey(draft.term, draft.reading));
  if (card) draft.have = deckOf(card) === deckId ? "here" : "elsewhere";
}

// ---------------- asking for a deck ----------------

let available: Promise<boolean> | null = null;

/** Whether the site can reach Claude at all. Asked once per page load. */
export function generatorAvailable(): Promise<boolean> {
  available ??= fetch(assetUrl("grammar.php?probe=1"))
    .then((res) => res.status === 204)
    .catch(() => false);
  return available;
}

function promptFor(request: string, count: number, avoid: string[]): string {
  const lines = [
    `Build a Japanese vocabulary deck of ${count} cards.`,
    "",
    "What it should contain:",
    request,
    "",
    "Rules, which are not negotiable:",
    "- Give the dictionary form of each word, written the way it is normally",
    "  written — kanji where kanji is normal, kana where kana is normal.",
    '- "reading" is the whole word in kana. For a word already written in kana,',
    "  that is the word itself.",
    '- "glosses" is one to three short English meanings, no articles, no',
    "  explanations, no part-of-speech tags.",
    '- "sentence" is optional: one short natural example using the word, with',
    '  "sentenceMeaning" its English. Include it only when it is genuinely',
    "  useful; a bad example is worse than none.",
    '- "notes" is optional and at most one line — usage, a nuance, a warning.',
    "- No duplicates, and no word you are not certain of. A shorter deck of",
    "  words you are sure about is better than a long one with a wrong reading",
    "  in it, because every card here is studied as fact.",
  ];
  if (avoid.length > 0) {
    lines.push(
      "",
      "The learner already has cards for every word below. Do NOT include any",
      "of them, in any spelling or form; each slot one of them would have",
      `taken goes to a word that is not on this list. Give ${count} words that`,
      "are all absent from it:",
      avoid.join("、"),
    );
  }
  return lines.join("\n");
}

/**
 * The words the model must not offer, biggest overlap first: what is
 * already in THIS deck (a themed request collides with its own deck far
 * more than with the rest), then everything the model already offered
 * this session (it escaped the ban once, so it gets named explicitly),
 * then the rest of the collection. Capped well under the server's prompt
 * limit, so a huge collection trims the tail rather than the rules.
 */
function avoidList(have: Map<string, Card>, deckId: string, offered: Set<string>): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  let length = 0;
  const push = (term: string): void => {
    if (!term || seen.has(term) || length + term.length > 7000) return;
    seen.add(term);
    list.push(term);
    length += term.length + 1;
  };
  const cards = [...have.values()];
  for (const card of cards) if (deckOf(card) === deckId) push(card.term);
  for (const term of offered) push(term);
  for (const card of cards) push(card.term);
  return list;
}

/** One request to the model, parsed but not yet checked. */
async function askOnce(request: string, count: number, avoid: string[]): Promise<unknown[]> {
  const res = await fetch(assetUrl("grammar.php"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "deck", prompt: promptFor(request, count, avoid) }),
  });
  if (!res.ok) throw new Error("The word list could not be written just now.");
  const { raw } = (await res.json()) as { raw?: string };
  if (!raw) throw new Error("The word list came back empty.");
  const parsed = JSON.parse(raw) as { cards?: unknown };
  if (!Array.isArray(parsed.cards)) throw new Error("The word list came back in the wrong shape.");
  return parsed.cards;
}

/**
 * Ask Claude for a deck, then check every word it gives back.
 *
 * The model writes the list; the dictionary is what makes it true. Each word
 * is looked up, and the reading it comes back with is preferred over the
 * model's — with the model's kept for words the dictionary does not have, and
 * those marked so nobody publishes them without a look.
 *
 * Every word offered is new by construction. The model is told what the
 * collection already holds and asked not to repeat it; anything held that
 * slips through anyway is dropped rather than shown, and the asking
 * repeats — with the slipped words now named in the ban — until the
 * requested number of genuinely new words is reached, or a round brings
 * nothing new and the well is declared dry. Asking for thirty words and
 * being shown ten, three of them already yours, was not an answer.
 */
export async function draftsFromRequest(
  request: string,
  count: number,
  deckId: string,
): Promise<Draft[]> {
  const dictionary = await activeDictionary();
  const have = await existingCards();
  const what = request.trim().slice(0, 2000);
  /** Every term the model has offered this session, held or not: banned
   * by name from the next round, since the broad ban missed it once. */
  const offered = new Set<string>();

  const fresh: Draft[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < 4 && fresh.length < count; round++) {
    let cards: unknown[];
    try {
      cards = await askOnce(what, count - fresh.length, avoidList(have, deckId, offered));
    } catch (err) {
      // The first round failing is a failure; a later one failing means
      // the words already gathered are the answer.
      if (round === 0) throw err;
      break;
    }

    let gained = 0;
    for (const value of cards) {
      const card = value as Partial<Draft>;
      const term = typeof card.term === "string" ? card.term.trim() : "";
      if (!term) continue;
      offered.add(term);
      const entry = lookup(dictionary, term);
      const reading =
        entry?.reading ?? (typeof card.reading === "string" ? card.reading.trim() : "") ?? "";
      const glosses = (Array.isArray(card.glosses) ? card.glosses : [])
        .filter((g): g is string => typeof g === "string" && g.trim().length > 0)
        .map((g) => g.trim())
        .slice(0, 4);
      if (glosses.length === 0) continue;
      const key = cardKey(term, reading);
      if (seen.has(key)) continue;
      seen.add(key);

      const draft: Draft = {
        term,
        reading,
        glosses,
        known: entry !== null,
        ...(typeof card.sentence === "string" && card.sentence.trim()
          ? { sentence: card.sentence.trim() }
          : {}),
        ...(typeof card.sentenceMeaning === "string" && card.sentenceMeaning.trim()
          ? { sentenceMeaning: card.sentenceMeaning.trim() }
          : {}),
        ...(typeof card.notes === "string" && card.notes.trim() ? { notes: card.notes.trim() } : {}),
      };
      markHeld(draft, have, deckId);
      // A word already held anywhere is not an offer at all.
      if (draft.have) continue;
      fresh.push(draft);
      gained++;
      if (fresh.length >= count) break;
    }
    // A whole round with nothing new in it: the topic is exhausted, and
    // asking again would only get the same words a third time.
    if (gained === 0) break;
  }
  return fresh;
}

// ---------------- turning drafts into cards ----------------

export interface AddResult {
  added: number;
  /** Words already in this deck, left alone. */
  here: number;
  /** Words held in another deck; a word lives in one place, so they stay put. */
  elsewhere: number;
}

/**
 * Add drafts to a deck, at the end of it.
 *
 * Cards go in through the same door as every other import, which is what
 * keeps one word to one card: a word already in the collection is not
 * duplicated into a second deck, and the caller is told how many that was
 * rather than left to wonder where they went.
 */
export async function addDrafts(drafts: Draft[], deckId: string): Promise<AddResult> {
  const wanted = drafts.filter((draft) => !draft.have);
  const now = Date.now();
  let at = await lastPosition(deckId, now);
  const cards: Card[] = wanted.map((draft, i) => {
    at += 60_000;
    return {
      id: makeId(),
      term: draft.term,
      reading: draft.reading,
      glosses: draft.glosses,
      ...(draft.sentence ? { sentence: draft.sentence } : {}),
      ...(draft.sentenceMeaning ? { sentenceMeaning: draft.sentenceMeaning } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
      ...(deckId === MINING_DECK_ID ? {} : { deckId }),
      order: at,
      createdAt: now + i,
      updatedAt: now + i,
      ...newCardSchedule(now),
    };
  });
  const added = cards.length > 0 ? await importCards(cards) : 0;
  return {
    added,
    here: drafts.filter((d) => d.have === "here").length,
    elsewhere: drafts.filter((d) => d.have === "elsewhere").length,
  };
}

/** Where the end of the deck currently is. */
async function lastPosition(deckId: string, now: number): Promise<number> {
  const cards = (await liveCards()).filter((card) => deckOf(card) === deckId);
  return cards.reduce((most, card) => Math.max(most, orderOf(card)), now);
}
