import {
  configIsFromEnv,
  currentAccount,
  envConfigProblem,
  getFirebaseConfig,
  parseFirebaseConfig,
  setFirebaseConfig,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  type AccountInfo,
} from "./cloud.js";
import { signedOutDeckAdoptable } from "./accounts.js";
import type { AnkiSource } from "./anki-import.js";
import {
  deckNameFromFile,
  formatSteps,
  parseFsrsWeights,
  parseSteps,
  type FieldMapping,
} from "@yomeyo/core";
import { getAdvancedMode, setAdvancedMode } from "./prefs.js";
import { changeUsername, ensureProfile, setProfilePhoto } from "./profile.js";
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
  const advanced = await getAdvancedMode();
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
  const adoptable = !account && (await signedOutDeckAdoptable());
  if (!isCurrent()) return; // a newer render has taken over

  main.innerHTML = `
    <h1>Settings</h1>

    <div class="card-panel">
      <b>Account</b>
      <div id="account-body"></div>
    </div>

    <div class="card-panel">
      <b>Scheduling</b>
      <div id="deck-config"></div>
    </div>

    <div class="card-panel">
      <b>Import from Anki</b>
      <div id="anki-import"></div>
    </div>

    <div class="card-panel">
      <b>Dictionary</b>
      <div class="msg" id="dict-status">Not loaded yet — open the Reader to load it.</div>
      <div class="row-actions">
        <button id="dict-load" class="secondary">Download for offline use</button>
      </div>
      ${advanced ? `<div id="extra-dicts" style="margin-top:14px"></div>` : ""}
    </div>

    <div class="card-panel">
      <b>Install on Android</b>
      <div class="msg">
        Chrome menu (⋮) → <i>Add to Home screen</i>: Yomeyo then opens like an
        app and works offline. To save words while browsing, select text and
        share it to Yomeyo — or install the browser extension and tap words
        right on the page.
      </div>
    </div>

    ${
      advanced
        ? `<details class="card-panel">
             <summary>Self-hosted sync server (alternative to Firebase)</summary>
             <label for="sync-url">Sync server URL</label>
             <input type="url" id="sync-url" placeholder="https://your-server:8787" value="${escapeAttr(settings?.url ?? "")}" />
             <label for="sync-token">Token</label>
             <input type="password" id="sync-token" placeholder="shared secret" value="${escapeAttr(settings?.token ?? "")}" />
             <div class="row-actions">
               <button id="sync-save" class="secondary">Save</button>
             </div>
           </details>`
        : ""
    }

    <div class="card-panel">
      <div class="settings-grid">
        <label for="adv-mode">Advanced settings</label>
        <label class="switch-sm"><input type="checkbox" id="adv-mode" ${advanced ? "checked" : ""} /></label>
      </div>
      <div class="msg">FSRS tuning, extra dictionaries, field mapping, cloud sync setup and more.</div>
    </div>
  `;

  main.querySelector<HTMLInputElement>("#adv-mode")!.addEventListener("change", async (ev) => {
    await setAdvancedMode((ev.target as HTMLInputElement).checked);
    void renderSettings(main);
  });

  void renderAccount();
  void renderDeckConfig(main, advanced);
  renderAnkiImport(main, account, advanced);
  wireDictionary(main);
  if (advanced) {
    void renderExtraDictionaries(main);
    wireServerSync(main);
  }

  // ---------------- account panel ----------------

  async function renderAccount(): Promise<void> {
    const body = main.querySelector<HTMLDivElement>("#account-body")!;

    if (!config) {
      // A deployment that *tried* to bake a config in deserves to hear what
      // went wrong — swallowed, a broken secret is indistinguishable from a
      // missing one, in the one place its owner would look.
      const bakedProblem = envConfigProblem();
      const bakedNote = bakedProblem
        ? `<div class="msg error">
             This build carries a <code>FIREBASE_CONFIG</code> repository secret, but it
             could not be used: ${escapeHtml(bakedProblem)} Fix the secret's value
             (what the Firebase console shows is accepted as-is) and redeploy.
           </div>`
        : "";
      // Setting up a Firebase project is real work; without Advanced mode
      // the panel only says the feature exists and where the door is.
      if (!advanced) {
        body.innerHTML = `
          ${bakedNote}
          <div class="msg">
            Yomeyo works fully on this device without an account. Signing in —
            which backs your deck up and syncs it between devices — needs a
            one-off setup: switch on <b>Advanced settings</b> below to do it.
          </div>
        `;
        return;
      }
      body.innerHTML = `
        ${bakedNote}
        <div class="msg">
          Sync needs a free Firebase project of your own — Yomeyo has no
          server, so your data can only live in a project you control.
        </div>
        <details>
          <summary>How to get the config (about two minutes)</summary>
          <div class="msg">
            1. Create a project at <b>console.firebase.google.com</b>.<br/>
            2. <b>Build → Firestore Database → Create database</b>.<br/>
            3. <b>Authentication → Sign-in method</b>, and switch on
               <b>Google</b> (and Email/Password if you want that too).<br/>
            4. <b>Authentication → Settings → Authorized domains</b>: add
               <b>${escapeHtml(location.hostname)}</b>.<br/>
            5. <b>Project settings → Your apps → Web</b>: register an app and
               copy the <code>firebaseConfig</code> object below.
          </div>
        </details>
        <label for="fb-config">Firebase config (pasted straight from the console is fine)</label>
        <textarea id="fb-config" style="min-height:120px;font-family:ui-monospace,monospace;font-size:0.8rem"
          placeholder='{ "apiKey": "…", "authDomain": "…", "projectId": "…", "appId": "…" }'></textarea>
        <div class="row-actions"><button id="fb-save">Enable cloud sync</button></div>
        <div class="msg" id="fb-msg"></div>
      `;
      body.querySelector<HTMLButtonElement>("#fb-save")!.addEventListener("click", async () => {
        const msg = body.querySelector<HTMLDivElement>("#fb-msg")!;
        const raw = body.querySelector<HTMLTextAreaElement>("#fb-config")!.value.trim();
        try {
          // Accepts what the Firebase console shows, pasted as-is.
          await setFirebaseConfig(parseFirebaseConfig(raw));
          void renderSettings(main);
        } catch (err) {
          msg.textContent = err instanceof Error ? err.message : "That doesn't look like a Firebase config.";
          msg.className = "msg error";
        }
      });
      return;
    }

    if (!account) {
      body.innerHTML = `
        <div class="msg">Sign in to back up your deck and keep it in step across devices.${
          adoptable ? " The words already saved here come with you." : ""
        }</div>
        <div class="row-actions"><button id="google-btn">Sign in with Google</button></div>
        <details>
          <summary>or use an email address</summary>
          <label for="email">Email</label>
          <input type="text" id="email" placeholder="you@example.com" autocomplete="username" />
          <label for="password">Password (a new account is created if you don't have one)</label>
          <input type="password" id="password" placeholder="at least 6 characters" autocomplete="current-password" />
          <div class="row-actions">
            <button id="email-btn" class="secondary">Continue with email</button>
            ${configIsFromEnv() ? "" : `<button id="fb-forget" class="ghost">Use a different project</button>`}
          </div>
        </details>
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

    // The profile, not the account's real name: what Google knows the
    // person as is theirs, and nothing here ever displays it. A brand-new
    // account is given a unique username right here, before choosing one.
    const profile = await ensureProfile().catch(() => null);
    body.innerHTML = `
      <div class="profile-row">
        ${avatarHtml(profile)}
        <div class="msg ok" style="margin:0">Signed in${
          profile ? ` as <b>@${escapeHtml(profile.name)}</b>` : ""
        }.</div>
      </div>
      ${
        profile
          ? `
      <label for="prof-name">Username</label>
      <input type="text" id="prof-name" value="${escapeAttr(profile.name)}" maxlength="20"
        autocapitalize="none" autocorrect="off" spellcheck="false" />
      <div class="msg">
        Yours alone — no two accounts can share one. It is what everyone sees;
        your real name never is.
      </div>
      <div class="row-actions">
        <button id="prof-save" class="secondary">Change username</button>
        <button id="prof-photo-pick" class="secondary">Profile picture…</button>
        <input type="file" id="prof-photo" accept="image/*" style="display:none" />
      </div>`
          : `<div class="msg">Your profile could not be loaded — check the connection and reopen Settings.</div>`
      }
      <div class="row-actions">
        <button id="cloud-sync">Sync now</button>
        <button id="cloud-out" class="secondary">Sign out</button>
      </div>
      <div class="msg" id="cloud-msg"></div>
    `;

    const msg = body.querySelector<HTMLDivElement>("#cloud-msg")!;

    body.querySelector<HTMLButtonElement>("#prof-save")?.addEventListener("click", async () => {
      try {
        await changeUsername(body.querySelector<HTMLInputElement>("#prof-name")!.value);
        toast("Username changed");
        void renderSettings(main);
      } catch (err) {
        msg.textContent = err instanceof Error ? err.message : String(err);
        msg.className = "msg error";
      }
    });

    const photoInput = body.querySelector<HTMLInputElement>("#prof-photo");
    body.querySelector<HTMLButtonElement>("#prof-photo-pick")?.addEventListener("click", () => photoInput?.click());
    photoInput?.addEventListener("change", async () => {
      const file = photoInput.files?.[0];
      photoInput.value = "";
      if (!file) return;
      try {
        await setProfilePhoto(file);
        toast("Profile picture updated");
        void renderSettings(main);
      } catch (err) {
        msg.textContent = err instanceof Error ? err.message : String(err);
        msg.className = "msg error";
      }
    });
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

/** The avatar, or a lettered placeholder when no picture is set. */
function avatarHtml(profile: { name: string; photo?: string } | null): string {
  if (profile?.photo && /^data:image\//.test(profile.photo)) {
    return `<img class="avatar" src="${escapeAttr(profile.photo)}" alt="" />`;
  }
  const letter = (profile?.name ?? "?").slice(0, 1).toUpperCase();
  return `<div class="avatar avatar-letter">${escapeHtml(letter)}</div>`;
}

/**
 * Importing a deck from Anki.
 *
 * Anyone coming here from Anki has years of reviews behind them, so this
 * reads the scheduling as well as the words: a card on a four-month interval
 * arrives on a four-month interval.
 *
 * Which field is the word and which the meaning is guessed and shown as a
 * preview of the first few cards, so a wrong guess is obvious before anything
 * is added. The mapping controls themselves appear only in Advanced mode —
 * the guess lands right for the common decks — or when the guess found
 * nothing, in which case they are the only way forward.
 */
function renderAnkiImport(main: HTMLElement, account: AccountInfo | null, advanced: boolean): void {
  const box = main.querySelector<HTMLDivElement>("#anki-import");
  if (!box) return;

  let source: AnkiSource | null = null;
  let keepScheduling = true;
  let deckName = "";
  let share = true;

  // The reader carries a ZIP inflater and a SQLite parser. Almost nobody
  // opens this panel on any given visit, and sync.html — loaded in the
  // background every time a word is saved — would otherwise share the cost.
  let anki: typeof import("./anki-import.js") | null = null;

  function drawChooser(message = "", kind: "" | "ok" | "error" = ""): void {
    box!.innerHTML = `
      <div class="msg">
        In Anki: <b>File → Export</b>, keep the <code>.apkg</code> format, and
        your words, review history, pictures and audio all come across.
        Importing the same file again is harmless.
      </div>
      <div class="row-actions">
        <button id="anki-pick" class="secondary">Choose an Anki file…</button>
        <input type="file" id="anki-file" accept=".apkg,.colpkg,.txt,.tsv,.csv" style="display:none" />
      </div>
      <div class="msg ${kind}" id="anki-msg">${escapeHtml(message)}</div>
    `;
    const input = box!.querySelector<HTMLInputElement>("#anki-file")!;
    const msg = box!.querySelector<HTMLDivElement>("#anki-msg")!;
    box!.querySelector<HTMLButtonElement>("#anki-pick")!.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      msg.textContent = `Reading ${file.name}…`;
      msg.className = "msg";
      try {
        anki ??= await import("./anki-import.js");
        source = await anki.readAnkiFile(file);
        keepScheduling = source.hasScheduling;
        deckName = deckNameFromFile(file.name);
        drawMapping();
      } catch (err) {
        msg.textContent = err instanceof Error ? err.message : String(err);
        msg.className = "msg error";
      }
    });
  }

  function drawMapping(): void {
    if (!source) return drawChooser();
    const roles: [keyof FieldMapping, string][] = [
      ["term", "Word"],
      ["reading", "Reading"],
      ["meaning", "Meaning"],
      ["sentence", "Sentence"],
      ["sentenceMeaning", "Sentence meaning"],
      ["notes", "Notes"],
    ];

    const total = source.groups.reduce((sum, g) => sum + (g.include ? g.notes.length : 0), 0);
    box!.innerHTML = `
      <div class="msg ok">
        <b>${escapeHtml(source.fileName)}</b> — ${total.toLocaleString()} note${total === 1 ? "" : "s"}
        across ${source.groups.length} note type${source.groups.length === 1 ? "" : "s"}.
      </div>
      <label for="anki-name">Deck name</label>
      <input type="text" id="anki-name" value="${escapeAttr(deckName)}" placeholder="Core 2k" />
      ${
        source.hasScheduling
          ? `<div class="settings-grid">
               <label for="anki-sched">Keep review history</label>
               <label class="switch-sm"><input type="checkbox" id="anki-sched" ${keepScheduling ? "checked" : ""} /></label>
             </div>
             <div class="msg">Nothing you have learned starts again from zero.</div>`
          : `<div class="msg">This export has no review history, so every word starts as new. Export as <code>.apkg</code> to keep your scheduling.</div>`
      }
      <div class="settings-grid">
        <label for="anki-share">Share with everyone</label>
        <label class="switch-sm"><input type="checkbox" id="anki-share" ${share ? "checked" : ""} /></label>
      </div>
      <div class="msg" id="anki-share-note"></div>
      <div id="anki-groups"></div>
      <div class="row-actions">
        <button id="anki-go">Import</button>
        <button id="anki-cancel" class="ghost">Choose another file</button>
      </div>
      <div class="msg" id="anki-msg"></div>
    `;

    const groups = box!.querySelector<HTMLDivElement>("#anki-groups")!;
    for (const group of source.groups) {
      const block = document.createElement("details");
      block.className = "card-panel";
      block.style.marginTop = "10px";
      block.open = source.groups.length === 1;
      const options = (selected: number) =>
        [`<option value="-1" ${selected < 0 ? "selected" : ""}>— none —</option>`]
          .concat(
            group.fieldNames.map(
              (name, i) =>
                `<option value="${i}" ${selected === i ? "selected" : ""}>${escapeHtml(name || `Field ${i + 1}`)}</option>`,
            ),
          )
          .join("");

      // The guessed mapping is usually right, so the selects are Advanced-mode
      // furniture — except when the guess produced nothing, where showing them
      // is the only way the import can still happen.
      const needsMapping = anki!.cardsFor(source!, group, keepScheduling).length === 0;
      block.innerHTML = `
        <summary>
          <label class="switch-sm" style="display:inline-flex;vertical-align:middle;margin-right:8px">
            <input type="checkbox" class="anki-include" ${group.include ? "checked" : ""} />
          </label>
          ${escapeHtml(group.name)} — ${group.notes.length.toLocaleString()} notes
        </summary>
        ${
          advanced || needsMapping
            ? `<div class="settings-grid">
                 ${roles
                   .map(
                     ([role, label]) =>
                       `<label for="anki-${group.key}-${role}">${label}</label>
                        <select id="anki-${group.key}-${role}" data-role="${role}">${options(group.mapping[role])}</select>`,
                   )
                   .join("")}
               </div>
               <div class="msg">Audio and pictures need no mapping — they are found in whichever fields they live.</div>`
            : ""
        }
        <div class="msg">Preview</div>
        <div class="preview"></div>
      `;

      const preview = block.querySelector<HTMLDivElement>(".preview")!;
      const drawPreview = () => {
        const cards = anki!.cardsFor(source!, group, keepScheduling).slice(0, 3);
        preview.innerHTML =
          cards.length === 0
            ? `<div class="msg error">Nothing would be imported — check which field holds the word.</div>`
            : cards
                .map(
                  (card) => `
                    <div class="word-row">
                      <div class="word">
                        <div><b>${escapeHtml(card.term)}</b>${card.reading ? ` <span class="glosses">${escapeHtml(card.reading)}</span>` : ""}${
                          card.audio || card.sentenceAudio ? ` <span title="Has audio">🔊</span>` : ""
                        }${card.image ? ` <span title="Has a picture">🖼️</span>` : ""}</div>
                        <div class="glosses">${escapeHtml(card.glosses.join("; ")) || "(no meaning)"}</div>
                        ${card.sentence ? `<div class="glosses">${escapeHtml(card.sentence)}</div>` : ""}
                        ${card.sentenceMeaning ? `<div class="glosses">${escapeHtml(card.sentenceMeaning)}</div>` : ""}
                        ${card.notes ? `<div class="glosses">📝 ${escapeHtml(card.notes.split("\n")[0])}</div>` : ""}
                      </div>
                      <div class="due">${escapeHtml(card.state)}${card.state === "review" ? ` ${card.intervalDays}d` : ""}</div>
                    </div>`,
                )
                .join("");
      };

      block.querySelector<HTMLInputElement>(".anki-include")!.addEventListener("change", (ev) => {
        group.include = (ev.target as HTMLInputElement).checked;
      });
      for (const select of block.querySelectorAll<HTMLSelectElement>("select")) {
        select.addEventListener("change", () => {
          group.mapping[select.dataset.role as keyof FieldMapping] = Number(select.value);
          drawPreview();
        });
      }

      groups.appendChild(block);
      drawPreview();
    }

    box!.querySelector<HTMLInputElement>("#anki-sched")?.addEventListener("change", (ev) => {
      keepScheduling = (ev.target as HTMLInputElement).checked;
      drawMapping();
    });
    box!.querySelector<HTMLButtonElement>("#anki-cancel")!.addEventListener("click", () => {
      source = null;
      drawChooser();
    });

    const nameField = box!.querySelector<HTMLInputElement>("#anki-name")!;
    nameField.addEventListener("input", () => {
      deckName = nameField.value;
    });

    const shareBox = box!.querySelector<HTMLInputElement>("#anki-share")!;
    const shareNote = box!.querySelector<HTMLDivElement>("#anki-share-note")!;
    const drawShareNote = (): void => {
      if (!account) {
        shareNote.className = "msg";
        shareNote.innerHTML = "Sharing needs an account — sign in above. Without one the deck is yours alone.";
        return;
      }
      shareNote.className = "msg";
      shareNote.innerHTML = share
        ? `The deck's <b>words</b> are listed for everyone under <b>Decks → Premade</b> —
           not your review history, mined words, pictures or audio. You can withdraw it
           later. <b>Don't share a private collection.</b>`
        : "The deck is imported for you alone.";
    };
    shareBox.disabled = !account;
    if (!account) share = false;
    shareBox.checked = share;
    shareBox.addEventListener("change", () => {
      share = shareBox.checked;
      drawShareNote();
    });
    drawShareNote();

    const msg = box!.querySelector<HTMLDivElement>("#anki-msg")!;
    const go = box!.querySelector<HTMLButtonElement>("#anki-go")!;
    go.addEventListener("click", async () => {
      if (!source) return;
      go.disabled = true;
      msg.textContent = "Importing…";
      msg.className = "msg";
      try {
        const name = deckName.trim() || "Imported deck";
        const result = await anki!.importAnki(source, keepScheduling, name);
        const parts = [`Added ${result.added.toLocaleString()} of ${result.total.toLocaleString()} words`];
        if (result.added < result.total) parts.push("the rest were already in your deck");
        if (result.withScheduling > 0) {
          parts.push(`${result.withScheduling.toLocaleString()} kept their review history`);
        }
        if (result.suspended > 0) {
          parts.push(`${result.suspended.toLocaleString()} were suspended in Anki and are marked as leeches`);
        }
        if (result.mediaCount > 0) {
          parts.push(
            `${result.mediaCount.toLocaleString()} audio clip${result.mediaCount === 1 ? "" : "s"} and picture${
              result.mediaCount === 1 ? "" : "s"
            } came across`,
          );
        }
        if (result.mediaMissing > 0) {
          parts.push(
            `${result.mediaMissing.toLocaleString()} media file${
              result.mediaMissing === 1 ? "" : "s"
            } could not be read from this export and were left out`,
          );
        }
        if (result.implausible > 0) {
          parts.push(`${result.implausible.toLocaleString()} had a due date far in the future and may need rescheduling`);
        }

        // Publishing after the words are safely in the local deck: if the
        // library is unreachable the import still stands, and the deck can be
        // shared later from the Decks screen.
        if (share && account) {
          msg.textContent = "Sharing…";
          try {
            await anki!.shareDeck(account, result.deckId, name, source.fileName);
            parts.push("and it is now in the shared library");
          } catch (err) {
            parts.push(
              `but sharing failed (${err instanceof Error ? err.message : String(err)}) — the words are still yours`,
            );
          }
        }

        source = null;
        drawChooser(`${parts.join("; ")}.`, "ok");
        toast(`Imported ${result.added.toLocaleString()} words from Anki`);
      } catch (err) {
        msg.textContent = err instanceof Error ? err.message : String(err);
        msg.className = "msg error";
        go.disabled = false;
      }
    });
  }

  drawChooser();
}

