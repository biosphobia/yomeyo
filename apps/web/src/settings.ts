import {
  configIsFromEnv,
  currentAccount,
  getFirebaseConfig,
  setFirebaseConfig,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  validateConfig,
  type AccountInfo,
} from "./cloud.js";
import {
  importDictionary,
  listDictionaries,
  removeDictionary,
  setDictionaryEnabled,
} from "./dictionaries.js";
import {
  dictionaryLoaded,
  dictionaryMeta,
  dictionarySize,
  getSyncSettings,
  loadDictionary,
  setSyncSettings,
  syncNow,
} from "./store.js";

/** Settings page: account + cloud sync, dictionary status, install help. */

export async function renderSettings(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const settings = await getSyncSettings();
  const config = await getFirebaseConfig();
  let account: AccountInfo | null = null;
  let accountError = "";
  if (config) {
    try {
      account = await currentAccount();
    } catch (err) {
      accountError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!isCurrent()) return; // a newer render has taken over

  main.innerHTML = `
    <h1>Settings</h1>
    <p class="subtitle">Your deck lives on this device. Sign in to keep it backed up and in step across devices.</p>

    <div class="card-panel">
      <b>Account</b>
      <div id="account-body"></div>
    </div>

    <div class="card-panel">
      <b>Dictionary</b>
      <div class="msg" id="dict-status">Not loaded yet — open the Reader to load it.</div>
      <div class="row-actions">
        <button id="dict-load" class="secondary">Download for offline use</button>
      </div>
      <div id="extra-dicts" style="margin-top:14px"></div>
    </div>

    <div class="card-panel">
      <b>Install on Android</b>
      <div class="msg">
        <b>1. Add to home screen.</b> Chrome menu (⋮) → <i>Add to Home screen</i>.
        Yomeyo then opens like a normal app and works offline.<br/><br/>
        <b>2. Mine words while browsing.</b> Select Japanese text on any page →
        tap <i>Share</i> → choose <b>Yomeyo</b>, or install the browser
        extension and tap words directly on the page.
      </div>
    </div>

    <details class="card-panel">
      <summary>Self-hosted sync server (alternative to Firebase)</summary>
      <label for="sync-url">Sync server URL</label>
      <input type="url" id="sync-url" placeholder="https://your-server:8787" value="${escapeAttr(settings?.url ?? "")}" />
      <label for="sync-token">Token</label>
      <input type="password" id="sync-token" placeholder="shared secret" value="${escapeAttr(settings?.token ?? "")}" />
      <div class="row-actions">
        <button id="sync-save" class="secondary">Save</button>
      </div>
      <div class="msg">Only used when no Firebase project is configured above.</div>
    </details>
  `;

  renderAccount();
  wireDictionary(main);
  void renderExtraDictionaries(main);
  wireServerSync(main);

  // ---------------- account panel ----------------

  function renderAccount(): void {
    const body = main.querySelector<HTMLDivElement>("#account-body")!;

    if (!config) {
      body.innerHTML = `
        <div class="msg">
          Cloud sync is off. Paste your Firebase project's web config below to
          turn on accounts and backup. Everything works without it — this only
          adds syncing between devices.
        </div>
        <label for="fb-config">Firebase config (JSON)</label>
        <textarea id="fb-config" style="min-height:120px;font-family:ui-monospace,monospace;font-size:0.8rem"
          placeholder='{ "apiKey": "…", "authDomain": "…", "projectId": "…", "appId": "…" }'></textarea>
        <div class="row-actions"><button id="fb-save">Enable cloud sync</button></div>
        <div class="msg" id="fb-msg"></div>
      `;
      body.querySelector<HTMLButtonElement>("#fb-save")!.addEventListener("click", async () => {
        const msg = body.querySelector<HTMLDivElement>("#fb-msg")!;
        const raw = body.querySelector<HTMLTextAreaElement>("#fb-config")!.value.trim();
        try {
          await setFirebaseConfig(validateConfig(JSON.parse(raw)));
          void renderSettings(main);
        } catch (err) {
          msg.textContent = err instanceof Error ? err.message : "That isn't valid JSON.";
          msg.className = "msg error";
        }
      });
      return;
    }

    if (!account) {
      body.innerHTML = `
        <div class="msg">Project <b>${escapeHtml(config.projectId)}</b>. Sign in to sync this deck.</div>
        <div class="row-actions"><button id="google-btn">Sign in with Google</button></div>
        <label for="email">or use an email address</label>
        <input type="text" id="email" placeholder="you@example.com" autocomplete="username" />
        <label for="password">Password (a new account is created if you don't have one)</label>
        <input type="password" id="password" placeholder="at least 6 characters" autocomplete="current-password" />
        <div class="row-actions">
          <button id="email-btn" class="secondary">Continue with email</button>
          ${configIsFromEnv() ? "" : `<button id="fb-forget" class="ghost">Use a different project</button>`}
        </div>
        <div class="msg error">${escapeHtml(accountError)}</div>
        <div class="msg" id="auth-msg"></div>
      `;

      const msg = body.querySelector<HTMLDivElement>("#auth-msg")!;
      const fail = (err: unknown) => {
        msg.textContent = err instanceof Error ? err.message : String(err);
        msg.className = "msg error";
      };

      body.querySelector<HTMLButtonElement>("#google-btn")!.addEventListener("click", async () => {
        msg.textContent = "Opening Google sign-in…";
        msg.className = "msg";
        try {
          await signInWithGoogle();
          void renderSettings(main);
        } catch (err) {
          fail(err);
        }
      });

      body.querySelector<HTMLButtonElement>("#email-btn")!.addEventListener("click", async () => {
        const email = body.querySelector<HTMLInputElement>("#email")!.value.trim();
        const password = body.querySelector<HTMLInputElement>("#password")!.value;
        if (!email || !password) {
          fail(new Error("Enter an email address and password."));
          return;
        }
        msg.textContent = "Signing in…";
        msg.className = "msg";
        try {
          await signInWithEmail(email, password);
          void renderSettings(main);
        } catch (err) {
          fail(err);
        }
      });

      body.querySelector<HTMLButtonElement>("#fb-forget")?.addEventListener("click", async () => {
        await setFirebaseConfig(undefined);
        void renderSettings(main);
      });
      return;
    }

    body.innerHTML = `
      <div class="msg ok">Signed in as <b>${escapeHtml(account.displayName || account.email || account.uid)}</b>
      (project ${escapeHtml(config.projectId)}).</div>
      <div class="row-actions">
        <button id="cloud-sync">Sync now</button>
        <button id="cloud-out" class="secondary">Sign out</button>
      </div>
      <div class="msg" id="cloud-msg"></div>
    `;

    const msg = body.querySelector<HTMLDivElement>("#cloud-msg")!;
    body.querySelector<HTMLButtonElement>("#cloud-sync")!.addEventListener("click", async () => {
      msg.textContent = "Syncing…";
      msg.className = "msg";
      try {
        const result = await syncNow();
        msg.textContent = `Synced: sent ${result.pushed}, received ${result.pulled}.`;
        msg.className = "msg ok";
      } catch (err) {
        msg.textContent = err instanceof Error ? err.message : String(err);
        msg.className = "msg error";
      }
    });
    body.querySelector<HTMLButtonElement>("#cloud-out")!.addEventListener("click", async () => {
      await signOut();
      void renderSettings(main);
    });
  }
}

/**
 * Extra dictionaries, including monolingual ones.
 *
 * JMdict — the source of the built-in dictionary — has no Japanese glosses,
 * so a Japanese-Japanese dictionary has to come from the user; the popular
 * ones are copyrighted and cannot be bundled. Yomitan's term-bank format is
 * what they are distributed in, so that is what this reads.
 */
async function renderExtraDictionaries(main: HTMLElement): Promise<void> {
  const box = main.querySelector<HTMLDivElement>("#extra-dicts");
  if (!box) return;
  const list = await listDictionaries();

  box.innerHTML = `
    <b style="font-size:0.85rem">Additional dictionaries</b>
    <div id="dict-list"></div>
    <div class="msg">
      Add a Japanese-Japanese or other bilingual dictionary. Unzip a
      Yomitan/Yomichan dictionary and select its <code>term_bank_*.json</code>
      files. Definitions are labelled with the dictionary they came from.
    </div>
    <label for="dict-name">Name</label>
    <input type="text" id="dict-name" placeholder="e.g. 三省堂国語辞典" />
    <div class="row-actions">
      <button id="dict-pick" class="secondary">Choose files…</button>
      <input type="file" id="dict-files" accept="application/json,.json" multiple style="display:none" />
    </div>
    <div class="msg" id="dict-import-msg"></div>
  `;

  const rows = box.querySelector<HTMLDivElement>("#dict-list")!;
  if (list.length === 0) {
    rows.innerHTML = `<div class="msg">Only the built-in JMdict (English) is in use.</div>`;
  }
  for (const record of list) {
    const row = document.createElement("div");
    row.className = "word-row";
    row.innerHTML = `
      <div class="word">
        <div><b>${escapeHtml(record.name)}</b></div>
        <div class="glosses">${record.entryCount.toLocaleString()} entries</div>
      </div>
      <label class="switch-sm"><input type="checkbox" ${record.enabled ? "checked" : ""} /></label>
      <button class="ghost" title="Remove">✕</button>
    `;
    row.querySelector<HTMLInputElement>("input")!.addEventListener("change", async (ev) => {
      await setDictionaryEnabled(record.id, (ev.target as HTMLInputElement).checked);
    });
    row.querySelector<HTMLButtonElement>("button")!.addEventListener("click", async () => {
      await removeDictionary(record.id);
      void renderExtraDictionaries(main);
    });
    rows.appendChild(row);
  }

  const fileInput = box.querySelector<HTMLInputElement>("#dict-files")!;
  const msg = box.querySelector<HTMLDivElement>("#dict-import-msg")!;
  box.querySelector<HTMLButtonElement>("#dict-pick")!.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files ?? [])];
    if (files.length === 0) return;
    const name =
      box.querySelector<HTMLInputElement>("#dict-name")!.value.trim() ||
      files[0].name.replace(/\.json$/i, "");
    msg.textContent = `Importing ${files.length} file${files.length === 1 ? "" : "s"}…`;
    msg.className = "msg";
    try {
      const record = await importDictionary(name, files);
      msg.textContent = `Added ${record.name} with ${record.entryCount.toLocaleString()} entries.`;
      msg.className = "msg ok";
      void renderExtraDictionaries(main);
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = "msg error";
    } finally {
      fileInput.value = "";
    }
  });
}

function wireDictionary(main: HTMLElement): void {
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
}

function wireServerSync(main: HTMLElement): void {
  const urlInput = main.querySelector<HTMLInputElement>("#sync-url")!;
  const tokenInput = main.querySelector<HTMLInputElement>("#sync-token")!;
  main.querySelector<HTMLButtonElement>("#sync-save")!.addEventListener("click", async () => {
    await setSyncSettings({ url: urlInput.value.trim(), token: tokenInput.value });
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
