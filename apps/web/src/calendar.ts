import { dateKey, dayStreak, eventsOf, planForDay, questProgress } from "./quests.js";
import { screenHeader } from "./screen.js";
import { levelState } from "./levels.js";

/**
 * The Calendar: a month of days, each carrying its quests.
 *
 * Days run on local time. Today shows its quests with live progress; past
 * days show how they went; future days show what is coming — readable any
 * time, attemptable only when the day arrives. Landmark days carry a 🏁.
 * A run of fully-completed days is the day streak, counted next to the
 * month.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The month being looked at, kept across tab switches within a session. */
let viewYear: number | null = null;
let viewMonth: number | null = null;
let selectedKey: string | null = null;

export async function renderCalendar(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const now = new Date();
  viewYear ??= now.getFullYear();
  viewMonth ??= now.getMonth();
  selectedKey ??= dateKey(now);

  const streak = await dayStreak(now);
  const level = await levelState();
  if (!isCurrent()) return;

  main.innerHTML = `
    ${screenHeader("Calendar")}
    <div class="cal-head">
      <button id="cal-prev" class="ghost" aria-label="Previous month">‹</button>
      <div class="cal-month">${MONTHS[viewMonth]} ${viewYear}</div>
      <button id="cal-next" class="ghost" aria-label="Next month">›</button>
      <div class="cal-streak">
        <span class="level-chip">Lv ${level.level}</span> · ${level.into}/${level.need} XP ·
        ${streak > 0 ? `🔥 ${streak}-day streak` : "no streak yet"}
      </div>
    </div>
    <div class="cal-grid" id="cal-grid">
      ${WEEKDAYS.map((day) => `<div class="cal-weekday">${day}</div>`).join("")}
    </div>
    <div id="cal-day"></div>
  `;

  main.querySelector<HTMLButtonElement>("#cal-prev")!.addEventListener("click", () => {
    viewMonth!--;
    if (viewMonth! < 0) {
      viewMonth = 11;
      viewYear!--;
    }
    void renderCalendar(main, isCurrent);
  });
  main.querySelector<HTMLButtonElement>("#cal-next")!.addEventListener("click", () => {
    viewMonth!++;
    if (viewMonth! > 11) {
      viewMonth = 0;
      viewYear!++;
    }
    void renderCalendar(main, isCurrent);
  });

  const grid = main.querySelector<HTMLDivElement>("#cal-grid")!;
  const todayKey = dateKey(now);
  const first = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = (first.getDay() + 6) % 7; // Monday-first

  for (let i = 0; i < leadingBlanks; i++) {
    grid.insertAdjacentHTML("beforeend", `<div class="cal-cell blank"></div>`);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(new Date(viewYear, viewMonth, day));
    const future = key > todayKey;
    const isToday = key === todayKey;
    const plan = await planForDay(key);
    let status = "";
    if (plan.beforeJourney) {
      status = "grace";
    } else if (!future) {
      const events = await eventsOf(key);
      const done = plan.quests.filter((quest) => questProgress(quest, events) >= quest.goal).length;
      status = done === plan.quests.length ? "done" : done > 0 || Object.keys(events).length > 0 ? "partial" : "idle";
    }
    if (!isCurrent()) return;

    const cell = document.createElement("button");
    cell.className = `cal-cell${isToday ? " today" : ""}${future ? " future" : ""}${
      plan.milestone ? " milestone" : ""
    } ${status}`;
    cell.innerHTML = `<span>${day}</span>${
      plan.milestone
        ? `<span class="cal-mark">🏁</span>`
        : status === "done"
          ? `<span class="cal-mark">★</span>`
          : status === "grace"
            ? `<span class="cal-mark cal-grace">✓</span>`
            : status === "partial"
              ? `<span class="cal-mark">·</span>`
              : ""
    }`;
    // Every day is readable, future ones included — the quests are known
    // ahead of time; only the attempting waits for the day itself.
    cell.addEventListener("click", () => {
      selectedKey = key;
      void renderDay(main, key, todayKey, isCurrent);
    });
    grid.appendChild(cell);
  }

  // Keep the selection inside the month on view changes.
  const shown = selectedKey.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`)
    ? selectedKey
    : todayKey;
  void renderDay(main, shown, todayKey, isCurrent);
}

async function renderDay(
  main: HTMLElement,
  key: string,
  todayKey: string,
  isCurrent: () => boolean,
): Promise<void> {
  const box = main.querySelector<HTMLDivElement>("#cal-day");
  if (!box) return;
  const plan = await planForDay(key);
  const events = await eventsOf(key);
  if (!isCurrent()) return;

  const isToday = key === todayKey;
  const future = key > todayKey;

  if (plan.beforeJourney) {
    box.innerHTML = `
      <div class="card-panel">
        <b>${key}</b><span class="glosses"> · cleared ✓</span>
        <div class="glosses" style="margin-top:6px">Before your journey began.</div>
      </div>
    `;
    return;
  }

  const complete =
    !future && plan.quests.every((quest) => questProgress(quest, events) >= quest.goal);

  box.innerHTML = `
    <div class="card-panel${future ? " cal-preview" : ""}">
      <b>${isToday ? "Today" : key}</b>
      ${plan.milestone ? `<span class="cal-milestone-tag">🏁 Milestone: ${plan.milestone}</span>` : ""}
      ${complete ? `<span class="glosses"> · all quests done ⭐</span>` : ""}
      ${future ? `<div class="glosses" style="margin-top:4px">Unlocks on the day.</div>` : ""}
      <div class="cal-quests">
        ${plan.quests
          .map((quest) => {
            const progress = future ? 0 : questProgress(quest, events);
            const done = progress >= quest.goal;
            const percent = Math.round((progress / quest.goal) * 100);
            return `
              <div class="cal-quest${done ? " done" : ""}">
                <div class="cal-quest-row">
                  <span>${future ? "🔒" : done ? "✅" : "⬜"} <b>${quest.title}</b></span>
                  <span class="glosses">${progress} / ${quest.goal}</span>
                </div>
                <div class="glosses">${quest.detail}</div>
                <div class="kana-bar"><div class="kana-bar-fill" style="width:${percent}%"></div></div>
              </div>`;
          })
          .join("")}
      </div>
      ${
        isToday && !complete
          ? `<div class="row-actions" style="margin-top:12px"><a href="#kana"><button class="secondary">To the Kana game →</button></a></div>`
          : ""
      }
    </div>
  `;
}
