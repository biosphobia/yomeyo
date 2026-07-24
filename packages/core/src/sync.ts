import type { Card } from "./types.js";

/**
 * Offline-first sync protocol, shared by clients and server.
 *
 * Every card carries `updatedAt`; merging is last-write-wins per card.
 * Deletions are soft (deleted: true) so they propagate like any edit.
 *
 * Client flow:
 *   POST /sync  { since, changes }  ->  { now, changes }
 * where `since` is the server timestamp from the previous sync, `changes`
 * is every local card modified since the last successful push, and the
 * response contains every server-side card modified after `since`.
 */
export interface SyncRequest {
  /** Server clock value from the last successful sync; 0 for first sync. */
  since: number;
  changes: Card[];
}

export interface SyncResponse {
  /** Server clock now; store and send as `since` next time. */
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
