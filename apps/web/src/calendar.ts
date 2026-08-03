import { dateKey, dayComplete, dayStreak, eventsOf, questProgress, questsForDay } from "./quests.js";

/**
 * The Calendar: a month of days, each carrying its quests.
 *
 * Days run on local time. Today shows its quests with live progress; past
 * days show how they went; future days keep their quests to themselves
 * until they arrive. A run of fully-completed days is the day streak,
 * counted next to the month.
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
  if (!isCurrent()) return;

  main.innerHTML = `
    <h1>Calendar</h1>
    <p class="subtitle">A little Japanese every day. Quests turn over at local midnight.</p>
    <div class="cal-head">
      <button id="cal-prev" class="ghost" aria-label="Previous month">‹</button>
      <div class="cal-month">${MONTHS[viewMonth]} ${viewYear}</div>
      <button id="cal-next" class="ghost" aria-label="Next month">›</button>
      <div class="cal-streak">${streak > 0 ? `🔥 ${streak}-day streak` : "no streak yet"}</div>
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
    let status = "";
    if (!future) {
      const events = await eventsOf(key);
      const quests = questsForDay(key);
      const done = quests.filter((quest) => questProgress(quest, events) >= quest.goal).length;
      status = done === quests.length ? "done" : done > 0 || Object.keys(events).length > 0 ? "partial" : "idle";
    }
    if (!isCurrent()) return;

    const cell = document.createElement("button");
    cell.className = `cal-cell${isToday ? " today" : ""}${future ? " future" : ""} ${status}`;
    cell.innerHTML = `<span>${day}</span>${
      status === "done" ? `<span class="cal-mark">★</span>` : status === "partial" ? `<span class="cal-mark">·</span>` : ""
    }`;
    if (!future) {
      cell.addEventListener("click", () => {
        selectedKey = key;
        void renderDay(main, key, todayKey, isCurrent);
      });
    } else {
      cell.disabled = true;
    }
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
  const quests = questsForDay(key);
  const events = await eventsOf(key);
  if (!isCurrent()) return;

  const isToday = key === todayKey;
  const complete = quests.every((quest) => questProgress(quest, events) >= quest.goal);

  box.innerHTML = `
    <div class="card-panel">
      <b>${isToday ? "Today" : key}</b>
      ${complete ? `<span class="glosses"> · all quests done ⭐</span>` : ""}
      <div class="cal-quests">
        ${quests
          .map((quest) => {
            const progress = questProgress(quest, events);
            const done = progress >= quest.goal;
            const percent = Math.round((progress / quest.goal) * 100);
            return `
              <div class="cal-quest${done ? " done" : ""}">
                <div class="cal-quest-row">
                  <span>${done ? "✅" : "⬜"} <b>${quest.title}</b></span>
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
