import { getMeta, onAccountChange, setMeta } from "./db.js";
import { addXp } from "./levels.js";
import { toast } from "./toast.js";

/**
 * Achievements: things done once, remembered for ever.
 *
 * Each one carries a difficulty tier, and the tier decides the XP paid the
 * moment it unlocks — through the same `addXp` the quests use, so level-ups
 * and their yenny bursts happen exactly as they would anywhere else. The
 * unlock date is recorded and shown; an achievement is a memory, and a
 * memory has a when.
 *
 * The definitions below are STARTERS so the shelf isn't bare — the real
 * list is arriving later and slots in by editing `ACHIEVEMENTS` alone.
 * Unlocks are keyed by id, so renaming an id orphans its unlock; edit
 * names and details freely, ids carefully.
 *
 * `unlockAchievement(id)` is safe to call from anywhere, repeatedly:
 * it awards once, quietly returns ever after, and never throws.
 */

export type AchievementTier = "easy" | "normal" | "hard" | "legendary";

/** What each tier pays, once, on unlock. */
export const TIER_XP: Record<AchievementTier, number> = {
  easy: 40,
  normal: 100,
  hard: 250,
  legendary: 600,
};

const TIER_LABEL: Record<AchievementTier, string> = {
  easy: "easy",
  normal: "normal",
  hard: "hard",
  legendary: "LEGENDARY",
};

export interface Achievement {
  /** Stable key: unlocks are stored against it. */
  id: string;
  name: string;
  icon: string;
  detail: string;
  tier: AchievementTier;
  /** Hidden until earned: shows as ??? on the shelf. */
  secret?: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  // ---- starters; the real list replaces/extends these ----
  { id: "first-kana-level", name: "First steps", icon: "👣", detail: "Clear any kana level.", tier: "easy" },
  { id: "first-chapter", name: "Chapter one", icon: "📖", detail: "Pass a grammar chapter's test.", tier: "easy" },
  { id: "first-pull", name: "Beginner's luck", icon: "🎁", detail: "Open your first crate.", tier: "easy" },
  {
    id: "kana-3000",
    name: "House key",
    icon: "🎰",
    detail: "Answer 3,000 kana questions. Somewhere in the snow, a heavy door unlocks.",
    tier: "legendary",
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

const KEY = "achievements";
/** id → unlock time (ms since epoch). */
type Unlocks = Record<string, number>;

let cached: Unlocks | null = null;
onAccountChange(() => {
  cached = null;
});

async function unlocks(): Promise<Unlocks> {
  cached ??= (await getMeta<Unlocks>(KEY)) ?? {};
  return cached;
}

/** Everything unlocked, with when. */
export async function achievementState(): Promise<Unlocks> {
  return { ...(await unlocks()) };
}

/**
 * Award an achievement, once. True only on the awarding call — callers can
 * hang extra fanfare on that if they want; the toast and XP are handled.
 */
export async function unlockAchievement(id: string): Promise<boolean> {
  try {
    const definition = BY_ID.get(id);
    if (!definition) return false;
    const state = await unlocks();
    if (state[id] !== undefined) return false;
    state[id] = Date.now();
    await setMeta(KEY, state);
    const { after, yennies } = await addXp(TIER_XP[definition.tier]);
    toast(
      `🏆 ${definition.name} — +${TIER_XP[definition.tier]} XP${
        yennies > 0 ? ` · level ${after.level}!` : ""
      }`,
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------- the shelf ----------------

const dateOf = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** The achievements shelf: earned ones with their dates, the rest waiting. */
export async function renderAchievements(host: HTMLElement): Promise<void> {
  const state = await unlocks();
  const earned = ACHIEVEMENTS.filter((a) => state[a.id] !== undefined);
  const waiting = ACHIEVEMENTS.filter((a) => state[a.id] === undefined);

  host.innerHTML = `
    <div class="ach-head">
      <b>Achievements</b>
      <span class="glosses">${earned.length} / ${ACHIEVEMENTS.length}</span>
    </div>
    <div class="ach-list">
      ${earned
        .sort((a, b) => state[b.id] - state[a.id])
        .map(
          (a) => `
        <div class="card-panel ach-row done tier-${a.tier}">
          <span class="ach-icon">${a.icon}</span>
          <div class="ach-body">
            <div class="ach-name">${escapeHtml(a.name)}
              <span class="ach-tier tier-${a.tier}">${TIER_LABEL[a.tier]} · +${TIER_XP[a.tier]} XP</span></div>
            <div class="glosses">${escapeHtml(a.detail)}</div>
          </div>
          <span class="ach-date">${dateOf(state[a.id])}</span>
        </div>`,
        )
        .join("")}
      ${waiting
        .map(
          (a) => `
        <div class="card-panel ach-row locked">
          <span class="ach-icon">${a.secret ? "❓" : a.icon}</span>
          <div class="ach-body">
            <div class="ach-name">${a.secret ? "???" : escapeHtml(a.name)}
              <span class="ach-tier tier-${a.tier}">${TIER_LABEL[a.tier]} · +${TIER_XP[a.tier]} XP</span></div>
            <div class="glosses">${a.secret ? "It will say when it happens." : escapeHtml(a.detail)}</div>
          </div>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
