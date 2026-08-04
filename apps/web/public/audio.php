<?php
/**
 * Same-origin word audio for Yomeyo.
 *
 * The app is a static site, so an API key pasted into it would be readable
 * by anyone who opened the developer tools. This endpoint keeps the key on
 * the server instead: the deploy workflow writes it to `audio-key.php` next
 * to this file (never committed, never published to GitHub Pages), and the
 * app asks here for a clip without ever seeing the key.
 *
 * Being same-origin also ends the CORS trouble the audio services cause
 * browsers — the server fetches the clip, the page plays it.
 *
 *   GET audio.php?probe=1              204 when configured, 404 when not
 *   GET audio.php?term=…&reading=…     audio bytes, or 404 when nothing found
 *   GET …&mode=tts                     synthesis only, no recordings
 *
 * On a host without the key file (or on GitHub Pages, which serves this file
 * as plain text) the app notices and falls back to the device voice.
 */

$key = @include __DIR__ . "/audio-key.php";
$configured = is_string($key) && $key !== "";

if (isset($_GET["probe"])) {
  http_response_code($configured ? 204 : 404);
  exit;
}
if (!$configured) {
  http_response_code(404);
  exit;
}

$term = isset($_GET["term"]) ? trim((string) $_GET["term"]) : "";
$reading = isset($_GET["reading"]) ? trim((string) $_GET["reading"]) : "";
if ($term === "" || strlen($term) > 300 || strlen($reading) > 300) {
  http_response_code(400);
  exit;
}
if ($reading === "") {
  $reading = $term;
}

if (!function_exists("array_is_list")) {
  // PHP < 8.1, which plenty of shared hosts still run.
  function array_is_list(array $a): bool {
    return $a === [] || array_keys($a) === range(0, count($a) - 1);
  }
}

/** Fetch one URL; null unless it answered 200 with a body of sane size. */
function fetch_bytes(string $url, int $maxBytes): ?array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 3,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_USERAGENT => "Yomeyo",
  ]);
  $body = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
  curl_close($ch);
  if (!is_string($body) || $status !== 200 || $body === "" || strlen($body) > $maxBytes) {
    return null;
  }
  return [$body, $type];
}

/**
 * Pull playable URLs out of a list response. The schema varies by service —
 * Yomitan's {audioSources: […]}, a bare array, or a wrapper object — so the
 * shapes these endpoints actually use are all accepted, mirroring the
 * parser the app itself used when the key lived in the browser.
 */
function clip_urls($payload): array {
  $lists = [];
  if (is_array($payload) && array_is_list($payload)) {
    $lists[] = $payload;
  } elseif (is_array($payload)) {
    foreach (["audioSources", "audioFileUrls", "results", "sources", "audio", "data"] as $k) {
      if (isset($payload[$k]) && is_array($payload[$k])) {
        $lists[] = $payload[$k];
      }
    }
  }
  $urls = [];
  foreach ($lists as $list) {
    foreach ($list as $entry) {
      if (is_string($entry) && preg_match('#^https?://#i', $entry)) {
        $urls[] = $entry;
        continue;
      }
      if (!is_array($entry)) {
        continue;
      }
      foreach (["url", "audioUrl", "src", "file", "audio"] as $k) {
        if (isset($entry[$k]) && is_string($entry[$k]) && preg_match('#^https?://#i', $entry[$k])) {
          $urls[] = $entry[$k];
          break;
        }
      }
    }
  }
  return array_values(array_unique($urls));
}

// Recorded voices first; synthesis only when nobody has recorded the word.
//
// A single kana asks for `mode=tts` instead. Recordings of one letter are
// people saying it however they chose — a name, a word it starts, a whole
// sentence — and a learner drilling あ needs the sound itself, said the same
// way every time. Whole words are the opposite: a real speaker beats
// synthesis, so they take the default chain.
$synthesis = "openai,elevenlabs,polly";
$sourceSets = (($_GET["mode"] ?? "") === "tts") ? [$synthesis] : ["forvo", $synthesis];
$listBase = "https://allaudio.animecards.site/audio/list?language=ja";

foreach ($sourceSets as $sources) {
  $listUrl = $listBase
    . "&sources=" . rawurlencode($sources)
    . "&term=" . rawurlencode($term)
    . "&reading=" . rawurlencode($reading)
    . "&apiKey=" . rawurlencode($key);
  $list = fetch_bytes($listUrl, 1000000);
  if ($list === null) {
    continue;
  }
  $payload = json_decode($list[0], true);
  foreach (clip_urls($payload) as $url) {
    // Clips travel encrypted or not at all: a service that lists an http://
    // URL almost always serves the same file over TLS, so ask for that.
    $url = preg_replace('#^http://#i', 'https://', $url);
    $clip = fetch_bytes($url, 10000000);
    if ($clip === null) {
      continue;
    }
    [$bytes, $type] = $clip;
    // An HTML error page or JSON apology is not a clip.
    if (stripos($type, "text/") === 0 || stripos($type, "application/json") === 0) {
      continue;
    }
    header("Content-Type: " . (preg_match('#^audio/#i', $type) ? $type : "audio/mpeg"));
    header("Content-Length: " . strlen($bytes));
    header("Cache-Control: private, max-age=86400");
    echo $bytes;
    exit;
  }
}

http_response_code(404);
