import type { DeinflectionResult } from "./types.js";

/**
 * Yomitan-style suffix-rewrite deinflection.
 *
 * Each rule rewrites a conjugated suffix back toward the dictionary form.
 * `fromClass` restricts which intermediate forms a rule may apply to
 * (empty = only applies to raw input or class-compatible intermediates),
 * `toClass` declares what the resulting form must be for the chain to be
 * valid — this is checked against dictionary part-of-speech tags at lookup
 * time so that e.g. 切って never resolves to an ichidan verb.
 */
interface Rule {
  from: string;
  to: string;
  /** Classes the current form must include for this rule to apply. */
  fromClass: string[];
  /** Classes of the produced form. */
  toClass: string[];
  reason: string;
}

// Word classes used internally:
//   v1    ichidan verb            v5u/v5k/v5g/v5s/v5t/v5n/v5b/v5m/v5r  godan by ending
//   vs    suru verb               vk  kuru verb
//   adj-i i-adjective             te  a te-form intermediate
//   ta    a plain-past intermediate
const ANY: string[] = [];

function r(from: string, to: string, toClass: string[], reason: string, fromClass: string[] = ANY): Rule {
  return { from, to, fromClass, toClass, reason };
}

// Godan て/た sound-change table: suffix -> possible dictionary endings.
const GODAN_TE: Array<[string, string, string]> = [
  ["って", "う", "v5u"],
  ["って", "つ", "v5t"],
  ["って", "る", "v5r"],
  ["いて", "く", "v5k"],
  ["いで", "ぐ", "v5g"],
  ["して", "す", "v5s"],
  ["んで", "ぬ", "v5n"],
  ["んで", "ぶ", "v5b"],
  ["んで", "む", "v5m"],
];

const GODAN_MASU: Array<[string, string, string]> = [
  ["い", "う", "v5u"],
  ["き", "く", "v5k"],
  ["ぎ", "ぐ", "v5g"],
  ["し", "す", "v5s"],
  ["ち", "つ", "v5t"],
  ["に", "ぬ", "v5n"],
  ["び", "ぶ", "v5b"],
  ["み", "む", "v5m"],
  ["り", "る", "v5r"],
];

const GODAN_NAI: Array<[string, string, string]> = [
  ["わ", "う", "v5u"],
  ["か", "く", "v5k"],
  ["が", "ぐ", "v5g"],
  ["さ", "す", "v5s"],
  ["た", "つ", "v5t"],
  ["な", "ぬ", "v5n"],
  ["ば", "ぶ", "v5b"],
  ["ま", "む", "v5m"],
  ["ら", "る", "v5r"],
];

const GODAN_E: Array<[string, string, string]> = [
  ["え", "う", "v5u"],
  ["け", "く", "v5k"],
  ["げ", "ぐ", "v5g"],
  ["せ", "す", "v5s"],
  ["て", "つ", "v5t"],
  ["ね", "ぬ", "v5n"],
  ["べ", "ぶ", "v5b"],
  ["め", "む", "v5m"],
  ["れ", "る", "v5r"],
];

const GODAN_O: Array<[string, string, string]> = [
  ["おう", "う", "v5u"],
  ["こう", "く", "v5k"],
  ["ごう", "ぐ", "v5g"],
  ["そう", "す", "v5s"],
  ["とう", "つ", "v5t"],
  ["のう", "ぬ", "v5n"],
  ["ぼう", "ぶ", "v5b"],
  ["もう", "む", "v5m"],
  ["ろう", "る", "v5r"],
];

