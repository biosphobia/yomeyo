/**
 * The kana groups: the rows a learner picks from — vowels, each consonant
 * row, the voiced rows, the combination sounds — for hiragana and katakana.
 *
 * Hiragana is written out once; katakana is the same syllabary at a fixed
 * Unicode offset, so it is derived rather than repeated.
 */

export interface KanaEntry {
  kana: string;
  /** Accepted romaji answers; the first is the one shown as correct. */
  romaji: string[];
}

export interface KanaGroup {
  id: string;
  script: "hiragana" | "katakana";
  /** The romaji label, e.g. "ka ki ku ke ko". */
  title: string;
  /** One short line on what the level adds. */
  detail: string;
  entries: KanaEntry[];
}

type Row = [detail: string, entries: [kana: string, ...romaji: string[]][]];

const BASIC_ROWS: Row[] = [
  ["The five vowels.", [["あ", "a"], ["い", "i"], ["う", "u"], ["え", "e"], ["お", "o"]]],
  ["The k row.", [["か", "ka"], ["き", "ki"], ["く", "ku"], ["け", "ke"], ["こ", "ko"]]],
  ["The s row. し is shi.", [["さ", "sa"], ["し", "shi", "si"], ["す", "su"], ["せ", "se"], ["そ", "so"]]],
  ["The t row. ち is chi, つ is tsu.", [["た", "ta"], ["ち", "chi", "ti"], ["つ", "tsu", "tu"], ["て", "te"], ["と", "to"]]],
  ["The n row.", [["な", "na"], ["に", "ni"], ["ぬ", "nu"], ["ね", "ne"], ["の", "no"]]],
  ["The h row. ふ is fu.", [["は", "ha"], ["ひ", "hi"], ["ふ", "fu", "hu"], ["へ", "he"], ["ほ", "ho"]]],
  ["The m row.", [["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"]]],
  ["The y row and the r row.", [["や", "ya"], ["ゆ", "yu"], ["よ", "yo"], ["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"]]],
  ["The last three: わ, を and the lone ん.", [["わ", "wa"], ["を", "wo", "o"], ["ん", "n", "nn"]]],
  ["Voiced g and z rows. じ is ji.", [["が", "ga"], ["ぎ", "gi"], ["ぐ", "gu"], ["げ", "ge"], ["ご", "go"], ["ざ", "za"], ["じ", "ji", "zi"], ["ず", "zu"], ["ぜ", "ze"], ["ぞ", "zo"]]],
  ["Voiced d and b rows. ぢ and づ sound like じ and ず.", [["だ", "da"], ["ぢ", "ji", "di", "dji"], ["づ", "zu", "du", "dzu"], ["で", "de"], ["ど", "do"], ["ば", "ba"], ["び", "bi"], ["ぶ", "bu"], ["べ", "be"], ["ぼ", "bo"]]],
  ["The p row, with the little circle.", [["ぱ", "pa"], ["ぴ", "pi"], ["ぷ", "pu"], ["ぺ", "pe"], ["ぽ", "po"]]],
  ["Combination sounds with small ゃゅょ: k, s and t rows.", [["きゃ", "kya"], ["きゅ", "kyu"], ["きょ", "kyo"], ["しゃ", "sha", "sya"], ["しゅ", "shu", "syu"], ["しょ", "sho", "syo"], ["ちゃ", "cha", "tya"], ["ちゅ", "chu", "tyu"], ["ちょ", "cho", "tyo"]]],
  ["Combination sounds: n, h, m and r rows.", [["にゃ", "nya"], ["にゅ", "nyu"], ["にょ", "nyo"], ["ひゃ", "hya"], ["ひゅ", "hyu"], ["ひょ", "hyo"], ["みゃ", "mya"], ["みゅ", "myu"], ["みょ", "myo"], ["りゃ", "rya"], ["りゅ", "ryu"], ["りょ", "ryo"]]],
  ["Voiced combination sounds. じゃ is ja.", [["ぎゃ", "gya"], ["ぎゅ", "gyu"], ["ぎょ", "gyo"], ["じゃ", "ja", "jya", "zya"], ["じゅ", "ju", "jyu", "zyu"], ["じょ", "jo", "jyo", "zyo"], ["びゃ", "bya"], ["びゅ", "byu"], ["びょ", "byo"], ["ぴゃ", "pya"], ["ぴゅ", "pyu"], ["ぴょ", "pyo"]]],
];

/** ぁ..ゖ sit exactly 0x60 below ァ..ヶ, so katakana is a shift, not a copy. */
function toKatakana(hiragana: string): string {
  return [...hiragana]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : ch;
    })
    .join("");
}

function groupsFor(script: "hiragana" | "katakana"): KanaGroup[] {
  return BASIC_ROWS.map(([detail, entries], index) => {
    const converted: KanaEntry[] = entries.map(([kana, ...romaji]) => ({
      kana: script === "katakana" ? toKatakana(kana) : kana,
      romaji,
    }));
    return {
      id: `${script}-${index + 1}`,
      script,
      title: converted.map((entry) => entry.romaji[0]).slice(0, 5).join(" ") + (converted.length > 5 ? " …" : ""),
      detail,
      entries: converted,
    };
  });
}

export const KANA_GROUPS: KanaGroup[] = [...groupsFor("hiragana"), ...groupsFor("katakana")];

export function groupById(id: string): KanaGroup | undefined {
  return KANA_GROUPS.find((group) => group.id === id);
}

/** Is this romaji an accepted reading of the entry? */
export function isCorrect(entry: KanaEntry, answer: string): boolean {
  return entry.romaji.includes(answer.trim().toLowerCase());
}

const DIGRAPHS = new Set(
  KANA_GROUPS.flatMap((group) => group.entries.map((entry) => entry.kana)).filter(
    (kana) => kana.length === 2,
  ),
);

/** Split a kana string into its sounds, digraphs (きゃ) kept whole. */
export function kanaSegments(kana: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < kana.length) {
    const pair = kana.slice(at, at + 2);
    if (DIGRAPHS.has(pair)) {
      out.push(pair);
      at += 2;
    } else {
      out.push(kana[at]);
      at += 1;
    }
  }
  return out;
}
