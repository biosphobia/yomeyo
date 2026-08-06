import { KANA_GROUPS } from "./kana-data.js";
import { getMeta } from "./db.js";
import { kanaGameLog, kanaStats, masteryStars, type KanaStat } from "./kana-stats.js";

/**
 * What the kana game has learned about you.
 *
 * Every answer has been recorded since the day the game was built — what was
 * right, what was wrong, what was typed instead, and a mastery per kana that
 * rises with practice and falls on its own. None of it was ever shown. This
 * is that record, read back: how solid each row is, which individual kana are
 * still weak, and the pairs that keep being confused for each other.
 *
 * The last of those is the useful one. "You mix up シ and ツ" is worth more
 * than any total, because it names the next thing to work on.
 */

const BEST_STREAK_KEY = "kanaBestStreak";

/** How many confusions are worth showing before it stops being a lesson. */
const CONFUSIONS = 10;

export async function renderKanaStats(body: HTMLDivElement): Promise<void> {
  body.innerHTML = `<div class="card-panel"><div class="msg">Reading your record…</div></div>`;

  const [stats, games, bestStreak] = await Promise.all([
    kanaStats(),
    kanaGameLog(),
    getMeta<number>(BEST_STREAK_KEY),
  ]);

  const answered = Object.values(stats);
  if (answered.length === 0) {
    body.innerHTML = `
      <div class="card-panel">
        <div class="empty-state"><div class="big">📊</div>
          Nothing recorded yet.
          <div class="glosses" style="margin-top:8px">Play a level and this fills in.</div>
        </div>
      </div>`;
    return;
  }

  const correct = answered.reduce((n, s) => n + s.correct, 0);
  const wrong = answered.reduce((n, s) => n + s.wrong, 0);
  const timeouts = answered.reduce((n, s) => n + s.timeouts, 0);
  const total = correct + wrong;
  const cleared = games.filter((g) => g.outcome === "cleared").length;
  const mastered = answered.filter((s) => masteryStars(s.mastery) >= 5).length;

  body.innerHTML = `
    <div class="card-panel">
      <div class="stat-grid">
        ${tile(total.toLocaleString(), "answered")}
        ${tile(total > 0 ? `${Math.round((correct / total) * 100)}%` : "—", "correct")}
        ${tile((bestStreak ?? 0).toLocaleString(), "best streak")}
        ${tile(answered.length.toLocaleString(), "kana seen")}
        ${tile(mastered.toLocaleString(), "at 5 stars")}
        ${tile(`${cleared}/${games.length}`, "levels cleared")}
      </div>
      ${timeouts > 0 ? `<div class="msg">${timeouts.toLocaleString()} of those were the clock running out.</div>` : ""}
    </div>

    <div class="card-panel">
      <b>Rows</b>
      <div class="glosses">Average mastery across each group you have played.</div>
      <div id="stat-groups"></div>
    </div>

    <div class="card-panel">
      <b>Every kana</b>
      <div class="glosses">Stars rise with practice, fall on a miss, and fade on their own.
        This is also what decides the questions: the fewer stars, the more often that kana
        comes up — up to six times as often as one you know. Five stars still appears, so
        nothing is ever dropped, and if it slips the stars fall and it comes straight back.</div>
      <div id="stat-kana"></div>
    </div>

    <div class="card-panel">
      <b>Mixed up</b>
      <div class="glosses">What you answer instead, and how often.</div>
      <div id="stat-confusions"></div>
    </div>
  `;

  drawGroups(body.querySelector<HTMLDivElement>("#stat-groups")!, stats);
  drawKana(body.querySelector<HTMLDivElement>("#stat-kana")!, stats);
  drawConfusions(body.querySelector<HTMLDivElement>("#stat-confusions")!, stats);
}

function tile(value: string, label: string): string {
  return `<div class="stat-tile"><div class="stat-value">${escapeHtml(value)}</div>
    <div class="stat-label">${escapeHtml(label)}</div></div>`;
}

