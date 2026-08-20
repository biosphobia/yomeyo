import { cardKey, fromSharedCards, type Card, type DeckInfo, type SharedCard } from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";
import { cardsInDeck, listDecks, rememberDeck } from "./my-decks.js";
import { getFirebaseConfig } from "./cloud.js";
import { importCards, saveCards } from "./store.js";
import { lazyImport } from "./lazy.js";
import { toast } from "./toast.js";

/**
 * Keeping added decks in step with their publishers.
 *
 * Adding a library deck used to be a photograph: the owner could fix a
 * gloss, add a hundred words, rename the deck — and everyone who had added
 * it kept the copy from the day they pressed Add, for ever. Now every
 * holder checks the library now and then, and when the owner's copy is
 * newer, takes the update.
 *
 * The merge is careful about what belongs to whom. Content — glosses,
 * sentences, notes, pitch, the deck's own name — is the publisher's, and is
 * overwritten. Scheduling is the learner's: a word's interval, its memory
 * state, its lapses survive every update untouched, matched across by the
 * word itself (term + reading), since shared cards travel without ids. New
 * words arrive as new cards. Words the owner removed go — but only words
 * that provably came from the library, judged against the key list saved at
 * the last pull, so anything the learner added to their own copy by hand is
 * never deleted by someone else's edit.
 */

/** How often the library is asked, at most. */
const CHECK_EVERY_MS = 60 * 60 * 1000;
const LAST_CHECK_KEY = "deckRefreshAt";
/** Per deck: the word keys delivered by the last pull — the ground truth
 * for which local cards are the library's to remove. */
const BASELINE_PREFIX = "deckPulledKeys:";

/** Fields the publisher owns; everything else on a card is the learner's. */
function patchContent(card: Card, shared: SharedCard, now: number): Card | null {
  const glosses = Array.isArray(shared.glosses) ? shared.glosses.filter((g) => typeof g === "string") : [];
  const pitch =
    Array.isArray(shared.pitchAccents) && shared.pitchAccents.some((a) => typeof a === "number")
      ? shared.pitchAccents.filter((a): a is number => typeof a === "number")
      : undefined;
  const next: Card = {
    ...card,
    glosses,
    sentence: typeof shared.sentence === "string" && shared.sentence ? shared.sentence : undefined,
    sentenceMeaning:
      typeof shared.sentenceMeaning === "string" && shared.sentenceMeaning ? shared.sentenceMeaning : undefined,
    sentenceFurigana:
      typeof shared.sentenceFurigana === "string" && shared.sentenceFurigana ? shared.sentenceFurigana : undefined,
    notes: typeof shared.notes === "string" && shared.notes ? shared.notes : undefined,
    pitchAccents: pitch,
  };
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (
    same(card.glosses, next.glosses) &&
    same(card.sentence, next.sentence) &&
    same(card.sentenceMeaning, next.sentenceMeaning) &&
    same(card.sentenceFurigana, next.sentenceFurigana) &&
    same(card.notes, next.notes) &&
    same(card.pitchAccents, next.pitchAccents)
  ) {
    return null;
  }
  next.updatedAt = now;
  return next;
}

