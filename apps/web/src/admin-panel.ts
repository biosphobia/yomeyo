import { firestoreApi } from "./cloud.js";
import { XP_DAY_BONUS, XP_PER_QUEST, levelFromXp } from "./levels.js";
import { dateKey, planForDayFrom, type DayPlan } from "./quests.js";
import { prizeTable } from "./gacha-data.js";
import { formatYennies } from "./yennies.js";

/**
 * The admin panel: one account, the holder of the `admin/owner` seat, can
 * open anyone's account and put things right — a calendar day that was
 * really done but not counted, a streak lost to a missed sync, a gacha
 * prize that should or should not be on someone's table.
 *
 * Everything here works on the target's synced progress in their
 * `users/{uid}` document; the security rules let exactly one account past
 * the owner check. Their device adopts the changes on its next progress
 * sync (start-up, sign-in, or Sync now):
 *
 *  - the quest log is written verbatim with a bumped `questLogRev`, which
 *    is what lets a *deletion* survive the usual grow-only merge — and the
 *    streak is derived from the log, so a repaired day restores it;
 *  - completing a quest here also pays its XP, through the same ledger the
 *    app uses (`questXpAwarded`), so the user's own device will not pay it
 *    a second time;
 *  - `hiddenPrizes` is the admin's list alone: the client adopts it and
 *    never writes it back.
 */

interface UserRow {
  uid: string;
  name: string;
}

type Progress = Record<string, unknown>;
type QuestLog = Record<string, Record<string, number>>;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function logOf(progress: Progress): QuestLog {
  const raw = progress.questLog;
  if (!isMap(raw)) return {};
  const out: QuestLog = {};
  for (const [day, events] of Object.entries(raw)) {
    if (!isMap(events)) continue;
    out[day] = {};
    for (const [event, count] of Object.entries(events)) out[day][event] = num(count);
  }
  return out;
}

function startOf(progress: Progress): string {
  return typeof progress.questStart === "string" && progress.questStart ? progress.questStart : dateKey();
}

function dayDone(key: string, start: string, log: QuestLog): boolean {
  const plan = planForDayFrom(key, start);
  if (plan.quests.length === 0) return true;
  const events = log[key] ?? {};
  return plan.quests.every((quest) => (events[quest.event] ?? 0) >= quest.goal);
}

