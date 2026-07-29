/**
 * Manifest generation for both engines from one definition.
 *
 * Chromium MV3 runs the background as a service worker; Firefox MV3 (including
 * Firefox for Android) runs it as an event page declared with `background.scripts`
 * and additionally requires an add-on id under `browser_specific_settings`.
 */

export const VERSION = "0.5.0";

/** Add-on id used when signing/listing the Firefox build. */
export const GECKO_ID = "yomeyo@yomeyo.app";

function base() {
  return {
    manifest_version: 3,
    name: "Yomeyo — Japanese word miner",
    version: VERSION,
    description:
      "Tap Japanese words on any page to look them up and save them as spaced-repetition flashcards.",
    icons: {
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    // Deliberately unchanged since 0.3.0, and deliberately small. Asking for
    // anything more makes a browser hold an already-installed extension until
    // the user approves it again — and an extension in that state looks
    // exactly like one that has stopped working. The handover to the app
    // needs neither host permissions nor an offscreen document; it runs in
    // the content script that is already there.
    permissions: ["storage", "tabs"],
    // Optional, and asked for only when the user presses the button in the
    // toolbar menu. Optional permissions do not make a browser hold an
    // already-installed extension for re-approval, which is what a required
    // one would do — and did.
    optional_host_permissions: ["*://*/*"],
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["content.js"],
        run_at: "document_idle",
        all_frames: false,
      },
    ],
    action: {
      default_popup: "popup.html",
      default_icon: {
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
    web_accessible_resources: [
      {
        resources: ["dict/dict.bin"],
        matches: ["<all_urls>"],
      },
    ],
  };
}

export function manifestFor(target) {
  const manifest = base();

  if (target === "firefox") {
    // Event page, not a service worker.
    manifest.background = { scripts: ["background.js"] };
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // MV3 support landed in Firefox 109 and is usable on Android from 120.
        strict_min_version: "120.0",
      },
      gecko_android: {
        strict_min_version: "120.0",
      },
    };
  } else {
    manifest.background = { service_worker: "background.js" };
  }

  return manifest;
}

export const TARGETS = ["chromium", "firefox"];
