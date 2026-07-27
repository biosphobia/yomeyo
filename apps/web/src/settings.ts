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
import { formatSteps, parseFsrsWeights, parseSteps, type AudioSourceConfig } from "@yomeyo/core";
import { getAudioConfig, saveAudioConfig, testAudioConfig } from "./audio.js";
import { toast } from "./toast.js";
import { getDeckConfig, resetDeckConfig, saveDeckConfig } from "./deck.js";
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
      <b>Scheduling</b>
      <div id="deck-config"></div>
    </div>

    <div class="card-panel">
      <b>Audio</b>
      <div id="audio-config"></div>
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
        extension and tap words directly on the page. Words saved with the
        extension come across on their own whenever Yomeyo is open in a
        browser tab — there is nothing to press. Opened from the home screen
        instead, use <i>Send them now</i> in the extension's toolbar popup.
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
  void renderDeckConfig(main);
  void renderAudioConfig(main);
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
 * Audio sources.
 *
 * The API key is typed in here and stored only in this browser's local
 * database — it is deliberately not part of the deployed app, so the
 * published build carries no credential of anyone's.
 */
async function renderAudioConfig(main: HTMLElement): Promise<void> {
  const box = main.querySelector<HTMLDivElement>("#audio-config");
  if (!box) return;
  const config = await getAudioConfig();

  box.innerHTML = `
    <div class="settings-grid">
      <label for="au-enabled">Use online audio</label>
      <label class="switch-sm"><input type="checkbox" id="au-enabled" ${config.enabled ? "checked" : ""} /></label>
    </div>
    <div class="msg">
      Real recordings (Forvo) are played first, synthesised audio second, and
      your device's Japanese voice if neither is available. Clips are cached
      on the device after the first play, so replays work offline.
    </div>

    <label for="au-key">API key</label>
    <input type="password" id="au-key" placeholder="paste your key" autocomplete="off" value="${escapeAttr(config.apiKey)}" />
    <div class="msg">Kept on this device only — never uploaded with the app or synced.</div>

    <details>
      <summary>Endpoints</summary>
      <label for="au-forvo">Recorded audio (tried first)</label>
      <textarea id="au-forvo" style="min-height:70px;font-family:ui-monospace,monospace;font-size:0.7rem">${escapeHtml(config.forvoUrl)}</textarea>
      <label for="au-tts">Synthesised audio (fallback)</label>
      <textarea id="au-tts" style="min-height:70px;font-family:ui-monospace,monospace;font-size:0.7rem">${escapeHtml(config.ttsUrl)}</textarea>
      <div class="msg">Placeholders: <code>{term}</code> <code>{reading}</code> <code>{language}</code> <code>{apiKey}</code>.</div>
    </details>

    <div class="row-actions">
      <button id="au-save">Save</button>
      <button id="au-test" class="secondary">Test</button>
    </div>
    <div class="msg" id="au-msg"></div>
  `;

  const msg = box.querySelector<HTMLDivElement>("#au-msg")!;
  const read = (): AudioSourceConfig => ({
    enabled: box.querySelector<HTMLInputElement>("#au-enabled")!.checked,
    apiKey: box.querySelector<HTMLInputElement>("#au-key")!.value.trim(),
    forvoUrl: box.querySelector<HTMLTextAreaElement>("#au-forvo")!.value.trim(),
    ttsUrl: box.querySelector<HTMLTextAreaElement>("#au-tts")!.value.trim(),
  });

  box.querySelector<HTMLButtonElement>("#au-save")!.addEventListener("click", async () => {
    await saveAudioConfig(read());
    msg.textContent = "Saved on this device.";
    msg.className = "msg ok";
    toast("Audio settings saved");
  });

  box.querySelector<HTMLButtonElement>("#au-test")!.addEventListener("click", async () => {
    const current = read();
    await saveAudioConfig(current);
    msg.textContent = "Testing…";
    msg.className = "msg";
    try {
      msg.textContent = await testAudioConfig(current);
      msg.className = "msg ok";
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = "msg error";
    }
  });
}

/**
 * Deck options, laid out like Anki's preset screen so the same settings are
 * recognisable: FSRS and its parameters, daily limits, learning steps, and
 * what to do with leeches.
 */
