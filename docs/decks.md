# Building and editing decks

A deck used to have one way in: find an `.apkg`, map its fields, import it.
That is right for Core 2k and useless for "the forty words in chapter three",
which is a list somebody has in their head and nowhere else. Decks can now be
built and maintained in the app itself.

Everything here is under **Decks → Mine → Edit words**.

## Editing a deck you already have

Any deck on the device opens, however it arrived — imported from Anki, added
from the shared library, or typed here.

- **Rename it.** The name and the one-line description. The mining deck is
  the exception: it is named by what it is.
- **Fix a card.** The pencil opens the same editor as the Words screen: word,
  reading, meanings, example sentence and its meaning, notes.
- **Delete a card.** The cross. Deletions sync like any other change, so a
  card removed here does not come back from another device.
- **Reorder.** The arrows beside each card move it one place. This is the
  order the words are *introduced* in — new cards come out of a deck top
  first — so the twenty words worth meeting first can be made to come first.
  Moving a card writes a position on that one card, so rearranging a deck of
  six thousand words costs one write per move, not six thousand.

Search filters the list; the arrows are hidden while it does, because moving
a card one place inside a filtered list means nothing.

## Adding words by typing

One word per line. The dictionary supplies the reading and the meaning, so a
list of words is enough:

```
食べる
学校
ねこ
```

Write your own where the dictionary's is wrong or missing — tabs, `|` or
commas all separate, and `;` separates one meaning from the next:

```
学校 | がっこう | school
食べる, たべる, to eat; to have a meal
```

Nothing is added until it has been looked at. **Look these up** shows the
drafts first: each one with what was found for it, a ✕ to throw it away, and
a flag on anything the dictionary has never heard of. A word already in the
collection is marked and left alone — one word is one card, wherever it
already lives.

## Asking for a word list

Admin only, because it spends the API key. **Ask for a word list** takes a
description ("40 kitchen and cooking words, N4 level"), asks Claude for the
deck, and then checks every word it gives back against the dictionary. The
dictionary's reading wins over the model's; words the dictionary does not
have keep the model's reading and are flagged, so nobody publishes an
invented reading without seeing it first.

The drafts behave exactly as the typed ones do — look, drop what is wrong,
add the rest.

## Sharing, and staying shared

A deck is local until it is shared. **Share with everyone** — on the deck's
row, and in the editor — publishes it to the library under your username. It
is offered for any deck of yours that is not already shared, including one you
published and then withdrew.

After that it keeps itself up to date. Rename it, fix a reading, add forty
words, reorder them, delete one: a few seconds later the library's copy is
rewritten to match, and everyone who adds the deck from then on gets what you
actually have. The delay swallows a burst of edits, so rearranging a deck is
one upload rather than twenty; leaving the editor sends anything still
waiting, and **Update the shared copy now** does it on the spot. Editing a
card from the Words screen counts too.

Two things it will not do. It will not publish an empty deck, so deleting
every word leaves the last good copy alone rather than replacing it with
nothing. And it checks the deck is still in the library first — if the admin
has withdrawn it, the update stops and the deck quietly stops calling itself
shared, so automatic updating cannot undo a moderation decision.

Withdrawing is on the deck's row in **Premade** (its publisher, or the admin,
for anything).