/**
 * Deck options. What everyone adjusts — how many cards a day — is always
 * there; the Anki-preset depths (FSRS and its parameters, learning steps,
 * leeches) appear in Advanced mode, laid out like Anki's own screen so the
 * same settings are recognisable.
 */
async function renderDeckConfig(main: HTMLElement, advanced: boolean): Promise<void> {
  const box = main.querySelector<HTMLDivElement>("#deck-config");
  if (!box) return;
  const config = await getDeckConfig();

  box.innerHTML = `
    <div class="settings-grid">
      <label for="cfg-new">New cards/day</label>
      <input type="number" id="cfg-new" min="0" max="9999" value="${config.newPerDay}" />

      <label for="cfg-max">Maximum reviews/day</label>
      <input type="number" id="cfg-max" min="0" max="99999" value="${config.maxReviewsPerDay}" />
      ${
        advanced
          ? `
      <label for="cfg-fsrs">FSRS scheduler</label>
      <label class="switch-sm"><input type="checkbox" id="cfg-fsrs" ${config.fsrs ? "checked" : ""} /></label>

      <label for="cfg-retention">Desired retention</label>
      <input type="number" id="cfg-retention" min="70" max="99" step="1" value="${Math.round(config.desiredRetention * 100)}" />

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
      </select>`
          : ""
      }
    </div>
    ${
      advanced
        ? `
    <label for="cfg-weights">FSRS parameters (21 values)</label>
    <textarea id="cfg-weights" style="min-height:96px;font-family:ui-monospace,monospace;font-size:0.75rem">${escapeHtml(
      config.fsrsWeights.join(", "),
    )}</textarea>
    <div class="msg">Paste an optimised set from Anki (Deck options → FSRS → FSRS parameters).</div>`
        : ""
    }
    <div class="row-actions">
      <button id="cfg-save">Save</button>
      ${advanced ? `<button id="cfg-reset" class="ghost">Reset to defaults</button>` : ""}
    </div>
    <div class="msg" id="cfg-msg"></div>
  `;

  const msg = box.querySelector<HTMLDivElement>("#cfg-msg")!;
  const value = (id: string) => box.querySelector<HTMLInputElement>(id)!.value.trim();

  box.querySelector<HTMLButtonElement>("#cfg-save")!.addEventListener("click", async () => {
    try {
      const next = {
        ...config,
        newPerDay: Math.max(0, Number(value("#cfg-new")) || 0),
        maxReviewsPerDay: Math.max(0, Number(value("#cfg-max")) || 0),
      };
      // The hidden options keep their stored values; only what is on screen
      // can change, so basic mode can never quietly reset a tuned setup.
      if (advanced) {
        const retention = Number(value("#cfg-retention"));
        if (!Number.isFinite(retention) || retention < 70 || retention > 99) {
          throw new Error("Desired retention must be between 70 and 99.");
        }
        next.fsrs = box.querySelector<HTMLInputElement>("#cfg-fsrs")!.checked;
        next.desiredRetention = retention / 100;
        next.fsrsWeights = parseFsrsWeights(box.querySelector<HTMLTextAreaElement>("#cfg-weights")!.value);
        next.learningStepsSec = parseSteps(value("#cfg-learn"));
        next.relearningStepsSec = parseSteps(value("#cfg-relearn"));
        next.leechThreshold = Math.max(1, Number(value("#cfg-leech")) || 1);
        next.leechAction = box.querySelector<HTMLSelectElement>("#cfg-leech-action")!.value as "tag" | "suspend";
        next.newCardOrder = box.querySelector<HTMLSelectElement>("#cfg-order")!.value as "added" | "random";
      }
      await saveDeckConfig(next);
      msg.textContent = "Saved.";
      msg.className = "msg ok";
      toast("Scheduling settings saved");
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = "msg error";
    }
  });

  box.querySelector<HTMLButtonElement>("#cfg-reset")?.addEventListener("click", async () => {
    await resetDeckConfig();
    void renderDeckConfig(main, advanced);
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
      Unzip a Yomitan/Yomichan dictionary and choose its
      <code>term_bank_*.json</code> files.
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
    const url = urlInput.value.trim();
    // Your whole deck and the token travel to this URL. Plain http would
    // send them readable to anyone on the path; only a server on this very
    // machine is exempt, because that traffic never crosses a wire.
    if (/^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(url)) {
      toast("Use an https:// address — plain http would send your words and token unencrypted.", "error");
      return;
    }
    await setSyncSettings({ url, token: tokenInput.value });
    toast("Sync server settings saved");
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
