import { MINING_DECK_ID, deckFace, fromSharedCards, type DeckInfo } from "@yomeyo/core";
import { screenHeader } from "./screen.js";
import { currentAccount, getFirebaseConfig, type AccountInfo } from "./cloud.js";
import { cardsInDeck, forgetDeck, listDecks, rememberDeck } from "./my-decks.js";
import { canShare, isSharedByMe } from "./deck-share.js";
import { deleteCards, importCards } from "./store.js";
import { deleteMediaOf } from "./media.js";
import { toast } from "./toast.js";
import type { LibraryDeck } from "./library.js";

/**
 * The Decks screen: premade decks anyone can add, and the decks you have.
 *
 * A premade deck is a whole vocabulary list somebody imported from Anki once.
 * Finding the file and mapping its fields is work, and it is the same work
 * for everybody — so it is done once and shared, and everyone after that adds
 * the deck with a tap and no file at all.
 *
 * Mining decks are the other kind: the words you saved yourself off the pages
 * you were reading. Those stay on your account and are never published.
 */

// The library needs Firestore, which is hundreds of kilobytes. Nobody who
// only reviews should pay for it, so it arrives when this screen asks.
import { lazyImport } from "./lazy.js";

let library: typeof import("./library.js") | null = null;
async function loadLibrary(): Promise<typeof import("./library.js")> {
  library ??= await lazyImport(() => import("./library.js"));
  return library;
}

type Tab = "premade" | "mine";
let tab: Tab = "premade";

/** The deck open in the editor, if any. Survives a redraw of the screen. */
let editing: string | null = null;

export async function renderDecks(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const mine = await listDecks();
  const config = await getFirebaseConfig();
  if (!isCurrent()) return;

  // Which decks this account has is itself something to sync — the cards
  // arrive on a new device without any record of the decks they belong to,
  // which is what "no decks added" over six thousand words was. Done while
  // the screen draws, and the screen is drawn again if it brought anything.
  void import("./deck-sync.js")
    .then((mod) => mod.syncDecks())
    .then((changed) => {
      if (changed && isCurrent()) void renderDecks(main, isCurrent);
    })
    .catch(() => undefined);

  // And whether any added deck's publisher has updated it. Same manner:
  // while the screen draws, redrawing if the library brought anything.
  void import("./deck-refresh.js")
    .then((mod) => mod.refreshSharedDecks())
    .then((changed) => {
      if (changed && isCurrent()) void renderDecks(main, isCurrent);
    })
    .catch(() => undefined);

  main.innerHTML = `
    ${screenHeader("Decks")}
    <div class="segmented" id="deck-tabs">
      <button data-tab="premade" class="${tab === "premade" ? "on" : ""}">Premade</button>
      <button data-tab="mine" class="${tab === "mine" ? "on" : ""}">Mine (${mine.length})</button>
    </div>
    <div id="deck-body"></div>
  `;

  for (const button of main.querySelectorAll<HTMLButtonElement>("#deck-tabs button")) {
    button.addEventListener("click", () => {
      tab = button.dataset.tab as Tab;
      editing = null;
      void renderDecks(main, isCurrent);
    });
  }

  const body = main.querySelector<HTMLDivElement>("#deck-body")!;
  const open = editing ? mine.find((deck) => deck.id === editing) : undefined;
  if (open) {
    main.querySelector<HTMLDivElement>("#deck-tabs")!.style.display = "none";
    void openEditor(body, open, main, isCurrent);
  } else if (tab === "mine") {
    void renderMine(body, mine, config !== undefined, main, isCurrent);
  } else {
    void renderPremade(body, mine, config !== undefined, main, isCurrent);
  }
}

/**
 * Whether this account holds the admin seat.
 *
 * Asked once and remembered: three panels want to know, and it is a network
 * round trip. Not knowing costs the admin's own extras, never the screen.
 */
async function isAdmin(): Promise<boolean> {
  if (!(await getFirebaseConfig())) return false;
  if (!(await currentAccount().catch(() => null))) return false;
  return (await loadLibrary())
    .adminState()
    .then((state) => state.isAdmin)
    .catch(() => false);
}