/** The same walk the app itself does, over the target's synced log. */
function streakOf(start: string, log: QuestLog): number {
  let streak = 0;
  const cursor = new Date();
  if (!dayDone(dateKey(cursor), start, log)) cursor.setDate(cursor.getDate() - 1);
  let guard = 0;
  while (dateKey(cursor) >= start && dayDone(dateKey(cursor), start, log) && guard++ < 3660) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function readUser(uid: string): Promise<Progress> {
  const { db, storeApi } = await firestoreApi();
  const snapshot = await storeApi.getDoc(storeApi.doc(db, "users", uid));
  const data = (snapshot.exists?.() ? snapshot.data?.() : null) ?? {};
  return isMap(data.progress) ? (data.progress as Progress) : {};
}

async function writeProgress(uid: string, patch: Progress): Promise<void> {
  const { db, storeApi } = await firestoreApi();
  await storeApi.setDoc(storeApi.doc(db, "users", uid), { progress: patch }, { merge: true });
}

async function listUsers(): Promise<UserRow[]> {
  const { db, storeApi } = await firestoreApi();
  const snapshot = await storeApi.getDocs(storeApi.collection(db, "users"));
  const uids: string[] = [];
  snapshot.forEach((doc: any) => uids.push(doc.id));
  const rows = await Promise.all(
    uids.map(async (uid) => {
      const profile = await storeApi.getDoc(storeApi.doc(db, "profiles", uid)).catch(() => null);
      const name = profile?.exists?.() ? String(profile.data?.()?.name ?? "") : "";
      return { uid, name: name || "(no username)" };
    }),
  );
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/**
 * Pay the XP a repaired day has newly earned, through the same ledger the
 * app itself keeps, so nothing pays twice. Returns the progress patch.
 */
function settleAwards(progress: Progress, key: string, plan: DayPlan, log: QuestLog): Progress {
  const events = log[key] ?? {};
  const awardedAll = isMap(progress.questXpAwarded)
    ? ({ ...(progress.questXpAwarded as Record<string, unknown>) } as Record<string, unknown>)
    : {};
  const paid = new Set(Array.isArray(awardedAll[key]) ? (awardedAll[key] as unknown[]).map(String) : []);
  let gained = 0;
  for (const quest of plan.quests) {
    if (paid.has(quest.id) || (events[quest.event] ?? 0) < quest.goal) continue;
    paid.add(quest.id);
    gained += XP_PER_QUEST;
  }
  const allDone = plan.quests.length > 0 && plan.quests.every((quest) => (events[quest.event] ?? 0) >= quest.goal);
  if (allDone && !paid.has("day!")) {
    paid.add("day!");
    gained += XP_DAY_BONUS;
  }
  if (gained === 0) return {};
  awardedAll[key] = [...paid].sort();
  return { questXpAwarded: awardedAll, xpTotal: num(progress.xpTotal) + gained };
}

// ---------------- the panel ----------------

export async function mountAdminPanel(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <div class="card-panel">
      <b>👑 Admin</b>
      <div class="msg">Open an account, repair its calendar, curate its gacha. Only this account can see this.</div>
      <div class="row-actions">
        <input type="search" id="adm-search" placeholder="Search users…" style="flex:1" />
        <button id="adm-load" class="secondary">Load users</button>
      </div>
      <div id="adm-users"></div>
      <div id="adm-user"></div>
    </div>
  `;
  const search = host.querySelector<HTMLInputElement>("#adm-search")!;
  const usersBox = host.querySelector<HTMLDivElement>("#adm-users")!;
  const userBox = host.querySelector<HTMLDivElement>("#adm-user")!;

  let rows: UserRow[] = [];

  const drawUsers = (): void => {
    const needle = search.value.trim().toLowerCase();
    const shown = rows.filter(
      (row) => !needle || row.name.toLowerCase().includes(needle) || row.uid.toLowerCase().includes(needle),
    );
    usersBox.innerHTML =
      shown.length === 0
        ? `<div class="glosses">${rows.length === 0 ? "" : "No user matches."}</div>`
        : shown
            .map(
              (row) => `<button class="adm-user-row" data-uid="${escapeAttr(row.uid)}">
                <b>@${escapeHtml(row.name)}</b>
                <span class="glosses">${escapeHtml(row.uid.slice(0, 10))}…</span>
              </button>`,
            )
            .join("");
    for (const button of usersBox.querySelectorAll<HTMLButtonElement>("[data-uid]")) {
      button.addEventListener("click", () => void openUser(button.dataset.uid!));
    }
  };

  host.querySelector<HTMLButtonElement>("#adm-load")!.addEventListener("click", () => {
    usersBox.innerHTML = `<div class="glosses">Reading…</div>`;
    listUsers().then(
      (list) => {
        rows = list;
        drawUsers();
      },
      (err) => {
        usersBox.innerHTML = `<div class="msg error">${escapeHtml(
          err instanceof Error ? err.message : String(err),
        )} — are the newest Firestore rules deployed?</div>`;
      },
    );
  });
  search.addEventListener("input", drawUsers);

  async function openUser(uid: string): Promise<void> {
    userBox.innerHTML = `<div class="glosses">Opening…</div>`;
    let progress: Progress;
    try {
      progress = await readUser(uid);
    } catch (err) {
      userBox.innerHTML = `<div class="msg error">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
      return;
    }
    const name = rows.find((row) => row.uid === uid)?.name ?? uid;
    let day = dateKey();

    const draw = (): void => {
      const log = logOf(progress);
      const start = startOf(progress);
      const level = levelFromXp(num(progress.xpTotal));
      const achievements = isMap(progress.achievements) ? Object.entries(progress.achievements) : [];
      const items = isMap(progress.gachaItems) ? Object.entries(progress.gachaItems) : [];
      const owned = Array.isArray(progress.gachaOwned) ? progress.gachaOwned.length : 0;

      userBox.innerHTML = `
        <div class="adm-head">
          <b>@${escapeHtml(name)}</b>
          <span class="glosses">${escapeHtml(uid)}</span>
        </div>
        <div class="adm-facts">
          <span>Lv ${level.level} · ${level.total.toLocaleString()} XP</span>
          <span>${formatYennies(num(progress.yennies))}</span>
          <span>🔥 ${streakOf(start, log)}-day streak</span>
          <span>best kana streak ${num(progress.kanaBestStreak)}</span>
          <span>journey since ${escapeHtml(start)}</span>
          <span>${owned} gacha pulls owned</span>
          ${items.map(([id, count]) => `<span>${escapeHtml(id)} ×${num(count)}</span>`).join("")}
          ${achievements
            .map(
              ([id, at]) =>
                `<span>🏆 ${escapeHtml(id)} · ${new Date(num(at)).toLocaleDateString()}</span>`,
            )
            .join("")}
        </div>

        <div class="adm-grants row-actions">
          <input type="number" id="adm-grant-n" value="100" style="width:90px" />
          <button id="adm-grant-xp" class="secondary">＋ XP</button>
          <button id="adm-grant-yen" class="secondary">＋ yennies</button>
        </div>

        <div class="adm-section"><b>Calendar</b></div>
        <div class="row-actions adm-dayrow">
          <button id="adm-prev" class="secondary">‹</button>
          <input type="date" id="adm-date" value="${escapeAttr(day)}" />
          <button id="adm-next" class="secondary">›</button>
        </div>
        <div id="adm-day"></div>

        <div class="adm-section"><b>Gacha visibility</b></div>
        <div class="glosses">Unticked prizes vanish from this account's table: not shown, not drawable.</div>
        <div id="adm-prizes" class="adm-prizes"><div class="glosses">Loading prizes…</div></div>
        <div class="msg" id="adm-msg"></div>
      `;

      const message = userBox.querySelector<HTMLDivElement>("#adm-msg")!;
      const say = (text: string): void => {
        message.textContent = text;
      };

      /** Write a patch, fold it into the local copy, redraw. */
      const commit = async (patch: Progress, note: string): Promise<void> => {
        try {
          await writeProgress(uid, patch);
          progress = { ...progress, ...patch };
          draw();
          userBox.querySelector<HTMLDivElement>("#adm-msg")!.textContent = note;
        } catch (err) {
          say(err instanceof Error ? err.message : String(err));
        }
      };

      // ---- grants ----
      const grantAmount = (): number =>
        Math.max(0, Math.floor(Number(userBox.querySelector<HTMLInputElement>("#adm-grant-n")!.value) || 0));
      userBox.querySelector("#adm-grant-xp")!.addEventListener("click", () => {
        const n = grantAmount();
        if (n > 0) void commit({ xpTotal: num(progress.xpTotal) + n }, `+${n} XP.`);
      });
      userBox.querySelector("#adm-grant-yen")!.addEventListener("click", () => {
        const n = grantAmount();
        if (n > 0) void commit({ yennies: num(progress.yennies) + n }, `+${n} ¥.`);
      });

      // ---- the day editor ----
      const dateInput = userBox.querySelector<HTMLInputElement>("#adm-date")!;
      const step = (delta: number): void => {
        const [y, m, d] = day.split("-").map(Number);
        day = dateKey(new Date(y, m - 1, d + delta));
        draw();
      };
      userBox.querySelector("#adm-prev")!.addEventListener("click", () => step(-1));
      userBox.querySelector("#adm-next")!.addEventListener("click", () => step(1));
      dateInput.addEventListener("change", () => {
        if (dateInput.value) {
          day = dateInput.value;
          draw();
        }
      });

      /** questLog writes always travel with a bumped rev, so deletions stick. */
      const logPatch = (nextLog: QuestLog, extra: Progress = {}): Progress => ({
        questLog: nextLog,
        questLogRev: num(progress.questLogRev) + 1,
        ...extra,
      });

      const dayBox = userBox.querySelector<HTMLDivElement>("#adm-day")!;
      const plan = planForDayFrom(day, start);
      const events = log[day] ?? {};
      const planEvents = new Set(plan.quests.map((quest) => quest.event));
      const extras = Object.entries(events).filter(([event]) => !planEvents.has(event));
      const done = dayDone(day, start, log);

      dayBox.innerHTML = `
        ${plan.beforeJourney ? `<div class="glosses">Before this account's journey began; cleared by grace.</div>` : ""}
        ${plan.milestone ? `<div class="glosses">🏁 ${escapeHtml(plan.milestone)}</div>` : ""}
        ${plan.quests
          .map((quest, i) => {
            const at = events[quest.event] ?? 0;
            return `<div class="adm-quest">
              <span class="adm-quest-name">${at >= quest.goal ? "✅" : "⬜"} ${escapeHtml(quest.title)}</span>
              <input type="number" min="0" data-ev="${escapeAttr(quest.event)}" value="${at}" />
              <span class="glosses">/ ${quest.goal}</span>
              <button class="secondary" data-doq="${i}">Done</button>
              <button class="secondary" data-clearq="${i}">0</button>
            </div>`;
          })
          .join("")}
        ${extras
          .map(
            ([event, count]) => `<div class="adm-quest">
              <span class="adm-quest-name glosses">${escapeHtml(event)}</span>
              <input type="number" min="0" data-ev="${escapeAttr(event)}" value="${count}" />
              <button class="secondary" data-delev="${escapeAttr(event)}">✕</button>
            </div>`,
          )
          .join("")}
        <div class="row-actions">
          <button id="adm-day-complete" class="secondary">${done ? "Day is complete ✓" : "Complete whole day"}</button>
          <button id="adm-day-save" class="secondary">Save counts</button>
          <button id="adm-day-delete" class="secondary">Delete day</button>
        </div>
      `;

      const withDay = (mutate: (bucket: Record<string, number>) => void): QuestLog => {
        const next: QuestLog = { ...log, [day]: { ...(log[day] ?? {}) } };
        mutate(next[day]);
        if (Object.keys(next[day]).length === 0) delete next[day];
        return next;
      };

      for (const button of dayBox.querySelectorAll<HTMLButtonElement>("[data-doq]")) {
        button.addEventListener("click", () => {
          const quest = plan.quests[Number(button.dataset.doq)];
          const next = withDay((bucket) => {
            bucket[quest.event] = Math.max(bucket[quest.event] ?? 0, quest.goal);
          });
          void commit(
            logPatch(next, settleAwards(progress, day, plan, next)),
            `${quest.title} marked done for ${day}.`,
          );
        });
      }
      for (const button of dayBox.querySelectorAll<HTMLButtonElement>("[data-clearq]")) {
        button.addEventListener("click", () => {
          const quest = plan.quests[Number(button.dataset.clearq)];
          const next = withDay((bucket) => {
            delete bucket[quest.event];
          });
          void commit(logPatch(next), `${quest.title} reset for ${day}.`);
        });
      }
      for (const button of dayBox.querySelectorAll<HTMLButtonElement>("[data-delev]")) {
        button.addEventListener("click", () => {
          const event = button.dataset.delev!;
          const next = withDay((bucket) => {
            delete bucket[event];
          });
          void commit(logPatch(next), `${event} removed from ${day}.`);
        });
      }
      dayBox.querySelector("#adm-day-complete")!.addEventListener("click", () => {
        const next = withDay((bucket) => {
          for (const quest of plan.quests) bucket[quest.event] = Math.max(bucket[quest.event] ?? 0, quest.goal);
        });
        void commit(
          logPatch(next, settleAwards(progress, day, plan, next)),
          `${day} marked complete; the streak follows.`,
        );
      });
      dayBox.querySelector("#adm-day-save")!.addEventListener("click", () => {
        const next = withDay((bucket) => {
          for (const input of dayBox.querySelectorAll<HTMLInputElement>("[data-ev]")) {
            const count = Math.max(0, Math.floor(Number(input.value) || 0));
            if (count > 0) bucket[input.dataset.ev!] = count;
            else delete bucket[input.dataset.ev!];
          }
        });
        void commit(logPatch(next, settleAwards(progress, day, plan, next)), `${day} saved.`);
      });
      dayBox.querySelector("#adm-day-delete")!.addEventListener("click", () => {
        const next: QuestLog = { ...log };
        delete next[day];
        void commit(logPatch(next), `${day} deleted.`);
      });

      // ---- gacha visibility ----
      void prizeTable().then((table) => {
        const box = userBox.querySelector<HTMLDivElement>("#adm-prizes");
        if (!box) return;
        const hidden = new Set(
          Array.isArray(progress.hiddenPrizes) ? (progress.hiddenPrizes as unknown[]).map(String) : [],
        );
        box.innerHTML = table.prizes
          .map(
            (prize) => `<label class="adm-prize">
              <input type="checkbox" data-prize="${escapeAttr(prize.id)}" ${hidden.has(prize.id) ? "" : "checked"} />
              <span>${escapeHtml(prize.name)}</span>
              <span class="glosses">${escapeHtml(prize.rarity)}</span>
            </label>`,
          )
          .join("");
        for (const check of box.querySelectorAll<HTMLInputElement>("[data-prize]")) {
          check.addEventListener("change", () => {
            const id = check.dataset.prize!;
            if (check.checked) hidden.delete(id);
            else hidden.add(id);
            void writeProgress(uid, { hiddenPrizes: [...hidden].sort() }).then(
              () => {
                progress = { ...progress, hiddenPrizes: [...hidden].sort() };
                say(`${id} is now ${check.checked ? "visible" : "hidden"} for @${name}.`);
              },
              (err) => say(err instanceof Error ? err.message : String(err)),
            );
          });
        }
      });
    };

    draw();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
