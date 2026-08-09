import "./styles.css";
import { renderReader } from "./reader.js";
import { renderReview } from "./review.js";
import { renderWords } from "./words.js";
import { renderDecks } from "./decks.js";
import { renderCalendar } from "./calendar.js";
import { renderKana } from "./kana.js";
import { renderArcade } from "./arcade.js";
import { lazyImport } from "./lazy.js";
import { renderGrammar } from "./grammar.js";
import { renderKanji } from "./kanji.js";
import { renderSettings } from "./settings.js";
import { closePopup } from "./popup.js";
import { consumeHandoff, showHandoffToast } from "./handoff.js";
import { listenForExtensionCards } from "./extension-bridge.js";
import { completeRedirectSignIn, currentAccount, getFirebaseConfig } from "./cloud.js";
import { restoreAccount } from "./accounts.js";
import { activeAccount, onAccountChange } from "./db.js";
import { toast } from "./toast.js";
import { markNavActive, mountNav, navHtml, navSheetHtml } from "./nav.js";

/**
 * Hash-routed SPA shell. The nav is a bottom tab bar on phones and a grouped
 * sidebar on wide screens; the same list of destinations serves both, and on
 * the phone the ones that do not fit live one tap away in a sheet.
 */

// Before anything reads storage: point it at whoever was signed in last time,
// so the first screen is already the right person's deck rather than the
// previous account's cards replaced a moment later.
await restoreAccount();

// Whatever skin was won and put on, applied before the first screen draws,
// so a skinned app never flashes the default palette on the way in.
await import("./skins.js").then((mod) => mod.applySkin()).catch(() => undefined);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  ${navHtml()}
  <main id="main"></main>
  ${navSheetHtml()}
`;
mountNav(app);

const main = document.querySelector<HTMLElement>("#main")!;

/**
 * Web Share Target (Android PWA): shares arrive as GET params on the app
 * root. Route them straight into the Reader.
 */
function consumeShare(): string | undefined {
  const params = new URLSearchParams(location.search);
  const text = params.get("text") ?? params.get("title") ?? undefined;
  if (text) {
    history.replaceState(null, "", location.pathname + "#reader");
    return text;
  }
  return undefined;
}

const sharedText = consumeShare();

/**
 * Screens render asynchronously (they read IndexedDB first), so a render
 * started earlier can finish later and paint over a newer one. Each render
 * carries a generation token and bails out if it is no longer the current
 * one — otherwise a fast tab switch, or an import that re-renders, can leave
 * a stale screen on display.
 */
let generation = 0;

function route(): void {
  closePopup();
  const gen = ++generation;
  const isCurrent = () => gen === generation;

  const hash = location.hash.replace("#", "") || "review";
  markNavActive(app, hash);
  switch (hash) {
    // No tab leads here any more: the Reader exists only for text shared to
    // the app from Android, which still lands on this route.
    case "reader":
      renderReader(main, sharedText && !readerShown ? sharedText : undefined);
      readerShown = true;
      break;
    case "words":
      void renderWords(main, isCurrent);
      break;
    case "decks":
      void renderDecks(main, isCurrent);
      break;
    case "kana":
      void renderKana(main, isCurrent);
      break;
    case "games":
      void renderArcade(main, isCurrent);
      break;
    case "grammar":
      void renderGrammar(main, isCurrent);
      break;
    case "kanji":
      void renderKanji(main, isCurrent);
      break;
    case "calendar":
      void renderCalendar(main, isCurrent);
      break;
    case "gacha":
      void lazyImport(() => import("./gacha.js")).then((mod) => mod.renderGacha(main, isCurrent));
      break;
    case "settings":
      void renderSettings(main, isCurrent);
      break;
    default:
      void renderReview(main, isCurrent);
  }
}

let readerShown = false;

/**
 * Words handed over by the browser extension arrive in the URL fragment.
 * Import before rendering so the deck is already up to date.
 *
 * This also runs on hashchange: the extension opens a fresh tab, but an
 * import URL opened in an already-running tab only changes the fragment,
 * and would otherwise be silently ignored.
 */
async function routeWithHandoff(): Promise<void> {
  const handoff = await consumeHandoff();
  route();
  if (handoff) showHandoffToast(handoff);
}

window.addEventListener("hashchange", () => void routeWithHandoff());
if (sharedText) location.hash = "#reader";

await routeWithHandoff();

// Signing in or out changes which deck, settings and daily counts are in
// front of you, so whatever is on screen is about to be wrong.
onAccountChange(() => route());

// The level, the purse and the achievements travel with the account, not
// the browser. Whenever an account lands — start-up or sign-in — fetch
// them quietly; the account-change bell above redraws when they arrive.
onAccountChange(() => {
  if (!activeAccount()) return;
  void import("./progress-sync.js").then((m) => m.syncProgress()).catch(() => undefined);
});

/**
 * Check the remembered account against the real session, once, in the
 * background.
 *
 * The account is remembered locally so the first screen needs no network and
 * no Firebase download. That memory can go stale — the session may have
 * expired, or been signed out in another tab — so it is confirmed afterwards,
 * where a slow answer costs nothing. Only for someone who has actually signed
 * in: everyone else must never pay for the SDK.
 */
if (activeAccount()) {
  void (async () => {
    if (await getFirebaseConfig()) {
      await currentAccount().catch(() => null);
      // The session stands: bring over any progress made elsewhere.
      await import("./progress-sync.js").then((m) => m.syncProgress()).catch(() => undefined);
    }
  })();
}

// Words saved by the extension arrive on their own whenever the app is open,
// so there is nothing for the user to press.
listenForExtensionCards(
  (count) => {
    toast(`Added ${count} word${count === 1 ? "" : "s"} saved with the extension.`);
    route(); // the deck on screen is now out of date
  },
  () => {
    // The extension introduced itself. Screens that say whether it is there
    // were drawn before that, so redraw them.
    const hash = location.hash.replace("#", "");
    if (hash === "words" || hash === "settings") route();
  },
);

// Google sign-in falls back to a redirect on mobile and in installed PWAs,
// which lands back here; completing it switches to that account's deck, and
// the listener above redraws.
void completeRedirectSignIn().then((account) => {
  // No name in the toast: what shows anywhere is the username, and a brand
  // new account is only just about to be given one, below.
  if (account) {
    toast("Signed in.");
    // Assign the default unique username straight away, so the account is
    // never nameless — the person can change it in Settings.
    void import("./profile.js").then((m) => m.ensureProfile().catch(() => undefined));
  }
});

// PWA service worker (production builds only; Vite dev serves from memory).
// Registered relatively so it works under a Pages subpath, where its scope
// becomes the app directory rather than the domain root.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // BASE_URL (not import.meta.url, which points into assets/) so the worker
  // is found at the app root and takes the app directory as its scope.
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
    /* offline support is progressive enhancement */
  });
}

// A book left half-read by "OCR all pages" carries on where it stopped —
// here while the app is open, and in the service worker once it is not.
void import("./ocr-resume.js").then((m) => m.resumeOcrJobs());
