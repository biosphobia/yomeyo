import {
  MemoryDictionary,
  createCard,
  lookup,
  mergeCards,
  type Card,
  type DictFile,
  type LookupMatch,
  type SyncRequest,
  type SyncResponse,
} from "@yomeyo/core";

/**
 * Background service worker: owns the dictionary (loaded from the packaged
 * dict.json) and the saved-card store (chrome.storage.local), and answers
 * messages from the content script and the action popup.
 *
 * Message protocol:
 *   { type: "lookup", text, offset }        -> LookupMatch[]
 *   { type: "save", entry, sentence, url }  -> { ok: true }
 *   { type: "isSaved", term, reading }      -> boolean
 *   { type: "stats" }                        -> { total, dirty }
 *   { type: "sync" }                         -> { pushed, pulled } | { error }
 *   { type: "getSettings" } / { type: "setSettings", settings }
 */

declare const chrome: any;

let dictPromise: Promise<MemoryDictionary> | null = null;

function getDictionary(): Promise<MemoryDictionary> {
  if (!dictPromise) {
    dictPromise = fetch(chrome.runtime.getURL("dict/dict.json"))
      .then((res) => res.json())
      .then((file: DictFile) => new MemoryDictionary(file));
  }
  return dictPromise;
}

type StoredCard = Card & { dirty?: boolean };

async function getCards(): Promise<Record<string, StoredCard>> {
  const data = await chrome.storage.local.get("cards");
  return data.cards ?? {};
}

async function setCards(cards: Record<string, StoredCard>): Promise<void> {
  await chrome.storage.local.set({ cards });
}

async function handleSave(entry: any, sentence?: string, url?: string): Promise<void> {
  const cards = await getCards();
  const card: StoredCard = {
    ...createCard(
      {
        term: entry.term,
        reading: entry.reading,
        glosses: entry.glosses,
        sentence,
        source: url,
      },
      Date.now(),
    ),
    dirty: true,
  };
  cards[card.id] = card;
  await setCards(cards);
}

async function isSaved(term: string, reading: string): Promise<boolean> {
  const cards = await getCards();
  return Object.values(cards).some((c) => !c.deleted && c.term === term && c.reading === reading);
}

async function handleSync(): Promise<{ pushed: number; pulled: number }> {
  const data = await chrome.storage.local.get(["settings", "syncSince"]);
  const settings = data.settings ?? {};
  if (!settings.url || !settings.token) {
    throw new Error("Set the sync server URL and token first.");
  }
  const since: number = data.syncSince ?? 0;
  const cards = await getCards();
  const dirty = Object.values(cards).filter((c) => c.dirty);

  const request: SyncRequest = {
    since,
    changes: dirty.map(({ dirty: _d, ...card }) => card),
  };
  const res = await fetch(settings.url.replace(/\/+$/, "") + "/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(res.status === 401 ? "Wrong sync token." : `Sync failed (${res.status}).`);
  }
  const response = (await res.json()) as SyncResponse;

  const map = new Map<string, Card>(Object.entries(cards));
  const applied = mergeCards(map, response.changes);
  const next: Record<string, StoredCard> = {};
  for (const [id, card] of map) {
    const wasApplied = applied.some((a) => a.id === id);
    const wasDirty = (cards[id] as StoredCard | undefined)?.dirty && !wasApplied;
    next[id] = { ...card, dirty: wasDirty && !dirty.some((d) => d.id === id) ? true : false };
  }
  await setCards(next);
  await chrome.storage.local.set({ syncSince: response.now });
  return { pushed: dirty.length, pulled: applied.length };
}

chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (r: any) => void) => {
  (async () => {
    switch (message?.type) {
      case "lookup": {
        const dict = await getDictionary();
        const matches: LookupMatch[] = lookup(dict, message.text, message.offset ?? 0);
        sendResponse(matches.slice(0, 8));
        break;
      }
      case "save": {
        await handleSave(message.entry, message.sentence, message.url);
        sendResponse({ ok: true });
        break;
      }
      case "isSaved": {
        sendResponse(await isSaved(message.term, message.reading));
        break;
      }
      case "stats": {
        const cards = await getCards();
        const live = Object.values(cards).filter((c) => !c.deleted);
        sendResponse({ total: live.length, dirty: live.filter((c) => c.dirty).length });
        break;
      }
      case "sync": {
        try {
          sendResponse(await handleSync());
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case "getSettings": {
        const data = await chrome.storage.local.get(["settings", "tapMode"]);
        sendResponse({ settings: data.settings ?? {}, tapMode: data.tapMode ?? false });
        break;
      }
      case "setSettings": {
        await chrome.storage.local.set({ settings: message.settings });
        sendResponse({ ok: true });
        break;
      }
      case "setTapMode": {
        await chrome.storage.local.set({ tapMode: message.enabled });
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse(null);
    }
  })();
  return true; // keep the message channel open for the async response
});