async function openEditor(
  body: HTMLElement,
  deck: DeckInfo,
  main: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  body.innerHTML = `<div class="card-panel"><div class="msg">Opening ${escapeHtml(deck.name)}…</div></div>`;
  const [{ renderDeckEditor, resetEditor }, account, admin] = await Promise.all([
    lazyImport(() => import("./deck-edit.js")),
    currentAccount().catch(() => null),
    isAdmin(),
  ]);
  if (!isCurrent()) return;
  void renderDeckEditor(
    body,
    deck,
    {
      account,
      isAdmin: admin,
      onBack: () => {
        resetEditor();
        editing = null;
        tab = "mine";
        void renderDecks(main, isCurrent);
      },
      onReopen: (deckId) => {
        editing = deckId;
        void renderDecks(main, isCurrent);
      },
    },
    isCurrent,
  );
}

// ---------------- the shared library ----------------

async function renderPremade(
  body: HTMLElement,
  mine: DeckInfo[],
  configured: boolean,
  main: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  if (!configured) {
    body.innerHTML = `
      <div class="card-panel">
        <div class="msg">
          Premade decks need cloud sync. Set it up under <b>Settings → Account</b>.
        </div>
      </div>
    `;
    return;
  }

  body.innerHTML = `<div class="card-panel"><div class="msg">Loading the library…</div></div>`;

  // The library is public: browsing it and adding a deck from it need no
  // account, because a beginner should be able to open the app and start on
  // a real word list rather than on a sign-up form. An account only decides
  // what you may do to the library — publish, withdraw — not what you may
  // take from it.
  let account: AccountInfo | null = null;
  let decks: LibraryDeck[] = [];
  try {
    account = await currentAccount().catch(() => null);
    decks = await (await loadLibrary()).browseLibrary();
  } catch (err) {
    body.innerHTML = `<div class="card-panel"><div class="msg error">${escapeHtml(
      err instanceof Error ? err.message : String(err),
    )}</div></div>`;
    return;
  }
  if (!isCurrent()) return;

  const held = new Set(mine.map((deck) => deck.id));

  // Whether this account holds the admin seat, for the withdraw buttons.
  // Failing to find out only costs those buttons, not the screen — and with
  // nobody signed in there is nothing to ask, so it is not asked.
  const admin = account
    ? await (await loadLibrary()).adminState().catch(() => ({ adminUid: null, isAdmin: false }))
    : { adminUid: null, isAdmin: false };

  // Publisher avatars, fetched together; a missing one is just no picture.
  const { profilesFor } = await import("./profile.js");
  const profiles = await profilesFor(decks.map((deck) => deck.ownerUid ?? "")).catch(
    () => new Map<string, { name: string; photo?: string }>(),
  );
  if (!isCurrent()) return;

  if (decks.length === 0) {
    body.innerHTML = `
      <div class="card-panel">
        <div class="empty-state"><div class="big">📦</div>
          No decks shared yet.
        </div>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="card-panel" style="padding:6px 14px" id="library-list"></div>
    ${
      // Said once, under the list, rather than in place of it: what an
      // account adds here is publishing, not reading.
      account
        ? ""
        : `<div class="card-panel"><div class="msg">
             Add any of these and study them right away. Sign in under
             <b>Settings → Account</b> to share a deck of your own.
           </div></div>`
    }
  `;
  const list = body.querySelector<HTMLDivElement>("#library-list")!;

  for (const deck of decks) {
    const row = document.createElement("div");
    row.className = "word-row";
    const isMine = account !== null && deck.ownerUid === account.uid;
    const profile = deck.ownerUid ? profiles.get(deck.ownerUid) : undefined;
    row.innerHTML = `
      ${avatarHtml(profile, deck.ownerName)}
      <div class="word">
        <div><b>${escapeHtml(deck.name)}</b></div>
        <div class="glosses">${deck.cardCount.toLocaleString()} words${
          deck.ownerName
            ? ` · shared by ${deck.ownerUid && deck.ownerUid === admin.adminUid ? "👑 " : ""}${escapeHtml(deck.ownerName)}`
            : ""
        }${isMine ? " · yours" : ""}</div>
        ${deck.description ? `<div class="glosses">${escapeHtml(deck.description)}</div>` : ""}
      </div>
      <button class="secondary preview-btn">Browse</button>
      <button class="add-btn${held.has(deck.id) ? " secondary" : ""}">${held.has(deck.id) ? "Added" : "Add"}</button>
      ${
        // Everyone who may delete this deck gets the button right here: its
        // publisher, and the admin for everything.
        admin.isAdmin || isMine
          ? `<button class="ghost admin-remove-btn" title="Delete from the library">✕</button>`
          : ""
      }
    `;

    row.querySelector<HTMLButtonElement>(".admin-remove-btn")?.addEventListener("click", async (ev) => {
      const warning = isMine
        ? `Delete your deck “${deck.name}” from the shared library?\n\nIt disappears for everyone; your own copy stays on your devices.`
        : `Delete “${deck.name}” from the shared library?\n\nIt disappears for everyone; copies already added stay on their devices.`;
      if (!confirm(warning)) return;
      const button = ev.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        await (await loadLibrary()).unpublishDeck(deck.id);
        // The local copy, if any, is no longer a shared deck.
        const local = mine.find((owned) => owned.id === deck.id);
        if (local?.shared) await rememberDeck({ ...local, shared: false });
        toast(`Deleted ${deck.name} from the library`);
        void renderDecks(main, isCurrent);
      } catch (err) {
        button.disabled = false;
        toast(err instanceof Error ? err.message : "Could not delete that deck.", "error");
      }
    });

    // Browse without adding: the whole word list, read-only, nothing
    // imported and nothing scheduled — window shopping.
    row.querySelector<HTMLButtonElement>(".preview-btn")!.addEventListener("click", async (ev) => {
      const previewButton = ev.currentTarget as HTMLButtonElement;
      previewButton.disabled = true;
      try {
        const shared = await (await loadLibrary()).downloadDeck(deck);
        const cards = fromSharedCards(shared, deck.id, Date.now());
        openDeckPreview(body, deck.name, cards, held.has(deck.id) ? null : () => button.click());
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not open that deck.", "error");
      }
      previewButton.disabled = false;
    });

    const button = row.querySelector<HTMLButtonElement>(".add-btn")!;
    button.disabled = held.has(deck.id);
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Adding…";
      try {
        const shared = await (await loadLibrary()).downloadDeck(deck);
        const cards = fromSharedCards(shared, deck.id, Date.now());
        const added = await importCards(cards);
        await rememberDeck({
          id: deck.id,
          name: deck.name,
          kind: "premade",
          cardCount: cards.length,
          description: deck.description,
          ownerUid: deck.ownerUid,
          ownerName: deck.ownerName,
          publishedAt: deck.publishedAt,
        });
        toast(
          added === cards.length
            ? `Added ${added.toLocaleString()} words from ${deck.name}`
            : `Added ${added.toLocaleString()} words; ${(cards.length - added).toLocaleString()} were already in your deck`,
        );
        void renderDecks(main, isCurrent);
      } catch (err) {
        button.disabled = false;
        button.textContent = "Add";
        toast(err instanceof Error ? err.message : "Could not add that deck.", "error");
      }
    });

    list.appendChild(row);
  }
}

