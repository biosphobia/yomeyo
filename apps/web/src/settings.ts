import {
  dictionaryLoaded,
  dictionaryMeta,
  dictionarySize,
  getSyncSettings,
  loadDictionary,
  setSyncSettings,
  syncNow,
} from "./store.js";

/** Settings page: sync configuration and dictionary status. */

export async function renderSettings(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const settings = await getSyncSettings();
  if (!isCurrent()) return; // a newer render has taken over

  main.innerHTML = `
    <h1>Settings</h1>
    <p class="subtitle">Sync your deck between this device, the browser extension, and other devices.</p>

    <div class="card-panel">
      <b>Sync</b>
      <label for="sync-url">Sync server URL</label>
      <input type="url" id="sync-url" placeholder="https://your-server.example.com:8787" value="${escapeAttr(settings?.url ?? "")}" />
      <label for="sync-token">Token (the YOMEYO_TOKEN you started the server with)</label>
      <input type="password" id="sync-token" placeholder="shared secret" value="${escapeAttr(settings?.token ?? "")}" />
      <div class="row-actions">
        <button id="sync-save" class="secondary">Save</button>
        <button id="sync-now">Sync now</button>
      </div>
      <div id="sync-msg" class="msg"></div>
    </div>

    <div class="card-panel">
      <b>Dictionary</b>
      <div class="msg" id="dict-status">Not loaded yet — open the Reader to load it.</div>
      <div class="row-actions">
        <button id="dict-load" class="secondary">Download for offline use</button>
      </div>
    </div>

    <div class="card-panel">
      <b>Install on Android</b>
      <div class="msg">
        <b>1. Add to home screen.</b> Chrome menu (⋮) → <i>Add to Home screen</i>.
        Yomeyo then opens like a normal app and works offline.<br/><br/>
        <b>2. Mine words while browsing.</b> Select Japanese text on any page →
        tap <i>Share</i> → choose <b>Yomeyo</b>. The text opens in the Reader with
        every word tappable.<br/><br/>
        Chrome for Android has no extension support, so sharing text is the way
        to mine on the phone. Pasting into the Reader works too.
      </div>
    </div>
  `;

  const urlInput = main.querySelector<HTMLInputElement>("#sync-url")!;
  const tokenInput = main.querySelector<HTMLInputElement>("#sync-token")!;
  const msg = main.querySelector<HTMLDivElement>("#sync-msg")!;

  // --- dictionary status ---
  const dictStatus = main.querySelector<HTMLDivElement>("#dict-status")!;
  const dictLoadBtn = main.querySelector<HTMLButtonElement>("#dict-load")!;

  function showDictStatus(): void {
    if (!dictionaryLoaded()) return;
    const meta = dictionaryMeta();
    const parts = [`${dictionarySize().toLocaleString()} entries loaded and cached offline.`];
    if (meta?.source) parts.push(`Source: ${meta.source}${meta.date ? ` (${meta.date})` : ""}.`);
    dictStatus.textContent = parts.join(" ");
    dictStatus.className = "msg ok";
    dictLoadBtn.textContent = "Loaded";
    dictLoadBtn.disabled = true;
  }

  showDictStatus();
  dictLoadBtn.addEventListener("click", async () => {
    dictLoadBtn.disabled = true;
    dictStatus.textContent = "Downloading dictionary…";
    dictStatus.className = "msg";
    try {
      await loadDictionary();
      showDictStatus();
    } catch (err) {
      dictStatus.textContent = err instanceof Error ? err.message : String(err);
      dictStatus.className = "msg error";
      dictLoadBtn.disabled = false;
    }
  });

  main.querySelector<HTMLButtonElement>("#sync-save")!.addEventListener("click", async () => {
    await setSyncSettings({ url: urlInput.value.trim(), token: tokenInput.value });
    msg.textContent = "Saved.";
    msg.className = "msg ok";
  });

  main.querySelector<HTMLButtonElement>("#sync-now")!.addEventListener("click", async () => {
    msg.textContent = "Syncing…";
    msg.className = "msg";
    try {
      await setSyncSettings({ url: urlInput.value.trim(), token: tokenInput.value });
      const result = await syncNow();
      msg.textContent = `Synced: pushed ${result.pushed}, pulled ${result.pulled}.`;
      msg.className = "msg ok";
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = "msg error";
    }
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
