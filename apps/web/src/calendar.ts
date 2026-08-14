import {
  beginJourney,
  dateKey,
  dayStreak,
  eventsOf,
  examCountdown,
  journeyStarted,
  planForDay,
  questProgress,
  type Countdown,
} from "./quests.js";
import { screenHeader } from "./screen.js";
import { levelState } from "./levels.js";
import { renderAchievements } from "./achievements.js";
import { totalKanaReviews } from "./kana-stats.js";

/**
 * The Calendar: a month of days, each carrying its quests.
 *
 * Days run on local time. Today shows its quests with live progress; past
 * days show how they went; future days show what is coming — readable any
 * time, attemptable only when the day arrives. Landmark days carry a 🏁 and
 * glow gold. A run of fully-completed days is the day streak, counted next to
 * the month, and the hiragana exam counts itself down at the top until the
 * day it falls on.
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

  // No journey yet: a bare month and the invitation, nothing else. The
  // journey used to start itself the first time this screen was opened,
  // which meant the schedule was already three days old by the time anyone
  // understood what it was. Now day 1 is the day the button is pressed.
  if ((await journeyStarted()) === null) {
    if (!isCurrent()) return;
    renderInvitation(main, now, isCurrent);
    return;
  }

  const streak = await dayStreak(now);
  const level = await levelState();
  const exam = await examCountdown(now);
  if (!isCurrent()) return;

  main.innerHTML = `
    ${screenHeader("Calendar")}
    ${countdownHtml(exam)}
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
    <div id="cal-achievements"></div>
  `;

  // Reading the total also settles any achievement earned before the
  // achievement existed, so the list below is honest before it draws.
  await totalKanaReviews().catch(() => 0);
  void renderAchievements(main.querySelector<HTMLElement>("#cal-achievements")!);

  // Tapping the countdown goes to the day itself, which is where the exam
  // and the quests around it are written out.
  main.querySelector<HTMLButtonElement>("#exam-countdown")?.addEventListener("click", () => {
    const [year, month] = exam.key.split("-").map(Number);
    viewYear = year;
    viewMonth = month - 1;
    selectedKey = exam.key;
    void renderCalendar(main, isCurrent);
  });

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
    } else if (plan.quests.length === 0) {
      // An unwritten day past the exam: no quests to have done or missed.
      status = "";
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

/**
 * The calendar before there is a journey: the month, blank, and one button.
 *
 * The days carry nothing because there is nothing yet — no quests, no
 * streak, no exam date. All of that begins when the button is pressed, and
 * the schedule it starts runs from that day up to the hiragana exam a week
 * later. What comes after the exam is still being written.
 */