/** One deck, brought up to the library's version. Returns what changed. */
async function refreshOne(
  deck: DeckInfo,
  remote: { name: string; description?: string; publishedAt?: number },
  shared: SharedCard[],
): Promise<{ added: number; changed: number; removed: number }> {
  const now = Date.now();
  const existing = await cardsInDeck(deck.id);
  const byKey = new Map(existing.map((card) => [cardKey(card.term, card.reading), card]));
  const sharedByKey = new Map(shared.map((card) => [cardKey(card.term, card.reading), card]));

  const updates: Card[] = [];

  // Words the owner added since the last pull — through the same deduping
  // door the Add button uses, so a word the learner already holds under
  // another id (mined by hand, say) is never doubled by an update.
  const fresh = shared.filter((card) => !byKey.has(cardKey(card.term, card.reading)));
  const added = fresh.length > 0 ? await importCards(fromSharedCards(fresh, deck.id, now)) : 0;

  // Words both sides hold: the publisher's content over the learner's
  // scheduling, and only written at all when something actually differs.
  let changed = 0;
  for (const [key, card] of byKey) {
    const upstream = sharedByKey.get(key);
    if (!upstream) continue;
    const patched = patchContent(card, upstream, now);
    if (patched) {
      updates.push(patched);
      changed++;
    }
  }

  // Words the owner removed — judged against the last pull's key list, so a
  // word the learner added to their own copy is not the library's to take.
  // A deck added before this existed has no baseline; the first refresh
  // removes nothing and writes one.
  let removed = 0;
  const baseline = await getMeta<string[]>(BASELINE_PREFIX + deck.id);
  if (Array.isArray(baseline)) {
    for (const key of baseline) {
      if (sharedByKey.has(key)) continue;
      const card = byKey.get(key);
      if (card) {
        updates.push({ ...card, deleted: true, updatedAt: now });
        removed++;
      }
    }
  }

  if (updates.length > 0) await saveCards(updates);
  await setMeta(BASELINE_PREFIX + deck.id, [...sharedByKey.keys()]);
  await rememberDeck({
    ...deck,
    name: remote.name || deck.name,
    description: remote.description ?? deck.description,
    cardCount: sharedByKey.size,
    publishedAt: remote.publishedAt ?? deck.publishedAt,
    updatedAt: now,
  });
  return { added, changed, removed };
}

let running: Promise<boolean> | null = null;

/**
 * Check every added library deck against the library, and take updates.
 * Returns true when anything changed. Throttled to once an hour unless
 * forced; concurrent calls share one run.
 */
export async function refreshSharedDecks(force = false): Promise<boolean> {
  if (running) return running;
  running = (async () => {
    try {
      if (!(await getFirebaseConfig())) return false;
      const last = (await getMeta<number>(LAST_CHECK_KEY)) ?? 0;
      if (!force && Date.now() - last < CHECK_EVERY_MS) return false;
      await setMeta(LAST_CHECK_KEY, Date.now());

      const { currentAccount, firestoreApi } = await import("./cloud.js");
      const account = await currentAccount().catch(() => null);
      const decks = (await listDecks()).filter(
        (deck) =>
          deck.kind === "premade" &&
          typeof deck.publishedAt === "number" &&
          // The owner's copy IS the newer version; pulling it over itself
          // would be a mirror updating a mirror.
          !(account && deck.ownerUid === account.uid),
      );
      if (decks.length === 0) return false;

      const { db, storeApi } = await firestoreApi();
      let anything = false;
      for (const deck of decks) {
        try {
          const snapshot = await storeApi.getDoc(storeApi.doc(db, "decks", deck.id));
          if (!snapshot.exists?.()) continue; // withdrawn; the local copy stays
          const data = snapshot.data?.() ?? {};
          const stamp = data.publishedAt;
          const remoteAt =
            typeof stamp === "number" ? stamp : typeof stamp?.toMillis === "function" ? stamp.toMillis() : 0;
          if (remoteAt <= (deck.publishedAt ?? 0)) continue; // already current

          const library = await lazyImport(() => import("./library.js"));
          const shared = await library.downloadDeck({
            ...deck,
            blockCount: typeof data.blockCount === "number" ? data.blockCount : 0,
          } as Parameters<typeof library.downloadDeck>[0]);
          const { added, changed, removed } = await refreshOne(
            deck,
            {
              name: typeof data.name === "string" ? data.name : deck.name,
              description: typeof data.description === "string" ? data.description : deck.description,
              publishedAt: remoteAt,
            },
            shared,
          );
          anything = true;
          const parts = [
            added > 0 ? `${added.toLocaleString()} new` : "",
            changed > 0 ? `${changed.toLocaleString()} revised` : "",
            removed > 0 ? `${removed.toLocaleString()} removed` : "",
          ].filter(Boolean);
          toast(`${deck.name} updated${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`);
        } catch {
          // This deck stays as it was; the next check tries again.
        }
      }
      return anything;
    } catch {
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}
