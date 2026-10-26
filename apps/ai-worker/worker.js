/**
 * Yomeyo's Claude endpoint as a Cloudflare Worker.
 *
 * GitHub Pages serves only static files, so `apps/web/public/grammar.php`
 * (which keeps the API key on a PHP host) cannot run there. This Worker is
 * the same endpoint for Pages: the key lives in the Worker as a secret, the
 * app sends the same requests it always has, and gets the same answers back.
 *
 *   GET  ?probe=1                     204 when the key is set, 404 when not
 *   POST {prompt, mode?, ...}         {raw, count}, exactly like grammar.php
 *
 * KEEP IN STEP WITH grammar.php: every mode, schema, system prompt and limit
 * below is a port of that file. A change to one belongs in the other.
 *
 * Only pages on ALLOWED_ORIGINS may call it (a comma-separated Worker
 * variable; GitHub Pages and the cPanel domain by default). That stops other
 * websites from spending the key through visitors' browsers; it does not
 * stop someone determined from calling it with a forged Origin, so set a
 * monthly spend limit on the Anthropic key.
 */

const DEFAULT_ORIGINS = "https://biosphobia.github.io,https://duugu.moe,http://localhost:5173";

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin") ?? "";
  const list = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(",").map((o) => o.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function cors(origin) {
  return origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-expose-headers": "retry-after",
        "access-control-max-age": "86400",
        vary: "origin",
      }
    : { vary: "origin" };
}

function reply(status, origin, body, extra = {}) {
  const headers = { ...cors(origin), ...extra };
  if (body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

const bytes = (s) => new TextEncoder().encode(s).length;
const str = (v) => (typeof v === "string" ? v : "");

// ---------------- schemas (ported from grammar.php) ----------------

const chunk = {
  type: "object",
  properties: {
    t: { type: "string" },
    r: { type: "string" },
    g: { type: "string" },
    role: { type: "string", enum: ["engine", "doer", "topic", "ghost", "object", "other"] },
    label: { type: "string" },
    p: { type: "string" },
    q: { type: "boolean" },
    glue: { type: "boolean" },
    // grammar.php adds k to the shared chunk before any schema uses it.
    k: { type: "string" },
  },
  required: ["t", "r", "g", "role", "label"],
  additionalProperties: false,
};

const cardSchema = {
  type: "object",
  properties: {
    term: { type: "string" },
    reading: { type: "string" },
    glosses: { type: "array", items: { type: "string" } },
    sentence: { type: "string" },
    sentenceMeaning: { type: "string" },
    notes: { type: "string" },
  },
  required: ["term", "reading", "glosses"],
  additionalProperties: false,
};

const obj = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });

const SCHEMAS = {
  translate: obj({ en: { type: "string" }, note: { type: "string" } }, ["en"]),
  coach: obj(
    {
      answer: { type: "string" },
      examples: { type: "array", items: obj({ jp: { type: "string" }, en: { type: "string" } }, ["jp", "en"]) },
      genki: { type: "string" },
    },
    ["answer", "examples"],
  ),
  explain: obj({ why: { type: "string" } }, ["why"]),
  ocrCrops: obj({ blocks: { type: "array", items: obj({ i: { type: "integer" }, text: { type: "string" } }, ["i", "text"]) } }, ["blocks"]),
  reading: obj(
    {
      scene: { type: "string" },
      lines: {
        type: "array",
        items: obj({ jp: { type: "string" }, reading: { type: "string" }, en: { type: "string" }, how: { type: "string" } }, ["jp", "en", "how"]),
      },
    },
    ["lines"],
  ),
  readingAsk: obj({ answer: { type: "string" } }, ["answer"]),
  ocr: obj(
    {
      blocks: {
        type: "array",
        items: obj(
          { text: { type: "string" }, x: { type: "integer" }, y: { type: "integer" }, w: { type: "integer" }, h: { type: "integer" } },
          ["text", "x", "y", "w", "h"],
        ),
      },
    },
    ["blocks"],
  ),
  deck: obj({ cards: { type: "array", items: cardSchema } }, ["cards"]),
  parse: obj({ chunks: { type: "array", items: chunk }, en: { type: "string" }, lit: { type: "string" }, note: { type: "string" } }, ["chunks", "en", "lit"]),
  sentences: obj(
    { sentences: { type: "array", items: obj({ chunks: { type: "array", items: chunk }, en: { type: "string" }, lit: { type: "string" } }, ["chunks", "en"]) } },
    ["sentences"],
  ),
};

