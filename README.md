# Yomeyo 読めよ

**An easy Yomitan + Anki, in one app.** Tap Japanese words you see while
browsing, save them as flashcards, and review them daily with spaced
repetition — the sentence-mining workflow without juggling two tools.

> **Nothing to build.** GitHub Actions builds the JMdict dictionary,
> publishes the app, and packages the extension on every push.

## One-time setup: turn on GitHub Pages

The build already runs and publishes the site to the **gh-pages** branch, but
GitHub does not allow the Actions token to switch Pages on, so this needs one
click from you:

**Settings → Pages → Source → "Deploy from a branch" → `gh-pages` → `/ (root)` → Save**

(Or pick **"GitHub Actions"** as the source and re-run the workflow — both
paths are published, so either works.)

A minute later the app is live at **https://biosphobia.github.io/yomeyo/**

## Install on Android

1. **Open** https://biosphobia.github.io/yomeyo/ in Chrome.
2. **Add it to your home screen** — Chrome menu (⋮) → *Add to Home screen*.
   It now opens like a normal app and keeps your deck on the device.
3. **Open it once while online** so the dictionary caches for offline use
   (Settings → *Download for offline use*, or just use the Reader once).
   After that, reviews and lookups work with no signal.

### Mining words on your phone

Select Japanese text on any page → tap **Share** → choose **Yomeyo**.
The text opens in the Reader with every word tappable: tap → definition →
**+ Save**. Pasting text into the Reader works too.

Chrome for Android does not support extensions at all, so no Yomitan-style
addon can exist there — sharing text into the app is the way to mine on
Android, and it is a two-tap flow once the app is on your home screen.

### Reviewing

Open the app and hit **Review**. Cards are scheduled Anki-style: rate each
one *Again / Hard / Good / Easy* and the interval adapts. Each button shows
when you would next see the card.

## Desktop extension (optional)

For tap-on-page lookup while browsing on a computer:

1. Download **https://biosphobia.github.io/yomeyo/yomeyo-extension.zip**
   — or, without waiting for Pages, grab the `yomeyo-extension` artifact from
   the latest run under the repository's **Actions** tab.
2. Unzip it.
3. Chrome/Edge → `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select the unzipped folder.

Hold **Alt/Option** and click any Japanese word for an instant popup, or flip
on *tap mode* in the toolbar popup so plain clicks look words up.

To get words from the extension onto your phone, run the sync server below.
If you only use the phone, you can ignore sync entirely.

## Optional: syncing between devices

Cards live on each device by default. To share one deck across your phone and
desktop, run the sync server somewhere both can reach:

```bash
YOMEYO_TOKEN=pick-a-secret npm run sync-server   # listens on :8787
```

Then enter that URL and token in the app's **Settings** and in the extension's
toolbar popup, and press *Sync now* on each device. Sync is offline-first and
last-write-wins per card; deletions propagate as soft deletes. Put it behind
HTTPS (Caddy/nginx, or a host like Fly/Railway) — the installed app can only
call HTTPS endpoints.

Without sync you can still move a deck by hand: **Words → Export JSON**, then
**Import JSON** on the other device.

## How the deployment works

`.github/workflows/deploy.yml` runs on every push to `main` or the
`claude/japanese-vocab-extension-7t4oai` branch:

1. runs the test suite,
2. downloads the latest [jmdict-simplified][jmdict] release and converts it to
   Yomeyo's compact dictionary format,
3. **verifies** the result — entry count plus spot-checks that 食べる/読む/
   高い/日本語/する are present with the right readings and parts of speech, so
   an upstream format change fails the build instead of shipping a dictionary
   that silently looks nothing up,
4. builds the app and publishes it both to the `gh-pages` branch and through
   the Actions Pages pipeline, so whichever Pages source you chose works,
5. zips the extension and publishes it alongside the app.

If Pages is not enabled yet, the build still succeeds and says so in the job
summary — the extension artifact is produced either way.

By default it builds the **common-words** JMdict: 23,186 entries, a 2.3 MB
download (~600 KB gzipped), which covers what learners actually read. For the
complete dictionary, run the workflow manually from the Actions tab with
*full_dictionary* checked.

[jmdict]: https://github.com/scriptin/jmdict-simplified

## Working on it locally

```bash
npm install
npm test              # core library tests
npm run build-dict    # optional: build the full JMdict locally
npm run build         # core + web app + extension
npm run dev:web       # dev server; "Try demo text" in the Reader
```

A small seed dictionary (~150 common words) is committed so everything works
before any dictionary build. `npm run build-dict` replaces it with real
JMdict; the built file is gitignored and the seed is restored automatically on
a fresh clone.

## Repository layout

```
packages/core       lookup + deinflection + SRS scheduler + sync merge (shared)
apps/web            the installable PWA (Vite, vanilla TS, IndexedDB)
apps/extension      the MV3 browser extension (esbuild)
apps/sync-server    zero-dependency Node sync server
scripts/            JMdict builder, dictionary seeder, icon + SW build helpers
```

## How the pieces work

- **Lookup** (`packages/core/src/dictionary.ts`): Yomitan-style scanning —
  from the tapped character it tries the longest candidate substring first,
  runs each through the deinflector, and filters hits by part-of-speech
  compatibility (so 切って matches 切る but never 着る).
- **Deinflection** (`packages/core/src/deinflect.ts`): rules for polite forms,
  te/ta forms, negatives, passive/potential/causative, conditionals,
  volitional, -tai, auxiliaries (ている・てしまう・ちゃう…) and i-adjectives,
  chained up to 6 steps deep.
- **SRS** (`packages/core/src/srs.ts`): Anki-style SM-2 — learning steps
  (1 min → 10 min), graduation at 1 day, intervals scaled by an ease factor
  (2.5 start, 1.3 floor), lapses to relearning with an ease penalty.
- **Dictionary format** (`yomeyo-dict-1`): positional tuples with an interned
  part-of-speech table, roughly a quarter smaller than plain objects, so the
  phone downloads less on mobile data.

## Not done yet

- **iOS/Safari.** The extension is written to convert with Apple's
  `safari-web-extension-converter`, but shipping it needs a Mac, Xcode and an
  Apple Developer account. Until then the app itself works on iOS — install
  it from Safari's *Share → Add to Home Screen* and use the Reader.
- FSRS scheduling, audio/pitch accent, frequency tags, kanji breakdowns.

## Credits

Dictionary data is [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) from
the Electronic Dictionary Research and Development Group, used under
CC BY-SA 4.0, via [jmdict-simplified][jmdict].
