import { assetUrl } from "./store.js";

/**
 * Where the app's Claude requests go.
 *
 * On a PHP host that is `grammar.php`, deployed next to the app with the key
 * beside it. GitHub Pages cannot run PHP, so a Pages build is pointed at the
 * Cloudflare Worker in `apps/ai-worker/` instead, through VITE_AI_URL, which
 * the deploy workflow sets to the Worker's address. Same requests, same
 * answers, either way.
 */

const WORKER = (import.meta.env.VITE_AI_URL as string | undefined)?.trim() || "";

/** The endpoint to POST requests to. */
export function aiUrl(): string {
  return WORKER || assetUrl("grammar.php");
}

/** The probe: 204 when Claude is configured, anything else when not. */
export function aiProbeUrl(): string {
  return WORKER ? `${WORKER}${WORKER.includes("?") ? "&" : "?"}probe=1` : assetUrl("grammar.php?probe=1");
}