/** Each row, as an average of the kana in it that have actually been seen. */
function drawGroups(box: HTMLDivElement, stats: Record<string, KanaStat>): void {
  const rows = KANA_GROUPS.map((group) => {
    const seen = group.entries.map((entry) => stats[entry.kana]).filter(Boolean);
    if (seen.length === 0) return null;
    const mastery = seen.reduce((sum, s) => sum + s.mastery, 0) / seen.length;
    const correct = seen.reduce((n, s) => n + s.correct, 0);
    const wrong = seen.reduce((n, s) => n + s.wrong, 0);
    return { group, mastery, seen: seen.length, correct, wrong };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) {
    box.innerHTML = `<div class="glosses">No rows played yet.</div>`;
    return;
  }

  rows.sort((a, b) => a.mastery - b.mastery);
  box.innerHTML = rows
    .map(({ group, mastery, seen, correct, wrong }) => {
      const percent = Math.round((mastery / 5) * 100);
      const answered = correct + wrong;
      // The hiragana and katakana rows share a romaji title, so the kana
      // themselves have to be on screen or two rows read as one repeated.
      const face = group.entries.map((entry) => entry.kana).join("");
      return `<div class="stat-row">
        <div class="stat-row-head">
          <span><b lang="ja">${escapeHtml(face)}</b>
            <span class="glosses">${escapeHtml(group.title)} · ${seen}/${group.entries.length} seen</span></span>
          <span class="stat-stars">${stars(mastery)}</span>
        </div>
        <div class="kana-bar"><div class="kana-bar-fill" style="width:${percent}%"></div></div>
        <div class="glosses">${answered.toLocaleString()} answered${
          answered > 0 ? ` · ${Math.round((correct / answered) * 100)}% right` : ""
        }</div>
      </div>`;
    })
    .join("");
}

/** Weakest first, because that is the list worth reading. */
function drawKana(box: HTMLDivElement, stats: Record<string, KanaStat>): void {
  const entries = Object.entries(stats).sort((a, b) => a[1].mastery - b[1].mastery);
  box.innerHTML = `<div class="kana-stat-grid">${entries
    .map(([kana, stat]) => {
      const whole = masteryStars(stat.mastery);
      const answered = stat.correct + stat.wrong;
      const rate = answered > 0 ? Math.round((stat.correct / answered) * 100) : 0;
      return `<div class="kana-stat" data-stars="${whole}"
          title="${escapeHtml(`${answered} answered, ${rate}% right`)}">
        <div class="kana-stat-face" lang="ja">${escapeHtml(kana)}</div>
        <div class="kana-stat-stars">${stars(stat.mastery)}</div>
        <div class="kana-stat-rate">${answered > 0 ? `${rate}%` : "—"}</div>
      </div>`;
    })
    .join("")}</div>`;
}

/**
 * The pairs that keep being answered for each other.
 *
 * Ordered by how often, so the top of the list is the next thing to fix.
 */
function drawConfusions(box: HTMLDivElement, stats: Record<string, KanaStat>): void {
  const pairs: { kana: string; given: string; count: number }[] = [];
  for (const [kana, stat] of Object.entries(stats)) {
    for (const [given, count] of Object.entries(stat.confusedWith ?? {})) {
      if (count > 0) pairs.push({ kana, given, count });
    }
  }
  if (pairs.length === 0) {
    box.innerHTML = `<div class="glosses">Nothing yet — either you have not missed one, or not enough to see a pattern.</div>`;
    return;
  }
  pairs.sort((a, b) => b.count - a.count);
  const most = pairs[0].count;
  box.innerHTML = pairs
    .slice(0, CONFUSIONS)
    .map(
      ({ kana, given, count }) => `<div class="confusion">
        <span class="confusion-kana" lang="ja">${escapeHtml(kana)}</span>
        <span class="confusion-arrow">→</span>
        <span class="confusion-given">${escapeHtml(given)}</span>
        <span class="confusion-bar"><span style="width:${Math.round((count / most) * 100)}%"></span></span>
        <span class="confusion-count">${count}×</span>
      </div>`,
    )
    .join("");
}

function stars(mastery: number): string {
  const whole = masteryStars(mastery);
  return `<span class="stars">${"★".repeat(whole)}${"☆".repeat(5 - whole)}</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
