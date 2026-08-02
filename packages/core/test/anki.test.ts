import { describe, expect, it } from "vitest";
import {
  convertSchedule,
  extractMediaRefs,
  guessFieldMapping,
  noteMedia,
  notesToCards,
  openZip,
  parseMediaManifest,
  parseTextExport,
  readApkg,
  readCollection,
  readMediaManifest,
  SqliteFile,
  columnsOf,
  splitFurigana,
  splitGlosses,
  stripHtml,
  summarise,
} from "../src/index.js";
import { buildCollection, buildZip } from "./anki-fixture.js";

const SEP = "\u001f";

describe("field text", () => {
  it("turns a field's HTML into what the card showed", () => {
    expect(stripHtml("<div>one</div><div>two</div>")).toBe("one\ntwo");
    expect(stripHtml("a<br>b<br/>c")).toBe("a\nb\nc");
    expect(stripHtml("<b>bold</b> &amp; <i>italic</i>")).toBe("bold & italic");
    expect(stripHtml("&#26085;&#x672c;")).toBe("日本");
  });

  it("leaves an entity it does not know rather than mangling it", () => {
    expect(stripHtml("&zwnj;x")).toBe("&zwnj;x");
  });

  it("splits Anki furigana into the word and its reading", () => {
    expect(splitFurigana("水[みず]")).toEqual({ text: "水", reading: "みず" });
    expect(splitFurigana("水臭[みずくさ]い")).toEqual({ text: "水臭い", reading: "みずくさい" });
    expect(splitFurigana(" 今日[きょう]は 良[よ]い 天気[てんき]です")).toEqual({
      text: "今日は良い天気です",
      reading: "きょうはよいてんきです",
    });
  });

  it("leaves a field with no furigana alone", () => {
    expect(splitFurigana("たべる")).toEqual({ text: "たべる", reading: "" });
  });

  it("breaks a meaning field into separate glosses", () => {
    expect(splitGlosses("to eat; to drink")).toEqual(["to eat", "to drink"]);
    expect(splitGlosses("<div>1. senior</div><div>2. superior</div>")).toEqual(["senior", "superior"]);
    expect(splitGlosses("   ")).toEqual([]);
  });

  it("drops sound tags the way a card hides its replay button", () => {
    expect(stripHtml("水[sound:mizu.mp3]")).toBe("水");
    expect(stripHtml("[sound:rec_1.mp3]water; cold water")).toBe("water; cold water");
  });
});

describe("media in the fields", () => {
  it("finds the clips and pictures a field names", () => {
    expect(extractMediaRefs('水 [sound:mizu.mp3] <img src="mizu.jpg">')).toEqual({
      audio: ["mizu.mp3"],
      images: ["mizu.jpg"],
    });
  });

  it("reads a src however it is quoted", () => {
    expect(extractMediaRefs("<img src='a.png'>").images).toEqual(["a.png"]);
    expect(extractMediaRefs("<img class=x src=b.png alt=y>").images).toEqual(["b.png"]);
    expect(extractMediaRefs('<img alt="word" src="c.png" />').images).toEqual(["c.png"]);
  });

  it("undoes entities so the name matches the archive", () => {
    expect(extractMediaRefs('<img src="a&amp;b.jpg">').images).toEqual(["a&b.jpg"]);
  });

  it("leaves out images that live on the web, not in the archive", () => {
    const refs = extractMediaRefs('<img src="https://example.com/x.png"> <img src="data:image/png;base64,AA==">');
    expect(refs.images).toEqual([]);
  });

  it("tells the sentence being read out from the word being pronounced", () => {
    const mapping = { term: 0, reading: -1, meaning: 1, sentence: 2 };
    const media = noteMedia(
      ["水", "water", "水を飲む[sound:sentence_1.mp3]", "[sound:word_1.mp3]", '<img src="mizu.jpg">'],
      mapping,
      ["Word", "Meaning", "Sentence", "Vocabulary-Audio", "Picture"],
    );
    expect(media).toEqual({ audio: "word_1.mp3", sentenceAudio: "sentence_1.mp3", image: "mizu.jpg" });
  });

  it("treats a 'Sentence-Audio' field as sentence audio even though it maps to no role", () => {
    const mapping = { term: 0, reading: -1, meaning: 1, sentence: -1 };
    const media = noteMedia(["水", "water", "[sound:s.mp3]"], mapping, ["Word", "Meaning", "Sentence-Audio"]);
    expect(media.sentenceAudio).toBe("s.mp3");
    expect(media.audio).toBeUndefined();
  });
});