// ---------------- the decks on this device ----------------

async function renderMine(
  body: HTMLElement,
  decks: DeckInfo[],
  configured: boolean,
  main: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  body.innerHTML = `
    <div id="deck-new-row"></div>
    <div class="card-panel" style="padding:6px 14px" id="my-list"></div>`;
  const list = body.querySelector<HTMLDivElement>("#my-list")!;

  // Only needed to decide whether a deck of yours can be shared or withdrawn,
  // so a failure here just leaves those actions off rather than the screen.
  const account = configured ? await currentAccount().catch(() => null) : null;
  if (!isCurrent()) return;

  // Building a deck from nothing is the admin's job: these are the decks
  // everyone else adds with a tap, and one of them is the shared library's
  // whole contents. Editing what is already here is anybody's.
  if (await isAdmin()) {
    if (!isCurrent()) return;
    const row = body.querySelector<HTMLDivElement>("#deck-new-row")!;
    row.innerHTML = `
      <div class="card-panel">
        <b>Build a deck</b>
        <div class="glosses">Type the words, or describe the deck and have it drafted.</div>
        <div class="row-actions" style="margin-top:10px">
          <input type="text" id="new-deck-name" placeholder="Deck name" style="flex:1;min-width:180px" />
          <button id="new-deck">Create</button>
        </div>
      </div>`;
    const create = async (): Promise<void> => {
      const input = row.querySelector<HTMLInputElement>("#new-deck-name")!;
      const name = input.value.trim();
      if (!name) {
        toast("Give the deck a name first.", "error");
        return;
      }
      const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await rememberDeck({ id, name, kind: "premade", cardCount: 0 });
      editing = id;
      void renderDecks(main, isCurrent);
    };
    row.querySelector<HTMLButtonElement>("#new-deck")!.addEventListener("click", () => void create());
    row.querySelector<HTMLInputElement>("#new-deck-name")!.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") void create();
    });
  }

  for (const deck of decks) {
    const row = document.createElement("div");
    row.className = "word-row";
    const publishedByMe = isSharedByMe(deck, account);
    // Anything of yours that is not already shared, including one you
    // published and then withdrew — which used to be publishable exactly
    // once, because withdrawing left your name on it and the old rule read
    // any name at all as somebody else's.
    const shareable = canShare(deck, account);
    row.innerHTML = `
      <div class="word">
        <div><span class="deck-row-face" aria-hidden="true">${escapeHtml(deckFace(deck))}</span> <b>${escapeHtml(
          deck.name,
        )}</b>${deck.shared ? ` <span class="glosses">· shared</span>` : ""}</div>
        <div class="glosses">${deck.cardCount.toLocaleString()} words${
          deck.kind === "mining" ? " · saved by you" : ""
        }</div>
        ${deck.description ? `<div class="glosses">${escapeHtml(deck.description)}</div>` : ""}
        <div class="row-actions" style="margin-top:6px">
          <button class="secondary edit-deck-btn">Edit words</button>
          <button class="secondary opts-btn">Options</button>
          ${shareable ? `<button class="secondary share-btn">Share with everyone</button>` : ""}
          ${publishedByMe ? `<button class="secondary unshare-btn">Stop sharing</button>` : ""}
        </div>
        <div class="deck-options" hidden>
          <label class="deck-own-toggle"><input type="checkbox" class="own-toggle" /> This deck has its own settings</label>
          <div class="deck-options-grid">
            <label>New cards/day <input type="number" class="opt-new" min="0" /></label>
            <label>Max reviews/day <input type="number" class="opt-max" min="1" /></label>
          </div>
          <div class="row-actions">
            <button class="secondary save-opts">Save options</button>
            <span class="glosses opts-msg"></span>
          </div>
        </div>
      </div>
      ${deck.kind === "premade" ? `<button class="ghost remove-btn" title="Remove this deck">✕</button>` : ""}
    `;

    // The deck's own scheduling: a partial override laid over the global
    // settings, exactly like an Anki preset. Off, it follows Settings.
    const optsPanel = row.querySelector<HTMLDivElement>(".deck-options")!;
    row.querySelector<HTMLButtonElement>(".opts-btn")!.addEventListener("click", async () => {
      if (!optsPanel.hidden) {
        optsPanel.hidden = true;
        return;
      }
      const { getDeckConfig, getDeckOverride } = await import("./deck.js");
      const own = await getDeckOverride(deck.id);
      const effective = await getDeckConfig(deck.id);
      optsPanel.querySelector<HTMLInputElement>(".own-toggle")!.checked = own !== null;
      optsPanel.querySelector<HTMLInputElement>(".opt-new")!.value = String(effective.newPerDay);
      optsPanel.querySelector<HTMLInputElement>(".opt-max")!.value = String(effective.maxReviewsPerDay);
      optsPanel.hidden = false;
    });
    optsPanel.querySelector<HTMLButtonElement>(".save-opts")!.addEventListener("click", async () => {
      const { saveDeckOverride } = await import("./deck.js");
      const message = optsPanel.querySelector<HTMLElement>(".opts-msg")!;
      if (!optsPanel.querySelector<HTMLInputElement>(".own-toggle")!.checked) {
        await saveDeckOverride(deck.id, null);
        message.textContent = "Follows the global settings.";
        return;
      }
      const newPerDay = Math.max(0, Math.floor(Number(optsPanel.querySelector<HTMLInputElement>(".opt-new")!.value) || 0));
      const maxReviews = Math.max(1, Math.floor(Number(optsPanel.querySelector<HTMLInputElement>(".opt-max")!.value) || 1));
      await saveDeckOverride(deck.id, { newPerDay, maxReviewsPerDay: maxReviews });
      message.textContent = `Saved: ${newPerDay} new/day, ${maxReviews} reviews/day for this deck.`;
    });

    // Every deck on the device opens: rename it, fix a card, reorder the
    // words, add more. However it arrived — Anki, the library, or typed here.
    row.querySelector<HTMLButtonElement>(".edit-deck-btn")!.addEventListener("click", () => {
      editing = deck.id;
      void renderDecks(main, isCurrent);
    });

    row.querySelector<HTMLButtonElement>(".share-btn")?.addEventListener("click", async (ev) => {
      const button = ev.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "Sharing…";
      try {
        const { shareDeck } = await import("./anki-import.js");
        await shareDeck(account!, deck.id, deck.name, deck.source ?? "");
        toast(`${deck.name} is now in the shared library`);
        void renderDecks(main, isCurrent);
      } catch (err) {
        button.disabled = false;
        button.textContent = "Share with everyone";
        toast(err instanceof Error ? err.message : "Could not share that deck.", "error");
      }
    });

    row.querySelector<HTMLButtonElement>(".unshare-btn")?.addEventListener("click", async (ev) => {
      if (!confirm(`Take “${deck.name}” out of the shared library?\n\nYour own copy stays.`)) return;
      const button = ev.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        const { unpublishDeck } = await loadLibrary();
        await unpublishDeck(deck.id);
        await rememberDeck({ ...deck, shared: false });
        toast(`${deck.name} is no longer shared`);
        void renderDecks(main, isCurrent);
      } catch (err) {
        button.disabled = false;
        toast(err instanceof Error ? err.message : "Could not withdraw that deck.", "error");
      }
    });

    row.querySelector<HTMLButtonElement>(".remove-btn")?.addEventListener("click", async () => {
      const cards = await cardsInDeck(deck.id);
      if (
        !confirm(
          `Remove “${deck.name}” and its ${cards.length.toLocaleString()} words from this device?` +
            `\n\nThe deck stays in the library, so you can add it again.`,
        )
      ) {
        return;
      }
      // The blobs first, while the cards still say which files are theirs.
      await deleteMediaOf(cards);
      await deleteCards(cards);
      await forgetDeck(deck.id);
      toast(`Removed ${deck.name}`);
      void renderDecks(main, isCurrent);
    });

    list.appendChild(row);
  }

  if (decks.every((deck) => deck.id === MINING_DECK_ID && deck.cardCount === 0)) {
    list.innerHTML = `<div class="empty-state"><div class="big">📚</div>
      Nothing here yet.<br/>Tap words while reading, or add a premade deck.</div>`;
  }
}

