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

Nothing to do: a word saved with the extension is added to the app's deck the
moment you save it, whether or not the app is open anywhere.

The extension has to keep its own deck — it must work on pages where the app
is not open — so something has to carry the words across. Since the extension
injects a content script into every page, including the app's own, the two
simply talk through the page they share: the extension offers what it has not
handed over yet, the app imports it and says which ids it took, and the
extension stops offering those. Nothing leaves the device, and no server is
involved. The extension checks the page against the app URL in its own
settings before handing anything over, so a site claiming to be Yomeyo is
given nothing.

An extension cannot write into a website's storage, so something on the app's
origin has to do the writing. The app ships a tiny page for it, `sync.html`,
which the extension's content script loads in a hidden frame on each save and
hands the card to. A frame of one origin inside another is normally given its
own partitioned storage, which would make this pointless — frames an
extension creates are exempt, and (measured, not assumed) that needs no extra
permission at all. The extension asks for exactly what it always has.

That frame cannot tell the extension apart from the page hosting it, so it
does not try: it demands a secret instead. The app mints one and hands it to
the extension over the bridge that runs on the app's own page, where no other
site can listen. A page that embeds `sync.html` and posts cards at it has
nothing to send, and gets nothing back — verified, including with a guessed
secret. Until the app has been opened once there is no secret, and the routes
below carry the words instead.

If that fails — no connection, a wrong app URL, or a page whose own policy
forbids frames — the words simply stay pending and go across on the next save, or
the next time the app is open in a tab. The toolbar popup also keeps a
**Send them now** button under *Words not arriving?* which opens the app and
hands them over in the URL fragment, which browsers never send to a server.
Re-sending is always harmless: cards merge by id and the newer version wins.

Signing in to the same account on both, or running the sync server below,
covers everything else — including a phone and a desktop.

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

## Pronunciation audio

Words are spoken with a real recording where one exists, a synthesised voice
where it does not, and the device's own Japanese voice when neither is
reachable. Clips are cached on the device after the first play.

Recordings come from a list endpoint of the kind Yomitan calls a "custom
audio source" — configured, with your key, in **Settings → Audio**. The key
is kept in that browser only: it is never committed here, never bundled, and
never synced.

**These services usually refuse web pages.** They were built for Yomitan and
Anki — an extension and a desktop program, neither bound by the browser's
cross-origin rules — so most never send the `Access-Control-Allow-Origin`
header a web page needs, and the request fails before it is even sent. The
app now says so plainly instead of reporting a bare "Failed to fetch", and
tells the two cases apart: a service that refuses pages, and one that is not
answering at all.

The extension is not bound by those rules either. With it installed, open its
toolbar menu and press **Allow audio downloads**, and the app fetches through
it. That permission is optional and asked for there rather than required up
front, because a required one would make browsers hold the extension for
re-approval on every update.

## Bringing a deck over from Anki

**Settings → Import from Anki.** In Anki, **File → Export**:

- **Anki Deck Package (`.apkg`)** — brings the words *and* your review
  history. A card on a four-month interval arrives on a four-month interval,
  with its ease, rep count and lapses. Tick **Support older Anki versions** in
  the export dialog: recent Anki compresses the collection with zstd, which
  browsers have no decompressor for. Media is ignored, so a huge collection
  imports without needing to fit in memory.
- **Notes in Plain Text (`.txt`)** — the words only. There is no scheduling in
  that format to lose, and it always works.

Yomeyo guesses which of your note type's fields is the word, the reading, the
meaning and the sentence — the common Japanese note types (Core 2k/6k, the
mining templates, and Japanese-named fields) land right untouched. The guess
is shown as dropdowns with a preview of the first few cards, so a wrong one is
obvious before anything is added. Note types you don't want can be switched
off, and each is mapped separately.

Furigana written into the expression field (`水臭[みずくさ]い`) is split into
the word and its reading. Fields are HTML, so a meaning laid out as a list
becomes separate glosses. Notes with an empty word field are skipped, and
words already in your deck are not added twice — importing the same file again
adds nothing, so you can move over gradually. Cards suspended in Anki arrive
marked as leeches, which **Settings → Scheduling → Leech action** can be told
to suspend.

