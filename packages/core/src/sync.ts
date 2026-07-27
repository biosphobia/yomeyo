import type { Card } from "./types.js";

/**
 * Offline-first sync, shared by every backend.
 *
 * Every card carries `updatedAt`; merging is last-write-wins per card.
 * Deletions are soft (deleted: true) so they propagate like any edit.
 *
 * The local store is always the source of truth for reading. Sync pushes
 * locally-changed cards, pulls whatever changed elsewhere since the last
 * run, and merges. This works the same whether the far side is the
 * self-hosted server or Firestore.
 */

export interface SyncRequest {
  /** Cursor from the last successful sync; 0 for the first. */
  since: number;
  changes: Card[];
}

export interface SyncResponse {
  /** New cursor; store and send as `since` next time. */
  now: number;
  changes: Card[];
}

/** Merge incoming cards into a local map, last-write-wins per id. */
export function mergeCards(local: Map<string, Card>, incoming: Card[]): Card[] {
  const applied: Card[] = [];
  for (const card of incoming) {
    const existing = local.get(card.id);
    if (!existing || card.updatedAt > existing.updatedAt) {
      local.set(card.id, card);
      applied.push(card);
    }
  }
  return applied;
}

/**
 * A place cards can be stored remotely.
 *
 * `cursor` is opaque to the engine: an HTTP backend uses the server clock, a
 * Firestore backend uses server write timestamps. Only two rules matter —
 * it must advance monotonically on the server, and `pull` must return
 * everything written after the cursor it is given.
 */
export interface SyncBackend {
  /** Everything changed remotely after `since`, plus the new cursor. */
  pull(since: number): Promise<{ changes: Card[]; cursor: number }>;
  /** Upload locally-changed cards. */
  push(cards: Card[]): Promise<void>;
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  /** Cursor to persist for the next run. */
  cursor: number;
  /** Cards that changed locally as a result of the pull. */
  applied: Card[];
}

/**
 * Run one sync round against a backend.
 *
 * Pushes first so a fresh device's own words are never lost to a conflicting
 * remote edit, then pulls and merges. `local` is mutated in place with
 * whatever the pull brought in; the caller persists `applied` and `cursor`.
 */
export async function runSync(
  backend: SyncBackend,
  local: Map<string, Card>,
  dirty: Card[],
  since: number,
): Promise<SyncOutcome> {
  if (dirty.length > 0) await backend.push(dirty);

  const { changes, cursor } = await backend.pull(since);
  const applied = mergeCards(local, changes);

  return {
    pushed: dirty.length,
    pulled: applied.length,
    // Never move the cursor backwards: a backend that reports an older
    // cursor would make the next pull re-fetch, or worse, skip nothing.
    cursor: Math.max(cursor, since),
    applied,
  };
}
