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
if ($raw === false || strlen($raw) > 20000) {
  http_response_code(400);
  exit;
}
$req = json_decode($raw, true);
if (!is_array($req) || !isset($req["prompt"]) || !is_string($req["prompt"])) {
  http_response_code(400);
  exit;
}
// The prompt is assembled by the app from its own unit definitions; this
// endpoint only ever asks for practice sentences, whatever it is sent.
$prompt = substr($req["prompt"], 0, 12000);
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

$schema = $explain
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
    ])));

$body = [
  // Feedback has to land while the answer still stings, so it rides the
  // fastest model; everything else keeps the careful one.
  "model" => $explain ? "claude-haiku-4-5-20251001" : "claude-sonnet-5",
  "max_tokens" => $explain ? 300 : 16000,
  "output_config" => $explain
    ? ["format" => ["type" => "json_schema", "schema" => $schema]]
    : [
        "effort" => $parse ? "high" : ($translate ? "low" : "medium"),
        "format" => ["type" => "json_schema", "schema" => $schema],
      ],
  "system" => $explain
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
      "learner as fact, so a wrong label teaches something wrong."))),
  "messages" => [["role" => "user", "content" => $prompt]],
];

$ch = curl_init("https://api.anthropic.com/v1/messages");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 90,
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
  http_response_code(502);
  header("content-type: application/json");
  echo json_encode(["error" => "generation failed"]);
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
