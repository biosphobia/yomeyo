import type { Card, SyncBackend } from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";
import { useAccount } from "./accounts.js";

/**
 * Firebase accounts + cloud storage.
 *
 * The whole SDK is loaded lazily, only once cloud sync is actually
 * configured. That keeps the app's first paint and its offline path — which
 * work with no account at all — free of ~hundreds of KB of Firebase code.
 *
 * The local IndexedDB deck stays the source of truth. Firestore is a sync
 * peer, not the read path, so reviews keep working with no signal.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  /** Only needed if you use Firebase Storage; harmless otherwise. */
  storageBucket?: string;
  messagingSenderId?: string;
}

export interface AccountInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
}

const CONFIG_KEY = "firebaseConfig";

/**
 * Build-time config, if the deployment baked one in. Falls back to whatever
 * the user pasted into Settings, so the hosted app works without a rebuild.
 */
function envConfig(): FirebaseConfig | undefined {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as FirebaseConfig;
    return parsed.apiKey && parsed.projectId ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function getFirebaseConfig(): Promise<FirebaseConfig | undefined> {
  return envConfig() ?? (await getMeta<FirebaseConfig>(CONFIG_KEY));
}

export async function setFirebaseConfig(config: FirebaseConfig | undefined): Promise<void> {
  await setMeta(CONFIG_KEY, config);
  // Force a fresh SDK init next time; the project may have changed.
  cached = null;
}

/** True when this build hard-codes the project (config is not user-editable). */
export function configIsFromEnv(): boolean {
  return envConfig() !== undefined;
}

export function validateConfig(value: unknown): FirebaseConfig {
  if (typeof value !== "object" || value === null) throw new Error("Config must be a JSON object.");
  const c = value as Record<string, unknown>;
  for (const key of ["apiKey", "authDomain", "projectId", "appId"]) {
    if (typeof c[key] !== "string" || !(c[key] as string).trim()) {
      throw new Error(`Config is missing "${key}".`);
    }
  }
  return value as FirebaseConfig;
}

// ---------------- lazy SDK ----------------

interface Loaded {
  auth: any;
  db: any;
  mod: {
    authApi: typeof import("firebase/auth");
    storeApi: typeof import("firebase/firestore");
  };
}

let cached: Promise<Loaded> | null = null;

async function load(): Promise<Loaded> {
  if (cached) return cached;
  cached = (async () => {
    const config = await getFirebaseConfig();
    if (!config) throw new Error("Cloud sync is not configured yet.");

    const [{ initializeApp, getApps, getApp }, authApi, storeApi] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
      import("firebase/firestore"),
    ]);

    const app = getApps().length ? getApp() : initializeApp(config);
    const auth = authApi.getAuth(app);
    const db = storeApi.getFirestore(app);

    // Point at local emulators when running the test harness. This has to
    // come before anything else touches auth — Firebase resolves the stored
    // session on first use, and doing that against the wrong endpoint loses
    // it, which looks exactly like being signed out on every reload.
    const emulator = import.meta.env.VITE_FIREBASE_EMULATOR;
    if (emulator) {
      const [host, authPort, storePort] = String(emulator).split(":");
      authApi.connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
      storeApi.connectFirestoreEmulator(db, host, Number(storePort));
    }

    // Survive reloads and app restarts without asking to sign in again.
    await authApi.setPersistence(auth, authApi.browserLocalPersistence).catch(() => {
      /* falls back to the default persistence */
    });

    return { auth, db, mod: { authApi, storeApi } };
  })().catch((err) => {
    cached = null; // let a later attempt retry after fixing the config
    return Promise.reject(err);
  });
  return cached;
}

// ---------------- accounts ----------------

function toAccount(user: any): AccountInfo {
  return { uid: user.uid, email: user.email ?? null, displayName: user.displayName ?? null };
}

/**
 * Every route into this module that learns who is signed in ends here.
 *
 * Local storage is per account, so knowing the account and pointing storage
 * at it must not be two steps a caller can get half right — a sign-in that
 * forgot the second step would show the previous person's deck, and a
 * sign-out that forgot it would leave a deck on screen that is no longer
 * anyone's. Doing it here means there is one place to get it right.
 */
