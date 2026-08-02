import {
  activeAccount,
  clearProfileCards,
  getAllCards,
  getMeta,
  readProfile,
  setActiveAccount,
  setMeta,
  writeProfile,
} from "./db.js";
import { toast } from "./toast.js";
import type { AccountInfo } from "./cloud.js";

/**
 * Which account's deck, settings and review history are in front of you.
 *
 * Everything local is stored per account, so two people sharing a browser —
 * or one person with two accounts — never see each other's cards, and signing
 * out does not leave the previous account's deck on screen.
 *
 * The account in use is remembered locally rather than asked of Firebase on
 * startup. Firebase would have to be downloaded first, which is hundreds of
 * kilobytes and a visible pause before anything can be read, and it would be
 * paid by people who have never signed in at all. The remembered value is
 * only a name for a local database; nothing is trusted to it — reading the
 * cloud still requires a real session.
 *
 * It is kept in IndexedDB, next to everything else, rather than in
 * localStorage. `sync.html` — the drop box the extension hands saved words to
 * — has to read it from inside a frame on some other site's page, and only
 * IndexedDB has been shown to reach the app's real storage from there. Two
 * places to look would eventually disagree, and the failure would be words
 * landing in a deck nobody is looking at.
 */

/** Device-wide (see db.ts): which account was last in use here. */
const REMEMBERED_KEY = "activeAccount";
/** Set on a signed-out deck once it has been taken into an account. */
const ADOPTED_KEY = "adoptedIntoAccount";

async function remember(uid: string | null): Promise<void> {
  await setMeta(REMEMBERED_KEY, uid ?? undefined).catch(() => {
    /* storage blocked; the account lasts for this page only */
  });
}

/**
 * Point storage at the remembered account before anything reads it.
 *
 * Awaited before the first render, so the opening screen is already the right
 * person's deck rather than the previous one replaced a moment later.
 */
export async function restoreAccount(): Promise<void> {
  const uid = await getMeta<string>(REMEMBERED_KEY).catch(() => undefined);
  setActiveAccount(typeof uid === "string" && uid.length > 0 ? uid : null);
}

/**
 * Move a deck mined before signing in into the account now signing in.
 *
 * Only the first account to sign in on a device takes it, and only if that
 * account has nothing yet — otherwise a second person signing in would
 * inherit the first one's words, and signing in again after a sync would
 * duplicate them.
 *
 * The words are moved, not copied. A copy left behind would reappear on
 * signing out, so the same word would exist twice, in two decks, reviewed
 * separately and drifting apart — and only one of them backed up. The
 * settings are copied rather than moved: they are small, and the deck kept
 * for nobody in particular should still work the way it was set up.
 */
async function adoptSignedOutDeck(uid: string): Promise<number> {
  const local = await readProfile(null);
  const alreadyAdopted = local.meta.some(([key]) => key === ADOPTED_KEY);
  if (alreadyAdopted || local.cards.length === 0) return 0;

  const existing = await readProfile(uid);
  if (existing.cards.length > 0) return 0; // this account already has a deck

  await writeProfile(uid, {
    cards: local.cards,
    // The sync cursor says how much of *an account's* cloud data has been
    // seen; carrying it over would make the first sync skip everything.
    meta: local.meta.filter(([key]) => key !== "cloudCursor"),
  });
  // Only once the cards are certainly in the account: this is the one order
  // in which a failure loses nothing.
  await clearProfileCards(null);
  await writeProfile(null, { meta: [[ADOPTED_KEY, { uid, at: Date.now() }]] });
  return local.cards.length;
}

export interface AccountSwitch {
  /** True when the data on screen now belongs to someone else. */
  changed: boolean;
  /** Words carried over from a deck mined before signing in. */
  adopted: number;
}

/**
 * Make `account` the one whose data the app reads and writes.
 *
 * Signing out passes null, which returns to the deck kept for nobody in
 * particular — the one that existed before accounts did.
 */
export async function useAccount(account: AccountInfo | null): Promise<AccountSwitch> {
  const uid = account?.uid ?? null;
  if (uid === activeAccount()) {
    await remember(uid);
    return { changed: false, adopted: 0 };
  }

  // Carry the deck across *before* switching, so the screens that redraw on
  // the switch already see the finished result rather than an empty deck that
  // fills in a moment later.
  const adopted = uid ? await adoptSignedOutDeck(uid).catch(() => 0) : 0;

  // Recorded before the switch is announced: a screen redrawing in response
  // must not be able to reload the page and find the old account remembered.
  await remember(uid);
  const changed = setActiveAccount(uid);

  // Words appearing in a brand-new account look like a bug unless it is said
  // out loud that they are the ones mined before signing in.
  if (adopted > 0) {
    toast(`Brought ${adopted} word${adopted === 1 ? "" : "s"} you saved before signing in into this account.`);
  }
  return { changed, adopted };
}

/** Whether this device has ever handed its signed-out deck to an account. */
export async function signedOutDeckAdopted(): Promise<boolean> {
  return (await getMeta(ADOPTED_KEY)) !== undefined;
}

/**
 * Whether signing in now would carry words across, so Settings can say so
 * before the user commits rather than surprise them afterwards.
 */
export async function signedOutDeckAdoptable(): Promise<boolean> {
  if (activeAccount() !== null) return false;
  if (await signedOutDeckAdopted()) return false;
  return (await getAllCards()).length > 0;
}
