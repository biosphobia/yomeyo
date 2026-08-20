<?php
/**
 * Fresh grammar practice sentences for Yomeyo, written by Claude.
 *
 * The app is a static site, so an API key inside it would be readable by
 * anyone who opened the developer tools. This endpoint keeps the key on the
 * server: the deploy workflow writes it to `grammar-key.php` next to this
 * file (never committed, never published to GitHub Pages), and the app asks
 * here for sentences without ever seeing the key.
 *
 *   GET  grammar.php?probe=1                  204 when configured, 404 when not
 *   POST grammar.php {prompt}                 practice sentences for a unit
 *   POST grammar.php {prompt, mode:parse}     one real sentence, taken apart
 *   POST grammar.php {prompt, mode:deck}      vocabulary cards for a deck
 *   POST grammar.php {prompt, mode:translate} one built word, translated
 *   POST grammar.php {prompt, mode:explain}   why a quiz answer was right/wrong
 *   POST grammar.php {mode:ocr, image, media} a page image read into text blocks
 *
 * On a host without the key file the app notices and simply uses the
 * sentences that ship with it, so nothing here is ever load-bearing.
 */

$key = @include __DIR__ . "/grammar-key.php";
$configured = is_string($key) && $key !== "";

if (isset($_GET["probe"])) {
  http_response_code($configured ? 204 : 404);
  exit;
}
if (!$configured) {
  http_response_code(404);
  exit;
}
if (($_SERVER["REQUEST_METHOD"] ?? "GET") !== "POST") {
  http_response_code(405);
  exit;
}

$raw = file_get_contents("php://input");
// OCR carries a page image; everything else is a few kilobytes of prompt.
if ($raw === false || strlen($raw) > 9000000) {
  http_response_code(400);
  exit;
}
$req = json_decode($raw, true);
if (!is_array($req)) {
  http_response_code(400);
  exit;
}
$isOcrRequest = (($req["mode"] ?? "") === "ocr");
// Roomy enough for a deck request carrying a ban list of everything the
// learner already holds; still nowhere near the OCR allowance above.
if (!$isOcrRequest && strlen($raw) > 64000) {
  http_response_code(400);
  exit;
}
if (!$isOcrRequest && (!isset($req["prompt"]) || !is_string($req["prompt"]))) {
  http_response_code(400);
  exit;
}
$req["prompt"] = is_string($req["prompt"] ?? null) ? $req["prompt"] : "";
// The prompt is assembled by the app from its own unit definitions; this
// endpoint only ever asks for practice sentences, whatever it is sent.
// Overlong is refused whole rather than truncated: substr counts bytes,
// and a cut through the middle of a kanji leaves invalid UTF-8 that
// json_encode turns into a silently empty request body.
$prompt = $req["prompt"];
if (strlen($prompt) > 48000) {
  http_response_code(400);
  exit;
}
$count = isset($req["count"]) ? max(1, min(12, (int) $req["count"])) : 8;

// The shape every sentence must arrive in. Asking the API to enforce it
// beats asking the model nicely and then repairing what comes back: the
// response is guaranteed to parse and to carry the fields the app reads.
$chunk = [
  "type" => "object",
  "properties" => [
    "t" => ["type" => "string"],
    "r" => ["type" => "string"],
    "g" => ["type" => "string"],
    "role" => [
      "type" => "string",
      "enum" => ["engine", "doer", "topic", "ghost", "object", "other"],
    ],
    "label" => ["type" => "string"],
    "p" => ["type" => "string"],
    "q" => ["type" => "boolean"],
    "glue" => ["type" => "boolean"],
  ],
  "required" => ["t", "r", "g", "role", "label"],
  "additionalProperties" => false,
];
$mode = (string) ($req["mode"] ?? "");
$parse = ($mode === "parse");
$deck = ($mode === "deck");
$translate = ($mode === "translate");
$explain = ($mode === "explain");
$ocr = ($mode === "ocr");