// ---------------- system prompts (ported from grammar.php) ----------------

const READING_BASE =
  "You are a Japanese reading tutor sitting with a beginner over one " +
  "page of a comic or scanned book. You see the page image and a " +
  "transcription of its text in reading order. Ground everything in " +
  "what the page actually shows: who is speaking, to whom, in what " +
  "situation, in what tone. Plain everyday words; if a grammar term " +
  "is unavoidable, explain it in a few words on the spot. Never use " +
  "an em dash. Never invent text that is not on the page. ";

const READING_ASK =
  'Answer the learner\'s question about this page in "answer": ' +
  "directly, concretely, and briefly enough to read on a phone, " +
  "quoting the page's own Japanese where it helps.";

const READING_WALK =
  'Walk the page: one "lines" entry per line of the ' +
  'transcription, in the same order. "jp" is the line exactly ' +
  'as transcribed. "reading" is the whole line in kana, left ' +
  'out when the line is already all kana. "en" is a natural ' +
  'English translation. "how" is two or three short sentences ' +
  "taking the Japanese apart: name each word and particle and " +
  "what it does here, spell out casual contractions with their " +
  "plain textbook forms, and note politeness or tone worth " +
  'knowing. "scene" is one or two sentences on what is ' +
  "happening in the picture and how it shapes the meaning.";

const SYSTEM = {
  ocrCrops:
    "You transcribe Japanese print from small numbered crops of a page, " +
    "usually manga. Each crop is ONE LINE of text: a single column read " +
    "top to bottom when it is marked vertical, a single row read left to " +
    "right when it is not. Return exactly one entry per crop, with i set " +
    "to its number and text set to that line's characters in order, " +
    "EXACTLY as printed — every kana, small kana and っ, long vowel " +
    "marks, and punctuation such as ！？。、 exactly where they appear. " +
    "Give only the characters of that one line: no spaces, no line " +
    "breaks, nothing from a neighbouring column, and no furigana unless " +
    "the crop IS the furigana. A crop holding no readable printed " +
    "Japanese (artwork, screentone, an empty scrap, a page number) gets " +
    "an empty string. Never translate, never invent, never describe a " +
    "picture, and never add characters to make a line read better.",
  ocr:
    "You read Japanese text off a page image, usually manga or a scan. " +
    "Return every distinct block of printed Japanese (a speech bubble, a " +
    "caption, a sign) as its own entry, in natural reading order (manga: " +
    "right to left, top to bottom). Transcribe the text EXACTLY as " +
    "printed, including っ and small kana; never translate, never invent " +
    "text, and skip blocks you cannot read confidently. Each block's box " +
    "must be TIGHT around the text itself, not its bubble: x and y are " +
    "the top-left corner and w and h the size, all in thousandths of the " +
    "image's width and height (0 to 1000). Positioning accuracy matters " +
    "as much as the text: a box that drifts off its bubble is a failure.",
  coach:
    "You are a precise Japanese teacher coaching a university " +
    "student who studies with the textbook Genki I (3rd edition), often " +
    "on their own. The request says which lesson and step they are on " +
    "and what has been taught so far. Answer their question the way a " +
    "good teacher would in office hours: start with the direct answer in " +
    "one or two sentences, then explain the why in plain English, short " +
    "enough to read on a phone. Accuracy comes first: never invent a " +
    "rule, and if usage genuinely varies or native speakers disagree, " +
    "say so. Stay inside what Genki has taught up to their lesson: use " +
    "only grammar and vocabulary from those lessons in your Japanese, in " +
    "kana for lessons 1 and 2. If the honest answer needs something from " +
    "a later lesson, say plainly that it comes in that lesson and give " +
    "only as much as they need now. Use Genki's own terms (topic " +
    "particle, noun, い-adjective, ru-verb, u-verb, short form) since " +
    "that is what their class uses, but explain any term the first time. " +
    'Put two or three short example sentences in "examples", each with ' +
    "a natural English translation; do not repeat them inside " +
    '"answer". In "genki", name where in Genki I to look (lesson and ' +
    'section, e.g. "Lesson 2, Grammar 1") when there is a specific ' +
    "place; leave it empty otherwise. Do not quote the textbook. If the " +
    "question is not about Japanese, steer back kindly in one sentence. " +
    'Plain text in "answer": paragraphs separated by blank lines, ' +
    "**bold** allowed, no headings, no tables, no em dashes. Write plainly, " +
    "like a textbook: no greeting, no praise of the question, no filler, " +
    "no exclamation marks, no closing offer of more help.",
  explain:
    "You give feedback on one answered quiz question in a beginner " +
    "Japanese course. One or two short sentences, plain everyday words, " +
    "no grammar jargon, no em dashes, no scolding. If they were right, " +
    "say in a few words why that answer does the job. If they were " +
    "wrong, say what the word they picked actually does and why the " +
    "correct one fits this sentence. Do not repeat the question.",
  translate:
    "You translate a learner's playground output: a single conjugated " +
    "Japanese word, or a short sentence built from a pattern. Give the " +
    "shortest natural English that carries the form, tense, politeness, " +
    "negation and all. For a sentence, say what a real speaker would most " +
    "likely mean by it: は marks a topic, not a subject, so a literal " +
    "reading is often not the meaning. Plain words only, no grammar " +
    "jargon, and never guess: if it is not real Japanese, say so in " +
    '"en" plainly.',
  deck:
    "You build Japanese vocabulary decks. Every card is studied as fact, " +
    "so a wrong reading teaches a wrong reading: give the dictionary form, " +
    "its reading in kana, and short plain-English meanings. Leave a word " +
    "out rather than guess at it.",
  parse:
    "You take Japanese sentences apart for a beginner course. Accuracy " +
    "matters more than anything: the learner is shown your answer as fact. " +
    "Follow the model and the wording rules in the request exactly.",
  sentences:
    "You write practice sentences for a beginner Japanese course. " +
    "Follow the rules in the request exactly; every sentence is shown to a " +
    "learner as fact, so a wrong label teaches something wrong.",
};

