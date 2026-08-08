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
 * No passphrase. The poster proves who they are with their Firebase sign-in:
 * the app sends the signed-in user's ID token, and this endpoint verifies it
 * against the site's own Firebase project (`firebase-project.php`, written
 * by the deploy from the FIREBASE_CONFIG secret). The FIRST account to
 * publish becomes the publisher — its uid is pinned in
 * `gacha/prizes-admin-uid.txt` — and every later edit must come from that
 * same account. To hand the seat to someone else, delete that file on the
 * host.
 *
 *   GET  prizes-admin.php?probe=1                 204 when configured
 *   POST {token, id, patch:{name?,text?,rarity?}} merge one prize's override
 *   POST {token, id, patch:null}                  clear one prize's override
 */

$project = @include __DIR__ . "/firebase-project.php";
$configured = is_string($project) && $project !== "";

if (isset($_GET["probe"])) {
  http_response_code($configured ? 204 : 404);
  exit;
}
if (!$configured || $_SERVER["REQUEST_METHOD"] !== "POST") {
  http_response_code(404);
  exit;
}

function b64url_decode(string $data): string {
  $pad = strlen($data) % 4;
  if ($pad > 0) {
    $data .= str_repeat("=", 4 - $pad);
  }
  return (string) base64_decode(strtr($data, "-_", "+/"));
}

/** Google's current signing certs, cached beside the overrides for an hour. */
function google_certs(): ?array {
  $cache = __DIR__ . "/gacha/firebase-certs.json";
  if (is_file($cache) && time() - (int) filemtime($cache) < 3600) {
    $held = json_decode((string) file_get_contents($cache), true);
    if (is_array($held)) {
      return $held;
    }
  }
  $ch = curl_init("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_USERAGENT => "Yomeyo",
  ]);
  $body = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  if (!is_string($body) || $status !== 200) {
    return null;
  }
  $certs = json_decode($body, true);
  if (!is_array($certs)) {
    return null;
  }
  @file_put_contents($cache, $body, LOCK_EX);
  return $certs;
}

/** The verified uid inside a Firebase ID token for this project, or null. */
function verified_uid(string $token, string $project): ?string {
  $parts = explode(".", $token);
  if (count($parts) !== 3) {
    return null;
  }
  $header = json_decode(b64url_decode($parts[0]), true);
  $claims = json_decode(b64url_decode($parts[1]), true);
  $signature = b64url_decode($parts[2]);
  if (!is_array($header) || !is_array($claims) || $signature === "") {
    return null;
  }
  if (($header["alg"] ?? "") !== "RS256" || !isset($header["kid"])) {
    return null;
  }
  $certs = google_certs();
  $cert = is_array($certs) ? ($certs[$header["kid"]] ?? null) : null;
  if (!is_string($cert)) {
    return null;
  }
  $key = openssl_pkey_get_public($cert);
  if ($key === false) {
    return null;
  }
  $signed = $parts[0] . "." . $parts[1];
  if (openssl_verify($signed, $signature, $key, OPENSSL_ALGO_SHA256) !== 1) {
    return null;
  }
  $now = time();
  if (($claims["exp"] ?? 0) < $now - 60 || ($claims["iat"] ?? PHP_INT_MAX) > $now + 300) {
    return null;
  }
  if (($claims["aud"] ?? "") !== $project) {
    return null;
  }
  if (($claims["iss"] ?? "") !== "https://securetoken.google.com/" . $project) {
    return null;
  }
  $uid = $claims["sub"] ?? "";
  return is_string($uid) && $uid !== "" ? $uid : null;
}

$body = json_decode(file_get_contents("php://input"), true);
if (!is_array($body) || !isset($body["token"]) || !is_string($body["token"])) {
  http_response_code(403);
  exit;
}
$uid = verified_uid($body["token"], $project);
if ($uid === null) {
  http_response_code(403);
  exit;
}

// The seat: first verified publisher takes it, everyone after must be them.
$seatFile = __DIR__ . "/gacha/prizes-admin-uid.txt";
$seat = is_file($seatFile) ? trim((string) file_get_contents($seatFile)) : "";
if ($seat === "") {
  @file_put_contents($seatFile, $uid, LOCK_EX);
} elseif (!hash_equals($seat, $uid)) {
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
  // Only the editable fields, only as short strings.
  $clean = [];
  foreach (["name", "text", "rarity"] as $field) {
    if (isset($patch[$field]) && is_string($patch[$field])) {
      $value = trim($patch[$field]);
      if ($value !== "" && strlen($value) <= 300) {
        $clean[$field] = $value;
      }
    }
  }
  if (isset($patch["on"]) && in_array($patch["on"], ["correct", "wrong"], true)) {
    $clean["on"] = $patch["on"];
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
