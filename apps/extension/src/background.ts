import {
  BinaryDictionary,
  createCard,
  findDuplicate,
  lookup,
  mergeCards,
  type Card,
  type LookupMatch,
  type SyncRequest,
  type SyncResponse,
} from "@yomeyo/core";
import { activeTab, ext, resourceUrl, sendToTab, storageGet, storageSet, tabsMatching } from "./browser.js";
import { syncFrameUrl } from "./frame-handoff.js";

/**
 * Background script: owns the dictionary (loaded from the packaged
 * dict.bin) and the saved-card store, and answers messages from the content
 * script and the toolbar popup.
 *
 * Runs as a service worker on Chromium and as an event page on Firefox; both
 * can be torn down between messages, so nothing is kept in memory that is not
 * either cheap to rebuild (the dictionary) or persisted (cards, settings).
 */

/** The default location of the hosted app, used for the deck handoff. */
const DEFAULT_APP_URL = "https://duugu.moe/yomeyo/";

/**
 * Places the app used to live.
 *
 * A stored setting beats the default, which is right until the default is
 * the one that moved — then everybody who ever opened this menu is pinned to
 * an address the app is no longer at, with their words piling up against it.
 * A stored value that is only ever an old default is not a choice anybody
 * made, so it is replaced; anything else is left exactly as it is.
 */
const OLD_APP_URLS = ["https://biosphobia.github.io/yomeyo/", "https://biosphobia.github.io/yomeyo"];

async function migrateAppUrl(): Promise<void> {
  const data = await storageGet<{ settings?: { appUrl?: string } }>("settings");
  const settings = data.settings;
  if (!settings) return;
  const current = settings.appUrl?.trim() ?? "";
  if (current !== "" && !OLD_APP_URLS.includes(current.replace(/\/index\.html$/, ""))) return;
  await storageSet({ settings: { ...settings, appUrl: DEFAULT_APP_URL } });
}

let dictPromise: Promise<BinaryDictionary> | null = null;

/**
 * The dictionary, read straight from the packaged file.
 *
 * Nothing is parsed: `yomeyo-dict-2` is searched where it lies, so this is a
 * read and a few typed-array views. That matters more here than anywhere
 * else — this is a service worker, so it is torn down whenever it goes idle
 * and pays this cost again on the next page. The old JSON dictionary took
 * seconds of parsing each time, which is what made the first tap on a freshly
 * loaded page feel dead.
 */
function getDictionary(): Promise<BinaryDictionary> {
  if (!dictPromise) {
    dictPromise = fetch(resourceUrl("dict/dict.bin"))
      .then((res) => res.arrayBuffer())
      .then((buffer) => new BinaryDictionary(buffer))
      .catch((err) => {
        dictPromise = null; // let the next lookup retry
        throw err;
      });
  }
  return dictPromise;
}

type StoredCard = Card & {
  dirty?: boolean;
  /** Set once the app has taken this card, so it is not offered again. */
  handedOff?: boolean;
};

async function getCards(): Promise<Record<string, StoredCard>> {
  const data = await storageGet<{ cards?: Record<string, StoredCard> }>("cards");
  return data.cards ?? {};
}

async function setCards(cards: Record<string, StoredCard>): Promise<void> {
  await storageSet({ cards });
}

async function handleSave(
  entry: any,
  sentence?: string,
  url?: string,
  fromTab?: number,
): Promise<"saved" | "duplicate"> {
  const cards = await getCards();
  // One card per word: the same word is reachable from several dictionary
  // entries and from more than one page, and a second card would carry its
  // own review schedule.
  if (findDuplicate(Object.values(cards), entry.term, entry.reading)) return "duplicate";

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
  void tellAppAboutNewWords();
  deliverSoon(fromTab);
  return "saved";
}

/**
 * Words the app has not taken yet.
 *
 * Offered to the app automatically whenever it is open — see
 * apps/web/src/extension-bridge.ts. Cards stay here afterwards; only the
 * "already handed over" mark is added, so this store remains usable on its
 * own and the manual handoff still works.
 */
async function pendingForApp(): Promise<Card[]> {
  const cards = await getCards();
  return (
    Object.values(cards)
      .filter((c) => !c.deleted && !c.handedOff)
      // Oldest first, so a large backlog arrives in the order it was mined.
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 500)
      .map(({ dirty: _dirty, handedOff: _handedOff, ...card }) => card)
  );
}