describe("the media manifest", () => {
  it("reads the JSON manifest of older exports", () => {
    const bytes = new TextEncoder().encode('{"0": "水.mp3", "1": "水.jpg"}');
    const names = parseMediaManifest(bytes);
    expect(names.get("水.mp3")).toBe("0");
    expect(names.get("水.jpg")).toBe("1");
  });

  it("reads the protobuf manifest of newer exports", () => {
    // Two entries; each is field 1 of the list, its name field 1 of the entry.
    const encoder = new TextEncoder();
    const entry = (name: string): number[] => {
      const text = encoder.encode(name);
      return [0x0a, text.length + 2, 0x0a, text.length, ...text];
    };
    const bytes = new Uint8Array([...entry("a.mp3"), ...entry("b.jpg")]);
    const names = parseMediaManifest(bytes);
    expect(names.get("a.mp3")).toBe("0");
    expect(names.get("b.jpg")).toBe("1");
  });

  it("returns nothing rather than something wrong for bytes it cannot read", () => {
    expect(parseMediaManifest(new Uint8Array([0xff, 0xff, 0xff])).size).toBe(0);
    expect(parseMediaManifest(new TextEncoder().encode("{broken")).size).toBe(0);
    expect(parseMediaManifest(new Uint8Array()).size).toBe(0);
  });

  it("reads the manifest out of an archive", async () => {
    const apkg = buildZip([
      { name: "media", data: new TextEncoder().encode('{"0": "mizu.mp3"}'), stored: true },
      { name: "0", data: new Uint8Array([1, 2, 3]), stored: true },
    ]);
    const names = await readMediaManifest(await openZip(apkg));
    expect(names.get("mizu.mp3")).toBe("0");
  });

  it("treats an archive without a manifest as a deck without media", async () => {
    const apkg = buildZip([{ name: "readme.txt", data: new TextEncoder().encode("hi") }]);
    expect((await readMediaManifest(await openZip(apkg))).size).toBe(0);
  });
});

