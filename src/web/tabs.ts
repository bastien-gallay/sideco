/** The right panel's tabs: what Claude's session does, the discussions, time, what the page said, the chosen card. */
import { h } from "./dom.ts";
import { locale, t } from "./locale.ts";

export type Tab = "session" | "notes" | "history" | "notices" | "detail";
export const TABS: Tab[] = ["session", "notes", "history", "notices", "detail"];

/** One drawing per tab, on one grid and one stroke: a terminal, a speech bubble, a clock, a bell, a page. */
const TAB_ICON: Record<Tab, string> = {
  session:
    '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6.5l2 1.75-2 1.75M8.5 10.5h3"/>',
  notes:
    '<path d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 12H7l-3 2.5V12H3a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 3 3z"/>',
  history: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75V8l2.25 1.5"/>',
  notices: '<path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1.25 1.25H2.75z"/><path d="M6.5 14.25h3"/>',
  detail: '<rect x="2.5" y="1.5" width="11" height="13" rx="1.5"/><path d="M5 5.5h6M5 8h6M5 10.5h4"/>',
};

export function tabIcon(id: Tab): HTMLSpanElement {
  const icon = h("span", { class: "tab-icon", "aria-hidden": "true" });
  icon.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${TAB_ICON[id]}</svg>`;
  return icon;
}

/** Each tab's name. Notifications' lives here, as messages.ts is at its ceiling. */
export function tabName(id: Tab): string {
  return id === "notices" ? { en: "Notifications", fr: "Notifications" }[locale] : t.tabs[id];
}

/**
 * Each tab is its icon, and the chosen one says its name beside it (S330).
 * Measured: where even that name does not fit, the icons stand alone, as in the folded rail.
 */
export function fitTabsIn(tabList: HTMLElement, folded: boolean): void {
  tabList.classList.remove("tabs-icons");
  if (folded) return;
  if (tabList.scrollWidth > tabList.clientWidth) tabList.classList.add("tabs-icons");
}

/** Where a key takes the keyboard among the tabs that are open: the arrows go round, Home and End to the ends. */
const STEP: Record<string, (at: number, open: number) => number> = {
  ArrowRight: (at, open) => (at + 1) % open,
  ArrowDown: (at, open) => (at + 1) % open,
  ArrowLeft: (at, open) => (at - 1 + open) % open,
  ArrowUp: (at, open) => (at - 1 + open) % open,
  Home: () => 0,
  End: (_, open) => open - 1,
};

/** The arrows go from tab to tab, past the one that has nothing to show yet; Home and End to the first and the last. */
export function tabKeys(
  tabList: HTMLElement,
  buttons: Record<Tab, HTMLButtonElement>,
  current: () => Tab,
  choose: (tab: Tab) => void,
): void {
  tabList.addEventListener("keydown", (event) => {
    const open = TABS.filter((id) => buttons[id].getAttribute("aria-disabled") !== "true");
    const step = Object.hasOwn(STEP, event.key) ? STEP[event.key] : undefined;
    const next = step && open[step(open.indexOf(current()), open.length)];
    if (!next) return;
    event.preventDefault();
    choose(next);
  });
}
