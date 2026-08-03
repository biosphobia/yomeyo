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

## Hosting on your own domain (cPanel / any FTP host)

Every push can also upload the built site to a host of your own — say
`https://duugu.moe/yomeyo/`. The app uses relative paths throughout, so it
works from any folder with no code change. One-time setup:

1. **Make the folder** on your host: in cPanel → *File Manager*, create
   `public_html/yomeyo`.
2. **Make an FTP account scoped to it**: cPanel → *FTP Accounts* → create one
   with **Directory** set to `public_html/yomeyo`. Scoped this way, the
   credentials can touch that folder and nothing else on your hosting.
3. **Add three repository secrets** on GitHub (*Settings → Secrets and
   variables → Actions → New repository secret*):

   | Secret | Value |
   |---|---|
   | `CPANEL_FTP_HOST` | your FTP server, e.g. `ftp.duugu.moe` or the server cPanel shows |
   | `CPANEL_FTP_USER` | the FTP account, e.g. `deploy@duugu.moe` |
   | `CPANEL_FTP_PASSWORD` | its password |

   Optional extras: `AUDIO_API_KEY` to turn on online pronunciation audio
   (the key stays on the server — see *Pronunciation audio* below),
   `CPANEL_FTP_DIR` if the account is *not* rooted in the target folder
   (e.g. `public_html/yomeyo/`), and `CPANEL_FTP_PROTOCOL` set to `ftp`
   only if your host offers no FTPS.

4. **Push** (or re-run the workflow). The site appears at your domain and
   every later push updates it — only changed files are uploaded.

Two notes: the first upload moves the whole dictionary (tens of megabytes),
so it takes a few minutes; later deploys are quick. And if you use cloud
sync, add your domain under **Firebase → Authentication → Settings →
Authorized domains**, or Google sign-in will refuse the new address.

The shipped `.htaccess` makes the site HTTPS-only: plain-http visits are
redirected, and HSTS tells browsers to skip http entirely from then on.
That assumes your domain has a certificate — on cPanel, check that
**SSL/TLS Status** shows AutoSSL active for the domain (it usually is).

### If the deploy is green but the site is empty

FTP cannot say *where* an account's root folder is on the disk, so a
successful upload can land in a folder the site never serves. Two fixes:

- The FTP account's **Directory** is fixed at creation and cannot be edited
  later — delete the account in **cPanel → FTP Accounts** and recreate it
  with the Directory set exactly to the site folder (the FTP Accounts list
  shows each account's path, which is also where the stray files went;
  clean those up in File Manager).
- Or keep the account and set the `CPANEL_FTP_DIR` secret to the site
  folder's path as seen from the account's root.

Set the `CPANEL_SITE_URL` secret (e.g. `https://duugu.moe/yomeyo/`) and
every deploy checks itself: the run fails with a clear message whenever
the URL is not serving the build it just uploaded.

A browser certificate error (`ERR_CERT_AUTHORITY_INVALID`) is the host,
not the deploy: the domain has no real certificate yet. In cPanel, open
**SSL/TLS Status** and **Run AutoSSL** for the domain; the error — and the
padlock — resolve a few minutes after it issues.

GitHub Pages keeps working alongside this; if you want the move to be
complete, switch Pages off under **Settings → Pages**.

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

There is nothing to configure in the app. Online audio is served by a tiny
endpoint (`audio.php`) deployed with the site, and the API key lives on the
server — set as the `AUDIO_API_KEY` repository secret, written to the host
at deploy time, never reaching any browser. A deployment without it (GitHub
Pages, or no secret set) falls straight through to the device voice.

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
audio source". The page itself never talks to it, for two reasons: those
services were built for Yomitan and Anki and usually refuse web pages
outright (no CORS header), and any key held by a web page is readable by
whoever opens the developer tools. Both problems end on the server — the
site ships `audio.php`, which holds the key, asks the service, and streams
the clip back same-origin.

To turn it on, add one repository secret: `AUDIO_API_KEY`. The deploy
workflow writes it to the cPanel host next to `audio.php` (and scrubs it
from the public GitHub Pages build, which cannot run PHP anyway). No key,
no cPanel host — the app quietly uses the device voice instead.

## Decks

Two kinds, and the **Decks** tab has both:

- **Mined words** — what you saved yourself, tapping words while reading.
  Personal, on your account, never shared.
- **Premade decks** — whole vocabulary lists somebody imported from Anki:
  Core 2k, a JLPT list, the words from a particular novel.

Premade decks are shared. Finding the file, getting it out of Anki and mapping
its fields is work, and it is the same work for everyone — so the first person
to do it publishes the result, and everyone after them adds the deck from
**Decks → Premade** with one tap and no file at all.

What gets shared is the **words only**: the term, reading, meanings and
example sentence. Not your review history — intervals and ease describe how
well *you* know a word — and never your mined deck. Whoever adds a premade
deck starts it as new, which is what they want anyway.

Decks can be removed again (the words go with them, the deck stays in the
library), and a deck you published can be withdrawn from **Decks → Mine**.

The library needs the same Firebase project as cloud sync, and you have to be
signed in to see it. Without a project, Anki import still works; the deck
simply stays on your device.

### Usernames and profile pictures

Decks carry their publisher's name — but never a real one. Every account is
given a unique username the first time it signs in (`learner-` and a stamp),
before its owner has chosen anything, so nobody is ever nameless and the
Google name is never displayed anywhere, to anyone. The username can be
changed in **Settings → Account** to anything not already taken — uniqueness
is a one-document-per-name claim enforced by the Firestore rules, so two
accounts can never share a name whatever a client does. A profile picture
can be set there too; it is downscaled on the device to a small square and
stored inside the profile, and shows beside shared decks in the library.

### The admin

One account — and structurally never more than one — holds the **admin
seat**, which grants moderation: withdrawing anyone's deck from the shared
library. The seat is a single `admin/owner` document the rules never let
change hands; its holder simply sees withdraw buttons on the Decks screen.
The enforcement lives in the Firestore rules, so a modified client gains
nothing; after changing the rules, redeploy them:

```
npx firebase-tools deploy --only firestore:rules --project <your-project-id>
```

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

An import becomes a deck of its own, named after the file, so it stays
separate from the words you mined. **Share with everyone** — on by default
when you are signed in — publishes it to the library described above, after
the words are safely in your own deck: if the library is unreachable the
import still stands, and the deck can be shared later from **Decks → Mine**.
Turn it off for anything that is really your own private collection.

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

Best done once, for every device at once: put the `firebaseConfig` object in
a repository secret named **`FIREBASE_CONFIG`** (*Settings → Secrets and
variables → Actions*) — copied straight out of the Firebase console is fine,
`const firebaseConfig =` prefix and all. Every build then ships with the
project already configured, and **Settings → Account** offers **Sign in with
Google** immediately — nothing to paste on each phone or laptop. If a build's
secret cannot be read, the Account panel says so rather than pretending no
secret exists.

Failing that, open **Settings → Account** and paste the config there; it is
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

`.github/workflows/deploy.yml` runs on every push to `main`:

1. runs the test suite,
2. downloads the latest [jmdict-simplified][jmdict] release and converts it to
   Yomeyo's binary dictionary format,
3. **verifies** the result — entry count plus spot-checks that 食べる/読む/
   高い/日本語/する are present with the right readings and parts of speech, so
   an upstream format change fails the build instead of shipping a dictionary
   that silently looks nothing up,
4. builds the app and publishes it to your own host over FTPS (when the
   `CPANEL_FTP_*` secrets are set), to the `gh-pages` branch, and through
   the Actions Pages pipeline, so whichever you chose works,
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
- **The shared library** (`packages/core/src/deck-library.ts`,
  `apps/web/src/library.ts`, `firestore.rules`): a deck travels as a handful
  of gzipped, base64'd blocks rather than a document per card. Firestore holds
  at most a megabyte per document and Core 6k is several times that, while a
  write per card would spend a day's free quota on a single deck — six
  thousand words becomes about two writes and roughly a fifth of the size.
  Blocks are written before the deck record, so a half-written deck is
  invisible rather than broken.

  A deck's id begins with its publisher's uid, which is what lets the rules
  decide who may change it from the path alone — no lookup on every write, and
  no way to publish under someone else's name. `publishedAt` must be the
  server's clock, so the top of the list cannot be claimed by backdating.
  Those rules are tested against the emulator over its REST API with real ID
  tokens, so nothing in the app's own code stands between the test and the
  boundary.
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
