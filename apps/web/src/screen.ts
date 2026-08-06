import { formatYennies } from "./yennies.js";

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