// OCR arrives one of two ways. The good way: `images`, an array of small
// crops the app cut out itself, one per detected text block — Claude only
// transcribes, all the positions stay the app's. The fallback: `image`,
// one whole page, where Claude also has to estimate boxes.
$ocrImage = "";
$ocrImages = [];
$ocrMedia = "";
if ($ocr) {
  $ocrMedia = is_string($req["media"] ?? null) ? $req["media"] : "";
  if (!in_array($ocrMedia, ["image/jpeg", "image/png", "image/webp"], true)) {
    http_response_code(400);
    exit;
  }
  if (isset($req["images"]) && is_array($req["images"])) {
    foreach ($req["images"] as $img) {
      if (is_string($img) && $img !== "" && strlen($img) <= 3000000) {
        $ocrImages[] = $img;
      }
    }
    if (count($ocrImages) === 0 || count($ocrImages) > 80) {
      http_response_code(400);
      exit;
    }
  } else {
    $ocrImage = is_string($req["image"] ?? null) ? $req["image"] : "";
    if ($ocrImage === "" || strlen($ocrImage) > 7000000) {
      http_response_code(400);
      exit;
    }
  }
}
$ocrCrops = count($ocrImages) > 0;

// Taking a real sentence apart adds kanji, a reading per piece, and the
// whole-sentence translations; writing practice sentences does not.
$chunk["properties"]["k"] = ["type" => "string"];
$chunkParse = $chunk;
$chunkParse["required"] = ["t", "r", "g", "role", "label"];

// A deck is vocabulary, not sentences: one object per word, with the fields a
// flashcard actually carries. Everything but the word itself is optional, so
// a word the model is unsure about arrives bare rather than invented.
$cardSchema = [
  "type" => "object",
  "properties" => [
    "term" => ["type" => "string"],
    "reading" => ["type" => "string"],
    "glosses" => ["type" => "array", "items" => ["type" => "string"]],
    "sentence" => ["type" => "string"],
    "sentenceMeaning" => ["type" => "string"],
    "notes" => ["type" => "string"],
  ],
  "required" => ["term", "reading", "glosses"],
  "additionalProperties" => false,
];

// The playground asks for one thing: what its built word means. Tiny on
// purpose — one short answer, maybe one note, nothing to go wrong.
$translateSchema = [
  "type" => "object",
  "properties" => [
    "en" => ["type" => "string"],
    "note" => ["type" => "string"],
  ],
  "required" => ["en"],
  "additionalProperties" => false,
];

// Feedback on one answered question: a sentence or two, nothing else.
$explainSchema = [
  "type" => "object",
  "properties" => ["why" => ["type" => "string"]],
  "required" => ["why"],
  "additionalProperties" => false,
];

// Numbered crops read back as text: one entry per crop, nothing spatial —
// the app already knows exactly where every crop came from.
$ocrCropSchema = [
  "type" => "object",
  "properties" => [
    "blocks" => [
      "type" => "array",
      "items" => [
        "type" => "object",
        "properties" => [
          "i" => ["type" => "integer"],
          "text" => ["type" => "string"],
        ],
        "required" => ["i", "text"],
        "additionalProperties" => false,
      ],
    ],
  ],
  "required" => ["blocks"],
  "additionalProperties" => false,
];

// A page read into text blocks: the text exactly as printed, and a tight
// box per block in thousandths of the image, so the overlay lands true.
$ocrSchema = [
  "type" => "object",
  "properties" => [
    "blocks" => [
      "type" => "array",
      "items" => [
        "type" => "object",
        "properties" => [
          "text" => ["type" => "string"],
          "x" => ["type" => "integer"],
          "y" => ["type" => "integer"],
          "w" => ["type" => "integer"],
          "h" => ["type" => "integer"],
        ],
        "required" => ["text", "x", "y", "w", "h"],
        "additionalProperties" => false,
      ],
    ],
  ],
  "required" => ["blocks"],
  "additionalProperties" => false,
];