describe("guessing which field is which", () => {
  it("reads the common Japanese note types without being told", () => {
    expect(guessFieldMapping(["Word", "Reading", "Meaning", "Sentence"])).toEqual({
      term: 0,
      reading: 1,
      meaning: 2,
      sentence: 3,
    });
    expect(guessFieldMapping(["Expression", "Kana", "English Definition", "Example Sentence"])).toEqual({
      term: 0,
      reading: 1,
      meaning: 2,
      sentence: 3,
    });
  });

  it("handles Japanese field names", () => {
    const mapping = guessFieldMapping(["単語", "読み", "意味", "例文"]);
    expect(mapping).toEqual({ term: 0, reading: 1, meaning: 2, sentence: 3 });
  });

  it("falls back to position when the names say nothing", () => {
    const mapping = guessFieldMapping(["A", "B", "C"]);
    expect(mapping.term).toBe(0);
    expect(mapping.meaning).toBe(1);
  });

  it("never gives two roles the same field", () => {
    const mapping = guessFieldMapping(["Front", "Back"]);
    const used = [mapping.term, mapping.reading, mapping.meaning, mapping.sentence].filter((i) => i >= 0);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("reading a collection database", () => {
  const notes = [
    { id: 1600000001000, fields: ["水[みず]", "みず", "water", "水を飲む"] },
    { id: 1600000002000, fields: ["先輩", "せんぱい", "senior; superior", ""] },
  ];

  it("reads notes and note types out of a schema 11 collection", () => {
    const collection = readCollection(buildCollection({ notes }));
    expect(collection.notes).toHaveLength(2);
    expect(collection.notes[0].fields).toEqual(["水[みず]", "みず", "water", "水を飲む"]);
    expect(collection.noteTypes[0].fieldNames).toEqual(["Word", "Reading", "Meaning", "Sentence"]);
    expect(collection.createdAt).toBe(1600000000);
  });

  it("reads field names from the tables a newer collection uses", () => {
    const collection = readCollection(buildCollection({ schema: 18, notes }));
    expect(collection.noteTypes[0].name).toBe("Japanese vocab");
    expect(collection.noteTypes[0].fieldNames).toEqual(["Word", "Reading", "Meaning", "Sentence"]);
  });

  it("reads a note far too long to fit in one page", () => {
    // Long fields spill onto overflow pages, which is a separate code path
    // and the one a real mining deck with screenshots and long sentences hits.
    const long = "あ".repeat(20000);
    const collection = readCollection(
      buildCollection({ notes: [{ id: 1600000003000, fields: ["長い", "ながい", long, ""] }] }),
    );
    expect(collection.notes[0].fields[2]).toHaveLength(20000);
    expect(collection.notes[0].fields[2]).toBe(long);
  });

  it("reads a collection with more notes than fit on one page", () => {
    // Enough rows to force the b-tree to grow interior pages, so the walk has
    // to descend rather than read a single leaf.
    const many = Array.from({ length: 2000 }, (_, i) => ({
      id: 1600000000000 + i,
      fields: [`語${i}`, `よみ${i}`, `meaning ${i}`, ""],
    }));
    const collection = readCollection(buildCollection({ notes: many }));
    expect(collection.notes).toHaveLength(2000);
    expect(collection.notes.at(-1)?.fields[0]).toBe("語1999");
  });

  it("keeps each note's scheduling", () => {
    const collection = readCollection(
      buildCollection({
        notes: [
          {
            id: 1600000004000,
            fields: ["復習", "ふくしゅう", "review", ""],
            card: { type: 2, queue: 2, due: 500, ivl: 120, factor: 2350, reps: 14, lapses: 2 },
          },
        ],
      }),
    );
    expect(collection.schedules.get(1600000004000)).toEqual({
      type: 2,
      queue: 2,
      due: 500,
      ivl: 120,
      factor: 2350,
      reps: 14,
      lapses: 2,
    });
  });

  it("refuses a file that is not a database", () => {
    expect(() => readCollection(new TextEncoder().encode("not sqlite at all"))).toThrow(/not a SQLite/i);
  });
});

describe("reading an .apkg", () => {
  const collection = buildCollection({
    notes: [{ id: 1600000005000, fields: ["辞書", "じしょ", "dictionary", ""] }],
  });

  it("finds the collection inside the archive", async () => {
    const apkg = buildZip([
      { name: "collection.anki2", data: collection },
      { name: "media", data: new TextEncoder().encode("{}"), stored: true },
      { name: "0", data: new Uint8Array([1, 2, 3]), stored: true },
    ]);
    const read = await readApkg(apkg);
    expect(read.notes[0].fields[0]).toBe("辞書");
  });

  it("prefers the newer collection when both are present", async () => {
    const newer = buildCollection({
      notes: [{ id: 1600000006000, fields: ["新しい", "あたらしい", "new", ""] }],
    });
    const apkg = buildZip([
      { name: "collection.anki2", data: collection },
      { name: "collection.anki21", data: newer },
    ]);
    expect((await readApkg(apkg)).notes[0].fields[0]).toBe("新しい");
  });

  it("says what to do when the collection is zstd-compressed", async () => {
    const zstd = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0, 0, 0]);
    const apkg = buildZip([{ name: "collection.anki21b", data: zstd }]);
    await expect(readApkg(apkg)).rejects.toThrow(/Support older Anki versions|Plain Text/i);
  });

  it("rejects an archive with no collection in it", async () => {
    const apkg = buildZip([{ name: "readme.txt", data: new TextEncoder().encode("hello") }]);
    await expect(readApkg(apkg)).rejects.toThrow(/no Anki collection/i);
  });

  it("lists entries without decompressing them", async () => {
    const apkg = buildZip([
      { name: "collection.anki2", data: collection },
      { name: "media", data: new TextEncoder().encode("{}") },
    ]);
    expect((await openZip(apkg)).entries.map((e) => e.name)).toEqual(["collection.anki2", "media"]);
  });
});

describe("plain-text exports", () => {
  it("reads Anki's tab-separated export", () => {
    const text = ["#separator:tab", "#html:true", "水\tみず\twater", "火\tひ\tfire"].join("\n");
    const parsed = parseTextExport(text);
    expect(parsed.rows).toEqual([
      ["水", "みず", "water"],
      ["火", "ひ", "fire"],
    ]);
  });

  it("uses the column names when the export declares them", () => {
    const text = ["#separator:tab", "#columns:Word\tReading\tMeaning", "水\tみず\twater"].join("\n");
    expect(parseTextExport(text).fieldNames).toEqual(["Word", "Reading", "Meaning"]);
  });

  it("honours a separator that is not a tab", () => {
    const parsed = parseTextExport(["#separator:semicolon", "水;みず;water"].join("\n"));
    expect(parsed.rows[0]).toEqual(["水", "みず", "water"]);
  });

  it("names the columns by position when nothing says otherwise", () => {
    expect(parseTextExport("水\tみず").fieldNames).toEqual(["Field 1", "Field 2"]);
  });
});

describe("Anki scheduling in Yomeyo's terms", () => {
  const crt = 1600000000; // when the collection was made, in seconds
  const now = Date.UTC(2024, 0, 1);

  it("keeps a review card's interval and due date", () => {
    const converted = convertSchedule(
      { type: 2, queue: 2, due: 500, ivl: 120, factor: 2350, reps: 14, lapses: 2 },
      crt,
      now,
    );
    expect(converted.state).toBe("review");
    expect(converted.intervalDays).toBe(120);
    expect(converted.ease).toBeCloseTo(2.35, 5);
    expect(converted.reps).toBe(14);
    expect(converted.lapses).toBe(2);
    expect(converted.due).toBe((crt + 500 * 86400) * 1000);
  });

  it("starts a new card as new, whatever its ease says", () => {
    const converted = convertSchedule({ type: 0, queue: 0, due: 3, ivl: 0, factor: 0, reps: 0, lapses: 0 }, crt, now);
    expect(converted.state).toBe("new");
    expect(converted.due).toBe(now);
    expect(converted.ease).toBe(2.5);
  });

  it("reads a learning card's due time as a timestamp", () => {
    const at = 1700000123;
    const converted = convertSchedule({ type: 1, queue: 1, due: at, ivl: 0, factor: 2500, reps: 3, lapses: 0 }, crt, now);
    expect(converted.state).toBe("learning");
    expect(converted.due).toBe(at * 1000);
  });

  it("treats a relearning card as relearning", () => {
    const converted = convertSchedule({ type: 3, queue: 1, due: 5, ivl: 0, factor: 2100, reps: 9, lapses: 4 }, crt, now);
    expect(converted.state).toBe("relearning");
    expect(converted.due).toBe(now); // too small to be a timestamp
  });

  it("converts an old negative interval from seconds to days", () => {
    const converted = convertSchedule(
      { type: 2, queue: 2, due: 10, ivl: -172800, factor: 2500, reps: 4, lapses: 0 },
      crt,
      now,
    );
    expect(converted.intervalDays).toBe(2);
  });

  it("never lets ease fall below Anki's own floor", () => {
    const converted = convertSchedule({ type: 2, queue: 2, due: 1, ivl: 3, factor: 900, reps: 2, lapses: 8 }, crt, now);
    expect(converted.ease).toBe(1.3);
  });

  it("marks a suspended card so the deck options can hold it back", () => {
    const converted = convertSchedule({ type: 2, queue: -1, due: 1, ivl: 30, factor: 2500, reps: 5, lapses: 1 }, crt, now);
    expect(converted.leech).toBe(true);
  });
});

describe("turning notes into cards", () => {
  const mapping = { term: 0, reading: 1, meaning: 2, sentence: 3 };
  const now = Date.UTC(2024, 0, 1);

  it("makes one card per note", () => {
    const cards = notesToCards(
      [{ id: 1, fields: ["水", "みず", "water", "水を飲む"] }],
      mapping,
      { now },
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      term: "水",
      reading: "みず",
      glosses: ["water"],
      sentence: "水を飲む",
      source: "Anki",
      state: "new",
    });
  });

  it("takes the reading from furigana when there is no reading field", () => {
    const cards = notesToCards([{ id: 1, fields: ["水臭[みずくさ]い", "", "cold, distant", ""] }], mapping, { now });
    expect(cards[0].term).toBe("水臭い");
    expect(cards[0].reading).toBe("みずくさい");
  });

  it("drops notes with nothing in the term field", () => {
    const cards = notesToCards(
      [
        { id: 1, fields: ["", "", "orphaned", ""] },
        { id: 2, fields: ["火", "ひ", "fire", ""] },
      ],
      mapping,
      { now },
    );
    expect(cards.map((c) => c.term)).toEqual(["火"]);
  });

  it("brings the scheduling across when asked", () => {
    const schedules = new Map([
      [1, { type: 2, queue: 2, due: 500, ivl: 120, factor: 2350, reps: 14, lapses: 2 }],
    ]);
    const cards = notesToCards(
      [{ id: 1, fields: ["復習", "ふくしゅう", "review", ""] }],
      mapping,
      { now, keepScheduling: true, collectionCreatedAt: 1600000000 },
      schedules,
    );
    expect(cards[0].state).toBe("review");
    expect(cards[0].intervalDays).toBe(120);
    expect(cards[0].reps).toBe(14);
  });

  it("starts everything from new when not asked", () => {
    const schedules = new Map([
      [1, { type: 2, queue: 2, due: 500, ivl: 120, factor: 2350, reps: 14, lapses: 2 }],
    ]);
    const cards = notesToCards([{ id: 1, fields: ["復習", "", "review", ""] }], mapping, { now }, schedules);
    expect(cards[0].state).toBe("new");
    expect(cards[0].reps).toBe(0);
  });

  it("carries each note's media across as the filenames it used", () => {
    const cards = notesToCards(
      [
        {
          id: 1,
          fields: ["水[sound:mizu.mp3]", "みず", 'water <img src="mizu.jpg">', "水を飲む[sound:s1.mp3]"],
        },
      ],
      mapping,
      { now, fieldNames: ["Word", "Reading", "Meaning", "Sentence"] },
    );
    expect(cards[0]).toMatchObject({
      term: "水",
      audio: "mizu.mp3",
      sentenceAudio: "s1.mp3",
      image: "mizu.jpg",
    });
    // The tags are gone from the text the card shows.
    expect(cards[0].glosses).toEqual(["water"]);
    expect(cards[0].sentence).toBe("水を飲む");
  });

  it("leaves the media fields off a card whose note has none", () => {
    const cards = notesToCards([{ id: 1, fields: ["水", "みず", "water", ""] }], mapping, { now });
    expect("audio" in cards[0]).toBe(false);
    expect("sentenceAudio" in cards[0]).toBe(false);
    expect("image" in cards[0]).toBe(false);
  });

  it("gives every card its own id", () => {
    const cards = notesToCards(
      [
        { id: 1, fields: ["水", "みず", "water", ""] },
        { id: 2, fields: ["火", "ひ", "fire", ""] },
      ],
      mapping,
      { now },
    );
    expect(cards[0].id).not.toBe(cards[1].id);
  });

  it("summarises what an import would bring", () => {
    const schedules = new Map([
      [1, { type: 2, queue: 2, due: 500, ivl: 120, factor: 2350, reps: 14, lapses: 2 }],
      [2, { type: 2, queue: -1, due: 10, ivl: 30, factor: 2500, reps: 5, lapses: 1 }],
    ]);
    const cards = notesToCards(
      [
        { id: 1, fields: ["復習", "", "review", ""] },
        { id: 2, fields: ["休止", "", "suspended", ""] },
        { id: 3, fields: ["新規", "", "brand new", ""] },
      ],
      mapping,
      { now, keepScheduling: true, collectionCreatedAt: 1600000000 },
      schedules,
    );
    const summary = summarise(cards, now);
    expect(summary.total).toBe(3);
    expect(summary.withScheduling).toBe(2);
    expect(summary.suspended).toBe(1);
    expect(summary.implausible).toBe(0);
  });
});

describe("end to end, from an .apkg to cards", () => {
  it("imports a deck the way somebody leaving Anki would", async () => {
    const collection = buildCollection({
      crt: 1600000000,
      fieldNames: ["Expression", "Reading", "Meaning", "Sentence"],
      notes: [
        {
          id: 1600000010000,
          fields: ["水臭[みずくさ]い", "", "<div>cold, distant</div><div>watery</div>", "水臭いこと言うなよ"],
          card: { type: 2, queue: 2, due: 900, ivl: 45, factor: 2400, reps: 20, lapses: 1 },
        },
        { id: 1600000011000, fields: ["玄人", "くろうと", "expert", ""] },
      ],
    });
    const apkg = buildZip([
      { name: "collection.anki2", data: collection },
      { name: "media", data: new TextEncoder().encode("{}"), stored: true },
    ]);

    const read = await readApkg(apkg);
    const mapping = guessFieldMapping(read.noteTypes[0].fieldNames);
    const cards = notesToCards(read.notes, mapping, {
      keepScheduling: true,
      collectionCreatedAt: read.createdAt,
      now: Date.UTC(2024, 0, 1),
    }, read.schedules);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      term: "水臭い",
      reading: "みずくさい",
      glosses: ["cold, distant", "watery"],
      sentence: "水臭いこと言うなよ",
      state: "review",
      intervalDays: 45,
      reps: 20,
    });
    expect(cards[1]).toMatchObject({ term: "玄人", reading: "くろうと", state: "new" });
  });

  it("brings a deck's pictures and audio along with its words", async () => {
    const collection = buildCollection({
      fieldNames: ["Word", "Meaning", "Vocabulary-Audio", "Picture"],
      notes: [
        { id: 1600000012000, fields: ["水", "water", "[sound:mizu.mp3]", '<img src="mizu.jpg">'] },
      ],
    });
    const clip = new Uint8Array([1, 2, 3, 4]);
    const picture = new Uint8Array([5, 6, 7, 8]);
    const apkg = buildZip([
      { name: "collection.anki2", data: collection },
      { name: "media", data: new TextEncoder().encode('{"0": "mizu.mp3", "1": "mizu.jpg"}'), stored: true },
      { name: "0", data: clip, stored: true },
      { name: "1", data: picture, stored: true },
    ]);

    const zip = await openZip(apkg);
    const read = await readApkg(apkg);
    const manifest = await readMediaManifest(zip);
    const mapping = guessFieldMapping(read.noteTypes[0].fieldNames);
    const cards = notesToCards(read.notes, mapping, {
      now: Date.UTC(2024, 0, 1),
      fieldNames: read.noteTypes[0].fieldNames,
    });

    expect(cards[0]).toMatchObject({ term: "水", audio: "mizu.mp3", image: "mizu.jpg" });
    expect(await zip.read(manifest.get(cards[0].audio!)!)).toEqual(clip);
    expect(await zip.read(manifest.get(cards[0].image!)!)).toEqual(picture);
  });
});