/** The app's location, as configured in the toolbar popup. */
async function appUrlSetting(): Promise<string> {
  const settings = await storageGet<{ settings?: { appUrl?: string } }>("settings");
  return settings.settings?.appUrl?.trim() || DEFAULT_APP_URL;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The secret that lets words be dropped into the app from any page.
 *
 * Kept per origin. The app mints it in its own storage, so a copy served
 * from somewhere else is a different app with a different secret — one flat
 * token meant that moving the app URL left the extension offering the old
 * host's secret to the new host, which quietly refuses it for ever.
 */
async function tokenFor(appUrl: string): Promise<string | undefined> {
  const origin = originOf(appUrl);
  if (!origin) return undefined;
  const data = await storageGet<{ handoverTokens?: Record<string, string>; handoverToken?: string }>([
    "handoverTokens",
    "handoverToken",
  ]);
  // The flat key is what builds before this one wrote; it is only ever right
  // for whichever app was configured then, so it is a last resort.
  return data.handoverTokens?.[origin] ?? data.handoverToken;
}

async function rememberToken(appUrl: string, token: string): Promise<void> {
  const origin = originOf(appUrl);
  if (!origin) return;
  const data = await storageGet<{ handoverTokens?: Record<string, string> }>("handoverTokens");
  await storageSet({ handoverTokens: { ...(data.handoverTokens ?? {}), [origin]: token } });
}

/**
 * Why the last delivery went the way it did.
 *
 * Words travelling on their own is the whole design, and its failure mode is
 * silence: the menu said "they keep trying" whether the next attempt would
 * work or whether nothing would ever work again. This is what it says
 * instead.
 */
export type DeliveryState = "delivered" | "nothing-to-do" | "not-linked" | "no-page" | "refused" | "failed";

interface LastDelivery {
  at: number;
  state: DeliveryState;
  delivered: number;
  detail?: string;
}

async function noteDelivery(state: DeliveryState, delivered: number, detail?: string): Promise<void> {
  const note: LastDelivery = { at: Date.now(), state, delivered };
  if (detail) note.detail = detail;
  await storageSet({ lastDelivery: note });
}

/**
 * Nudge an already-open app tab to collect the word just saved.
 *
 * Without this the app only picks words up when its page loads, so anything
 * saved while it sits open in another tab would appear to have gone nowhere
 * until the user reloaded it.
 */
async function tellAppAboutNewWords(): Promise<void> {
  const appUrl = await appUrlSetting();
  const pattern = appUrl.replace(/[^/]*$/, "") + "*"; // the app's directory
  for (const tab of await tabsMatching(pattern)) {
    if (tab.id !== undefined) void sendToTab(tab.id, { type: "appHasNewWords" });
  }
}

/**
 * Put the words into the app's deck now, whether or not the app is open.
 *
 * The writing has to happen on the app's own origin, and a service worker has
 * no DOM to load a page with — so the content script already running in the
 * user's tab does it, loading the app's drop box in a hidden frame. That
 * needs no permission beyond the one that put the content script there:
 * asking for more would make browsers hold the extension for re-approval,
 * which is indistinguishable from it being broken.
 */
let delivering: Promise<void> = Promise.resolve();

/**
 * Tabs that can host the hidden frame: the one just used, then the active
 * one, then every other ordinary page — a site whose policy blocks frames
 * must not be the end of it when the next tab over would have worked.
 */
async function deliveryTabs(preferred?: number): Promise<number[]> {
  const ids: number[] = [];
  if (preferred !== undefined) ids.push(preferred);
  const active = await activeTab();
  if (active?.id !== undefined && !ids.includes(active.id)) ids.push(active.id);
  for (const pattern of ["https://*/*", "http://*/*"]) {
    for (const tab of await tabsMatching(pattern).catch(() => [])) {
      if (tab.id !== undefined && !ids.includes(tab.id)) ids.push(tab.id);
    }
  }
  return ids.slice(0, 8);
}

async function deliverToApp(preferredTab?: number): Promise<DeliveryState> {
  const pending = await pendingForApp();
  if (pending.length === 0) {
    await noteDelivery("nothing-to-do", 0);
    return "nothing-to-do";
  }
  const appUrl = await appUrlSetting();
  // The app's drop box will not take words without the secret it minted, and
  // it only hands that over on its own page. Until the app has been opened
  // once, the older routes carry the words instead.
  const token = await tokenFor(appUrl);
  if (!token) {
    await noteDelivery("not-linked", 0);
    return "not-linked";
  }
  const frameUrl = syncFrameUrl(appUrl);

  let refused = false;
  let detail = "";
  const tabs = await deliveryTabs(preferredTab);
  for (const tabId of tabs) {
    const res = await sendToTab<{ ids?: string[]; error?: string }>(tabId, {
      type: "deliverViaFrame",
      frameUrl,
      cards: pending,
      token,
    });
    if (res?.ids) {
      await markHandedOff(res.ids);
      await noteDelivery("delivered", res.ids.length);
      return "delivered";
    }
    if (res?.error) {
      detail = res.error;
      // The app answered and would not take them: the secret this extension
      // holds is not the one that app minted. Trying the next tab cannot
      // change that, and every other route is the same door.
      if (/not linked|refused/i.test(res.error)) refused = true;
    }
    if (refused) break;
  }
  // No page could do it — a restricted tab, a page whose own policy forbids
  // frames, or no connection. The words stay pending and go on the next save.
  const state: DeliveryState = refused ? "refused" : tabs.length === 0 ? "no-page" : "failed";
  await noteDelivery(state, 0, detail);
  return state;
}

/** Deliver, quietly: saving a word must never fail because of this. */
function deliverSoon(preferredTab?: number): void {
  delivering = delivering
    .catch(() => {})
    .then(async () => {
      await deliverToApp(preferredTab).catch(() => {
        /* stays pending; tried again on the next save */
      });
    });
}

/**
 * Fetch something the app's page is not allowed to fetch itself.
 *
 * Audio services written for Yomitan and Anki serve extensions and desktop
 * programs, neither of which is bound by CORS, so many never send the header
 * a web page needs. This extension is not bound by it either — given
 * permission, which is optional and asked for in the toolbar menu.
 */
async function fetchForApp(url: string): Promise<{ base64?: string; contentType?: string; error?: string }> {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return { error: "not a http(s) url" };

  const origin = (() => {
    try {
      return new URL(url).origin + "/*";
    } catch {
      return null;
    }
  })();
  if (!origin) return { error: "not a valid url" };

  try {
    const allowed = await new Promise<boolean>((resolve) => {
      try {
        const result = ext.permissions?.contains({ origins: [origin] }, resolve);
        if (result && typeof result.then === "function") result.then(resolve, () => resolve(false));
      } catch {
        resolve(false);
      }
    });
    if (!allowed) return { error: "not allowed to fetch that yet" };
  } catch {
    return { error: "could not check permissions" };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `the service returned ${res.status}` };
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    // In chunks: one huge apply() blows the argument limit on big clips.
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { base64: btoa(binary), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Record that the app has these words, so they stop being offered. */
async function markHandedOff(ids: unknown): Promise<number> {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const cards = await getCards();
  let marked = 0;
  for (const id of ids) {
    const card = typeof id === "string" ? cards[id] : undefined;
    if (card && !card.handedOff) {
      cards[id as string] = { ...card, handedOff: true };
      marked++;
    }
  }
  if (marked > 0) {
    await setCards(cards);
    await storageSet({ lastHandoffAt: Date.now() });
  }
  return marked;
}

async function isSaved(term: string, reading: string): Promise<boolean> {
  const cards = await getCards();
  return Object.values(cards).some((c) => !c.deleted && c.term === term && c.reading === reading);
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

ext.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (r: any) => void) => {
  (async () => {
    switch (message?.type) {
      // A page has finished loading. Start the dictionary now, while the
      // user is still reading, rather than on the tap they are waiting for.
      // Used by the toolbar popup, and after a browser restart, to flush
      // anything that could not be delivered at the time it was saved.
      case "deliverNow": {
        try {
          sendResponse({ ok: true, state: await deliverToApp() });
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      /*
       * The button in the toolbar menu.
       *
       * It used to be a sync-server push, which almost nobody has one of, so
       * pressing it said "set the sync server URL and token first" — an
       * error about a thing that is not how words travel. The words travel
       * by the hidden frame; that is what this does, and the server is only
       * touched when somebody has actually configured one.
       */
      case "pushNow": {
        try {
          const state = await deliverToApp();
          const data = await storageGet<{ settings?: { url?: string; token?: string } }>("settings");
          const server = data.settings;
          let synced: { pushed: number; pulled: number } | undefined;
          if (server?.url && server.token) synced = await handleSync().catch(() => undefined);
          sendResponse({ state, appUrl: await appUrlSetting(), synced });
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case "warm": {
        void getDictionary().catch(() => {
          /* reported when a lookup is actually attempted */
        });
        sendResponse({ ok: true });
        break;
      }
      case "pendingForApp": {
        sendResponse(await pendingForApp());
        break;
      }
      case "fetchForApp": {
        sendResponse(await fetchForApp(message.url));
        break;
      }
      case "setHandoverToken": {
        if (typeof message.token === "string" && message.token.length >= 32) {
          // Against the origin of the page that offered it, not the one in
          // settings: those are the same page, and the page is the truth.
          await rememberToken(typeof sender?.tab?.url === "string" ? sender.tab.url : await appUrlSetting(), message.token);
          await storageSet({ handoverToken: message.token });
          deliverSoon(sender?.tab?.id); // a backlog may be waiting on this
        }
        sendResponse({ ok: true });
        break;
      }
      case "handedOff": {
        sendResponse({ marked: await markHandedOff(message.ids) });
        break;
      }
      case "lookup": {
        const dict = await getDictionary();
        const matches: LookupMatch[] = lookup(dict, message.text, message.offset ?? 0);
        sendResponse(matches.slice(0, 8));
        break;
      }
      case "save": {
        const outcome = await handleSave(message.entry, message.sentence, message.url, sender?.tab?.id);
        sendResponse({ ok: true, outcome });
        break;
      }
      case "isSaved": {
        sendResponse(await isSaved(message.term, message.reading));
        break;
      }
      case "stats": {
        const cards = await getCards();
        const live = Object.values(cards).filter((c) => !c.deleted);
        const meta = await storageGet<{ lastHandoffAt?: number; lastDelivery?: LastDelivery }>([
          "lastHandoffAt",
          "lastDelivery",
        ]);
        const appUrl = await appUrlSetting();
        sendResponse({
          total: live.length,
          waiting: live.filter((c) => !c.handedOff).length,
          dirty: live.filter((c) => c.dirty).length,
          lastHandoffAt: meta.lastHandoffAt ?? null,
          version: ext.runtime.getManifest?.().version ?? null,
          appUrl,
          // Whether this app has ever handed over the secret that lets words
          // in. Without it nothing can arrive, however many times it tries.
          linked: (await tokenFor(appUrl)) !== undefined,
          lastDelivery: meta.lastDelivery ?? null,
        });
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
        const data = await storageGet<{
          settings?: any;
          tapMode?: boolean | null;
          showToggle?: boolean;
        }>(["settings", "tapMode", "showToggle"]);
        sendResponse({
          settings: { appUrl: DEFAULT_APP_URL, ...(data.settings ?? {}) },
          tapMode: data.tapMode ?? null,
          showToggle: data.showToggle !== false,
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
      case "setShowToggle": {
        await storageSet({ showToggle: message.enabled });
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse(null);
    }
  })();
  return true; // keep the message channel open for the async response
});

// A backlog can build up while the browser is closed, or while the app URL
// is wrong; flush it once things are running again. The address the app is
// served from is checked at the same time, because an update that moves it
// must not leave everybody pointing at where it used to be.
ext.runtime.onStartup?.addListener(() => void migrateAppUrl().then(() => deliverSoon()));
ext.runtime.onInstalled?.addListener(() => void migrateAppUrl().then(() => deliverSoon()));

/*
 * And on a timer, whether or not anything happens.
 *
 * Every other trigger here is somebody doing something: saving a word,
 * loading a page, opening this menu. A phone left on one tab all evening
 * does none of them, and a delivery that failed because that one tab
 * happened to be a restricted page would then wait for the next save rather
 * than for the next minute. `alarms` is a permission with no warning
 * attached, so adding it does not make a browser hold the extension for
 * re-approval the way a host permission would.
 */
const FLUSH_ALARM = "yomeyo-flush";
ext.alarms?.create?.(FLUSH_ALARM, { periodInMinutes: 5, delayInMinutes: 1 });
ext.alarms?.onAlarm?.addListener((alarm: any) => {
  if (alarm?.name !== FLUSH_ALARM) return;
  void (async () => {
    if ((await pendingForApp()).length === 0) return;
    deliverSoon();
  })();
});

// And whenever any ordinary page finishes loading: a save that could not be
// delivered (every open tab restricted, or offline) goes across the moment
// there is a page that can host the frame, not on the next save. Throttled,
// because busy browsing fires this constantly.
let lastAutoFlush = 0;
ext.tabs?.onUpdated?.addListener((tabId: number, info: any, tab: any) => {
  if (info?.status !== "complete") return;
  if (typeof tab?.url !== "string" || !/^https?:/i.test(tab.url)) return;
  const now = Date.now();
  if (now - lastAutoFlush < 10000) return;
  lastAutoFlush = now;
  void (async () => {
    if ((await pendingForApp()).length === 0) return;
    deliverSoon(tabId);
  })();
});