$schema = $ocr
  ? ($ocrCrops ? $ocrCropSchema : $ocrSchema)
  : ($explain
  ? $explainSchema
  : ($translate
  ? $translateSchema
  : ($deck
  ? [
      "type" => "object",
      "properties" => ["cards" => ["type" => "array", "items" => $cardSchema]],
      "required" => ["cards"],
      "additionalProperties" => false,
    ]
  : ($parse
  ? [
      "type" => "object",
      "properties" => [
        "chunks" => ["type" => "array", "items" => $chunkParse],
        "en" => ["type" => "string"],
        "lit" => ["type" => "string"],
        "note" => ["type" => "string"],
      ],
      "required" => ["chunks", "en", "lit"],
      "additionalProperties" => false,
    ]
  : [
      "type" => "object",
      "properties" => [
        "sentences" => [
          "type" => "array",
          "items" => [
            "type" => "object",
            "properties" => [
              "chunks" => ["type" => "array", "items" => $chunk],
              "en" => ["type" => "string"],
              "lit" => ["type" => "string"],
            ],
            "required" => ["chunks", "en"],
            "additionalProperties" => false,
          ],
        ],
      ],
      "required" => ["sentences"],
      "additionalProperties" => false,
    ]))));

$body = [
  // Feedback has to land while the answer still stings, so it rides the
  // fastest model; everything else keeps the careful one.
  "model" => $explain ? "claude-haiku-4-5-20251001" : "claude-sonnet-5",
  "max_tokens" => $explain ? 300 : ($ocr ? 8000 : 16000),
  "output_config" => $explain
    ? ["format" => ["type" => "json_schema", "schema" => $schema]]
    : [
        "effort" => $parse ? "high" : ($translate || $ocr ? "low" : "medium"),
        "format" => ["type" => "json_schema", "schema" => $schema],
      ],
  "system" => ($ocr && $ocrCrops)
    ? "You transcribe Japanese print from small numbered crops of a page, " .
      "usually manga. Each crop is ONE LINE of text: a single column read " .
      "top to bottom when it is marked vertical, a single row read left to " .
      "right when it is not. Return exactly one entry per crop, with i set " .
      "to its number and text set to that line's characters in order, " .
      "EXACTLY as printed — every kana, small kana and っ, long vowel " .
      "marks, and punctuation such as ！？。、 exactly where they appear. " .
      "Give only the characters of that one line: no spaces, no line " .
      "breaks, nothing from a neighbouring column, and no furigana unless " .
      "the crop IS the furigana. A crop holding no readable printed " .
      "Japanese (artwork, screentone, an empty scrap, a page number) gets " .
      "an empty string. Never translate, never invent, never describe a " .
      "picture, and never add characters to make a line read better."
    : ($ocr
    ? "You read Japanese text off a page image, usually manga or a scan. " .
      "Return every distinct block of printed Japanese (a speech bubble, a " .
      "caption, a sign) as its own entry, in natural reading order (manga: " .
      "right to left, top to bottom). Transcribe the text EXACTLY as " .
      "printed, including っ and small kana; never translate, never invent " .
      "text, and skip blocks you cannot read confidently. Each block's box " .
      "must be TIGHT around the text itself, not its bubble: x and y are " .
      "the top-left corner and w and h the size, all in thousandths of the " .
      "image's width and height (0 to 1000). Positioning accuracy matters " .
      "as much as the text: a box that drifts off its bubble is a failure."
    : ($explain
    ? "You give feedback on one answered quiz question in a beginner " .
      "Japanese course. One or two short sentences, plain everyday words, " .
      "no grammar jargon, no em dashes, no scolding. If they were right, " .
      "say in a few words why that answer does the job. If they were " .
      "wrong, say what the word they picked actually does and why the " .
      "correct one fits this sentence. Do not repeat the question."
    : ($translate
    ? "You translate a learner's playground output: a single conjugated " .
      "Japanese word, or a short sentence built from a pattern. Give the " .
      "shortest natural English that carries the form, tense, politeness, " .
      "negation and all. For a sentence, say what a real speaker would most " .
      "likely mean by it: は marks a topic, not a subject, so a literal " .
      "reading is often not the meaning. Plain words only, no grammar " .
      "jargon, and never guess: if it is not real Japanese, say so in " .
      "\"en\" plainly."
    : ($deck
    ? "You build Japanese vocabulary decks. Every card is studied as fact, " .
      "so a wrong reading teaches a wrong reading: give the dictionary form, " .
      "its reading in kana, and short plain-English meanings. Leave a word " .
      "out rather than guess at it."
    : ($parse
    ? "You take Japanese sentences apart for a beginner course. Accuracy " .
      "matters more than anything: the learner is shown your answer as fact. " .
      "Follow the model and the wording rules in the request exactly."
    : "You write practice sentences for a beginner Japanese course. " .
      "Follow the rules in the request exactly; every sentence is shown to a " .
      "learner as fact, so a wrong label teaches something wrong."))))),
  "messages" => [[
    "role" => "user",
    "content" => $ocrCrops
      ? (function () use ($ocrImages, $ocrMedia, $req) {
          $vertical = is_array($req["vertical"] ?? null) ? $req["vertical"] : [];
          $content = [];
          foreach ($ocrImages as $at => $img) {
            $isVertical = ($vertical[$at] ?? true) ? "vertical, read top to bottom" : "horizontal, read left to right";
            $content[] = ["type" => "text", "text" => "Crop " . ($at + 1) . " (" . $isVertical . "):"];
            $content[] = ["type" => "image", "source" => ["type" => "base64", "media_type" => $ocrMedia, "data" => $img]];
          }
          $content[] = ["type" => "text", "text" =>
            "Transcribe each numbered crop: one blocks entry per crop, i matching its number, " .
            "text being just that line's characters in order, empty for a crop with no readable " .
            "printed Japanese."];
          return $content;
        })()
      : ($ocr
      ? [
          ["type" => "image", "source" => ["type" => "base64", "media_type" => $ocrMedia, "data" => $ocrImage]],
          ["type" => "text", "text" =>
            "This image is " . max(1, (int) ($req["width"] ?? 0)) . " by " . max(1, (int) ($req["height"] ?? 0)) .
            " pixels. Read it into text blocks with tight boxes. x runs rightward from the LEFT edge, " .
            "y downward from the TOP edge, and x, y, w, h are all thousandths (0-1000) of the image's " .
            "width and height. Take a moment per block to check its box really sits on the text."],
        ]
      : $prompt),
  ]],
];

