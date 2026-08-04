# Grammar content format

The Grammar tab is entirely data-driven, so new practice sentences and
dictionary entries — hand-written or generated with the Claude API — drop in
without touching any engine code. This file is the contract a generator must
follow.

## Where content lives

| File | Contents |
| --- | --- |
| `apps/web/src/grammar-data.ts` | Course units (`GRAMMAR_UNITS`) and the Basics dictionary (`GRAMMAR_POINTS`) |
| `apps/web/src/grammar-jlpt-n5.ts` … `grammar-jlpt-n2n1.ts` | JLPT dictionary entries (`JlptPoint[]`) |

## The model (source: Cure Dolly, *Unlocking Japanese* / the video series)

Every sentence is a train:

- The **engine** comes last and is one of exactly three kinds: a do-word
  (あるく), a describing い-word (あかい — its "is" is built in), or a
  thing + だ (うなぎだ).
- The **doer** (the が-car) is always present, even when invisible: the
  hidden doer ∅が, whose default value is "I" but whose real value comes
  from context.
- **は is not a car** — it is a flag flown over a car, marking the topic.
  It never changes the logic of the sentence.
- **Particles attach to the word BEFORE them** and are rendered as small
  connector wagons of their own: ペン｜が｜赤い.
- **Word order is free** (the logical particles carry the meaning), with two
  exceptions the drills enforce: the engine comes last, and a describing
  word glued to a car stays immediately before it.

## Sentence format

```ts
interface Chunk {
  t: string;      // the car, kana only, particle included: "さくらが"
  r: string;      // romaji, particle separated by a space: "sakura ga"
  role: "engine" | "doer" | "topic" | "ghost" | "object" | "other";
  label: string;  // plain words, no grammar jargon — what a beginner reads
  p?: string;     // the particle this car ends with, when it has one
  q?: boolean;    // true ONLY if blanking this particle has exactly one right answer
  glue?: boolean; // true for a describing word bound to the NEXT car
}

interface Sentence {
  chunks: Chunk[];
  en: string;   // natural English
  lit?: string; // literal skeleton when it differs: "As for me, (it) is an eel."
}
```

Rules a generator MUST follow:

1. Kana only in `t` — this course runs alongside the kana course.
2. One chunk per car; the particle stays inside its car's `t` and is named
   in `p`. The romaji `r` mirrors `t` with the particle as the last
   space-separated token.
3. Every sentence has exactly one `engine` chunk, and it is last.
4. A sentence whose doer is hidden carries a `ghost` chunk
   (`{ t: "∅が", r: "(it)", role: "ghost", ... }`) placed where the doer
   logically sits. Pure-topic sentences (は + noun/adjective engine) need
   one; a は-flagged doer does not (use role `doer` with `p: "は"`).
5. `q: true` only where one particle is grammatically possible given the
   English shown (e.g. blank the は when the literal reads "as for…";
   never blank がっこうに where へ would also be right).
6. Labels are plain words — "who or what it's about", "the engine — a
   do-word" — never "subject", "predicate", "conjugation", "copula".
7. Vocabulary stays beginner-simple and concrete.

## Dictionary format

```ts
interface JlptPoint {
  t: string;  // the pattern: "〜てもいい"
  n: string;  // plain-words name: "it's okay to"
  e: string;  // 1-2 short sentences, jargon-free, Cure Dolly-consistent
  ex: string; // one example sentence
  en: string; // its translation
}
```

Voice rules: do-words / describing words / things (never verb / adjective /
noun where avoidable); れる・られる is "it lands on you", not "passive";
な is だ in its glue-on shape; ない is a describing word; the plain form is
non-past ("does / will do").

## Generating with the Claude API

A workable prompt shape: give the model this file, the target unit's theme
and particle inventory, and ask for JSON matching the `Sentence` interface
verbatim (kana only, chunked, labelled). Validate mechanically before
shipping: engine last, ghost placement, romaji token counts, `q` flags only
on unambiguous particles, and every kana within the learner's syllabary.
