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

## Wording rules (read this first)

The model below comes from Cure Dolly's lessons, but **none of her metaphor
reaches the screen** — no "engine", "carriage", "A-car", "train" — and
neither does textbook terminology — no "subject", "predicate", "copula",
"particle", "conjugation". A beginner sees two things per piece: **what it
means in English**, and **what job it does**, in ordinary words:

| never write | write instead |
| --- | --- |
| the engine | what happens / what it is / what it's like |
| the A-car, the subject | the one doing it |
| the topic marker は | as for… |
| the object を | what the action lands on |
| the zero pronoun / invisible が | nobody said it — but it's there |
| particle | little word / connecting word |
| conjugate | change shape |
| passive | it lands on you |

Every chunk carries `g`, its English meaning, and it is shown right under
the Japanese. That gloss is the single most important field: it is what
makes a dissected sentence readable to somebody on day one.

## The model (source: Cure Dolly, *Unlocking Japanese* / the video series)

Internally, every sentence is a train:

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
- **Word order matters, but not the way it does in English.** The source is
  explicit that both "Japanese is SOV" and "word order doesn't matter" are
  wrong. There are exactly two rules:
  1. **The ending always comes last.**
  2. **Anything describing something comes immediately before it.**
  Within those, the noun pieces may be in any order — メアリーが スーザンを
  なぐった and スーザンを メアリーが なぐった say the same thing, because
  が and を carry the roles, not the positions. What order *does* decide:
  move a noun to the end position and the clause stops being a sentence and
  becomes a description of that noun (いちばで かった ドレス, "the dress I
  bought at the market"). That is the whole basis of unit 7.

Further points from the later lessons, which the content must respect:

- **Logical vs non-logical particles.** が を に で と から まで mark what a
  word is doing. は and も do not — they flag a topic. Two logical particles
  never stack. に/で/と can carry は or も on top (には, にも, とは), but
  **が and を never stack — they step aside**: さくらは なぐった is
  さくらは ∅が ∅を なぐった.
- **Finding the sentence** (the analysis technique): the last engine is the
  end of the main clause. Anything earlier that looks like a clause but does
  *not* end in a connector is a **modifier** of a car or the engine, not a
  clause of its own. Sentence-enders (よ ね か) sit after the finished
  sentence.
- **The hidden doer need not be nameable.** It can mean "the circumstances"
  — よかった is ∅が よかった, "it would have been good".
- **Three word types only**: い-engines (describing words), う-engines
  (do-words), and everything else is a thing-word. な-words, の-words and
  する-words are all thing-words; there is no separate adverb car.
- **Self-move vs other-move**, not transitive/intransitive: でる (it comes
  out) vs だす (someone takes it out). ある is the parent of self-movers,
  する of other-movers.
- **No passive, no conjugation.** られる is the receptive — the doing lands
  on you; words *morph* into new words rather than conjugating.

## Sentence format

```ts
interface Chunk {
  t: string;      // the piece, kana only, particle included: "さくらが"
  r: string;      // romaji, particle separated by a space: "sakura ga"
  g: string;      // what it MEANS in English: "Sakura" — required, shown on screen
  role: "engine" | "doer" | "topic" | "ghost" | "object" | "other";
  label: string;  // the job, in ordinary words: "the one doing it"
  p?: string;     // the little word this piece ends with, when it has one
  q?: boolean;    // true ONLY if blanking that word has exactly one right answer
  glue?: boolean; // true for a piece bound to the NEXT one
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
4. A sentence whose doer is unsaid carries a `ghost` chunk
   (`{ t: "", r: "", g: "I", role: "ghost", ... }` — `g` is who it means
   *here*, drawn on screen as "(I)") placed where the doer logically sits.
   Pure-topic sentences (は + thing/describing ending) need one; a
   は-flagged doer does not (use role `doer` with `p: "は"`).
5. `q: true` only where one particle is grammatically possible given the
   English shown (e.g. blank the は when the literal reads "as for…";
   never blank がっこうに where へ would also be right).
6. `g` is required on every chunk and is a plain English meaning, not a
   grammatical description: "the cat", "sleeps", "as for me".
7. Labels follow the wording table above — never "subject", "predicate",
   "conjugation", "copula", "engine" or "car".
8. Engine labels must be one of "what happens", "what it is" or "what it's
   like", because the question shown to the learner is built from them:
   *"Which word tells you what happens?"*
9. Vocabulary stays beginner-simple and concrete.

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

This is already wired up: `apps/web/public/grammar.php` calls the Messages
API server-side (the key is written from the `ANTHROPIC_API_KEY` repository
secret at deploy time and never reaches the browser), and
`apps/web/src/grammar-ai.ts` asks for a fresh batch when a unit starts.

- **Model:** `claude-sonnet-5`, at `medium` effort.
- **Shape:** enforced by the API with structured outputs
  (`output_config.format`, a `json_schema` mirroring `Chunk`/`Sentence`), so
  the reply always parses and always carries the fields the app reads —
  no fence-stripping or repair.
- **Prompt:** two real sentences from the unit as worked examples, plus the
  unit's theme and the particles it has taught.
- **Validation is still mandatory** and lives in `validSentence()`: a schema
  guarantees the shape, not the teaching. It re-checks kana-only, exactly one
  ending and it comes last, an engine label the question wording is built
  from, a doer said or unsaid, and only particles the unit has taught.
  Anything failing is dropped; fewer than four survivors falls back to the
  built-in sentences silently.
