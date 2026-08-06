# The gacha

Everything the crate can give out lives in **`apps/web/public/gacha/prizes.json`**.
Edit it on GitHub, push, and the next deploy has it — there is no code to
change and nothing to rebuild by hand.

## What a pull costs and pays

| Field | Meaning |
| --- | --- |
| `cost` | Yennies per pull |
| `duplicateRefund` | Fraction of the cost paid back when a pull is one you already own (`0.4` = 40%) |
| `draw` | `"uniform"` or `"rarity"` — see below |
| `rarities` | Each rarity's label, colour and **relative** weight. Only consulted when `draw` is `"rarity"` |

### How a pull is decided

**`"uniform"` (what the table uses now).** Every prize has the same chance.
Adding one on GitHub changes nothing about what the others were worth, which
is what you want while the pool is still being filled in. Under it a prize's
`rarity` is only its colour: the collection prints no rarity label and the
Odds panel says "every prize, equally likely · 1 in N", because claiming
odds that rarity does not control would be a lie.

**`"rarity"`.** The weighted draw: a rarity is picked by weight, then a prize
within it — so a tenth legendary makes legendaries no commoner, only more
varied. A rarity nobody has written a prize for is skipped rather than
swallowing its share, so a half-finished table still rolls fairly, and the
Odds panel shows the real percentages worked out from the weights.

Switching between them is one word in `prizes.json`.

## Prizes

Two kinds are supported. **Only gifs are in the pool at the moment** — the
skins were taken out, though everything below still works if any are put
back. Both kinds need `id`, `name` and `rarity`; `note` is optional flavour
shown in the collection.

Removing a prize from the file is safe: anyone who already owned it simply
stops seeing it, and a skin that was being worn falls back to the palette the
app ships with. Put it back under the same id and it returns to them.

**The `id` is what a save file remembers.** Renaming a prize is fine; reusing
an id for a different prize silently hands it to everyone who owned the old
one.

### A skin — supported, none in the pool right now

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
that have been pulled the more varied the answering gets. `text` is that
gif's own line and travels with it: when this gif comes up, this is the line
under it, never another prize's.

`image` is a filename in `public/gacha/` (put pictures in
`public/gacha/gifs/`), a path like `../feedback/correct.gif`, or a full
`https://` URL. Gif, animated webp, avif, png or jpeg all work — an
animation or a photograph — and any size does: reactions are drawn in a box
of their own.

**Nothing to run.** Every deploy squeezes each reaction to the same budget —
longest side 320px, 260 KB — so a tall picture and a wide one cost the same
to fetch on a phone. It happens to the *built* copy, so what you uploaded
stays in the repository untouched; upload the original and let the build
worry about the weight. Gifs go through gifsicle, which gives up size and
palette before it drops frames, because a gif missing half its frames looks
worse than one drawn slightly smaller; everything else goes through sharp,
which gives up size before quality for the same reason. An animation keeps
its frames, its timing and its loop. A photograph is turned the right way up
— the rotation of a photo lives in its metadata rather than in its pixels,
and the metadata is dropped here, which also means a picture taken on a phone
stops carrying the place it was taken. Anything already inside the budget is
left alone, and anything that will not fit is deployed as small as it would
go rather than failing the build. (Animated avif is the one exception: nothing
in the toolchain can write one, so it ships as it arrived.)

To see what a deploy will do to a picture, run the same pass by hand:
`node scripts/shrink-media.mjs path/to/it.webp` — though note that one
rewrites the file you point it at.

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
in that range: they are downloaded when the Gacha tab first opens, and never
precached.

The scene measures each model after updating its world matrices and scales it
to a fixed height, with the foot offset baked into a holder group — so
`position.y = 0` means feet on the floor whatever the exporter thought the
origin was. Models face +Z at rest, which is towards the camera, so a
character walking towards it needs no turn at all.

If only one model has a real animation, its clip drives both — the mixer
binds by joint name and these rigs match. A clip shorter than 0.1s is taken
to be a pose rather than a movement and ignored.

