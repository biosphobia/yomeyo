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

Two ways, use whichever suits the moment:

**1. The extension — tap words directly on the page.** Install it in an
Android browser that supports extensions (below), then just tap any Japanese
word while reading. A sheet slides up with the definition; tap **+ Save**.

**2. Share text into the app.** Select Japanese text on any page → tap
**Share** → choose **Yomeyo**. The text opens in the Reader with every word
tappable. This works in any browser, including ones without extension
support, and is handy for a whole article. Pasting into the Reader works too.

## The extension on Android

Download the build for your browser (both are published on every run):

| Browser | Package |
|---|---|
| Firefox for Android | [`yomeyo-extension-firefox.zip`](https://biosphobia.github.io/yomeyo/yomeyo-extension-firefox.zip) |
| Chrome / Edge / other Chromium | [`yomeyo-extension-chromium.zip`](https://biosphobia.github.io/yomeyo/yomeyo-extension-chromium.zip) |

Both are also attached to every Actions run as the `yomeyo-extension`
artifact.

**Tap-to-look-up is on by default on touch devices** — no setting to find.
On desktop it stays off and you hold **Alt/Option** and click instead, so
ordinary clicking is unaffected. The toolbar popup toggles this, and shows
what the page you are on will actually do.

Installing an unsigned extension differs per browser: Firefox for Android
requires the add-on to be signed by Mozilla (via addons.mozilla.org, or a
custom collection on Firefox Nightly with *Settings → Advanced → Custom
Add-on collection*), while Chromium browsers that allow it use
`chrome://extensions` → *Developer mode* → *Load unpacked* on the unzipped
folder. Follow whichever your browser supports.

### Getting extension words into the app

The extension keeps its own deck, so send words over when you want to
review: open the toolbar popup and tap **Send words to the Yomeyo app**. The
app opens and imports them.

The words travel in the URL fragment, which browsers never send to a server,
so your deck stays on the device. Re-sending is harmless — cards merge by id
and the newer version wins. If you run the sync server below, both sides sync
automatically instead and you never need this button.

### Reviewing

Open the app and hit **Review**. Rate each card *Again / Hard / Good / Easy*;
each button shows when you would next see it. Tap 🔊 to hear the word.

### Audio

Three sources are tried in order, so you get a real human voice when one
exists and never silence when it doesn't:

1. **Forvo** — an actual person saying the word
2. **Synthesised** — OpenAI / ElevenLabs / Polly from the same endpoint
3. **Your device's Japanese voice** — always available, works offline

Clips are cached on the device after the first play, so replaying a card
during review is instant and keeps working with no signal.

Online audio needs an API key, entered under **Settings → Audio**. **The key
is stored only in your browser** — it is never committed to this repository,
never bundled into the published app, and never synced. The endpoints are
editable there too if you use a different service; they take `{term}`,
`{reading}`, `{language}` and `{apiKey}` placeholders. A **Test** button
reports exactly what each source returns without ever printing your key.

With no key configured, audio falls straight through to the device voice.

Scheduling is **FSRS-6**, the same algorithm Anki uses with FSRS enabled, and
it ships configured to match a real mining deck:

| Setting | Default |
|---|---|
| Scheduler | FSRS, 80% desired retention |
| FSRS parameters | 21-weight optimised set (replaceable) |
| New cards/day | 20 |
| Maximum reviews/day | 9999 |
| Learning steps | 20s 1m 5m |
| Relearning steps | 3m |
| Leech threshold | 5 lapses, tag only |
| New card order | Order added |

All of it is editable under **Settings → Scheduling**, including pasting a
fresh parameter set from Anki (*Deck options → FSRS → FSRS parameters*).
Turning FSRS off falls back to SM-2.

Learning steps sit outside FSRS, exactly as they do in Anki: FSRS models
memory over days, while a 20-second step is about getting a new word in at
all. Once a card graduates, FSRS picks the interval from the memory state
built up during those steps.

## Kanji

The **Kanji** tab has two lists:

- **From my words** — every kanji appearing in words you have saved, which is
  the set actually worth studying.
- **Jōyō** — all 2,136 school kanji, with the ones you have already met
  highlighted.

Tapping a character shows its meanings, on/kun readings, grade, stroke count
and JLPT level, the words in your deck that use it, and its **stroke order
animated one stroke at a time** (with numbering, replay, and a
show-the-finished-character button).

Data is [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)
for the readings and meanings and [KanjiVG](https://kanjivg.tagaini.net/) for
the stroke paths, both built in CI alongside the dictionary.

## Extra dictionaries (Japanese-Japanese and other languages)

The built-in dictionary is JMdict English. **JMdict contains no Japanese
glosses**, and the well-known monolingual dictionaries (三省堂, 大辞林, …) are
copyrighted, so a Japanese-Japanese dictionary cannot be shipped with the
app. What Yomeyo does instead is read the format those dictionaries are
distributed in, so one you already have can be added:

**Settings → Dictionary → Additional dictionaries** → unzip a
Yomitan/Yomichan dictionary and select its `term_bank_*.json` files.

Imported dictionaries are searched alongside the built-in one, each
definition labelled with where it came from, and can be switched off or
removed without losing anything. Yomeyo's own exported dictionary format is
accepted too, so a JMdict build in another language (Spanish, French, German,
Dutch, Russian, …) can be added the same way — `npm run build-dict` takes the
language edition you point it at.

## The extension on desktop

Same packages as above. Chrome/Edge → `chrome://extensions` → **Developer
mode** → **Load unpacked** → the unzipped `chromium` folder. Firefox →
`about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick
`manifest.json` inside the unzipped `firefox` folder.

Hold **Alt/Option** and click any Japanese word for an instant popup, or turn
on *Tap to look up* in the toolbar popup for click-only lookup.

## Accounts and cloud sync (Firebase)

Your deck works with no account at all — it lives in the browser on each
device. Signing in adds backup and keeps devices in step.

### Setting up your Firebase project (once)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com/).
2. **Authentication → Get started**, and enable the sign-in methods you want:
   **Google** and/or **Email/Password**.
3. **Firestore Database → Create database**. Any location; start in
   production mode, since the rules below replace whatever it starts with.
4. **Project settings → Your apps → Web (`</>`)** — register an app and copy
   the `firebaseConfig` object.
5. Deploy the security rules from this repo, so each deck is private:
   ```bash
   npx firebase-tools deploy --only firestore:rules --project <your-project-id>
   ```
   Or paste `firestore.rules` into **Firestore → Rules** in the console.
6. **Authentication → Settings → Authorized domains**: add
   `biosphobia.github.io` (and any other host you serve the app from), or
   Google sign-in will be rejected.

### Turning it on in the app

Open **Settings → Account**, paste the `firebaseConfig` JSON, then sign in
with Google or an email address. (An email that isn't registered yet creates
the account, so there's one button rather than a separate sign-up flow.)

Press **Sync now** on each device. Sync is offline-first and last-write-wins
per card, deletions included — mine on your phone, review on your laptop, and
the scheduling state follows you.

The Firebase config is not a secret (its protection comes from the rules
above), but if you'd rather bake it into the build than paste it, set
`VITE_FIREBASE_CONFIG` to the JSON at build time and the app will use that
instead.

**What it costs:** a personal deck sits far inside Firebase's free tier —
a sync reads only what changed since last time, and writes only what you
mined or reviewed.

### Alternative: self-hosted sync server

If you'd rather not use Google's infrastructure, the repo still ships a
zero-dependency sync server:

```bash
YOMEYO_TOKEN=pick-a-secret npm run sync-server   # listens on :8787
```

Enter that URL and token under **Settings → Self-hosted sync server** (and in
the extension's toolbar popup). It is used only when no Firebase project is
configured. Put it behind HTTPS — the installed app can only call HTTPS
endpoints.

Without any sync you can still move a deck by hand: **Words → Export JSON**,
then **Import JSON** on the other device.

## How the deployment works

`.github/workflows/deploy.yml` runs on every push to `main` or the
`claude/japanese-vocab-extension-7t4oai` branch:

1. runs the test suite,
2. downloads the latest [jmdict-simplified][jmdict] release and converts it to
   Yomeyo's binary dictionary format,
3. **verifies** the result — entry count plus spot-checks that 食べる/読む/
   高い/日本語/する are present with the right readings and parts of speech, so
   an upstream format change fails the build instead of shipping a dictionary
   that silently looks nothing up,
4. builds the app and publishes it both to the `gh-pages` branch and through
   the Actions Pages pipeline, so whichever Pages source you chose works,
5. zips the extension for both engines and publishes them alongside the app.

If Pages is not enabled yet, the build still succeeds and says so in the job
summary — the extension artifact is produced either way.

It builds the **complete** JMdict by default. The common-words subset is
smaller but omits ordinary compounds — 遠距離恋愛 and 人工知能 are both
missing from it — and a word you cannot look up is exactly the word worth
mining. Run the workflow manually with *common_dictionary* checked if you
would rather have the smaller download.

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
packages/core       lookup + deinflection + SRS scheduler + sync engine (shared)
apps/web            the installable PWA (Vite, vanilla TS, IndexedDB, Firebase)
apps/extension      the MV3 browser extension, built for Chromium and Gecko
apps/sync-server    zero-dependency Node sync server (Firebase alternative)
scripts/            JMdict builder, dictionary seeder, icon + SW build helpers
firestore.rules     Firestore security rules — each deck is private to its owner
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
- **Dictionary format** (`yomeyo-dict-2`, `packages/core/src/dict-binary.ts`):
  the dictionary is searched where it lies rather than parsed. Keys are stored
  sorted by their UTF-8 bytes, so a lookup is a binary search comparing raw
  bytes — the query is encoded once and no stored key is ever decoded — and
  only the handful of entries a tap actually hits get decoded. Opening it is
  a read plus a few typed-array views.

  This matters because nothing stays loaded: the app's page and the
  extension's service worker both start from nothing on every page. Parsing
  the old JSON dictionary cost about four seconds on a mid-range phone each
  time, and left ~180 MB of heap behind; the binary form costs about a tenth
  of a second and holds only the buffer. The app also reads it straight out of
  Cache Storage instead of through `fetch`, because a service worker streaming
  ~19 MB back through JavaScript was itself ~2.5 s of that.
- **Kanji data**: KANJIDIC2 for readings/meanings, KanjiVG stroke paths
  bucketed by codepoint so opening one character fetches ~100 KB rather than
  every stroke in the set. The animation drives a dash offset along each
  stroke path in order.
- **Sync** (`packages/core/src/sync.ts`): one engine behind a `SyncBackend`
  interface, so Firestore and the self-hosted server share the same
  push/pull/merge logic. The local IndexedDB deck is always the read path —
  the cloud is a peer, not a dependency, so reviews work with no signal.
  Cards live at `users/{uid}/cards/{cardId}` with a server-written
  `syncedAt`, so the sync cursor cannot be skewed by a wrong device clock.

## Not done yet

- **Signed extension builds.** The packages are unsigned, so installing them
  follows each browser's developer path. Listing the Firefox build on
  addons.mozilla.org would make it a one-tap install on Firefox for Android;
  the manifest already carries the required add-on id.
- **iOS/Safari.** The extension is written to convert with Apple's
  `safari-web-extension-converter`, but shipping it needs a Mac, Xcode and an
  Apple Developer account. The app itself already works on iOS — install it
  from Safari's *Share → Add to Home Screen* and use the Reader.
- FSRS scheduling, audio/pitch accent, frequency tags, kanji breakdowns.

## Credits

Dictionary data is [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) from
the Electronic Dictionary Research and Development Group, used under
CC BY-SA 4.0, via [jmdict-simplified][jmdict].