describe("the SQLite reader's own corners", () => {
  it("picks column names out of a CREATE TABLE", () => {
    expect(columnsOf("CREATE TABLE notes (id integer primary key, guid text not null, mid integer)")).toEqual([
      "id",
      "guid",
      "mid",
    ]);
  });

  it("ignores table-level constraints", () => {
    expect(columnsOf("CREATE TABLE fields (ntid integer, ord integer, primary key (ntid, ord))")).toEqual([
      "ntid",
      "ord",
    ]);
  });

  it("unwraps quoted and bracketed names", () => {
    expect(columnsOf('CREATE TABLE t ([odd name] integer, "quoted" text, `ticked` text)')).toEqual([
      "odd",
      "quoted",
      "ticked",
    ]);
  });

  it("lists the tables it can see", () => {
    const db = new SqliteFile(buildCollection({ notes: [{ id: 1, fields: ["a", "b", "c", "d"] }] }));
    expect(db.tables().sort()).toEqual(["cards", "col", "notes"]);
  });

  it("says which table is missing rather than returning nothing", () => {
    const db = new SqliteFile(buildCollection({ notes: [] }));
    expect(() => db.rows("revlog")).toThrow(/no "revlog"/);
  });

  it("splits fields on the separator Anki uses", () => {
    const collection = readCollection(
      buildCollection({ notes: [{ id: 1, fields: ["a", "b", "c", "d"] }] }),
    );
    expect(collection.notes[0].fields).toHaveLength(4);
    expect(`a${SEP}b${SEP}c${SEP}d`.split(SEP)).toHaveLength(4);
  });
});