async function adopt(user: any | null): Promise<AccountInfo | null> {
  const account = user ? toAccount(user) : null;
  await useAccount(account);
  return account;
}

/** Current account, or null. Resolves once Firebase has restored the session. */
export async function currentAccount(): Promise<AccountInfo | null> {
  const config = await getFirebaseConfig();
  // Without a project there is nothing to ask, and nothing to correct: the
  // remembered account stays in use so its deck is still readable offline.
  if (!config) return null;
  const { auth, mod } = await load();
  const user = await new Promise<any>((resolve) => {
    const stop = mod.authApi.onAuthStateChanged(auth, (u: any) => {
      stop();
      resolve(u);
    });
  });
  // This is also the reconcile: if the session expired or was ended in
  // another tab, storage follows it back to the signed-out deck.
  return adopt(user);
}

/**
 * True when the app was launched from the home screen rather than a tab.
 *
 * A popup opened from there lands in a separate browser window the user has
 * to find and come back from, and on Android it frequently never returns a
 * result at all — so those installs go straight to the redirect flow.
 */
function isInstalledApp(): boolean {
  try {
    if ((navigator as any).standalone === true) return true; // iOS
    return window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches;
  } catch {
    return false;
  }
}

export async function signInWithGoogle(): Promise<AccountInfo> {
  const { auth, mod } = await load();
  const provider = new mod.authApi.GoogleAuthProvider();

  const redirect = async (): Promise<AccountInfo> => {
    markRedirectPending();
    await mod.authApi.signInWithRedirect(auth, provider);
    // Navigation happens; this promise never settles in practice. The result
    // is collected by completeRedirectSignIn() on the next load.
    return new Promise<AccountInfo>(() => {});
  };

  if (isInstalledApp()) return redirect();

  try {
    const credential = await mod.authApi.signInWithPopup(auth, provider);
    return (await adopt(credential.user))!;
  } catch (err: any) {
    // Some mobile browsers block popups even in a tab; redirect works there.
    const code = err?.code ?? "";
    if (
      code.includes("popup-blocked") ||
      code.includes("popup-closed-by-user") ||
      code.includes("cancelled-popup-request") ||
      code.includes("operation-not-supported")
    ) {
      return redirect();
    }
    throw new Error(friendlyAuthError(err));
  }
}

/**
 * Note that we are about to leave for the sign-in page.
 *
 * The app has to know, on the way back, that a redirect result is waiting —
 * and it cannot ask Firebase without loading Firebase, which is the thing
 * being avoided. This used to sniff sessionStorage for a Firebase-internal
 * "pendingRedirect" key, which the SDK no longer writes: the redirect
 * completed, the result was never collected, and the user landed back on the
 * app still signed out with nothing to explain why. Recording it ourselves
 * does not depend on Firebase's internals.
 */
const REDIRECT_KEY = "yomeyo:signInRedirect";

function markRedirectPending(): void {
  try {
    localStorage.setItem(REDIRECT_KEY, String(Date.now()));
  } catch {
    /* storage blocked; the sessionStorage sniff below may still catch it */
  }
}

function redirectIsPending(): boolean {
  try {
    if (localStorage.getItem(REDIRECT_KEY)) return true;
  } catch {
    /* fall through */
  }
  try {
    // Older Firebase versions left their own marker; harmless to keep.
    return Object.keys(sessionStorage).some((key) => key.includes("pendingRedirect"));
  } catch {
    return false;
  }
}

