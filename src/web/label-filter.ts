/**
 * The filter by label (S308): a chip pressed, on a card or in the Detail tab,
 * keeps in view the cards that wear its label. The others step back where they
 * are: no card moves, so the board read a moment ago is still the board. The
 * filter is the reader's own, kept while the page is open and from board to
 * board, since a label is the same on all of them. Its words live here, in
 * each language, as messages.ts is at its ceiling.
 */
import type { Locale } from "../domain/i18n.ts";
import { hasLabel, sameLabel } from "../domain/labels.ts";
import { type Chosen, chipText, labelColours } from "../domain/render/labels.ts";
import type { Board } from "../domain/workspace.ts";
import { h, region } from "./dom.ts";
import { locale } from "./locale.ts";
import { currentBoard, shown, state } from "./store.ts";

interface Words {
  filter: string;
  count: (shown: number, of: number) => string;
  clear: string;
  /** The name of a chip's button: what pressing it does. */
  only: (label: string) => string;
  cleared: string;
}

const WORDS: Record<Locale, Words> = {
  en: {
    filter: "Filter",
    count: (shown, of) => `${shown} of ${of} card${of > 1 ? "s" : ""}`,
    clear: "Show all",
    only: (label) => `Show only the cards labelled ${label}`,
    cleared: "Filter off: every card is shown",
  },
  fr: {
    filter: "Filtre",
    count: (shown, of) => `${shown} carte${shown > 1 ? "s" : ""} sur ${of}`,
    clear: "Tout montrer",
    only: (label) => `Ne montrer que les cartes qui portent le label ${label}`,
    cleared: "Filtre levé : toutes les cartes sont montrées",
  },
};
const w = WORDS[locale];

/** How far a press may travel and still be a press on a chip, not a card carried by it. */
const PRESS_REACH = 4;

let label: string | undefined;
let hooks: { changed: () => void; speak: (words: string) => void } = { changed: () => {}, speak: () => {} };

/** Over the board while a filter holds: the label, how many cards wear it, and the way back. */
export const filterBar = h("div", { class: "filter-bar", hidden: true });

/** The cards of a board that wear a label, among all of them. */
export function wearing(board: Board, by: string): { shown: number; of: number } {
  return { shown: board.elements.filter((e) => hasLabel(e, by)).length, of: board.elements.length };
}

export const filteredBy = (by: string): boolean => label !== undefined && sameLabel(label, by);
export const filterName = (by: string): string => w.only(chipText(by));

/** Filters by this label; pressed again, the same label lets go. */
export function toggleLabelFilter(by: string): void {
  label = filteredBy(by) ? undefined : by;
  const board = currentBoard();
  if (label === undefined) hooks.speak(w.cleared);
  else if (board) hooks.speak(`${w.filter} ${label}: ${count(board, label)}`);
  hooks.changed();
}

const count = (board: Board, by: string): string => {
  const { shown, of } = wearing(board, by);
  return w.count(shown, of);
};

/**
 * A chip of a card is pressed where the pointer went down and stayed. A card
 * carried by its chip is a move, wherever it is let go; a card pressed to end a
 * link is the link's; the second press of a double click is the rename's.
 */
export function mountLabelFilter(canvas: HTMLElement, on: typeof hooks): void {
  hooks = on;
  let down: { x: number; y: number } | undefined;
  const carried = (): boolean => canvas.querySelector("g.card.is-dragging") !== null;
  canvas.addEventListener("pointerdown", (event) => {
    down = state.linking === null ? { x: event.clientX, y: event.clientY } : undefined;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (down && (carried() || Math.hypot(event.clientX - down.x, event.clientY - down.y) > PRESS_REACH))
      down = undefined;
  });
  canvas.addEventListener("click", (event) => {
    const pressed = down !== undefined && event.detail < 2;
    down = undefined;
    if (!pressed) return;
    // The board holds the pointer while a card is pressed: what is under it says which chip.
    const chip = document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGGElement>(".card-chip");
    if (chip?.dataset.label) toggleLabelFilter(chip.dataset.label);
  });
  // The bar goes with the filter: the keyboard that pressed "Show all" goes back to the board, not nowhere.
  filterBar.addEventListener("click", () => {
    if (label === undefined) canvas.querySelector<SVGGElement>('g.card[tabindex="0"], g.card')?.focus();
  });
}

const paintBar = region(filterBar, (m: { label: string; count: string; colours?: Chosen }) => {
  const { fill, ink } = labelColours(m.label, m.colours);
  return [
    h(
      "span",
      { class: "filter-what" },
      `${w.filter} `,
      h(
        "span",
        { class: "label-chip", style: `background:${fill};color:${ink}`, title: m.label },
        chipText(m.label),
      ),
      h("span", { class: "filter-count" }, m.count),
    ),
    h("button", { type: "button", class: "quiet", onclick: () => toggleLabelFilter(m.label) }, w.clear),
  ];
});

/** After the board is drawn: the cards without the label step back, and the bar says how many stay. */
export function paintLabelFilter(board: Board | undefined, canvas: HTMLElement): void {
  const by = board ? label : undefined;
  filterBar.hidden = by === undefined;
  if (board && by !== undefined) paintBar({ label: by, count: count(board, by), colours: shown().colours });
  const worn = new Set(
    board && by !== undefined ? board.elements.filter((e) => hasLabel(e, by)).map((e) => e.id) : [],
  );
  for (const g of canvas.querySelectorAll<SVGGElement>("g.card"))
    g.classList.toggle("is-filtered-out", by !== undefined && !worn.has(g.dataset.id ?? ""));
  // The chips of the Detail tab say which one holds, without a repaint that would take the keyboard off them.
  for (const chip of document.querySelectorAll<HTMLElement>(".label-filter-by"))
    chip.setAttribute("aria-pressed", String(filteredBy(chip.dataset.label ?? "")));
}
