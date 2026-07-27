import {
  CombinedDictionary,
  MemoryDictionary,
  parseDictFile,
  parseYomitanTermBank,
  type DictEntry,
  type Dictionary,
} from "@yomeyo/core";
import { getMeta, setMeta } from "./db.js";

/**
 * Extra dictionaries alongside the built-in JMdict English one.
 *
 * JMdict has no Japanese glosses, so a monolingual (Japanese-Japanese)
 * dictionary cannot be shipped with the app — the well-known ones are
 * copyrighted. What it can do is read the format those dictionaries are
 * distributed in, so a dictionary you already have can be added here and
 * used for lookups like any other.
 *
 * Two formats are accepted:
 *  - Yomitan / Yomichan `term_bank_*.json` files (unzip the dictionary first)
 *  - Yomeyo's own compact dictionary format
 */

export interface ExtraDictionary {
  id: string;
  name: string;
  entryCount: number;
  addedAt: number;
  enabled: boolean;
}

const LIST_KEY = "extraDictionaries";
const dataKey = (id: string) => `dictData:${id}`;

export async function listDictionaries(): Promise<ExtraDictionary[]> {
  return (await getMeta<ExtraDictionary[]>(LIST_KEY)) ?? [];
}

async function saveList(list: ExtraDictionary[]): Promise<void> {
  await setMeta(LIST_KEY, list);
  combinedCache = null;
}

/**
 * Add a dictionary from one or more files.
 *
 * A Yomitan dictionary is a zip of several `term_bank_N.json` parts, so
 * multiple files are merged into one entry rather than appearing as several
 * unrelated dictionaries.
 */
export async function importDictionary(name: string, files: File[]): Promise<ExtraDictionary> {
  const entries: DictEntry[] = [];

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} is not valid JSON. Unzip the dictionary first and pick the term_bank files.`);
    }

    if (Array.isArray(parsed)) {
      // Either a Yomitan term bank or a plain Yomeyo entry list.
      const first = parsed[0];
      if (Array.isArray(first)) {
        entries.push(...parseYomitanTermBank(parsed, name));
      } else if (first && typeof first === "object" && "term" in (first as object)) {
        entries.push(...parseDictFile(parsed).map((e) => ({ ...e, source: name })));
      } else if (parsed.length > 0) {
        throw new Error(`${file.name} is JSON but not a dictionary this app understands.`);
      }
    } else if (parsed && typeof parsed === "object" && "format" in (parsed as object)) {
      entries.push(...parseDictFile(parsed).map((e) => ({ ...e, source: name })));
    } else {
      throw new Error(`${file.name} is not a recognised dictionary file.`);
    }
  }

  if (entries.length === 0) throw new Error("No entries found in those files.");

  const id = `d${Date.now().toString(36)}`;
  await setMeta(dataKey(id), entries);
  const record: ExtraDictionary = {
    id,
    name,
    entryCount: entries.length,
    addedAt: Date.now(),
    enabled: true,
  };
  await saveList([...(await listDictionaries()), record]);
  return record;
}

export async function setDictionaryEnabled(id: string, enabled: boolean): Promise<void> {
  const list = await listDictionaries();
  await saveList(list.map((d) => (d.id === id ? { ...d, enabled } : d)));
}

export async function removeDictionary(id: string): Promise<void> {
  await setMeta(dataKey(id), undefined);
  await saveList((await listDictionaries()).filter((d) => d.id !== id));
}

// ---------------- lookup wiring ----------------

let combinedCache: Promise<Dictionary> | null = null;

/** Invalidate the combined dictionary (called when the built-in one loads). */
export function resetCombined(): void {
  combinedCache = null;
}

/**
 * The built-in dictionary plus every enabled extra one, as a single
 * lookupable dictionary. The built-in stays first so everyday words keep
 * their familiar definitions at the top.
 */
export async function combineWith(builtIn: Dictionary): Promise<Dictionary> {
  if (!combinedCache) {
    combinedCache = (async () => {
      const enabled = (await listDictionaries()).filter((d) => d.enabled);
      if (enabled.length === 0) return builtIn;

      const parts = [{ name: "JMdict", dictionary: builtIn }];
      for (const record of enabled) {
        const entries = await getMeta<DictEntry[]>(dataKey(record.id));
        if (entries?.length) {
          parts.push({ name: record.name, dictionary: new MemoryDictionary(entries) });
        }
      }
      return parts.length === 1 ? builtIn : new CombinedDictionary(parts);
    })();
  }
  return combinedCache;
}