function renderInvitation(main: HTMLElement, now: Date, isCurrent: () => boolean): void {
  const todayKey = dateKey(now);
  const first = new Date(viewYear!, viewMonth!, 1);
  const daysInMonth = new Date(viewYear!, viewMonth! + 1, 0).getDate();
  const leadingBlanks = (first.getDay() + 6) % 7; // Monday-first

  main.innerHTML = `
    ${screenHeader("Calendar")}
    <div class="cal-head">
      <button id="cal-prev" class="ghost" aria-label="Previous month">‹</button>
      <div class="cal-month">${MONTHS[viewMonth!]} ${viewYear}</div>
      <button id="cal-next" class="ghost" aria-label="Next month">›</button>
    </div>
    <div class="cal-grid">
      ${WEEKDAYS.map((day) => `<div class="cal-weekday">${day}</div>`).join("")}
      ${Array.from({ length: leadingBlanks }, () => `<div class="cal-cell blank"></div>`).join("")}
      ${Array.from({ length: daysInMonth }, (_, i) => {
        const key = dateKey(new Date(viewYear!, viewMonth!, i + 1));
        return `<div class="cal-cell quiet${key === todayKey ? " today" : ""}"><span>${i + 1}</span></div>`;
      }).join("")}
    </div>
    <div class="card-panel journey-invite">
      <div class="big">🌱</div>
      <b>Your journey has not started yet.</b>
      <div class="glosses" style="margin:8px 0 14px">
        Press the button and today becomes day 1. A week of daily quests
        teaches you the whole hiragana, two rows a day, and on day 8 you sit
        the hiragana exam. The calendar fills in as you go.
      </div>
      <button id="journey-begin">Start my journey</button>
    </div>
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

  main.querySelector<HTMLButtonElement>("#journey-begin")!.addEventListener("click", async (ev) => {
    (ev.currentTarget as HTMLButtonElement).disabled = true;
    await beginJourney();
    // Back to the month being lived in, where day 1 now is.
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    selectedKey = todayKey;
    void renderCalendar(main, isCurrent);
  });
}

/**
 * The countdown to the hiragana exam.
 *
 * The exam is the eighth day of the journey — the last row learned, and
 * everything before it tested together — so it has a real date the moment
 * somebody starts, and a date you can see coming is a date you prepare for.
 * It leaves the screen the day after it falls: a countdown to something
 * behind you is just clutter.
 */
function countdownHtml(exam: Countdown): string {
  if (exam.daysAway < 0) return "";
  const soon = exam.daysAway <= 1;
  const left = exam.daysAway === 0 ? "Today" : exam.daysAway === 1 ? "Tomorrow" : `${exam.daysAway} days`;
  return `
    <button class="card-panel exam-countdown" id="exam-countdown" data-key="${exam.key}">
      <span class="exam-days">${left}</span>
      <span class="exam-what">${soon ? "is" : "until"} the hiragana exam</span>
      <span class="glosses">${readableDate(exam.key)} · every row, together</span>
    </button>
  `;
}

/** "Saturday 9 August", from a day key. */
function readableDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    date.getDay()
  ];
  return `${weekday} ${d} ${MONTHS[m - 1]}`;
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

  // Past the written schedule: the journey so far runs up to the hiragana
  // exam, and these days will be filled in as the road is laid further.
  if (plan.afterSchedule && plan.quests.length === 0) {
    box.innerHTML = `
      <div class="card-panel">
        <b>${isToday ? "Today" : key}</b>
        <div class="glosses" style="margin-top:6px">Beyond the exam. This part of the journey is still being written.</div>
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
      <div id="cal-study" class="cal-study"></div>
    </div>
  `;

  // What was actually studied that day: flashcards by button, kana by
  // answer. Filled in after the panel stands, absent when nothing happened.
  if (!future) void drawDayStudy(box.querySelector<HTMLDivElement>("#cal-study"), key);
}

/** The day's study record: flashcard grades and kana answers. */
async function drawDayStudy(box: HTMLDivElement | null, key: string): Promise<void> {
  if (!box) return;
  const [reviewStats, kanaGames] = await Promise.all([
    import("./review-stats.js").then((m) => m.dayReviewStats(key)),
    import("./kana-stats.js").then((m) => m.kanaGameLog()),
  ]);
  if (!box.isConnected) return;

  const cardTotal = reviewStats.again + reviewStats.hard + reviewStats.good + reviewStats.easy;

  // Kana runs whose start fell on this local day.
  const sameDay = (at: number): boolean => {
    const d = new Date(at);
    return (
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` === key
    );
  };
  const runs = kanaGames.filter((game) => sameDay(game.startedAt));
  const kana = runs.reduce(
    (sum, game) => ({
      questions: sum.questions + (game.questions ?? 0),
      correct: sum.correct + (game.correct ?? 0),
      wrong: sum.wrong + (game.wrong ?? 0),
    }),
    { questions: 0, correct: 0, wrong: 0 },
  );

  if (cardTotal === 0 && kana.questions === 0) return;
  box.innerHTML = `
    ${
      cardTotal > 0
        ? `<div class="cal-study-row">
            <span>🗂 <b>${cardTotal.toLocaleString()}</b> card review${cardTotal === 1 ? "" : "s"}${
              reviewStats.introduced > 0 ? ` · ${reviewStats.introduced} new` : ""
            }</span>
            <span class="glosses">again ${reviewStats.again} · hard ${reviewStats.hard} · good ${reviewStats.good} · easy ${reviewStats.easy}</span>
          </div>`
        : ""
    }
    ${
      kana.questions > 0
        ? `<div class="cal-study-row">
            <span>あ <b>${kana.questions.toLocaleString()}</b> kana answer${kana.questions === 1 ? "" : "s"}</span>
            <span class="glosses">${kana.correct} right · ${kana.wrong} wrong${
              kana.questions > 0 ? ` · ${Math.round((kana.correct / Math.max(1, kana.correct + kana.wrong)) * 100)}%` : ""
            }</span>
          </div>`
        : ""
    }
  `;
}
