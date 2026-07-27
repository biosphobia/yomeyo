/**
 * Manifest generation for both engines from one definition.
 *
 * Chromium MV3 runs the background as a service worker; Firefox MV3 (including
 * Firefox for Android) runs it as an event page declared with `background.scripts`
 * and additionally requires an add-on id under `browser_specific_settings`.
 */

export const VERSION = "0.2.0";

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
    permissions: ["storage", "tabs"],
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
