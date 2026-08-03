import { MINING_DECK_ID, fromSharedCards, type DeckInfo } from "@yomeyo/core";
import { currentAccount, getFirebaseConfig, type AccountInfo } from "./cloud.js";
import { cardsInDeck, forgetDeck, listDecks, rememberDeck } from "./my-decks.js";
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
let library: typeof import("./library.js") | null = null;
async function loadLibrary(): Promise<typeof import("./library.js")> {
  library ??= await import("./library.js");
  return library;
}

type Tab = "premade" | "mine";
let tab: Tab = "premade";

export async function renderDecks(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const mine = await listDecks();
  const config = await getFirebaseConfig();
  if (!isCurrent()) return;

  main.innerHTML = `
    <h1>Decks</h1>
    <p class="subtitle">Ready-made word lists, and the decks on this device.</p>
    <div class="segmented" id="deck-tabs">
      <button data-tab="premade" class="${tab === "premade" ? "on" : ""}">Premade</button>
      <button data-tab="mine" class="${tab === "mine" ? "on" : ""}">Mine (${mine.length})</button>
    </div>
    <div id="deck-body"></div>
  `;

  for (const button of main.querySelectorAll<HTMLButtonElement>("#deck-tabs button")) {
    button.addEventListener("click", () => {
      tab = button.dataset.tab as Tab;
      void renderDecks(main, isCurrent);
    });
  }

  const body = main.querySelector<HTMLDivElement>("#deck-body")!;
  if (tab === "mine") void renderMine(body, mine, config !== undefined, main, isCurrent);
  else void renderPremade(body, mine, config !== undefined, main, isCurrent);
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
          Premade decks need cloud sync — set it up under <b>Settings →
          Account</b>. You can still import Anki decks from a file; they stay
          on this device.
        </div>
      </div>
    `;
    return;
  }

  body.innerHTML = `<div class="card-panel"><div class="msg">Loading the library…</div></div>`;

  let account: AccountInfo | null = null;
  let decks: LibraryDeck[] = [];
  try {
    account = await currentAccount();
    if (!account) {
      body.innerHTML = `
        <div class="card-panel">
          <div class="msg">Sign in to see the decks people have shared — <b>Settings → Account</b>.</div>
        </div>
      `;
      return;
    }
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
  // Failing to find out only costs those buttons, not the screen.
  const admin = await (await loadLibrary())
    .adminState()
    .catch(() => ({ adminUid: null, isAdmin: false }));
  if (!isCurrent()) return;

  if (decks.length === 0) {
    body.innerHTML = `
      <div class="card-panel">
        <div class="empty-state"><div class="big">📦</div>
          No decks shared yet.<br/>
          Import one under <b>Settings → Import from Anki</b> to share it.
        </div>
      </div>
    `;
    return;
  }

  body.innerHTML = `<div class="card-panel" style="padding:6px 14px" id="library-list"></div>`;
  const list = body.querySelector<HTMLDivElement>("#library-list")!;

  for (const deck of decks) {
    const row = document.createElement("div");
    row.className = "word-row";
    const isMine = deck.ownerUid === account.uid;
    row.innerHTML = `
      <div class="word">
        <div><b>${escapeHtml(deck.name)}</b></div>
        <div class="glosses">${deck.cardCount.toLocaleString()} words${
          deck.ownerName ? ` · shared by ${escapeHtml(deck.ownerName)}` : ""
        }${isMine ? " · yours" : ""}</div>
        ${deck.description ? `<div class="glosses">${escapeHtml(deck.description)}</div>` : ""}
      </div>
      <button class="add-btn${held.has(deck.id) ? " secondary" : ""}">${held.has(deck.id) ? "Added" : "Add"}</button>
      ${admin.isAdmin && !isMine ? `<button class="ghost admin-remove-btn" title="Withdraw from the library (admin)">✕</button>` : ""}
    `;

    row.querySelector<HTMLButtonElement>(".admin-remove-btn")?.addEventListener("click", async (ev) => {
      if (!confirm(`Withdraw “${deck.name}” from the shared library?\n\nIt disappears for everyone; copies already added stay on their devices.`)) {
        return;
      }
      const button = ev.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        await (await loadLibrary()).unpublishDeck(deck.id);
        toast(`Withdrew ${deck.name} from the library`);
        void renderDecks(main, isCurrent);
      } catch (err) {
        button.disabled = false;
        toast(err instanceof Error ? err.message : "Could not withdraw that deck.", "error");
      }
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
  body.innerHTML = `<div class="card-panel" style="padding:6px 14px" id="my-list"></div>`;
  const list = body.querySelector<HTMLDivElement>("#my-list")!;

  // Only needed to decide whether a deck of yours can be shared or withdrawn,
  // so a failure here just leaves those actions off rather than the screen.
  const account = configured ? await currentAccount().catch(() => null) : null;
  if (!isCurrent()) return;

  for (const deck of decks) {
    const row = document.createElement("div");
    row.className = "word-row";
    const publishedByMe = deck.shared === true && deck.ownerUid === account?.uid;
    // Only a deck imported here can be shared. One added from the library
    // already has a publisher, and re-sharing it would put a second copy in
    // the list under somebody else's name.
    const shareable = deck.kind === "premade" && !deck.ownerUid && account !== null;
    row.innerHTML = `
      <div class="word">
        <div><b>${escapeHtml(deck.name)}</b>${deck.shared ? ` <span class="glosses">· shared</span>` : ""}</div>
        <div class="glosses">${deck.cardCount.toLocaleString()} words${
          deck.kind === "mining" ? " · saved by you" : ""
        }</div>
        ${deck.description ? `<div class="glosses">${escapeHtml(deck.description)}</div>` : ""}
        <div class="row-actions" style="margin-top:6px">
          ${shareable ? `<button class="secondary share-btn">Share with everyone</button>` : ""}
          ${publishedByMe ? `<button class="secondary unshare-btn">Stop sharing</button>` : ""}
        </div>
      </div>
      ${deck.kind === "premade" ? `<button class="ghost remove-btn" title="Remove this deck">✕</button>` : ""}
    `;

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

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  );
}