/**
 * A read-only look inside a library deck: every word, its reading and its
 * meanings, scrollable, with Add at the bottom for when browsing convinces.
 */
function openDeckPreview(
  body: HTMLElement,
  name: string,
  cards: { term: string; reading?: string; glosses?: string[] }[],
  onAdd: (() => void) | null,
): void {
  body.querySelector(".rc-scrim")?.remove();
  const scrim = document.createElement("div");
  scrim.className = "rc-scrim";
  const SHOWN = 200;
  scrim.innerHTML = `
    <div class="rc-pop card-panel deck-preview" role="dialog" aria-modal="true">
      <div class="rc-pop-head">
        <b>${escapeHtml(name)}</b>
        <button class="rc-close ghost" aria-label="Close">✕</button>
      </div>
      <div class="glosses">${cards.length.toLocaleString()} words. Just looking — nothing is added.</div>
      <div class="deck-preview-list">
        ${cards
          .slice(0, SHOWN)
          .map(
            (card) => `<div class="deck-preview-row">
              <b lang="ja">${escapeHtml(card.term)}</b>
              ${card.reading && card.reading !== card.term ? `<span lang="ja" class="glosses">${escapeHtml(card.reading)}</span>` : ""}
              <span class="glosses">${escapeHtml((card.glosses ?? []).slice(0, 3).join(" · "))}</span>
            </div>`,
          )
          .join("")}
        ${cards.length > SHOWN ? `<div class="glosses" style="padding:8px 0">…and ${(cards.length - SHOWN).toLocaleString()} more.</div>` : ""}
      </div>
      ${onAdd ? `<div class="row-actions" style="margin-top:10px"><button class="preview-add">Add this deck</button></div>` : ""}
    </div>`;
  body.appendChild(scrim);
  const close = (): void => scrim.remove();
  scrim.addEventListener("click", (ev) => {
    if (ev.target === scrim) close();
  });
  scrim.querySelector(".rc-close")!.addEventListener("click", close);
  scrim.querySelector(".preview-add")?.addEventListener("click", () => {
    close();
    onAdd?.();
  });
}

/** The publisher's avatar, or a lettered placeholder without a picture. */
function avatarHtml(profile: { name: string; photo?: string } | undefined, fallbackName?: string): string {
  if (profile?.photo && /^data:image\//.test(profile.photo)) {
    return `<img class="avatar" src="${profile.photo.replace(/"/g, "&quot;")}" alt="" />`;
  }
  const letter = (profile?.name ?? fallbackName ?? "?").slice(0, 1).toUpperCase();
  return `<div class="avatar avatar-letter">${escapeHtml(letter)}</div>`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  );
}
