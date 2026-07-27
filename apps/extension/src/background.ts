import {
  MemoryDictionary,
  createCard,
  lookup,
  mergeCards,
  parseDictFile,
  type Card,
  type LookupMatch,
  type SyncRequest,
  type SyncResponse,
} from "@yomeyo/core";
import { ext, resourceUrl, storageGet, storageSet } from "./browser.js";

/**
 * Background script: owns the dictionary (loaded from the packaged
 * dict.json) and the saved-card store, and answers messages from the content
 * script and the toolbar popup.
 *
 * Runs as a service worker on Chromium and as an event page on Firefox; both
 * can be torn down between messages, so nothing is kept in memory that is not
 * either cheap to rebuild (the dictionary) or persisted (cards, settings).
 */

/** The default location of the hosted app, used for the deck handoff. */
const DEFAULT_APP_URL = "https://biosphobia.github.io/yomeyo/";

let dictPromise: Promise<MemoryDictionary> | null = null;

function getDictionary(): Promise<MemoryDictionary> {
  if (!dictPromise) {
    dictPromise = fetch(resourceUrl("dict/dict.json"))
      .then((res) => res.json())
      .then((raw) => new MemoryDictionary(parseDictFile(raw)))
      .catch((err) => {
        dictPromise = null; // let the next lookup retry
        throw err;
      });
  }
  return dictPromise;
}

type StoredCard = Card & { dirty?: boolean };

async function getCards(): Promise<Record<string, StoredCard>> {
  const data = await storageGet<{ cards?: Record<string, StoredCard> }>("cards");
  return data.cards ?? {};
}

async function setCards(cards: Record<string, StoredCard>): Promise<void> {
  await storageSet({ cards });
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

/** Base64url-encode UTF-8 JSON for the app handoff fragment. */
function encodePayload(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Hand the words saved here over to the app.
 *
 * On a single phone there is no sync server to bridge the two stores, so the
 * cards travel in the URL fragment — which browsers never send to the server
 * — and the app imports them into its own deck. Cards stay here too, so this
 * is safe to repeat.
 */
async function handoffToApp(): Promise<{ url: string; count: number }> {
  const settings = await storageGet<{ settings?: { appUrl?: string } }>("settings");
  const appUrl = settings.settings?.appUrl?.trim() || DEFAULT_APP_URL;

  const cards = await getCards();
  const pending = Object.values(cards)
    .filter((c) => !c.deleted)
    .sort((a, b) => b.createdAt - a.createdAt)
    // Keep the fragment to a sane length; repeat the handoff for more.
    .slice(0, 300)
    .map(({ dirty: _dirty, ...card }) => card);

  const base = appUrl.endsWith("/") ? appUrl : appUrl + "/";
  const url = `${base}#import=${encodePayload(pending)}`;
  await ext.tabs.create({ url });
  return { url, count: pending.length };
}

async function handleSync(): Promise<{ pushed: number; pulled: number }> {
  const data = await storageGet<{ settings?: any; syncSince?: number }>(["settings", "syncSince"]);
  const settings = data.settings ?? {};
  if (!settings.url || !settings.token) {
    throw new Error("Set the sync server URL and token first.");
  }
  const since: number = data.syncSince ?? 0;
  const cards = await getCards();
  const dirty = Object.values(cards).filter((c) => c.dirty);

  const request: SyncRequest = {
    since,
    changes: dirty.map(({ dirty: _dirty, ...card }) => card),
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
  const appliedIds = new Set(applied.map((c) => c.id));
  const pushedIds = new Set(dirty.map((c) => c.id));

  const next: Record<string, StoredCard> = {};
  for (const [id, card] of map) {
    const wasPushed = pushedIds.has(id);
    const wasPulled = appliedIds.has(id);
    const stillDirty = (cards[id]?.dirty ?? false) && !wasPushed && !wasPulled;
    next[id] = { ...card, dirty: stillDirty };
  }
  await setCards(next);
  await storageSet({ syncSince: response.now });
  return { pushed: dirty.length, pulled: applied.length };
}

ext.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (r: any) => void) => {
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
      case "handoff": {
        try {
          sendResponse(await handoffToApp());
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        }
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
        const data = await storageGet<{ settings?: any; tapMode?: boolean | null }>([
          "settings",
          "tapMode",
        ]);
        sendResponse({
          settings: { appUrl: DEFAULT_APP_URL, ...(data.settings ?? {}) },
          tapMode: data.tapMode ?? null,
        });
        break;
      }
      case "setSettings": {
        await storageSet({ settings: message.settings });
        sendResponse({ ok: true });
        break;
      }
      case "setTapMode": {
        await storageSet({ tapMode: message.enabled });
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse(null);
    }
  })();
  return true; // keep the message channel open for the async response
});