function buildRules(): Rule[] {
  const rules: Rule[] = [];

  // ---- auxiliaries riding on the te-form; peel back to the te-form ----
  const teAux: Array<[string, string, string]> = [
    ["ている", "て", "progressive"],
    ["でいる", "で", "progressive"],
    ["てる", "て", "progressive (casual)"],
    ["でる", "で", "progressive (casual)"],
    ["ていた", "て", "past progressive"],
    ["でいた", "で", "past progressive"],
    ["てた", "て", "past progressive (casual)"],
    ["でた", "で", "past progressive (casual)"],
    ["ていない", "て", "negative progressive"],
    ["でいない", "で", "negative progressive"],
    ["てない", "て", "negative progressive (casual)"],
    ["でない", "で", "negative progressive (casual)"],
    ["ています", "て", "polite progressive"],
    ["でいます", "で", "polite progressive"],
    ["てある", "て", "-te aru"],
    ["である", "で", "-te aru"],
    ["ておく", "て", "-te oku"],
    ["でおく", "で", "-te oku"],
    ["とく", "て", "-te oku (casual)"],
    ["どく", "で", "-te oku (casual)"],
    ["てしまう", "て", "-te shimau"],
    ["でしまう", "で", "-te shimau"],
    ["てしまった", "て", "-te shimau past"],
    ["でしまった", "で", "-te shimau past"],
    ["てしまいました", "て", "-te shimau polite past"],
    ["でしまいました", "で", "-te shimau polite past"],
    ["ちゃう", "て", "-chau"],
    ["じゃう", "で", "-chau"],
    ["ちゃった", "て", "-chatta"],
    ["じゃった", "で", "-chatta"],
    ["てください", "て", "-te kudasai"],
    ["でください", "で", "-te kudasai"],
    ["てくる", "て", "-te kuru"],
    ["でくる", "で", "-te kuru"],
    ["ていく", "て", "-te iku"],
    ["でいく", "で", "-te iku"],
    ["てみる", "て", "-te miru"],
    ["でみる", "で", "-te miru"],
  ];
  for (const [from, to, reason] of teAux) {
    rules.push(r(from, to, ["te"], reason));
  }

  // ---- te-form back to dictionary form ----
  rules.push(r("て", "る", ["v1"], "-te", ["te"]));
  rules.push(r("て", "る", ["v1"], "-te"));
  for (const [from, to, cls] of GODAN_TE) {
    rules.push(r(from, to, [cls], "-te", ["te"]));
    rules.push(r(from, to, [cls], "-te"));
  }
  rules.push(r("して", "する", ["vs"], "-te"));
  rules.push(r("きて", "くる", ["vk"], "-te"));
  rules.push(r("来て", "来る", ["vk"], "-te"));

  // ---- plain past ----
  rules.push(r("た", "る", ["v1"], "past", ["ta"]));
  rules.push(r("た", "る", ["v1"], "past"));
  for (const [teFrom, to, cls] of GODAN_TE) {
    const taFrom = teFrom.replace("て", "た").replace("で", "だ");
    rules.push(r(taFrom, to, [cls], "past", ["ta"]));
    rules.push(r(taFrom, to, [cls], "past"));
  }
  rules.push(r("した", "する", ["vs"], "past"));
  rules.push(r("きた", "くる", ["vk"], "past"));
  rules.push(r("来た", "来る", ["vk"], "past"));

  // -tara conditional / -tari: reduce to plain past first.
  rules.push(r("たら", "た", ["ta"], "-tara"));
  rules.push(r("だら", "だ", ["ta"], "-tara"));
  rules.push(r("たり", "た", ["ta"], "-tari"));
  rules.push(r("だり", "だ", ["ta"], "-tari"));

  // ---- polite forms (ます riding on the masu-stem) ----
  const masuVariants: Array<[string, string]> = [
    ["ます", "polite"],
    ["ました", "polite past"],
    ["ません", "polite negative"],
    ["ませんでした", "polite negative past"],
    ["ましょう", "polite volitional"],
  ];
  for (const [masu, reason] of masuVariants) {
    rules.push(r(masu, "る", ["v1"], reason));
    for (const [stem, to, cls] of GODAN_MASU) {
      rules.push(r(stem + masu, to, [cls], reason));
    }
    rules.push(r("し" + masu, "する", ["vs"], reason));
    rules.push(r("き" + masu, "くる", ["vk"], reason));
    rules.push(r("来" + masu, "来る", ["vk"], reason));
  }

  // ---- negative ----
  rules.push(r("ない", "る", ["v1"], "negative"));
  for (const [stem, to, cls] of GODAN_NAI) {
    rules.push(r(stem + "ない", to, [cls], "negative"));
  }
  rules.push(r("しない", "する", ["vs"], "negative"));
  rules.push(r("こない", "くる", ["vk"], "negative"));
  rules.push(r("来ない", "来る", ["vk"], "negative"));
  // negative past / te reduce to ない (which then behaves like adj-i)
  rules.push(r("なかった", "ない", ["negform"], "negative past"));
  rules.push(r("なくて", "ない", ["negform"], "negative -te"));
  rules.push(r("なければ", "ない", ["negform"], "negative -ba"));
  rules.push(r("なきゃ", "ない", ["negform"], "negative -kya"));

  // ---- desire (-tai rides the masu-stem, conjugates as adj-i) ----
  rules.push(r("たい", "る", ["v1"], "-tai"));
  for (const [stem, to, cls] of GODAN_MASU) {
    rules.push(r(stem + "たい", to, [cls], "-tai"));
  }
  rules.push(r("したい", "する", ["vs"], "-tai"));
  rules.push(r("きたい", "くる", ["vk"], "-tai"));
  // adj-i style conjugations of たい reduce to たい first
  rules.push(r("たかった", "たい", ["taiform"], "-tai past"));
  rules.push(r("たくない", "たい", ["taiform"], "-tai negative"));
  rules.push(r("たくて", "たい", ["taiform"], "-tai -te"));

  // ---- passive / potential / causative ----
  rules.push(r("られる", "る", ["v1"], "passive/potential"));
  rules.push(r("られた", "る", ["v1"], "passive/potential past"));
  rules.push(r("られない", "る", ["v1"], "passive/potential negative"));
  for (const [stem, to, cls] of GODAN_NAI) {
    rules.push(r(stem + "れる", to, [cls], "passive"));
    rules.push(r(stem + "れた", to, [cls], "passive past"));
    rules.push(r(stem + "れない", to, [cls], "passive negative"));
  }
  for (const [stem, to, cls] of GODAN_E) {
    rules.push(r(stem + "る", to, [cls], "potential"));
    rules.push(r(stem + "た", to, [cls], "potential past"));
    rules.push(r(stem + "ない", to, [cls], "potential negative"));
  }
  rules.push(r("できる", "する", ["vs"], "potential"));
  rules.push(r("される", "する", ["vs"], "passive"));
  rules.push(r("こられる", "くる", ["vk"], "passive/potential"));
  rules.push(r("させる", "る", ["v1"], "causative"));
  for (const [stem, to, cls] of GODAN_NAI) {
    rules.push(r(stem + "せる", to, [cls], "causative"));
  }
  rules.push(r("させる", "する", ["vs"], "causative"));
  rules.push(r("こさせる", "くる", ["vk"], "causative"));

  // ---- -ba conditional ----
  rules.push(r("れば", "る", ["v1", "v5r"], "-ba"));
  for (const [stem, to, cls] of GODAN_E) {
    if (stem === "れ") continue; // covered above
    rules.push(r(stem + "ば", to, [cls], "-ba"));
  }
  rules.push(r("すれば", "する", ["vs"], "-ba"));
  rules.push(r("くれば", "くる", ["vk"], "-ba"));
  rules.push(r("ければ", "い", ["adj-i"], "-ba (adj)"));

  // ---- volitional ----
  rules.push(r("よう", "る", ["v1"], "volitional"));
  for (const [from, to, cls] of GODAN_O) {
    rules.push(r(from, to, [cls], "volitional"));
  }
  rules.push(r("しよう", "する", ["vs"], "volitional"));
  rules.push(r("こよう", "くる", ["vk"], "volitional"));

  // ---- imperative (common ones only) ----
  rules.push(r("ろ", "る", ["v1"], "imperative"));
  rules.push(r("しろ", "する", ["vs"], "imperative"));
  rules.push(r("こい", "くる", ["vk"], "imperative"));
  for (const [stem, to, cls] of GODAN_E) {
    rules.push(r(stem, to, [cls], "imperative"));
  }

  // ---- masu-stem as standalone (renyoukei nominal / compound verbs) ----
  rules.push(r("", "る", ["v1"], "masu stem", ["masustem"]));

  // ---- i-adjectives ----
  rules.push(r("かった", "い", ["adj-i"], "adj past"));
  rules.push(r("くない", "い", ["adj-i"], "adj negative"));
  rules.push(r("くなかった", "い", ["adj-i"], "adj negative past"));
  rules.push(r("くて", "い", ["adj-i"], "adj -te"));
  rules.push(r("く", "い", ["adj-i"], "adverbial"));
  rules.push(r("すぎる", "い", ["adj-i"], "-sugiru (adj)"));
  rules.push(r("そう", "い", ["adj-i"], "-sou (adj)"));

  return rules;
}