const MEDIA = ["image/jpeg", "image/png", "image/webp"];

class Bad extends Error {}

/** The Messages API body for one app request, or a thrown Bad (→ 400). */
function buildBody(raw) {
  // OCR and the reading tutor carry a page image; everything else is a few
  // kilobytes of prompt.
  if (bytes(raw) > 9000000) throw new Bad();
  let req;
  try {
    req = JSON.parse(raw);
  } catch {
    throw new Bad();
  }
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Bad();
  const mode = str(req.mode);
  const ocr = mode === "ocr";
  const reading = mode === "reading";
  const carriesImage = ocr || reading;
  if (!carriesImage && bytes(raw) > 64000) throw new Bad();
  if (!carriesImage && typeof req.prompt !== "string") throw new Bad();
  const prompt = str(req.prompt);
  if (bytes(prompt) > 48000) throw new Bad();
  const count = req.count !== undefined ? Math.max(1, Math.min(12, parseInt(req.count, 10) || 0)) : 8;

  let readingImage = "";
  let readingMedia = "";
  let readingText = "";
  let readingQuestion = "";
  if (reading) {
    readingMedia = str(req.media);
    if (!MEDIA.includes(readingMedia)) throw new Bad();
    readingImage = str(req.image);
    if (readingImage === "" || bytes(readingImage) > 5000000) throw new Bad();
    readingText = str(req.text);
    readingQuestion = str(req.question);
    if (bytes(readingText) > 12000 || bytes(readingQuestion) > 4000) throw new Bad();
  }

  let ocrImage = "";
  const ocrImages = [];
  let ocrMedia = "";
  if (ocr) {
    ocrMedia = str(req.media);
    if (!MEDIA.includes(ocrMedia)) throw new Bad();
    if (Array.isArray(req.images)) {
      for (const img of req.images) {
        if (typeof img === "string" && img !== "" && bytes(img) <= 3000000) ocrImages.push(img);
      }
      if (ocrImages.length === 0 || ocrImages.length > 80) throw new Bad();
    } else {
      ocrImage = str(req.image);
      if (ocrImage === "" || bytes(ocrImage) > 7000000) throw new Bad();
    }
  }
  const ocrCrops = ocrImages.length > 0;

  const kind = ocr
    ? ocrCrops
      ? "ocrCrops"
      : "ocr"
    : reading
      ? readingQuestion !== ""
        ? "readingAsk"
        : "reading"
      : ["explain", "coach", "translate", "deck", "parse"].includes(mode)
        ? mode
        : "sentences";

  const explain = mode === "explain";
  const system = reading ? READING_BASE + (readingQuestion !== "" ? READING_ASK : READING_WALK) : SYSTEM[kind];

  let content;
  if (ocrCrops) {
    const vertical = Array.isArray(req.vertical) ? req.vertical : [];
    content = [];
    ocrImages.forEach((img, at) => {
      const isVertical = (vertical[at] ?? true) ? "vertical, read top to bottom" : "horizontal, read left to right";
      content.push({ type: "text", text: `Crop ${at + 1} (${isVertical}):` });
      content.push({ type: "image", source: { type: "base64", media_type: ocrMedia, data: img } });
    });
    content.push({
      type: "text",
      text:
        "Transcribe each numbered crop: one blocks entry per crop, i matching its number, " +
        "text being just that line's characters in order, empty for a crop with no readable " +
        "printed Japanese.",
    });
  } else if (ocr) {
    const width = Math.max(1, parseInt(req.width, 10) || 0);
    const height = Math.max(1, parseInt(req.height, 10) || 0);
    content = [
      { type: "image", source: { type: "base64", media_type: ocrMedia, data: ocrImage } },
      {
        type: "text",
        text:
          `This image is ${width} by ${height}` +
          " pixels. Read it into text blocks with tight boxes. x runs rightward from the LEFT edge, " +
          "y downward from the TOP edge, and x, y, w, h are all thousandths (0-1000) of the image's " +
          "width and height. Take a moment per block to check its box really sits on the text.",
      },
    ];
  } else if (reading) {
    content = [
      { type: "image", source: { type: "base64", media_type: readingMedia, data: readingImage } },
      { type: "text", text: "The page's transcription, in reading order, one line per line:\n" + readingText },
      { type: "text", text: readingQuestion !== "" ? "The learner asks: " + readingQuestion : "Walk this page for the learner." },
    ];
  } else {
    content = prompt;
  }

  const schema = SCHEMAS[kind === "readingAsk" ? "readingAsk" : kind];
  const body = {
    // Feedback has to land while the answer still stings, so it rides the
    // fastest model; everything else keeps the careful one.
    model: explain ? "claude-haiku-4-5-20251001" : "claude-sonnet-5",
    max_tokens: explain ? 300 : mode === "coach" ? 2500 : ocr ? 8000 : reading ? 6000 : 16000,
    output_config: explain
      ? { format: { type: "json_schema", schema } }
      : {
          effort: mode === "parse" ? "high" : mode === "translate" || ocr ? "low" : "medium",
          format: { type: "json_schema", schema },
        },
    system,
    messages: [{ role: "user", content }],
  };
  return { body, count };
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    const configured = typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY !== "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return reply(origin ? 204 : 403, origin);
    if (!origin) return reply(403, null, { error: "origin not allowed" });
    if (url.searchParams.has("probe")) return reply(configured ? 204 : 404, origin);
    if (!configured) return reply(404, origin);
    if (request.method !== "POST") return reply(405, origin);

    let built;
    try {
      built = buildBody(await request.text());
    } catch (err) {
      if (err instanceof Bad) return reply(400, origin);
      throw err;
    }

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(built.body),
      });
    } catch {
      return reply(429, origin, { error: "busy", status: 0 });
    }

    if (!res.ok) {
      // Tell the app WHICH kind of no this is: "later" (rate limit, overload)
      // or "never" (a request that will not work).
      const busy = res.status === 429 || res.status === 529 || res.status >= 500;
      const retryAfter = res.headers.get("retry-after");
      return reply(
        busy ? 429 : 502,
        origin,
        { error: busy ? "busy" : "generation failed", status: res.status },
        retryAfter ? { "retry-after": retryAfter } : {},
      );
    }

    const parsed = await res.json().catch(() => ({}));
    const text = (parsed.content ?? [])
      .filter((part) => part && part.type === "text")
      .map((part) => part.text)
      .join("");
    return reply(200, origin, { raw: text, count: built.count }, { "cache-control": "no-store" });
  },
};
