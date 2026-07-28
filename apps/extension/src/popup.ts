import { activeTab, sendMessage, sendToTab } from "./browser.js";

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
const handoffBtn = $<HTMLButtonElement>("handoff-btn");
const syncBtn = $<HTMLButtonElement>("sync-btn");
const msg = $<HTMLDivElement>("msg");
const statTotal = $<HTMLElement>("stat-total");
const statWaiting = $<HTMLElement>("stat-waiting");
const transferHint = $<HTMLDivElement>("transfer-hint");
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
      ? "Off — nothing happens when you tap words."
      : "Off — hold Alt/Option and click a word instead.";
}

/**
 * What tap mode is actually doing on the page the user is looking at.
 *
 * The content script is the authority — it sees the real page environment,
 * which can differ from this popup's own context — so ask it first and only
 * fall back to a local guess when no content script is listening.
 */
async function effectiveTapMode(stored: boolean | null): Promise<boolean> {
  const tab = await activeTab();
  if (tab?.id !== undefined) {
    const state = await sendToTab<{ active: boolean }>(tab.id, { type: "getTapState" });
    if (typeof state?.active === "boolean") return state.active;
  }
  return typeof stored === "boolean" ? stored : IS_TOUCH;
}

async function refresh(): Promise<void> {
  const { settings, tapMode, showToggle } = await sendMessage<{
    settings: any;
    tapMode: boolean | null;
    showToggle: boolean;
  }>({ type: "getSettings" });
  // null means "follow the device default": on for touch, off for desktop.
  tapToggle.checked = await effectiveTapMode(tapMode);
  showToggleInput.checked = showToggle !== false;
  updateHint();
  appUrlInput.value = settings.appUrl ?? "";
  urlInput.value = settings.url ?? "";
  tokenInput.value = settings.token ?? "";

  const stats = await sendMessage<{
    total: number;
    waiting: number;
    lastHandoffAt: number | null;
    version: string | null;
  }>({ type: "stats" });
  statTotal.textContent = String(stats.total);
  statWaiting.textContent = String(stats.waiting);
  handoffBtn.disabled = stats.total === 0;
  // Words normally travel on their own; this button is the fallback for when
  // the app is not open in a tab (an installed app, or another browser).
  // Saying when the last transfer happened is the difference between "this is
  // working" and "nothing seems to happen", which is not otherwise visible.
  transferHint.textContent =
    stats.waiting === 0 && stats.total > 0
      ? `Everything saved here is in the app${stats.lastHandoffAt ? ` (last sent ${describeWhen(stats.lastHandoffAt)})` : ""}.`
      : stats.total === 0
        ? "Tap a Japanese word on any page to save it."
        : stats.lastHandoffAt
          ? `Waiting for the app. Last sent ${describeWhen(stats.lastHandoffAt)}.`
          : "These go to the app by themselves next time you open it in a tab.";
  if (stats.version) versionLabel.textContent = `Yomeyo ${stats.version}`;
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

handoffBtn.addEventListener("click", async () => {
  handoffBtn.disabled = true;
  setMessage("Opening the app…");
  await saveSettings();
  const result = await sendMessage<{ count?: number; error?: string }>({ type: "handoff" });
  if (result?.error) {
    setMessage(result.error, "error");
    handoffBtn.disabled = false;
  } else {
    setMessage(`Sent ${result.count} word${result.count === 1 ? "" : "s"} to the app.`, "ok");
  }
});

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

void refresh();
