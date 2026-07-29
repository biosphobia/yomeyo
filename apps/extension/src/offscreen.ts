import { ext } from "./browser.js";
import { handOverViaFrame } from "./frame-handoff.js";

/**
 * Offscreen document: a place with a DOM.
 *
 * A Chromium MV3 background is a service worker and cannot create a frame,
 * so the handover to the app's own page happens here instead. Firefox's
 * event page has a document of its own and does this inline.
 */
ext.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (r: any) => void) => {
  if (message?.type !== "deliverToApp") return undefined;
  handOverViaFrame(message.frameUrl, message.cards).then(
    (ids) => sendResponse({ ids }),
    (err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }),
  );
  return true; // keep the channel open for the async response
});
