import type { Card } from "@yomeyo/core";
import { importCards } from "./store.js";
import { toast } from "./toast.js";

/**
 * Receive words handed over by the browser extension.
 *
 * The extension opens the app at `#import=<base64url JSON>`. A fragment is
 * used rather than a query string because browsers never send fragments to
 * the server, so the deck never leaves the device — which matters when the
 * app is hosted on GitHub Pages.
 */

function decodePayload(encoded: string): unknown {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function looksLikeCard(value: any): value is Card {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.term === "string" &&
    typeof value.updatedAt === "number"
  );
}

export interface HandoffResult {
  imported: number;
  total: number;
}

/**
 * If the current URL carries an extension handoff, import it and clear the
 * fragment. Returns null when there is nothing to import.
 */
export async function consumeHandoff(): Promise<HandoffResult | null> {
  const match = /[#&]import=([^&]+)/.exec(location.hash);
  if (!match) return null;

  // Clear the fragment first so a reload cannot re-run the import and so the
  // (potentially large) payload does not sit in the address bar.
  history.replaceState(null, "", location.pathname + location.search + "#words");

  try {
    const payload = decodePayload(match[1]);
    if (!Array.isArray(payload)) throw new Error("not a list of cards");
    const cards = payload.filter(looksLikeCard);
    if (cards.length === 0) return { imported: 0, total: 0 };
    const imported = await importCards(cards);
    return { imported, total: cards.length };
  } catch {
    return { imported: 0, total: 0 };
  }
}

/** Briefly show the outcome of an import. */
export function showHandoffToast(result: HandoffResult): void {
  toast(
    result.total === 0
      ? "Nothing to import from the extension."
      : result.imported === 0
        ? `Already had all ${result.total} word${result.total === 1 ? "" : "s"}.`
        : `Imported ${result.imported} word${result.imported === 1 ? "" : "s"} from the extension.`,
  );
}
