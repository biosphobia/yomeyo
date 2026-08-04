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
 *   GET  grammar.php?probe=1   204 when configured, 404 when not
 *   POST grammar.php           {unit} -> {sentences:[…]} in the app's format
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

$body = [
  "model" => "claude-sonnet-4-5",
  "max_tokens" => 8000,
  "system" =>
    "You write practice sentences for a beginner Japanese course. " .
    "Reply with JSON only: no prose, no code fences.",
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
// Models sometimes wrap JSON in a fence despite being asked not to.
$text = trim(preg_replace('/^```(?:json)?|```$/m', "", trim($text)));

header("content-type: application/json; charset=utf-8");
header("cache-control: no-store");
echo json_encode(["raw" => $text, "count" => $count]);
