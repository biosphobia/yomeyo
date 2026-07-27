import "./styles.css";
import { renderReader } from "./reader.js";
import { renderReview } from "./review.js";
import { renderWords } from "./words.js";
import { renderSettings } from "./settings.js";
import { closePopup } from "./popup.js";
import { consumeHandoff, showHandoffToast } from "./handoff.js";

/** Hash-routed SPA shell with a bottom tab bar. */

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main id="main"></main>
  <nav>
    <a href="#review" data-route="review"><span class="icon">🗂️</span>Review</a>
    <a href="#reader" data-route="reader"><span class="icon">📖</span>Reader</a>
    <a href="#words" data-route="words"><span class="icon">📚</span>Words</a>
    <a href="#settings" data-route="settings"><span class="icon">⚙️</span>Settings</a>
  </nav>
`;

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
  document.querySelectorAll("nav a").forEach((a) => {
    a.classList.toggle("active", (a as HTMLAnchorElement).dataset.route === hash);
  });
  switch (hash) {
    case "reader":
      renderReader(main, sharedText && !readerShown ? sharedText : undefined);
      readerShown = true;
      break;
    case "words":
      void renderWords(main, isCurrent);
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
