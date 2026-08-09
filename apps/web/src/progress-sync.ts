import { currentAccount, firestoreApi, getFirebaseConfig } from "./cloud.js";
import { getMeta, notifyAccountData, setMeta } from "./db.js";

/**
 * The account's progress, across its devices.
 *
 * Cards sync, deck records sync — but the level was stuck: XP, yennies,
 * achievements, the kana record, the gacha shelf all lived only in the
 * device's own database, so signing in on a new browser showed level 1
 * over a deck of six thousand cards. This carries those numbers in the
 * same user document the deck records already use.
 *
 * Every key merges by a rule that is idempotent and order-free, so two
 * devices syncing in any order settle on the same answer and a repeat
 * sync changes nothing:
 *
 *  - lifetime counters (XP, best streak, bribes) take the larger value;
 *  - unions (achievements, gacha shelf, quest payouts) keep everything
 *    either side has, earliest timestamp winning where there is one;
 *  - per-kana records keep whichever side has answered more;
 *  - the yennies balance also takes the larger value, which after a
 *    spend on one device can hand the balance back on the next sync.
 *    That is accepted: a purse that can only be topped up by drilling
 *    kana does not need bank-grade ledgers.
 */

type Merge = (local: unknown, remote: unknown) => unknown;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Objects rebuilt with sorted keys, so equal content compares equal. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isMap(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a) ?? null) === JSON.stringify(canonical(b) ?? null);

const larger: Merge = (local, remote) =>
  local === undefined && remote === undefined ? undefined : Math.max(num(local), num(remote));

/** Achievements: id → unlock time. Both sides kept, first unlock wins. */
const earliestTimes: Merge = (local, remote) => {
  if (!isMap(local) && !isMap(remote)) return undefined;
  const out: Record<string, number> = {};
  for (const side of [local, remote]) {
    if (!isMap(side)) continue;
    for (const [id, at] of Object.entries(side)) {
      if (typeof at !== "number") continue;
      out[id] = id in out ? Math.min(out[id], at) : at;
    }
  }
  return out;
};

const unionStrings: Merge = (local, remote) => {
  if (!Array.isArray(local) && !Array.isArray(remote)) return undefined;
  const out = new Set<string>();
  for (const side of [local, remote]) {
    if (!Array.isArray(side)) continue;
    for (const item of side) if (typeof item === "string") out.add(item);
  }
  return [...out].sort();
};

/** Item counts and similar: per key, the larger count. */
const perKeyMax: Merge = (local, remote) => {
  if (!isMap(local) && !isMap(remote)) return undefined;
  const out: Record<string, number> = {};
  for (const side of [local, remote]) {
    if (!isMap(side)) continue;
    for (const [key, value] of Object.entries(side)) {
      out[key] = Math.max(out[key] ?? 0, num(value));
    }
  }
  return out;
};

/** The earliest of two date strings — the day the streak calendar began. */
const earliestDay: Merge = (local, remote) => {
  const a = typeof local === "string" ? local : "";
  const b = typeof remote === "string" ? remote : "";
  if (!a) return b || undefined;
  if (!b) return a;
  return a < b ? a : b;
};

/** The quest log: date → event → count. Per event, the larger count. */
const questLogMerge: Merge = (local, remote) => {
  if (!isMap(local) && !isMap(remote)) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const side of [local, remote]) {
    if (!isMap(side)) continue;
    for (const [day, events] of Object.entries(side)) {
      if (!isMap(events)) continue;
      const bucket = (out[day] ??= {});
      for (const [event, count] of Object.entries(events)) {
        bucket[event] = Math.max(bucket[event] ?? 0, num(count));
      }
    }
  }
  return out;
};

/** Quest payouts: date → quest ids already paid. Union, so nothing pays twice. */
const paidUnion: Merge = (local, remote) => {
  if (!isMap(local) && !isMap(remote)) return undefined;
  const out: Record<string, string[]> = {};
  for (const side of [local, remote]) {
    if (!isMap(side)) continue;
    for (const [day, ids] of Object.entries(side)) {
      if (!Array.isArray(ids)) continue;
      const bucket = new Set(out[day] ?? []);
      for (const id of ids) if (typeof id === "string") bucket.add(id);
      out[day] = [...bucket].sort();
    }
  }
  return out;
};

/** Per kana, whichever side has answered more speaks for that kana. */
const kanaStatsMerge: Merge = (local, remote) => {
  if (!isMap(local) && !isMap(remote)) return undefined;
  const weight = (stat: unknown): number =>
    isMap(stat) ? num(stat.correct) + num(stat.wrong) : -1;
  const out: Record<string, unknown> = {};
  for (const side of [local, remote]) {
    if (!isMap(side)) continue;
    for (const [kana, stat] of Object.entries(side)) {
      if (!isMap(stat)) continue;
      const held = out[kana];
      if (
        held === undefined ||
        weight(stat) > weight(held) ||
        (weight(stat) === weight(held) && isMap(held) && num(stat.lastAnswered) > num(held.lastAnswered))
      ) {
        out[kana] = stat;
      }
    }
  }
  return out;
};