async function renderDeckConfig(main: HTMLElement): Promise<void> {
  const box = main.querySelector<HTMLDivElement>("#deck-config");
  if (!box) return;
  const config = await getDeckConfig();

  box.innerHTML = `
    <div class="settings-grid">
      <label for="cfg-fsrs">FSRS scheduler</label>
      <label class="switch-sm"><input type="checkbox" id="cfg-fsrs" ${config.fsrs ? "checked" : ""} /></label>

      <label for="cfg-retention">Desired retention</label>
      <input type="number" id="cfg-retention" min="70" max="99" step="1" value="${Math.round(config.desiredRetention * 100)}" />

      <label for="cfg-new">New cards/day</label>
      <input type="number" id="cfg-new" min="0" max="9999" value="${config.newPerDay}" />

      <label for="cfg-max">Maximum reviews/day</label>
      <input type="number" id="cfg-max" min="0" max="99999" value="${config.maxReviewsPerDay}" />

      <label for="cfg-learn">Learning steps</label>
      <input type="text" id="cfg-learn" value="${escapeAttr(formatSteps(config.learningStepsSec))}" />

      <label for="cfg-relearn">Relearning steps</label>
      <input type="text" id="cfg-relearn" value="${escapeAttr(formatSteps(config.relearningStepsSec))}" />

      <label for="cfg-leech">Leech threshold</label>
      <input type="number" id="cfg-leech" min="1" max="99" value="${config.leechThreshold}" />

      <label for="cfg-leech-action">Leech action</label>
      <select id="cfg-leech-action">
        <option value="tag" ${config.leechAction === "tag" ? "selected" : ""}>Tag only</option>
        <option value="suspend" ${config.leechAction === "suspend" ? "selected" : ""}>Suspend card</option>
      </select>

      <label for="cfg-order">New card order</label>
      <select id="cfg-order">
        <option value="added" ${config.newCardOrder === "added" ? "selected" : ""}>Order added</option>
        <option value="random" ${config.newCardOrder === "random" ? "selected" : ""}>Random</option>
      </select>
    </div>

    <label for="cfg-weights">FSRS parameters (21 values)</label>
    <textarea id="cfg-weights" style="min-height:96px;font-family:ui-monospace,monospace;font-size:0.75rem">${escapeHtml(
      config.fsrsWeights.join(", "),
    )}</textarea>
    <div class="msg">Paste an optimised set from Anki (Deck options → FSRS → FSRS parameters).</div>

    <div class="row-actions">
      <button id="cfg-save">Save</button>
      <button id="cfg-reset" class="ghost">Reset to defaults</button>
    </div>
    <div class="msg" id="cfg-msg"></div>
  `;

  const msg = box.querySelector<HTMLDivElement>("#cfg-msg")!;
  const value = (id: string) => box.querySelector<HTMLInputElement>(id)!.value.trim();

  box.querySelector<HTMLButtonElement>("#cfg-save")!.addEventListener("click", async () => {
    try {
      const retention = Number(value("#cfg-retention"));
      if (!Number.isFinite(retention) || retention < 70 || retention > 99) {
        throw new Error("Desired retention must be between 70 and 99.");
      }
      await saveDeckConfig({
        ...config,
        fsrs: box.querySelector<HTMLInputElement>("#cfg-fsrs")!.checked,
        desiredRetention: retention / 100,
        fsrsWeights: parseFsrsWeights(box.querySelector<HTMLTextAreaElement>("#cfg-weights")!.value),
        newPerDay: Math.max(0, Number(value("#cfg-new")) || 0),
        maxReviewsPerDay: Math.max(0, Number(value("#cfg-max")) || 0),
        learningStepsSec: parseSteps(value("#cfg-learn")),
        relearningStepsSec: parseSteps(value("#cfg-relearn")),
        leechThreshold: Math.max(1, Number(value("#cfg-leech")) || 1),
        leechAction: box.querySelector<HTMLSelectElement>("#cfg-leech-action")!.value as "tag" | "suspend",
        newCardOrder: box.querySelector<HTMLSelectElement>("#cfg-order")!.value as "added" | "random",
      });
      msg.textContent = "Saved. New intervals use these settings from the next review.";
      msg.className = "msg ok";
      toast("Scheduling settings saved");
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = "msg error";
    }
  });

  box.querySelector<HTMLButtonElement>("#cfg-reset")!.addEventListener("click", async () => {
    await resetDeckConfig();
    void renderDeckConfig(main);
  });
}

/**
 * Extra dictionaries, including monolingual ones.
 *
 * JMdict — the source of the built-in dictionary — has no Japanese glosses,
 * so a Japanese-Japanese dictionary has to come from the user; the popular
 * ones are copyrighted and cannot be bundled. Yomitan's term-bank format is
 * what they are distributed in, so that is what this reads.
 */
/** A message to show once the list has been rebuilt, since rebuilding it
 * replaces the element the message would otherwise have been written into. */
interface DictStatus {
  text: string;
  kind: "ok" | "error";
}

async function renderExtraDictionaries(main: HTMLElement, status?: DictStatus): Promise<void> {
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
  if (status) {
    msg.textContent = status.text;
    msg.className = `msg ${status.kind}`;
  }
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
      // The message has to survive the re-render below, which replaces the
      // element it is written into.
      void renderExtraDictionaries(main, {
        text: `Added ${record.name} with ${record.entryCount.toLocaleString()} entries.`,
        kind: "ok",
      });
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
    toast("Sync server settings saved");
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
