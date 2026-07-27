import { describe, expect, it } from "vitest";
import { createCard } from "../src/card.js";
import { runSync, type SyncBackend } from "../src/sync.js";
import type { Card } from "../src/types.js";

const T0 = 1_700_000_000_000;

function card(id: string, term: string, updatedAt: number, extra: Partial<Card> = {}): Card {
  return {
    ...createCard({ term, reading: term, glosses: [term] }, T0),
    id,
    updatedAt,
    ...extra,
  };
}

/**
 * A stand-in for a remote store, with the same contract as the real ones:
 * a monotonic server-side cursor, and pull returning everything written
 * after a given cursor. Lets the engine be tested without a network.
 */
class FakeBackend implements SyncBackend {
  /** id -> { card, writtenAt } */
  private rows = new Map<string, { card: Card; writtenAt: number }>();
  private clock = 100;
  pushes: Card[][] = [];
  pulls: number[] = [];

  /** Simulate another device writing. */
  remoteWrite(...cards: Card[]): void {
    for (const c of cards) this.rows.set(c.id, { card: c, writtenAt: ++this.clock });
  }

  async pull(since: number): Promise<{ changes: Card[]; cursor: number }> {
    this.pulls.push(since);
    const changes: Card[] = [];
    let cursor = since;
    for (const { card: c, writtenAt } of this.rows.values()) {
      if (writtenAt > since) {
        changes.push(c);
        cursor = Math.max(cursor, writtenAt);
      }
    }
    return { changes, cursor };
  }

  async push(cards: Card[]): Promise<void> {
    this.pushes.push(cards);
    // A real backend last-write-wins too, so a stale push must not clobber.
    for (const c of cards) {
      const existing = this.rows.get(c.id);
      if (!existing || c.updatedAt >= existing.card.updatedAt) {
        this.rows.set(c.id, { card: c, writtenAt: ++this.clock });
      }
    }
  }

  snapshot(): Card[] {
    return [...this.rows.values()].map((r) => r.card);
  }
}

describe("sync engine", () => {
  it("pushes local changes and advances the cursor", async () => {
    const backend = new FakeBackend();
    const local = new Map<string, Card>();
    const mine = card("a", "猫", T0);
    local.set("a", mine);

    const result = await runSync(backend, local, [mine], 0);
    expect(result.pushed).toBe(1);
    expect(backend.snapshot()).toHaveLength(1);
    expect(result.cursor).toBeGreaterThan(0);
  });

  it("pulls another device's cards into the local map", async () => {
    const backend = new FakeBackend();
    backend.remoteWrite(card("b", "犬", T0));
    const local = new Map<string, Card>();

    const result = await runSync(backend, local, [], 0);
    expect(result.pulled).toBe(1);
    expect(local.get("b")?.term).toBe("犬");
    expect(result.applied.map((c) => c.id)).toEqual(["b"]);
  });

  it("does not re-pull the same changes on the next run", async () => {
    const backend = new FakeBackend();
    backend.remoteWrite(card("b", "犬", T0));
    const local = new Map<string, Card>();

    const first = await runSync(backend, local, [], 0);
    const second = await runSync(backend, local, [], first.cursor);
    expect(second.pulled).toBe(0);
    expect(backend.pulls[1]).toBe(first.cursor);
  });

  it("keeps the newer version when both sides edited a card", async () => {
    const backend = new FakeBackend();
    const older = card("a", "猫", T0);
    backend.remoteWrite({ ...older, glosses: ["remote, older"], updatedAt: T0 });

    const local = new Map<string, Card>();
    const newer = { ...older, glosses: ["local, newer"], updatedAt: T0 + 5000 };
    local.set("a", newer);

    const result = await runSync(backend, local, [newer], 0);
    // Local edit is newer, so it must survive the round trip on both sides.
    expect(local.get("a")?.glosses).toEqual(["local, newer"]);
    expect(backend.snapshot()[0].glosses).toEqual(["local, newer"]);
    expect(result.pulled).toBe(0);
  });

  it("lets a newer remote edit win over an older local one", async () => {
    const backend = new FakeBackend();
    const base = card("a", "猫", T0);
    backend.remoteWrite({ ...base, glosses: ["remote, newer"], updatedAt: T0 + 9000 });

    const local = new Map<string, Card>([["a", base]]);
    await runSync(backend, local, [base], 0);
    expect(local.get("a")?.glosses).toEqual(["remote, newer"]);
  });

  it("propagates deletions", async () => {
    const backend = new FakeBackend();
    const alive = card("a", "猫", T0);
    backend.remoteWrite({ ...alive, deleted: true, updatedAt: T0 + 1000 });

    const local = new Map<string, Card>([["a", alive]]);
    await runSync(backend, local, [], 0);
    expect(local.get("a")?.deleted).toBe(true);
  });

  it("skips the push call entirely when nothing changed locally", async () => {
    const backend = new FakeBackend();
    await runSync(backend, new Map(), [], 0);
    expect(backend.pushes).toHaveLength(0);
  });

  it("never moves the cursor backwards", async () => {
    const backend: SyncBackend = {
      async pull() {
        return { changes: [], cursor: 5 }; // backend reports something stale
      },
      async push() {},
    };
    const result = await runSync(backend, new Map(), [], 900);
    expect(result.cursor).toBe(900);
  });

  it("converges two devices through the same backend", async () => {
    const backend = new FakeBackend();

    const phone = new Map<string, Card>();
    const laptop = new Map<string, Card>();

    // Phone mines a word.
    const fromPhone = card("p1", "面白い", T0);
    phone.set("p1", fromPhone);
    const phoneRun = await runSync(backend, phone, [fromPhone], 0);

    // Laptop mines a different word and syncs.
    const fromLaptop = card("l1", "辞書", T0 + 1000);
    laptop.set("l1", fromLaptop);
    const laptopRun = await runSync(backend, laptop, [fromLaptop], 0);

    // Laptop now has both.
    expect([...laptop.keys()].sort()).toEqual(["l1", "p1"]);

    // Phone syncs again and catches up.
    await runSync(backend, phone, [], phoneRun.cursor);
    expect([...phone.keys()].sort()).toEqual(["l1", "p1"]);
    expect(laptopRun.pulled).toBe(1);
  });

  it("carries review progress between devices", async () => {
    const backend = new FakeBackend();
    const reviewed = card("a", "猫", T0 + 60_000, {
      state: "review",
      intervalDays: 10,
      ease: 2.6,
      reps: 3,
    });
    backend.remoteWrite(reviewed);

    const local = new Map<string, Card>([["a", card("a", "猫", T0)]]);
    await runSync(backend, local, [], 0);
    const merged = local.get("a")!;
    expect(merged.state).toBe("review");
    expect(merged.intervalDays).toBe(10);
    expect(merged.reps).toBe(3);
  });
});
