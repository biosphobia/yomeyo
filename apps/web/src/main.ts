import "./styles.css";
import { renderReader } from "./reader.js";
import { renderReview } from "./review.js";
import { renderWords } from "./words.js";
import { renderSettings } from "./settings.js";
import { closePopup } from "./popup.js";

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

function route(): void {
  closePopup();
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
      void renderWords(main);
      break;
    case "settings":
      void renderSettings(main);
      break;
    default:
      void renderReview(main);
  }
}

let readerShown = false;
window.addEventListener("hashchange", route);
if (sharedText) location.hash = "#reader";
route();

// PWA service worker (production builds only; Vite dev serves from memory).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* offline support is progressive enhancement */
  });
}
