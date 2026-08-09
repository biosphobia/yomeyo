import { syncMode, syncNow, type SyncOutcome } from "./store.js";
import { activeAccount } from "./db.js";

/**
 * Keeping the deck up to date without being asked.
 *
 * The account's level, purse and achievements already came down on their
 * own; the cards did not, so a device that had not pressed "Sync now" sat
 * there claiming an empty deck. That is a bad first impression and, worse,
 * a lie — the cards were there, just not fetched yet.
 *
 * So a round runs whenever it is plausibly useful: at startup, when an
 * account lands, when the tab comes back to the front, after the extension
 * hands over words, and on a slow timer while the app is open. All of it
 * is quiet. Nothing here ever reports an error, because none of these were
 * asked for: offline simply means the next round does it.
 *
 * Rounds are throttled and never overlap, so a burst of triggers (sign-in
 * and a redraw and the tab regaining focus, all at once) is still one sync.
 */

/** How long between unforced rounds. */
const QUIET_MS = 60_000;

let lastRun = 0;
let inFlight: Promise<SyncOutcome | null> | null = null;

const listeners = new Set<(pulled: number) => void>();

/** Told after a round that actually brought something down. */
export function onSynced(listener: (pulled: number) => void): void {
  listeners.add(listener);
}

/**
 * Run a round, unless one is already going or the last was moments ago.
 *
 * Every sync in the app comes through here, so the manual button and the
 * automatic rounds can never overlap and fight over the cursor. `force`
 * skips the throttle, and `loud` lets the error out — both are for the
 * button, where somebody is watching and deserves an answer.
 */
export function autoSync(options: { force?: boolean; loud?: boolean } = {}): Promise<SyncOutcome | null> {
  if (inFlight) return inFlight;
  if (!options.force && Date.now() - lastRun < QUIET_MS) return Promise.resolve(null);

  inFlight = (async (): Promise<SyncOutcome | null> => {
    // Nobody signed in, or no backend set up: there is nothing to sync,
    // and asking would only download the SDK for someone who never will.
    if (!activeAccount() && !options.loud) return null;
    if ((await syncMode()) === "none" && !options.loud) return null;
    try {
      const result = await syncNow();
      lastRun = Date.now();
      if (result.pulled > 0) for (const listener of listeners) listener(result.pulled);
      return result;
    } catch (err) {
      // Offline, or the session has gone stale. Either way the next round
      // handles it, and an unasked-for sync must never interrupt anyone —
      // but a sync somebody pressed for says what went wrong.
      lastRun = Date.now();
      if (options.loud) throw err;
      return null;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Wire the app's own triggers. Called once, at startup. */
export function startAutoSync(): void {
  void autoSync();

  // Coming back to the app is the moment a stale deck shows itself.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void autoSync();
  });
  window.addEventListener("online", () => void autoSync({ force: true }));

  // And a slow heartbeat, for a session left open all day.
  window.setInterval(() => void autoSync(), 5 * 60_000);
}