// A rate limit is not a failure, it is "later" — so the header that says
// how much later is kept and handed back to the app.
$retryAfter = "";
$ch = curl_init("https://api.anthropic.com/v1/messages");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 90,
  CURLOPT_HEADERFUNCTION => function ($curl, $header) use (&$retryAfter) {
    if (stripos($header, "retry-after:") === 0) {
      $retryAfter = trim(substr($header, strlen("retry-after:")));
    }
    return strlen($header);
  },
  CURLOPT_HTTPHEADER => [
    "content-type: application/json",
    "x-api-key: " . $key,
    "anthropic-version: 2023-06-01",
  ],
  CURLOPT_POSTFIELDS => json_encode($body),
]);
$res = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($res === false || $status < 200 || $status >= 300) {
  // Tell the app WHICH kind of no this is. Too many requests, or the model
  // briefly overloaded, means wait and ask again — quite different from a
  // request that will never work, and the app backs off rather than
  // treating a whole book as unreadable.
  $busy = ($status === 429 || $status === 529 || $status >= 500);
  http_response_code($busy ? 429 : 502);
  if ($retryAfter !== "") {
    header("retry-after: " . $retryAfter);
  }
  header("content-type: application/json");
  echo json_encode(["error" => $busy ? "busy" : "generation failed", "status" => $status]);
  exit;
}

$parsed = json_decode($res, true);
$text = "";
foreach ($parsed["content"] ?? [] as $part) {
  if (($part["type"] ?? "") === "text") {
    $text .= $part["text"];
  }
}
header("content-type: application/json; charset=utf-8");
header("cache-control: no-store");
echo json_encode(["raw" => $text, "count" => $count]);