## Accounts and cloud sync (Firebase)

Your deck works with no account at all — it lives in the browser on each
device. Signing in adds backup, keeps devices in step, and gives each account
its own deck, settings and daily counts, so more than one person can share a
browser without seeing each other's words. Signing out puts an account's deck
away and brings back the one kept for nobody in particular.

The first account to sign in on a device takes over whatever was mined before
signing in — moved, not copied, so the same word does not end up in two decks
drifting apart. Afterwards each account starts empty and fills from its own
cloud. A few things stay device-wide because they are not anyone's in
particular: the Firebase config (you need it *in order to* sign in), the
extension's handover secret, imported dictionaries, and downloaded audio.

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

### Turning it on

Best done once, for every device at once: put the `firebaseConfig` JSON in a
repository secret named **`FIREBASE_CONFIG`** (*Settings → Secrets and
variables → Actions*). Every build then ships with the project already
configured, and **Settings → Account** offers **Sign in with Google**
immediately — nothing to paste on each phone or laptop.

Failing that, open **Settings → Account** and paste the JSON there; it is
stored on that device only. Either way you can also sign in with an email
address — an address that isn't registered yet creates the account, so
there's one button rather than a separate sign-up flow.

The config is not a secret (its protection comes from the rules above); the
only reason to keep it in a repository secret is so forks don't inherit your
project.

Press **Sync now** on each device. Sync is offline-first and last-write-wins
per card, deletions included — mine on your phone, review on your laptop, and
the scheduling state follows you.

Opened from the home screen rather than in a tab, Google sign-in leaves the
app and comes back rather than opening a popup — a popup there lands in a
separate browser window, and on Android often never returns at all.

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
packages/core       lookup + deinflection + SRS scheduler + sync + Anki reader
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
- **Tap scanning** (`packages/core/src/dictionary.ts`): a desktop hover tool
  can scan forward from the character under the cursor, because you point at
  a word's first character. A finger cannot: Japanese has no spaces, so
  nothing on screen marks where a word begins, and a fingertip covers several
  characters. Scanning forward only, a tap on the 臭 of 水臭い found 臭い and a
  tap on its い found 遺孤 — over hand-segmented sentences the top result was
  the word actually tapped just 43% of the time. The scan now also starts up
  to eight characters back, keeping only matches that still cover the tapped
  character, which takes that to 87%. Candidates are ranked longest first,
  then fewest deinflection steps, then kanji-initial (the content words people
  mine), then dictionary frequency.
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
- **Anki import** (`packages/core/src/anki.ts`, `sqlite.ts`, `zip.ts`): an
  `.apkg` is a ZIP holding a SQLite collection. Reading it the usual way means
  shipping SQLite compiled to WebAssembly — about a megabyte, downloaded by
  everyone, to read a file most people open once. What is actually needed is a
  full table scan of three tables, which is the file format's simplest path:
  walk the b-tree, decode each row. That is ~200 lines, including the overflow
  pages long fields spill onto. It is tested against databases written by
  Node's own SQLite rather than by this repository, so a bug here cannot agree
  with itself. Reading 25,000 notes takes about 0.4 s.

  The ZIP side never holds the whole file: it reads the index at the end, then
  the bytes of the one entry it wants. Media in a mined collection can run
  past a gigabyte, and on a phone that is the difference between importing a
  deck and running out of memory. Inflating is
  `DecompressionStream("deflate-raw")`, which is exactly what a ZIP stores.
- **Accounts** (`apps/web/src/accounts.ts`, `db.ts`): one IndexedDB database
  per account, named after its uid; the signed-out deck keeps the original
  name, so a deck mined before accounts existed is where it always was. Which
  account is in use is itself stored in IndexedDB rather than localStorage,
  because `sync.html` — the drop box the extension hands saved words to — has
  to read it from inside a frame on someone else's page, and only IndexedDB is
  known to reach the app's real storage from there.
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
