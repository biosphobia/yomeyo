/** Toolbar popup: tap-mode toggle, deck stats, sync controls. */

declare const chrome: any;

function sendMessage(message: unknown): Promise<any> {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

const tapToggle = document.getElementById("tap-mode") as HTMLInputElement;
const urlInput = document.getElementById("sync-url") as HTMLInputElement;
const tokenInput = document.getElementById("sync-token") as HTMLInputElement;
const syncBtn = document.getElementById("sync-btn") as HTMLButtonElement;
const msg = document.getElementById("msg") as HTMLDivElement;
const statTotal = document.getElementById("stat-total") as HTMLElement;
const statDirty = document.getElementById("stat-dirty") as HTMLElement;

async function refresh(): Promise<void> {
  const { settings, tapMode } = await sendMessage({ type: "getSettings" });
  tapToggle.checked = tapMode;
  urlInput.value = settings.url ?? "";
  tokenInput.value = settings.token ?? "";
  const stats = await sendMessage({ type: "stats" });
  statTotal.textContent = String(stats.total);
  statDirty.textContent = String(stats.dirty);
}

tapToggle.addEventListener("change", () => {
  void sendMessage({ type: "setTapMode", enabled: tapToggle.checked });
});

async function saveSettings(): Promise<void> {
  await sendMessage({
    type: "setSettings",
    settings: { url: urlInput.value.trim(), token: tokenInput.value },
  });
}
urlInput.addEventListener("change", () => void saveSettings());
tokenInput.addEventListener("change", () => void saveSettings());

syncBtn.addEventListener("click", async () => {
  await saveSettings();
  msg.textContent = "Syncing…";
  msg.className = "msg";
  const result = await sendMessage({ type: "sync" });
  if (result?.error) {
    msg.textContent = result.error;
    msg.className = "msg error";
  } else {
    msg.textContent = `Pushed ${result.pushed}, pulled ${result.pulled}.`;
    msg.className = "msg ok";
    void refresh();
  }
});

void refresh();