Everything else in the shot — the ruins, the snow, the fog, the crate — is
built in code in `apps/web/src/gacha-scene.ts`.

### The nine films

One is drawn at random each time. They do not all begin the same way — some
walk in out of the fog, some are already sitting, some are already in the
water — and they run 12 to 19 seconds.

| | Where | |
| --- | --- | --- |
| **For an amazing reason** | city | Yuuri is green. Chito would like to know why. The answer arrives from above. |
| **Rations** | city | Yuuri is hungry. Yuuri is always hungry. Chito settles it with a flat hand. |
| **Unscheduled delivery** | city | A crate falls out of the sky onto one of them. |
| **Percussive maintenance** | city | Two kicks do nothing. The third launches it out of frame. |
| **Right of way** | city | Something rolls in at speed, bowls straight through both of them, and comes back. |
| **Adverse weather** | city | The sky fills with crates. They dodge, badly. |
| **Table service** | cafe | Sat at a counter nobody has served at for years. They ring the bell three times. |
| **Something in the water** | bath | Up to the shoulders in the last hot water on earth. Something is rising. |
| **Feeding time** | aquarium | A crate drifts past inside the tank among the fish, then leaves through the glass. |

### Titles and dialogue, on GitHub

The `cutscenes` block in `prizes.json` carries both:

```json
"green": {
  "title": "For an amazing reason",
  "lines": ["chichan look", "why are you green....", "for an amazing reason", "that's not a reason"]
}
```

Lines are in the order they are spoken. Who says each one, when it appears
and how long it stays are set in the code; the words are not. Drop a line or
leave it blank and the one written in `gacha-scene.ts` is used. The keys are
the scenario ids and cannot be invented here.

The text is drawn to a small canvas and scaled up with
`image-rendering: pixelated`, so the letters are proper blocks without a
webfont to download. Lines type themselves out; a line marked `loud` is
bigger, yellow and shakes.

### Camera

Each scenario carries a list of shots. A shot is a position, what it looks
at, and optionally where it moves to — so cuts, pans, pushes and zooms are
all the same thing with different fields:

```ts
{ at: 10.4, from: [...], look: (s) => posOf(s.cast[0], 1.28),
  to: [...], fov: 34, fovTo: 9, shake: 0.03 }
```

`from`, `to`, `look` and `lookTo` take either a fixed point or a function of
the stage, so a shot can follow somebody who is moving. `blend` eases out of
the previous shot instead of cutting. `shake` is handheld, in metres. A jolt
is added automatically on any beat whose key names an impact.

### The four places

`apps/web/src/gacha-locations.ts`. Each is built from boxes and points at run
time, so a location costs nothing to download:

- **city** — ruins under snow, grey fog
- **cafe** — a counter, stools, a swinging lamp, one wall missing and the
  weather coming in through the gap
- **bath** — tiles, a sunken bath, pipes, steam rising off the water
- **aquarium** — dark room, a lit tank filling the back wall, fish drifting

A location returns an `ambient(dt, t)` called every frame for whatever moves
on its own, and the height the camera should look at.

### Poses and gags

The models came with one usable animation between them — a walk cycle — so
everything else is posed procedurally against the rig's named joints in
`pose()`: sit, soak, wave, point, reach, hungry, swing, hurt, panic, flat.
No extra clips and nothing more to download. Adding one is a case in that
switch. `smackGag()` is the wind-up, the contact and the aftermath in one
call.

Tinting somebody a colour goes through `emissive` rather than `color`: these
models are lit almost entirely by their own texture, and multiplying that by
a colour barely moves it. Materials are cloned per pull, so turning one of
them green cannot follow the model into the next crate.

### It does not skip

There is no skip button on either half, and the pull happens inside the
film: when the crate opens, the scene reports where it is on screen and the
strip unrolls out of it while the film keeps playing underneath. three.js and the models are
fetched when the Gacha tab opens rather than when the button is pressed, so
the film starts at once instead of after a wait on an empty box.

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