function clearRedirectPending(): void {
  try {
    localStorage.removeItem(REDIRECT_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Complete a redirect-based sign-in, if one is in flight.
 *
 * Called on every app start, so it must not drag the Firebase SDK in on a
 * normal launch — a signed-in user opening the app to review offline should
 * not wait on hundreds of KB.
 */
export async function completeRedirectSignIn(): Promise<AccountInfo | null> {
  if (!redirectIsPending()) return null;

  const config = await getFirebaseConfig();
  if (!config) {
    clearRedirectPending();
    return null;
  }
  try {
    const { auth, mod } = await load();
    const result = await mod.authApi.getRedirectResult(auth);
    if (result?.user) return adopt(result.user);
    // No result, but the session may still have been restored from the
    // redirect — ask before giving up, or the user sees no sign of success.
    const user = await new Promise<any>((resolve) => {
      const stop = mod.authApi.onAuthStateChanged(auth, (u: any) => {
        stop();
        resolve(u);
      });
    });
    return user ? adopt(user) : null;
  } catch {
    return null;
  } finally {
    clearRedirectPending();
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AccountInfo> {
  const { auth, mod } = await load();
  try {
    const credential = await mod.authApi.signInWithEmailAndPassword(auth, email, password);
    return (await adopt(credential.user))!;
  } catch (err: any) {
    // Treat a missing account as a sign-up, so there is one button not two.
    if (err?.code === "auth/user-not-found" || err?.code === "auth/invalid-credential") {
      try {
        const created = await mod.authApi.createUserWithEmailAndPassword(auth, email, password);
        return (await adopt(created.user))!;
      } catch (createErr: any) {
        throw new Error(friendlyAuthError(createErr));
      }
    }
    throw new Error(friendlyAuthError(err));
  }
}

export async function signOut(): Promise<void> {
  const { auth, mod } = await load();
  await mod.authApi.signOut(auth);
  // The sync cursor is left alone: it belongs to this account's own database,
  // which nobody else will read, so signing back in resumes where it left off
  // instead of downloading the whole deck again.
  await useAccount(null);
}

function friendlyAuthError(err: any): string {
  const code: string = err?.code ?? "";
  if (code.includes("invalid-email")) return "That email address doesn't look right.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("email-already-in-use")) return "That email is already registered.";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) {
    return "Wrong email or password.";
  }
  if (code.includes("network-request-failed")) return "Could not reach Firebase. Check your connection.";
  if (code.includes("unauthorized-domain")) {
    return "This domain isn't authorised in Firebase (Authentication → Settings → Authorized domains).";
  }
  if (code.includes("operation-not-allowed")) {
    return "Google sign-in isn't switched on for this project yet (Firebase console → Authentication → Sign-in method → Google).";
  }
  if (code.includes("account-exists-with-different-credential")) {
    return "You already have an account with that email. Sign in with the email and password instead.";
  }
  return err?.message ?? "Sign-in failed.";
}

// ---------------- Firestore as a sync backend ----------------

/**
 * Cards live at `users/{uid}/cards/{cardId}`, so the security rules can scope
 * a deck to its owner with a single match.
 *
 * Each document carries a server-written `syncedAt`. The sync cursor uses
 * that rather than the card's own `updatedAt`, so devices with skewed clocks
 * cannot cause changes to be skipped.
 */
export async function firestoreBackend(): Promise<SyncBackend> {
  const { auth, db, mod } = await load();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in first.");
  const { storeApi } = mod;
  const cardsRef = storeApi.collection(db, "users", user.uid, "cards");

  return {
    async pull(since: number) {
      const q = storeApi.query(
        cardsRef,
        storeApi.where("syncedAt", ">", storeApi.Timestamp.fromMillis(since)),
        storeApi.orderBy("syncedAt"),
      );
      const snapshot = await storeApi.getDocs(q);
      const changes: Card[] = [];
      let cursor = since;
      snapshot.forEach((doc: any) => {
        const { syncedAt, ...card } = doc.data();
        // A just-written document can briefly report a null server timestamp.
        const at = syncedAt?.toMillis?.();
        if (typeof at === "number") cursor = Math.max(cursor, at);
        changes.push(card as Card);
      });
      return { changes, cursor };
    },

    async push(cards: Card[]) {
      // Firestore allows 500 writes per batch.
      for (let i = 0; i < cards.length; i += 400) {
        const batch = storeApi.writeBatch(db);
        for (const card of cards.slice(i, i + 400)) {
          batch.set(storeApi.doc(cardsRef, card.id), {
            ...card,
            syncedAt: storeApi.serverTimestamp(),
          });
        }
        await batch.commit();
      }
    },
  };
}