/** Game runs, united by id — this is also what counts towards the casino. */
const gameLogMerge: Merge = (local, remote) => {
  if (!Array.isArray(local) && !Array.isArray(remote)) return undefined;
  const byId = new Map<string, Record<string, unknown>>();
  for (const side of [local, remote]) {
    if (!Array.isArray(side)) continue;
    for (const run of side) {
      if (!isMap(run) || typeof run.id !== "string") continue;
      const held = byId.get(run.id);
      if (!held || num(run.questions) > num(held.questions)) byId.set(run.id, run);
    }
  }
  return [...byId.values()].sort((a, b) => num(a.startedAt) - num(b.startedAt));
};

/** The bunker cutscenes: seen anywhere is seen. */
const seenMerge: Merge = (local, remote) => {
  if (!isMap(local) && !isMap(remote)) return undefined;
  const l = isMap(local) ? local : {};
  const r = isMap(remote) ? remote : {};
  return { locked: l.locked === true || r.locked === true, opened: l.opened === true || r.opened === true };
};

/** Every key that travels, and how its two sides become one. */
const KEYS: { key: string; merge: Merge }[] = [
  { key: "xpTotal", merge: larger },
  { key: "yennies", merge: larger },
  { key: "achievements", merge: earliestTimes },
  { key: "kanaBestStreak", merge: larger },
  { key: "kanaStats", merge: kanaStatsMerge },
  { key: "kanaGameLog", merge: gameLogMerge },
  { key: "gachaOwned", merge: unionStrings },
  { key: "gachaItems", merge: perKeyMax },
  { key: "yuuriDoorBribes", merge: larger },
  { key: "questStart", merge: earliestDay },
  { key: "questXpAwarded", merge: paidUnion },
  { key: "casinoGateSeen", merge: seenMerge },
];

/**
 * The quest log is special: the admin panel can rewrite anyone's calendar —
 * completing a missed day, deleting one — and a deletion can never survive
 * a max-merge. So the panel writes the log verbatim and bumps
 * `questLogRev`; a client that sees a rev ahead of its own adopts the
 * remote log as-is, once, and organic play merges on top as before.
 */
const QUEST_LOG_KEY = "questLog";
const QUEST_REV_KEY = "questLogRev";
/** The user's own hidden-prize list; only ever written by the admin panel. */
const HIDDEN_PRIZES_KEY = "hiddenPrizes";

let running: Promise<boolean> | null = null;

/**
 * Exchange progress with the cloud. True when anything local changed.
 *
 * Quiet about everything — no account, no cloud, no network all mean the
 * local numbers stand, exactly as they did before any of this existed.
 */
export function syncProgress(): Promise<boolean> {
  running ??= exchange().finally(() => {
    running = null;
  });
  return running;
}

async function exchange(): Promise<boolean> {
  try {
    if (!(await getFirebaseConfig())) return false;
    const me = await currentAccount().catch(() => null);
    if (!me) return false;

    const { db, storeApi } = await firestoreApi();
    const ref = storeApi.doc(db, "users", me.uid);
    const snapshot = await storeApi.getDoc(ref);
    const data = (snapshot.exists?.() ? snapshot.data?.() : null) ?? {};
    const remote: Record<string, unknown> = isMap(data.progress) ? data.progress : {};

    let localChanged = false;
    const upload: Record<string, unknown> = {};
    for (const { key, merge } of KEYS) {
      const local = await getMeta<unknown>(key);
      const merged = merge(local, remote[key]);
      if (merged === undefined) continue;
      if (!same(merged, local)) {
        await setMeta(key, merged);
        localChanged = true;
      }
      if (!same(merged, remote[key])) upload[key] = canonical(merged);
    }

    // The quest log: adopt an admin rewrite outright, merge otherwise.
    {
      const localLog = await getMeta<unknown>(QUEST_LOG_KEY);
      const localRev = num(await getMeta<unknown>(QUEST_REV_KEY));
      const remoteRev = num(remote[QUEST_REV_KEY]);
      if (remoteRev > localRev && isMap(remote[QUEST_LOG_KEY])) {
        await setMeta(QUEST_LOG_KEY, remote[QUEST_LOG_KEY]);
        await setMeta(QUEST_REV_KEY, remoteRev);
        localChanged = true;
      } else {
        const merged = questLogMerge(localLog, remote[QUEST_LOG_KEY]);
        if (merged !== undefined) {
          if (!same(merged, localLog)) {
            await setMeta(QUEST_LOG_KEY, merged);
            localChanged = true;
          }
          if (!same(merged, remote[QUEST_LOG_KEY])) upload[QUEST_LOG_KEY] = canonical(merged);
        }
      }
    }

    // The hidden-prize list is the admin's alone: whatever the cloud says
    // stands, and the client never writes it back.
    if (Array.isArray(remote[HIDDEN_PRIZES_KEY])) {
      const local = await getMeta<unknown>(HIDDEN_PRIZES_KEY);
      if (!same(remote[HIDDEN_PRIZES_KEY], local)) {
        await setMeta(HIDDEN_PRIZES_KEY, remote[HIDDEN_PRIZES_KEY]);
        localChanged = true;
      }
    }

    if (Object.keys(upload).length > 0) {
      await storeApi.setDoc(ref, { progress: upload }, { merge: true });
    }
    // Modules cache these numbers until the account changes; the same bell
    // tells them their copy is stale.
    if (localChanged) notifyAccountData();
    return localChanged;
  } catch {
    // Progress that will not sync is not a reason to lose the progress here.
    return false;
  }
}
