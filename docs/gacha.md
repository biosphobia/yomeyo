# The gacha

Everything the crate can give out lives in **`apps/web/public/gacha/prizes.json`**.
Edit it on GitHub, push, and the next deploy has it — there is no code to
change and nothing to rebuild by hand.

## What a pull costs and pays

| Field | Meaning |
| --- | --- |
| `cost` | Yennies per pull |
| `duplicateRefund` | Fraction of the cost paid back when a pull is one you already own (`0.4` = 40%) |
| `rarities` | Each rarity's label, colour and **relative** weight — they need not add to 100 |

A rarity nobody has written a prize for is skipped rather than swallowing its
share of the odds, so a half-finished table still rolls fairly. The Gacha tab
shows the real percentages, worked out from the weights.

## Prizes

Two kinds. Both need `id`, `name` and `rarity`; `note` is optional flavour
shown in the collection.

**The `id` is what a save file remembers.** Renaming a prize is fine; reusing
an id for a different prize silently hands it to everyone who owned the old
one.

### A skin

```json
{
  "id": "skin-rust",
  "type": "skin",
  "name": "Rust",
  "rarity": "common",
  "note": "Everything left outside long enough.",
  "vars": {
    "--bg": "#17120f",
    "--panel": "#221a15",
    "--panel-2": "#2f241d",
    "--text": "#f0e6dd",
    "--muted": "#a89383",
    "--accent": "#c2703c",
    "--accent-soft": "rgba(194, 112, 60, 0.18)"
  }
}
```

`vars` is any of the CSS custom properties the app draws itself with. Every
colour in the site already comes from one, so overriding them repaints the
whole thing — no stylesheet to write. The ones worth setting are above, plus
`--good`, `--warn` and `--bad` for the right/wrong and yenny colours.

Only names matching `--something` are accepted, so a prize file can never
inject arbitrary CSS. A skin that leaves a variable out gets the app's own
value for it — the previous skin's is always cleared first.

Light skins work: set `--bg` and `--panel` light and `--text` dark.

### A reaction gif

```json
{
  "id": "gif-yatta",
  "type": "gif",
  "name": "やった!",
  "rarity": "rare",
  "on": "correct",
  "image": "gifs/yatta.gif",
  "text": "やった!"
}
```

`on` is `"correct"` or `"wrong"`. Once won, it **joins the pool** the kana
game and grammar drills draw from — it does not replace anything, so the more
that have been pulled the more varied the answering gets.

`image` is a filename in `public/gacha/` (put gifs in `public/gacha/gifs/`),
a path like `../feedback/correct.gif`, or a full `https://` URL. Any size
works: reactions are drawn in a box of their own.

## Admin pulls

Whoever holds the admin seat and has **Unlock every level on this device**
switched on in Settings also opens crates for free — the button reads
"free", works at any balance, and takes nothing, so an admin's yennies stay
whatever they actually earned. A free pull refunds nothing on a duplicate,
because it cost nothing. This is per-device, like the level key.

## The cutscene

`apps/web/public/gacha/models/yuuri.glb` and `chito.glb`. Replacing either is
dropping a different `.glb` in with the same name — the scene measures each
model and scales it to a fixed height, so nothing in the code assumes
anything about how a replacement was exported.

Both were 25 MB on arrival, almost all of it a 4096² texture; they ship at
about 550 KB each, resized to 1024 and re-encoded as WebP. Keep replacements
in that range: they are downloaded the first time a crate is opened, and
never precached.

If only one model has a real animation, its clip drives both — the mixer
binds by joint name and these rigs match. A clip shorter than 0.1s is taken
to be a pose rather than a movement and ignored.

Everything else in the shot — the ruins, the snow, the fog, the crate — is
built in code in `apps/web/src/gacha-scene.ts`.

### The five films

One is drawn at random each time, and its name is captioned in the corner:

| | |
| --- | --- |
| **Unscheduled delivery** | They walk out of the fog. A crate falls out of the sky onto one of them. The other comes over and pokes it. |
| **Percussive maintenance** | A crate is already here, half buried. Two kicks do nothing. The third launches it out of frame, and it comes back down flat. |
| **A disagreement** | Both take a side and pull. It does not move. They give up and sit in the snow, at which point it opens by itself. |
| **Right of way** | Something rolls in from the left at speed, bowls straight through both of them, hits a ruin off-screen, and rolls back. |
| **Adverse weather** | The sky fills with crates. They dodge, badly. All of them sink into the snow except one, which lands gently. |

A scenario is an entry in `SCENARIOS`: an id, a name, a length, and a
`run(t, dt, stage)` called every frame. The stage hands it the cast, the
crate and its lid, nine spare crates, the sound kit, and `once(key, at, fn)`
for anything that should happen exactly one time. Camera shake is automatic
on any beat whose key mentions an impact.

### Sound

`apps/web/src/gacha-audio.ts`. Nothing is a recording: wind is filtered
noise with a slow wander in the filter, a footstep is a very short noise
burst, a falling crate is a sine sliding down, an impact is that plus a
thump. It is built when the crate is opened — which is a click, so autoplay
rules are satisfied — and every call is a no-op if the browser refuses.

## What is not configurable, on purpose

The pull is decided the moment it is paid for, before a frame is drawn.
Neither the cutscene nor the strip can change it; both only show something
that has already happened, and both can be skipped.
