/**
 * The navigation, in one place, for two very different screens.
 *
 * There are nine destinations. A wide screen has room for all of them down
 * the side, grouped and labelled. A phone does not: nine tabs across a
 * 400-pixel bar gives each one 44 pixels, which is narrower than a fingertip
 * and reads as a wall of tiny icons.
 *
 * So the phone bar carries four destinations — the ones a study session
 * actually starts from — and a More button that opens the full map as a
 * sheet, grouped exactly as the sidebar groups it. Nothing is hidden: the
 * sheet lists every destination including the four on the bar, so "where is
 * Kanji" is answered in one tap rather than remembered.
 *
 * The More button is not a dead end either. While you are somewhere that
 * lives in the sheet, the button wears that place's icon and name and lights
 * up, so the bar always says where you are.
 */

export interface NavItem {
  route: string;
  label: string;
  icon: string;
  /** On the phone bar. Everything else reaches the phone via the sheet. */
  primary?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Pinned to the bottom of the sidebar. */
  tail?: boolean;
}

export const NAV: NavGroup[] = [
  {
    label: "Study",
    items: [
      { route: "review", label: "Review", icon: "🗂️", primary: true },
      { route: "words", label: "Words", icon: "📚", primary: true },
      { route: "decks", label: "Decks", icon: "📦" },
    ],
  },
  {
    label: "Learn",
    items: [
      { route: "kana", label: "Kana", icon: "あ", primary: true },
      { route: "grammar", label: "Grammar", icon: "文", primary: true },
      { route: "kanji", label: "Kanji", icon: "漢" },
    ],
  },
  {
    label: "Play",
    items: [
      { route: "calendar", label: "Calendar", icon: "📅" },
      { route: "gacha", label: "Gacha", icon: "🎁" },
      { route: "games", label: "Games", icon: "🕹️" },
    ],
  },
  {
    label: "You",
    items: [{ route: "settings", label: "Settings", icon: "⚙️" }],
    tail: true,
  },
];

const ITEMS = NAV.flatMap((group) => group.items);

function link(item: NavItem, className = ""): string {
  return `<a href="#${item.route}" data-route="${item.route}"${item.primary ? " data-primary" : ""}
    ${className ? `class="${className}"` : ""}><span class="icon">${item.icon}</span>${item.label}</a>`;
}

/** The bar/sidebar, and the sheet that opens off it. */
export function navHtml(): string {
  return `
    <nav>
      <div class="brand" aria-hidden="true">読めよ<span>Yomeyo</span></div>
      ${NAV.map(
        (group) => `<div class="nav-group${group.tail ? " nav-tail" : ""}" data-label="${group.label}">
          ${group.items.map((item) => link(item)).join("")}
        </div>`,
      ).join("")}
      <button type="button" class="nav-more" id="nav-more" aria-expanded="false" aria-controls="nav-sheet">
        <span class="icon" id="nav-more-icon">⋯</span><span id="nav-more-label">More</span>
      </button>
    </nav>`;
}

export function navSheetHtml(): string {
  return `
    <div class="nav-sheet" id="nav-sheet" hidden>
      <div class="nav-sheet-scrim" id="nav-sheet-scrim"></div>
      <div class="nav-sheet-panel" role="dialog" aria-modal="true" aria-label="All sections">
        <div class="nav-sheet-grip" aria-hidden="true"></div>
        ${NAV.map(
          (group) => `<div class="nav-sheet-group">
            <div class="nav-sheet-label">${group.label}</div>
            <div class="nav-sheet-items">${group.items
              .map((item) => link(item, "nav-sheet-item"))
              .join("")}</div>
          </div>`,
        ).join("")}
      </div>
    </div>`;
}

/**
 * Wire the More button.
 *
 * The sheet closes on anything that means "I am done with it": a
 * destination, the scrim, Escape, or the back gesture — a tap on a place you
 * are already at changes no hash and fires no route, so it is closed here
 * rather than left hanging.
 */
export function mountNav(root: ParentNode): void {
  const sheet = root.querySelector<HTMLDivElement>("#nav-sheet");
  const more = root.querySelector<HTMLButtonElement>("#nav-more");
  if (!sheet || !more) return;

  const setOpen = (open: boolean): void => {
    sheet.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("sheet-open", open);
  };

  more.addEventListener("click", () => setOpen(sheet.hidden));
  sheet.querySelector("#nav-sheet-scrim")!.addEventListener("click", () => setOpen(false));
  for (const anchor of sheet.querySelectorAll("a")) {
    anchor.addEventListener("click", () => setOpen(false));
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !sheet.hidden) setOpen(false);
  });
  window.addEventListener("hashchange", () => setOpen(false));
}

/**
 * Light up wherever we are — in the bar, in the sidebar, and in the sheet.
 *
 * When the current place is not one of the four on the phone bar, the More
 * button becomes it: same icon, same name, same accent. The bar never shows
 * nothing selected.
 */
export function markNavActive(root: ParentNode, route: string): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("nav a, .nav-sheet a")) {
    anchor.classList.toggle("active", anchor.dataset.route === route);
  }
  const more = root.querySelector<HTMLButtonElement>("#nav-more");
  if (!more) return;
  const here = ITEMS.find((item) => item.route === route);
  const inSheet = here !== undefined && !here.primary;
  more.classList.toggle("active", inSheet);
  root.querySelector("#nav-more-icon")!.textContent = inSheet ? here.icon : "⋯";
  root.querySelector("#nav-more-label")!.textContent = inSheet ? here.label : "More";
}
