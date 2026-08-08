<?php
/**
 * The admin's pencil, published: edits to the gacha prize table that apply
 * to everyone, not just the device they were made on.
 *
 * Edits land in `gacha/prizes-overrides.json` next to prizes.json — the app
 * loads both and lays the overrides on top, so prizes.json itself is never
 * rewritten and stays safe to hand-edit on GitHub. A deploy replaces
 * prizes.json; the overrides file lives only on the host and survives.
 *
 * Guarded by `admin-key.php`, written by the deploy workflow from the
 * GACHA_ADMIN_KEY repository secret (same pattern as the audio and grammar
 * keys). Without it this endpoint answers 404 and the app's editor stays
 * device-local.
 *
 *   GET  prizes-admin.php?probe=1                204 when configured
 *   POST {key, id, patch:{name?,text?,rarity?}}  merge one prize's override
 *   POST {key, id, patch:null}                   clear one prize's override
 */

$secret = @include __DIR__ . "/admin-key.php";
$configured = is_string($secret) && $secret !== "";

if (isset($_GET["probe"])) {
  http_response_code($configured ? 204 : 404);
  exit;
}
if (!$configured || $_SERVER["REQUEST_METHOD"] !== "POST") {
  http_response_code(404);
  exit;
}

$body = json_decode(file_get_contents("php://input"), true);
if (!is_array($body) || !isset($body["key"]) || !hash_equals($secret, (string) $body["key"])) {
  http_response_code(403);
  exit;
}
$id = isset($body["id"]) ? trim((string) $body["id"]) : "";
if ($id === "" || strlen($id) > 100) {
  http_response_code(400);
  exit;
}

$file = __DIR__ . "/gacha/prizes-overrides.json";
$overrides = [];
if (is_file($file)) {
  $decoded = json_decode((string) file_get_contents($file), true);
  if (is_array($decoded)) {
    $overrides = $decoded;
  }
}

if (!array_key_exists("patch", $body) || $body["patch"] === null) {
  unset($overrides[$id]);
} else {
  $patch = $body["patch"];
  if (!is_array($patch)) {
    http_response_code(400);
    exit;
  }
  // Only the three editable fields, only as short strings.
  $clean = [];
  foreach (["name", "text", "rarity"] as $field) {
    if (isset($patch[$field]) && is_string($patch[$field])) {
      $value = trim($patch[$field]);
      if ($value !== "" && strlen($value) <= 300) {
        $clean[$field] = $value;
      }
    }
  }
  if (count($clean) === 0) {
    unset($overrides[$id]);
  } else {
    $overrides[$id] = $clean;
  }
}

$written = file_put_contents(
  $file,
  json_encode($overrides, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
  LOCK_EX
);
http_response_code($written === false ? 500 : 204);
