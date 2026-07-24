import { dictionarySize, getSyncSettings, setSyncSettings, syncNow } from "./store.js";

/** Settings page: sync configuration and dictionary status. */

export async function renderSettings(main: HTMLElement): Promise<void> {
  const settings = await getSyncSettings();

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
      <div class="msg">${dictionarySize().toLocaleString()} entries loaded.
      The bundled seed dictionary covers common words for trying things out —
      build the full JMdict dictionary with <code>npm run build-dict</code>
      and redeploy to look up everything.</div>
    </div>

    <div class="card-panel">
      <b>Mining on your phone</b>
      <div class="msg">
        <b>Android (Chrome):</b> select Japanese text on any page → Share → Yomeyo
        (install this app to your home screen first), or paste into the Reader.<br/><br/>
        <b>iOS (Safari):</b> use the Yomeyo Safari extension for tap-to-lookup on any
        page, or share/paste text into the Reader here.
      </div>
    </div>
  `;

  const urlInput = main.querySelector<HTMLInputElement>("#sync-url")!;
  const tokenInput = main.querySelector<HTMLInputElement>("#sync-token")!;
  const msg = main.querySelector<HTMLDivElement>("#sync-msg")!;

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
