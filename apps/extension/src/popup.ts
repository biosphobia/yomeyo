import { activeTab, sendMessage, sendToTab, storageGet } from "./browser.js";

/** Toolbar popup: tap-mode toggle, deck stats, handoff to the app, sync. */

const IS_TOUCH =
  typeof matchMedia === "function"
    ? matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0
    : navigator.maxTouchPoints > 0;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const tapToggle = $<HTMLInputElement>("tap-mode");
const showToggleInput = $<HTMLInputElement>("show-toggle");
const tapHint = $<HTMLDivElement>("tap-hint");
const appUrlInput = $<HTMLInputElement>("app-url");
const urlInput = $<HTMLInputElement>("sync-url");
const tokenInput = $<HTMLInputElement>("sync-token");
const syncBtn = $<HTMLButtonElement>("sync-btn");
const msg = $<HTMLDivElement>("msg");
const statTotal = $<HTMLElement>("stat-total");
const statWaiting = $<HTMLElement>("stat-waiting");
const transferHint = $<HTMLDivElement>("transfer-hint");
const audioHint = $<HTMLDivElement>("audio-hint");
const audioAllowBtn = $<HTMLButtonElement>("audio-allow");
const versionLabel = $<HTMLDivElement>("version-label");

/** "just now" / "12 minutes ago" / "3 days ago". */
function describeWhen(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function setMessage(text: string, kind: "" | "ok" | "error" = ""): void {
  msg.textContent = text;
  msg.className = kind ? `msg ${kind}` : "msg";
}

function updateHint(): void {
  tapHint.textContent = tapToggle.checked
    ? "Tap any Japanese word on a page to look it up."
    : IS_TOUCH
      ? "Off."
      : "Off. Hold Alt/Option and click a word instead.";
}

/**
 * What tap mode is actually doing on the page the user is looking at.
 *
 * The content script is the authority — it sees the real page environment,
 * which can differ from this popup's own context — so ask it first and only
 * fall back to a local guess when no content script is listening.
 */
async function effectiveTapMode(stored: boolean | null): Promise<boolean> {
  try {
    const tab = await activeTab();
    if (tab?.id !== undefined) {
      const state = await sendToTab<{ active: boolean }>(tab.id, { type: "getTapState" });
      if (typeof state?.active === "boolean") return state.active;
    }
  } catch {
    /* no content script to ask; fall back to what was stored */
  }
  return typeof stored === "boolean" ? stored : IS_TOUCH;
}

/**
 * Fill this menu in.
 *
 * Every step is allowed to fail on its own. This used to read the settings
 * from the background and destructure the reply — and a reply that never came
 * is `undefined`, so the whole function threw on its first line. The result
 * was this menu showing dashes where the counts belong and both switches
 * sitting off, with nothing to say why: the same picture whether the
 * background was merely asleep or completely broken.
 */
async function refresh(): Promise<void> {
  // Storage first. The switches must work, and show the truth, even when
  // nothing else does — reading them needs no background at all.
  const stored = await storageGet<{ tapMode?: boolean | null; showToggle?: boolean }>([
    "tapMode",
    "showToggle",
  ]).catch(() => ({}) as { tapMode?: boolean | null; showToggle?: boolean });

  tapToggle.checked = await effectiveTapMode(
    typeof stored.tapMode === "boolean" ? stored.tapMode : null,
  );
  showToggleInput.checked = stored.showToggle !== false;
  updateHint();

  const reply = await sendMessage<{
    settings: any;
    tapMode: boolean | null;
    showToggle: boolean;
  }>({ type: "getSettings" }).catch(() => undefined);

  if (!reply) {
    setMessage(
      "Yomeyo's background is not responding, so lookups will not work. Close and reopen this menu; if it keeps happening, remove the extension and install it again.",
      "error",
    );
    statTotal.textContent = "?";
    statWaiting.textContent = "?";
    transferHint.textContent = "";
    return;
  }

  const { settings, tapMode, showToggle } = reply;
  tapToggle.checked = await effectiveTapMode(tapMode);
  showToggleInput.checked = showToggle !== false;
  updateHint();
  appUrlInput.value = settings.appUrl ?? "";
  urlInput.value = settings.url ?? "";
  tokenInput.value = settings.token ?? "";

  const stats = (await sendMessage<{
    total: number;
    waiting: number;
    lastHandoffAt: number | null;
    version: string | null;
  }>({ type: "stats" }).catch(() => undefined)) ?? {
    total: 0,
    waiting: 0,
    lastHandoffAt: null,
    version: null,
  };
  statTotal.textContent = String(stats.total);
  statWaiting.textContent = String(stats.waiting);
  // Words travel on their own. Saying when the last transfer happened is the
  // difference between "this is working" and "nothing seems to happen",
  // which is not otherwise visible.
  transferHint.textContent =
    stats.total === 0
      ? "Tap a Japanese word on any page to save it."
      : stats.waiting === 0
        ? `Everything saved here is in the app${stats.lastHandoffAt ? ` (last added ${describeWhen(stats.lastHandoffAt)})` : ""}.`
        : "Some words have not reached the app yet. They keep trying on their own.";
  if (stats.version) versionLabel.textContent = `Yomeyo ${stats.version}`;
  await refreshAudioPermission();
}

tapToggle.addEventListener("change", () => {
  updateHint();
  void sendMessage({ type: "setTapMode", enabled: tapToggle.checked });
});

showToggleInput.addEventListener("change", () => {
  void sendMessage({ type: "setShowToggle", enabled: showToggleInput.checked });
});

async function saveSettings(): Promise<void> {
  await sendMessage({
    type: "setSettings",
    settings: {
      appUrl: appUrlInput.value.trim(),
      url: urlInput.value.trim(),
      token: tokenInput.value,
    },
  });
}
for (const input of [appUrlInput, urlInput, tokenInput]) {
  input.addEventListener("change", () => void saveSettings());
}

syncBtn.addEventListener("click", async () => {
  await saveSettings();
  setMessage("Syncing…");
  const result = await sendMessage<{ pushed?: number; pulled?: number; error?: string }>({
    type: "sync",
  });
  if (result?.error) {
    setMessage(result.error, "error");
  } else {
    setMessage(`Pushed ${result.pushed}, pulled ${result.pulled}.`, "ok");
    void refresh();
  }
});

// Opening this menu is a moment somebody is wondering about their words:
// flush anything waiting, then show the counts as they now stand.
void sendMessage({ type: "deliverNow" })
  .catch(() => undefined)
  .then(() => refresh());

/**
 * Audio services written for Yomitan and Anki generally refuse web pages, so
 * the app cannot fetch them itself. This extension can, once allowed — and
 * that permission is optional and asked for here, rather than demanded up
 * front, because requiring it would make browsers hold the extension for
 * re-approval on every update.
 */
const AUDIO_ORIGINS = { origins: ["*://*/*"] };

function permissionsApi(): any {
  return (globalThis as any).chrome?.permissions ?? (globalThis as any).browser?.permissions;
}

function hasAudioPermission(): Promise<boolean> {
  const api = permissionsApi();
  if (!api) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const result = api.contains(AUDIO_ORIGINS, resolve);
      if (result && typeof result.then === "function") result.then(resolve, () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

async function refreshAudioPermission(): Promise<void> {
  const api = permissionsApi();
  if (!api) {
    audioHint.textContent = "";
    audioAllowBtn.style.display = "none";
    return;
  }
  if (await hasAudioPermission()) {
    audioHint.textContent = "Audio downloads are allowed.";
    audioAllowBtn.style.display = "none";
  } else {
    audioHint.textContent =
      "Pronunciation audio services usually refuse web pages. Allow this, and the app can fetch them through the extension.";
    audioAllowBtn.style.display = "";
  }
}

audioAllowBtn.addEventListener("click", () => {
  const api = permissionsApi();
  if (!api) return;
  try {
    const result = api.request(AUDIO_ORIGINS, () => void refreshAudioPermission());
    if (result && typeof result.then === "function") result.then(() => void refreshAudioPermission());
  } catch {
    setMessage("This browser would not show the permission prompt.", "error");
  }
});
