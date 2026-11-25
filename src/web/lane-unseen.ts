/**
 * The cards of a column that are out of view (S306): a column that scrolls
 * alone says, in its drawing, how many of its cards are above and below its
 * window. Here they are counted to the reader, under its heading and at its
 * foot; pressed, a count brings the next few into view.
 */
import { findFormat, laneName } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import type { Board } from "../domain/workspace.ts";
import { h } from "./dom.ts";
import { scrollLane, settleWindow } from "./lane-scroll.ts";
import { locale } from "./locale.ts";

const WORDS: Record<
  Locale,
  { higher: (cards: number, lane: string) => string; lower: (cards: number, lane: string) => string }
> = {
  en: {
    higher: (cards, lane) => `${cards} card${cards > 1 ? "s" : ""} higher in ${lane}`,
    lower: (cards, lane) => `${cards} card${cards > 1 ? "s" : ""} lower in ${lane}`,
  },
  fr: {
    higher: (cards, lane) => `${cards} carte${cards > 1 ? "s" : ""} plus haut dans ${lane}`,
    lower: (cards, lane) => `${cards} carte${cards > 1 ? "s" : ""} plus bas dans ${lane}`,
  },
};
const w = WORDS[locale];

type Side = "above" | "below";

/** How many cards a count pressed brings into view: a few, so the reader keeps their place in the column. */
const FEW = 3;

const layer = h("div", { class: "unseen" });
/** The counts drawn, by lane and side: kept from one drawing to the next, so the keyboard stays on the one pressed. */
const chips = new Map<string, HTMLButtonElement>();
let shown: Board | undefined;
let listening: HTMLElement | undefined;
let later: () => void = () => {};

/** The count of one side of a column, drawn anew or brought up to date, where the column says it is on screen. */
function chip(side: Side, column: SVGRectElement, name: string, canvas: DOMRect): string {
  const lane = column.dataset.laneBox ?? "";
  const key = `${lane}|${side}`;
  const cards = Number(column.dataset[side] ?? 0);
  const box = column.getBoundingClientRect();
  const zoom = box.height / (Number(column.getAttribute("height")) || box.height);
  const button = chips.get(key) ?? h("button", { type: "button" });
  if (!chips.has(key)) {
    chips.set(key, button);
    layer.append(button);
  }
  const said = (side === "above" ? w.higher : w.lower)(cards, name);
  // Under the heading of the column, or at its foot: the room the layout keeps for it.
  const top = side === "above" ? box.top + 46 * zoom : box.bottom - 30 * zoom;
  button.className = `unseen-chip is-${side}`;
  button.style.cssText = `left: ${box.left + box.width / 2 - canvas.left}px; top: ${top - canvas.top}px`;
  button.setAttribute("aria-label", said);
  button.title = said;
  button.textContent = `${side === "above" ? "↑" : "↓"} ${cards}`;
  button.onclick = () => scrollLane(lane, Number(column.dataset.skip ?? 0), side === "above" ? -FEW : FEW);
  return key;
}

/** Draws the counts of every column that says cards are out of view; the keys of those drawn. */
function counts(canvas: HTMLElement, scroll: HTMLElement, board: Board): Set<string> {
  const kept = new Set<string>();
  const format = findFormat(board.format);
  const box = canvas.getBoundingClientRect();
  // A column says what is out of view only where it scrolls alone: a kanban's, a retro's, on screen.
  for (const column of scroll.querySelectorAll<SVGRectElement>("rect.lane-bg[data-lane-box]")) {
    const name = laneName(format, board, column.dataset.laneBox ?? "", locale);
    for (const side of ["above", "below"] as const)
      if (Number(column.dataset[side]) > 0) kept.add(chip(side, column, name, box));
  }
  return kept;
}

function draw(canvas: HTMLElement): void {
  const scroll = canvas.querySelector<HTMLElement>(".canvas-scroll");
  const kept = shown && scroll && !canvas.hidden ? counts(canvas, scroll, shown) : new Set<string>();
  for (const [key, button] of chips) {
    if (kept.has(key)) continue;
    button.remove();
    chips.delete(key);
  }
  settleWindow();
}

/** Follows the scroll and the size of what scrolls: one drawing a frame, whatever asks for it. */
function follow(canvas: HTMLElement, scroll: HTMLElement): void {
  listening = scroll;
  let waiting = false;
  later = (): void => {
    if (waiting) return;
    waiting = true;
    requestAnimationFrame(() => {
      waiting = false;
      draw(canvas);
    });
  };
  scroll.addEventListener("scroll", later, { passive: true });
  new ResizeObserver(later).observe(scroll);
}

/** Counts again what is out of sight; call it once the board is painted. It follows the scroll by itself. */
export function paintUnseen(canvas: HTMLElement, board: Board | undefined): void {
  shown = board;
  const scroll = canvas.querySelector<HTMLElement>(".canvas-scroll");
  // The board is mounted once: what scrolls is the same for the life of the page.
  if (scroll && listening !== scroll) follow(canvas, scroll);
  if (layer.parentElement !== canvas) canvas.append(layer);
  // The cards are where the painting put them once it has settled.
  later();
}
