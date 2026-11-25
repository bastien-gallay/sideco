/**
 * The search over the cards of every board (out of main.ts, T171): the cards
 * found are listed as the words are typed, the board shown's first; the arrows
 * choose one, Enter goes to it, wherever it is. main.ts says what opens it and
 * where its bar stands; this module keeps the words, the list and the keys.
 */

import { markWords, queryWords } from "../domain/find.ts";
import type { BoardView } from "./board-api.ts";
import { h } from "./dom.ts";
import { bringCard, isScrolledOut } from "./lane-scroll.ts";
import { t } from "./locale.ts";
import { currentBoard, shown } from "./store.ts";
import { type FindHit, findHits } from "./view.ts";

/** As many as a glance reads: the count says the rest. */
const FIND_SHOWN = 40;

/** Where the words were, when not in the card's name. */
function foundWhere(hit: FindHit): string {
  const where = hit.where;
  if (!where) return "";
  if (where.in === "labels") return `${t.findInLabels}${t.colon} ${where.text}`;
  if (where.in === "detail") return `${t.findInDetail}${t.colon} ${where.text}`;
  return `${t.findInNote(where.note)}${t.colon} ${where.text}`;
}

/** Shown text with the words asked marked: the eye finds why a line is there. */
function marked(text: string, words: readonly string[]): (string | HTMLElement)[] {
  return markWords(text, words).map((part) => (part.found ? h("mark", {}, part.text) : part.text));
}

export interface FindHooks {
  /** The board on screen: a card found on it is pointed at, shown, and takes the keyboard. */
  view: Pick<BoardView, "point" | "focus" | "reveal">;
  /** To a card by its own address: its board opens, and the card is chosen, centred and lit up. */
  open(board: string, id: string): void;
}

/** What the page gave: set once, when the bar is mounted. */
let hooks: FindHooks | undefined;

/**
 * A search over the cards of every board: `/` or Ctrl+K opens it. The cards found are listed as the
 * words are typed, the board shown's first; the arrows choose one, Enter goes to it, wherever it is.
 */
const findField = h("input", {
  type: "search",
  name: "find",
  placeholder: t.findPlaceholder,
  "aria-label": t.find,
  autocomplete: "off",
  role: "combobox",
  "aria-autocomplete": "list",
  "aria-expanded": "false",
  "aria-controls": "find-results",
});
const findCount = h("output", { class: "find-count", "aria-live": "polite" });
const findList = h("ul", {
  id: "find-results",
  class: "find-results",
  role: "listbox",
  "aria-label": t.find,
});
findList.hidden = true;
const findBar = h(
  "form",
  { class: "find-bar", role: "search", hidden: true },
  findField,
  findCount,
  h("button", { type: "button", class: "quiet", onclick: () => closeFind() }, t.close),
  findList,
);
let found: FindHit[] = [];
let foundAt = -1;

function openFind(): void {
  findBar.hidden = false;
  findField.focus();
  findField.select();
}

/** Closed, the keyboard stays on the card found when it is on the board shown. */
function closeFind(): void {
  findBar.hidden = true;
  findField.value = "";
  findCount.textContent = "";
  hooks?.view.point(undefined);
  const hit = found[foundAt];
  found = [];
  foundAt = -1;
  paintFound();
  if (hit?.here) hooks?.view.focus(hit.id);
}

/** To the card found: on its board, which the page opens when it is not the one shown. */
function goToFound(at: number): void {
  const hit = found[at];
  if (!hit) return;
  foundAt = at;
  closeFind();
  // The card's own address: its board opens, and the card is chosen, centred and lit up.
  hooks?.open(hit.board, hit.id);
}

findField.addEventListener("input", () => {
  found = findHits(shown(), findField.value, currentBoard()?.id);
  foundAt = found.length > 0 ? 0 : -1;
  paintFound();
  showFound();
});

findBar.addEventListener("submit", (event) => {
  event.preventDefault();
  goToFound(foundAt);
});

findField.addEventListener("keydown", (event) => {
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (event.key === "Escape") closeFind();
  else if (step !== 0 && found.length > 0) {
    const shownCount = Math.min(found.length, FIND_SHOWN);
    foundAt = (foundAt + step + shownCount) % shownCount;
    showFound();
  } else return;
  event.preventDefault();
  event.stopPropagation();
});

/** The list of the cards found, under the field. */
function paintFound(): void {
  const words = queryWords(findField.value);
  const items = found.slice(0, FIND_SHOWN).map((hit, at) => {
    const where = foundWhere(hit);
    return h(
      "li",
      {
        id: `find-hit-${at}`,
        role: "option",
        class: "find-hit",
        "aria-selected": "false",
        // The field keeps the keyboard: a press on a line goes to its card.
        onmousedown: (event: Event) => event.preventDefault(),
        onclick: () => goToFound(at),
      },
      // Spaces between the parts, for who hears the line: the grid lays them out without them.
      h("span", { class: "find-hit-id" }, hit.id),
      " ",
      h("span", { class: "find-hit-name" }, ...marked(hit.label.replace(/\s+/g, " ").trim(), words)),
      !hit.here && " ",
      !hit.here && h("span", { class: "find-hit-board" }, hit.title),
      where && " ",
      where && h("span", { class: "find-hit-where" }, ...marked(where, words)),
    );
  });
  const more = found.length - FIND_SHOWN;
  findList.replaceChildren(
    ...items,
    ...(more > 0 ? [h("li", { class: "find-more", role: "presentation" }, t.findMore(more))] : []),
  );
  const open = items.length > 0 && !findBar.hidden;
  findList.hidden = !open;
  findField.setAttribute("aria-expanded", String(open));
}

function showFound(): void {
  const hit = found[foundAt];
  for (const [at, item] of [...findList.querySelectorAll<HTMLElement>("[role=option]")].entries())
    item.setAttribute("aria-selected", String(at === foundAt));
  if (hit) findField.setAttribute("aria-activedescendant", `find-hit-${foundAt}`);
  else findField.removeAttribute("aria-activedescendant");
  findList.querySelector(`#find-hit-${foundAt}`)?.scrollIntoView({ block: "nearest" });
  // The count alone says nothing to who cannot see the board: the card found is named with it, and its board.
  const name = hit ? ` ${hit.label.replace(/\s+/g, " ").trim()}${hit.here ? "" : ` — ${hit.title}`}` : "";
  findCount.textContent =
    findField.value.trim() === ""
      ? ""
      : hit
        ? `${t.findCount(foundAt + 1, found.length)} · ${hit.id}${name}`
        : t.findNone;
  const show = (): void => {
    hooks?.view.point(hit?.here ? hit.id : undefined);
    if (hit?.here) hooks?.view.reveal(hit.id);
  };
  // A hit out of the window of its column (S306) is not drawn: its column comes to it, then it is lit.
  if (!hit?.here || !isScrolledOut(hit.id)) {
    show();
    return;
  }
  bringCard(hit.id);
  requestAnimationFrame(() => requestAnimationFrame(show));
}

/** Gives the search bar, and what opens it, to the page that says where it stands. */
export function mountFind(given: FindHooks): { bar: HTMLElement; open(): void } {
  hooks = given;
  return { bar: findBar, open: openFind };
}
