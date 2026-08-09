import { formatYennies, onYenniesChange } from "./yennies.js";

// Every yen chip on screen follows the purse live: a casino win or a spent
// bet updates the header the moment it happens, no re-render required.
onYenniesChange((balance) => {
  for (const chip of document.querySelectorAll<HTMLElement>(".yen-chip")) {
    chip.textContent = formatYennies(balance);
  }
});

/**
 * The heading a screen wears.
 *
 * Centred, with the purse beside it where there is one. Yennies are quiet
 * everywhere else — no counter climbs beside the questions, because that is a
 * reason to keep tapping rather than a reason to learn — but a balance at the
 * top of the game you earn them in is a fact, not a nag, and the title looks
 * better for having something to sit against.
 */
export function screenHeader(title: string, balance?: number): string {
  return `<div class="screen-head">
    <h1>${escapeHtml(title)}</h1>
    ${balance === undefined ? "" : `<span class="yen-chip">${escapeHtml(formatYennies(balance))}</span>`}
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
