import { getMeta, setMeta } from "./db.js";
import { currentAccount, firestoreApi } from "./cloud.js";

/**
 * Public profiles: the username other people see, and an optional picture.
 *
 * Google sign-in hands over a real name; it is never shown to anyone.
 * Instead every account is given a unique username the moment it first
 * signs in — `learner-` plus a stamp derived from the account id — which
 * can then be changed to anything not already taken. Uniqueness is a
 * one-document-per-name claim enforced by the security rules, so two
 * accounts can never display the same name whatever a client does.
 *
 * The picture is downscaled on the device and stored inside the profile
 * document as a data URL — small enough that no file storage service is
 * needed, and it travels wherever the profile is read.
 */

export interface Profile {
  name: string;
  /** A data: URL, at most ~100 KB. */
  photo?: string;
}

const CACHE_KEY = "profile";
const NAME_RULE = /^[a-z0-9][a-z0-9_-]{2,19}$/;

export function isValidUsername(name: string): boolean {
  return NAME_RULE.test(name);
}

/** A short stable stamp of the account id, for the default username. */
function uidStamp(uid: string, salt: number): string {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}

function asProfile(data: unknown): Profile | null {
  const record = data as Record<string, unknown> | null;
  if (!record || typeof record.name !== "string" || !record.name) return null;
  const photo =
    typeof record.photo === "string" && /^data:image\//.test(record.photo) ? record.photo : undefined;
  return { name: record.name, ...(photo ? { photo } : {}) };
}

async function fetchProfile(uid: string): Promise<Profile | null> {
  const { db, storeApi } = await firestoreApi();
  const snapshot = await storeApi.getDoc(storeApi.doc(db, "profiles", uid));
  return snapshot.exists?.() ? asProfile(snapshot.data?.()) : null;
}

async function writeProfile(uid: string, profile: Profile): Promise<void> {
  const { db, storeApi } = await firestoreApi();
  await storeApi.setDoc(storeApi.doc(db, "profiles", uid), profile);
  await setMeta(CACHE_KEY, profile);
}

/**
 * Take a username. Throws when somebody else already holds it; holding it
 * yourself already (a retried claim) is fine.
 */
async function claimUsername(uid: string, name: string): Promise<void> {
  const { db, storeApi } = await firestoreApi();
  const ref = storeApi.doc(db, "usernames", name);
  const existing = await storeApi.getDoc(ref);
  if (existing.exists?.()) {
    if (existing.data?.()?.uid === uid) return;
    throw new Error(`"${name}" is already taken.`);
  }
  try {
    await storeApi.setDoc(ref, { uid });
  } catch {
    // Lost a race, or the rules refused the shape of the name.
    throw new Error(`"${name}" is already taken.`);
  }
}

async function releaseUsername(uid: string, name: string): Promise<void> {
  const { db, storeApi } = await firestoreApi();
  const ref = storeApi.doc(db, "usernames", name);
  const existing = await storeApi.getDoc(ref);
  if (existing.exists?.() && existing.data?.()?.uid === uid) {
    await storeApi.deleteDoc(ref).catch(() => {
      /* a stray claim is unfortunate, not fatal */
    });
  }
}

/**
 * The signed-in account's profile, created on first need.
 *
 * A brand-new account gets `learner-<stamp>` — unique by construction, and
 * claimed like any other name so it stays that way — before the person has
 * chosen anything. There is therefore never a moment where an account has
 * no name to show.
 */
export async function ensureProfile(): Promise<Profile> {
  const cached = await getMeta<Profile>(CACHE_KEY);
  if (cached?.name) return cached;

  const me = await currentAccount();
  if (!me) throw new Error("Sign in first.");

  let profile = await fetchProfile(me.uid);
  if (!profile) {
    let name = "";
    for (let attempt = 0; attempt < 5 && !name; attempt++) {
      const candidate = `learner-${uidStamp(me.uid, attempt)}`;
      try {
        await claimUsername(me.uid, candidate);
        name = candidate;
      } catch {
        // Astronomically unlikely collision; the next stamp differs.
      }
    }
    if (!name) throw new Error("Could not assign a username. Try again.");
    profile = { name };
    await writeProfile(me.uid, profile);
  } else {
    await setMeta(CACHE_KEY, profile);
  }
  return profile;
}

/** Change the username to one of the person's own choosing. */
export async function changeUsername(rawName: string): Promise<Profile> {
  const name = rawName.trim().toLowerCase();
  if (!isValidUsername(name)) {
    throw new Error("3–20 characters: lowercase letters, numbers, - and _ (starting with a letter or number).");
  }
  const me = await currentAccount();
  if (!me) throw new Error("Sign in first.");
  const current = await ensureProfile();
  if (current.name === name) return current;

  await claimUsername(me.uid, name);
  const next: Profile = { ...current, name };
  try {
    await writeProfile(me.uid, next);
  } catch (err) {
    await releaseUsername(me.uid, name);
    throw err;
  }
  await releaseUsername(me.uid, current.name);
  return next;
}

/**
 * Set the profile picture from a chosen image file.
 *
 * Scaled down to a small square on the device — a library avatar needs
 * nothing more — so what is stored is a few kilobytes, not the original.
 */
export async function setProfilePhoto(file: File): Promise<Profile> {
  const me = await currentAccount();
  if (!me) throw new Error("Sign in first.");
  const current = await ensureProfile();

  const photo = await squareThumbnail(file, 128);
  if (photo.length > 100000) throw new Error("Could not shrink that image. Try another.");
  const next: Profile = { ...current, photo };
  await writeProfile(me.uid, next);
  return next;
}

async function squareThumbnail(file: File, size: number): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file does not look like an image.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Cover: crop the shorter dimension rather than squashing the picture.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.82);
}

/**
 * The profiles behind a set of accounts, for showing avatars beside shared
 * decks. Missing ones are simply absent; the list renders without them.
 */
export async function profilesFor(uids: string[]): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  const distinct = [...new Set(uids.filter(Boolean))];
  await Promise.all(
    distinct.map(async (uid) => {
      const profile = await fetchProfile(uid).catch(() => null);
      if (profile) out.set(uid, profile);
    }),
  );
  return out;
}