const RULES = buildRules();

/**
 * Tag intermediate forms so chained rules stay coherent:
 * a form ending in て/で produced by peeling an auxiliary is class "te",
 * a form ending in た/だ from -tara/-tari is "ta", ない forms are "negform",
 * たい forms are "taiform".
 */
function intermediateClasses(toClass: string[]): string[] {
  return toClass;
}

const MAX_DEPTH = 6;

/**
 * Generate all plausible dictionary forms for a conjugated surface string.
 * Always includes the identity (the text itself, unconstrained).
 */
export function deinflect(text: string): DeinflectionResult[] {
  const results: DeinflectionResult[] = [{ term: text, reasons: [], classes: [] }];
  const seen = new Set<string>([text + " "]);

  interface Node {
    term: string;
    reasons: string[];
    classes: string[]; // classes of THIS form ("" = raw input, unconstrained)
    depth: number;
  }
  const queue: Node[] = [{ term: text, reasons: [], classes: [], depth: 0 }];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.depth >= MAX_DEPTH) continue;

    for (const rule of RULES) {
      if (rule.from.length > 0 && !node.term.endsWith(rule.from)) continue;
      if (rule.from.length === 0 && !(node.classes.length === 0 && node.term.length > 0)) {
        // empty-suffix rules (masu-stem) only apply directly to raw input
        continue;
      }
      // class gate: raw input (no classes) may take any rule; otherwise the
      // rule's fromClass must be satisfied by the current form's classes.
      if (node.classes.length > 0) {
        if (rule.fromClass.length === 0) {
          // rules with unconstrained entry only chain from raw input or
          // class-tagged forms whose classes include the rule's own toClass
          // requirement — here we require overlap with the classes that a
          // suffix-form would need. Allow only if the current form's classes
          // include one of rule.toClass's "source shape" — too strict to
          // model exactly, so allow chaining only from intermediate markers.
          const markers = ["te", "ta", "negform", "taiform", "adj-i", "v1"];
          if (!node.classes.some((c) => markers.includes(c))) continue;
        } else if (!rule.fromClass.some((c) => node.classes.includes(c))) {
          continue;
        }
      } else if (rule.fromClass.length > 0 && rule.from.length > 0) {
        // rules that REQUIRE an intermediate class (e.g. plain て→る with
        // fromClass ["te"]) also exist in an unconstrained copy, so skip the
        // constrained one for raw input to avoid duplicates.
        continue;
      }

      const base = node.term.slice(0, node.term.length - rule.from.length);
      const produced = base + rule.to;
      if (produced.length === 0) continue;

      // Tag intermediates
      let classes = intermediateClasses(rule.toClass);
      if (rule.to === "て" || rule.to === "で") classes = ["te"];
      else if ((rule.to === "た" || rule.to === "だ") && rule.reason.startsWith("-ta")) classes = ["ta"];
      else if (rule.to === "ない") classes = ["negform", "adj-i"];
      else if (rule.to === "たい") classes = ["taiform", "adj-i"];

      const reasons = [...node.reasons, rule.reason];
      const key = produced + " " + classes.join(",");
      if (seen.has(key)) continue;
      seen.add(key);

      const isIntermediate = ["te", "ta", "negform", "taiform"].some((m) => classes.includes(m));
      if (!isIntermediate || rule.to === "ない" || rule.to === "たい") {
        results.push({ term: produced, reasons, classes });
      }
      queue.push({ term: produced, reasons, classes, depth: node.depth + 1 });
    }
  }

  return results;
}

/**
 * Check whether a deinflection's required classes are compatible with a
 * dictionary entry's part-of-speech tags. Lenient: unconstrained matches
 * everything; a POS list we don't recognize matches everything.
 */
export function classesMatchPos(classes: string[], pos: string[]): boolean {
  if (classes.length === 0) return true;
  if (pos.length === 0) return true;
  for (const c of classes) {
    for (const p of pos) {
      if (p === c) return true;
      // JMdict uses v5k, v5k-s, v5u-s, v1-s etc.
      if (p.startsWith(c)) return true;
      if (c === "v1" && (p === "v1-s" || p === "vz")) return true;
      if (c.startsWith("v5") && p === "v5") return true;
      if (c === "vs" && (p.startsWith("vs") || p === "vz")) return true;
      if (c === "adj-i" && p === "adj-ix") return true;
    }
  }
  return false;
}
