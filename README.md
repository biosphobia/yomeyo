# Yomeyo 読めよ

**An easy Yomitan + Anki, in one app, synced across your devices.**

Tap Japanese words you see while browsing, save them as flashcards, and review
them daily with spaced repetition — the classic *sentence mining* workflow,
without juggling two separate tools.

Yomeyo is three pieces sharing one core:

| Piece | Role | Where it runs |
|---|---|---|
| **Web app (PWA)** | Reviews + tap-to-lookup Reader ("the Anki side") | Any browser; installable on Android & iOS home screens |
| **Browser extension (MV3)** | Tap words on *any* page ("the Yomitan side") | Desktop Chrome/Firefox/Edge; converts to an iOS Safari extension |
| **Sync server** | Keeps every device's deck identical | Anywhere Node runs (self-hosted, zero dependencies) |

```
packages/core       dictionary lookup + deinflection + SRS scheduler + sync merge (shared by everything)
apps/web            the PWA (Vite, vanilla TS, IndexedDB)
apps/extension      the MV3 extension (esbuild)
apps/sync-server    zero-dependency Node sync server
scripts/            JMdict dictionary builder, icon generator
data/seed-dict.json small bundled dictionary so everything works out of the box
```

## How mining works on each platform

**Android (Chrome).** Chrome for Android does not support extensions — no
Yomitan-style addon can exist there. Yomeyo's Android flow instead uses the
PWA: install the web app to your home screen, then **select Japanese text on
any page → Share → Yomeyo**. The text opens in the Reader where every word is
tappable: tap → definition → save. (Pasting text or a whole article into the
Reader works too.)

**iOS (Safari).** Safari supports Web Extensions wrapped in an App Store app.
The extension in `apps/extension` is written to be convertible with Apple's
converter (see below), giving true tap-on-page lookup like Yomitan. Until you
build that wrapper, the shared-text/paste Reader flow works on iOS exactly as
on Android.

**Desktop (Chrome/Edge/Firefox).** Load `apps/extension/dist` as an unpacked
extension. Hold **Alt/Option and click** any Japanese word for an instant
popup, or enable *tap mode* from the toolbar for click-only lookup.

Cards from every device meet in the middle via the sync server: save a word on
your desktop at lunch, review it on your phone that evening.

## Quick start

```bash
npm install
npm test            # core library tests
npm run build       # core + web app + extension
```

**Try the web app:**

```bash
npm run dev:web     # then open http://localhost:5173, hit "Try demo text" in Reader
```

**Load the extension (desktop Chrome):** `chrome://extensions` → Developer
mode → *Load unpacked* → `apps/extension/dist`.

**Run the sync server:**

```bash
YOMEYO_TOKEN=pick-a-secret npm run sync-server   # listens on :8787
```

Then enter the server URL + token in the web app's Settings and in the
extension's toolbar popup, and press *Sync now* on each device. Sync is
offline-first and last-write-wins per card; deletions propagate as soft
deletes. Deploy the server anywhere Node runs and put it behind HTTPS (a
Caddy/nginx reverse proxy or a platform like Fly/Railway) — browsers require
HTTPS for the PWA to call it.

## The full dictionary

A small seed dictionary (~150 common words) is bundled so the app works
immediately. For real use, build the full JMdict dictionary:

```bash
npm run build-dict          # downloads jmdict-simplified, converts, installs
npm run build               # rebuild apps with the full dictionary
```

This writes `dict.json` into both apps' `public/dict/` folders (gitignored;
the seed is auto-restored on fresh clones). JMdict is published by
[EDRDG](https://www.edrdg.org/) under CC BY-SA 4.0 — credit it if you
distribute builds.

## iOS Safari extension (App Store wrapper)

On a Mac with Xcode:

```bash
npm run build -w @yomeyo/extension
xcrun safari-web-extension-converter apps/extension/dist --project-location ios/ --app-name Yomeyo
```

Open the generated Xcode project, sign it, and run it on your iPhone
(Settings → Safari → Extensions → enable Yomeyo). Enable *tap mode* from the
extension popup for one-tap lookups on the phone. Distribution to other
people requires an Apple Developer account (TestFlight or App Store).

## How the pieces work

- **Lookup** (`packages/core/src/dictionary.ts`): Yomitan-style scanning —
  from the tapped character it tries the longest candidate substring first,
  runs each through the deinflector, and filters hits by part-of-speech
  compatibility (so 切って matches 切る but never 着る).
- **Deinflection** (`packages/core/src/deinflect.ts`): a rule table covering
  polite forms, te/ta forms, negatives, passives/potentials/causatives,
  conditionals, volitional, -tai, auxiliaries (ている・てしまう・ちゃう…),
  and i-adjective conjugation, chained up to 6 steps deep.
- **SRS** (`packages/core/src/srs.ts`): Anki-style SM-2 — learning steps
  (1 min → 10 min), graduation to 1 day, interval growth by an ease factor
  (2.5 start, 1.3 floor), lapses to relearning with ease penalty. Grades:
  Again / Hard / Good / Easy, with the predicted interval shown on each button.
- **Sync** (`packages/core/src/sync.ts`, `apps/sync-server`): every card
  carries `updatedAt`; clients push dirty cards and pull everything changed
  since their last sync; merges are last-write-wins per card.

## Development

```bash
npm test                       # vitest suite for the core library
npm run build                  # everything
npm run dev:web                # web app dev server
npm run build -w @yomeyo/extension   # rebuild extension after changes
```

## Roadmap ideas

- FSRS scheduler option (better retention modeling than SM-2)
- Audio (pitch accent + TTS) on cards
- Frequency-list tagging (show how common a word is before you save it)
- Kanji decomposition on the card back
- E2E-encrypted hosted sync
